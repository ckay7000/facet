import { Account, actions, type KeyPairString } from 'near-api-js';
import { configuration, contractId, dispatchPrivate, provider, send, view } from './chain.js';
import { InputError } from './http.js';
import { decode, FIELDS, hash, holderPublic, randomHex, signJson, validRequestShape } from '../shared/crypto.js';
import { MAX_ENCRYPTED_INPUT_BYTES, MAX_TEE_FILE_BYTES, approvalText, verifyApproval, verifyAgentRequest, maskFields, type AgentGrant, type PrivateApproval, type PrivateJob, type TeeConfig } from '../shared/agent.js';
import type { ChainRecord, SignedRequest, FieldId } from '../shared/types.js';

const API_URL = 'https://testnet-api.outlayer.ai';
const STORAGE_PRICE = 10n ** 19n;
const queues: Record<string, Promise<unknown>> = {};
let publicKeyCache: { key: string; scope: string; until: number } | null = null;
export type PrivateConfig = { ready: boolean; tee: TeeConfig | null; encryption_public_key: string; outlayer_api_url: string; max_file_bytes: number; message?: string };

async function settings() {
  const c = await configuration(), tee = c.contract?.tee;
  if (!tee?.configured || !process.env.FACET_BROKER_KEY || !process.env.FACET_AGENT_KEY || process.env.FACET_BROKER_ID !== tee.broker_id || process.env.FACET_AGENT_ID !== tee.agent_id) throw new InputError('The private testnet vault is not configured yet. Your local vault remains available.');
  return { config: c, tee };
}
export async function privateConfig(): Promise<PrivateConfig> {
  const blank: PrivateConfig = { ready: false, tee: null, encryption_public_key: '', outlayer_api_url: API_URL, max_file_bytes: MAX_TEE_FILE_BYTES };
  try {
    const { tee } = await settings(); blank.tee = tee;
    const scope = `${tee.project_id}:${tee.broker_id}`;
    if (!publicKeyCache || publicKeyCache.scope !== scope || publicKeyCache.until <= Date.now()) {
      const response = await fetch(`${API_URL}/secrets/pubkey`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessor: { type: 'Project', project_id: tee.project_id }, owner: tee.broker_id, secrets_json: '{"FACET_PACKET":""}' }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Keystore unavailable');
      const value = await response.json() as { pubkey?: string; owner?: string };
      if (!value.pubkey || !/^[a-f0-9]{64}$/.test(value.pubkey) || value.owner !== tee.broker_id) throw new Error('Unexpected keystore key');
      publicKeyCache = { key: value.pubkey, scope, until: Date.now() + 300000 };
    }
    return { ...blank, ready: true, encryption_public_key: publicKeyCache.key };
  } catch { return { ...blank, message: 'Private execution is temporarily unavailable. Your local encrypted vault remains available.' }; }
}

// Only a dedicated broker's own funded balance can pay secret-storage deposits.
// The agent key is function-call restricted to Facet.execute_agent on testnet.
async function roleCall(role: 'broker' | 'agent', receiver: string, method: string, args: object, deposit = 0n, gas = 250000000000000n) {
  const { tee } = await settings();
  if (!(role === 'broker' ? receiver === 'outlayer.testnet' && ['store_secrets', 'delete_secrets'].includes(method) : receiver === contractId() && method === 'execute_agent' && deposit === 0n)) throw new Error('Unsupported private relay action');
  const accountId = role === 'broker' ? tee.broker_id : tee.agent_id;
  const key = process.env[role === 'broker' ? 'FACET_BROKER_KEY' : 'FACET_AGENT_KEY'] as KeyPairString;
  const execute = async () => {
    if (role === 'agent') { const result = await dispatchPrivate(accountId, key, 'execute_agent', args, (args as { job_id: string }).job_id, gas); return { transaction: result.transaction, value: result.result }; }
    const response = await new Account(accountId, provider(), key).signAndSendTransaction({ receiverId: receiver, actions: [actions.functionCall(method, args, gas, deposit)], waitUntil: 'FINAL', throwOnFailure: false });
    const success = typeof response.status === 'object' && 'SuccessValue' in response.status;
    let value: unknown = null;
    if (success && typeof response.status === 'object' && 'SuccessValue' in response.status && response.status.SuccessValue) { try { value = JSON.parse(Buffer.from(response.status.SuccessValue, 'base64').toString()); } catch { /* void */ } }
    return { transaction: { hash: response.transaction.hash, method, success }, value };
  };
  const pending = (queues[role] || Promise.resolve()).then(execute, execute);
  queues[role] = pending.catch(() => undefined);
  return pending;
}

export function validPrivateApproval(a: unknown): a is PrivateApproval {
  if (!a || typeof a !== 'object') return false;
  const v = a as PrivateApproval;
  const keys = ['operation', 'job_id', 'token_id', 'packet_hash', 'fields_mask', 'expires_at', 'max_uses', 'purpose_hash', 'delivery_key_hash', 'auth_key', 'copy_hash', 'worker_hash', 'project_id'];
  if (Object.keys(v).length !== keys.length || !Object.keys(v).every(k => keys.includes(k)) || !['copy', 'grant'].includes(v.operation) || !/^[a-f0-9]{32}$/.test(v.job_id) || !/^facet_[a-f0-9]{32}$/.test(v.token_id) || ![v.packet_hash, v.purpose_hash, v.delivery_key_hash, v.auth_key, v.copy_hash, v.worker_hash].every(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)) || typeof v.project_id !== 'string' || !/^[a-z0-9._-]+\.testnet\/[a-z0-9-]+$/.test(v.project_id) || ![v.fields_mask, v.expires_at, v.max_uses].every(Number.isSafeInteger)) return false;
  if (v.operation === 'copy') return v.fields_mask === 0 && v.expires_at === 0 && v.max_uses === 0 && [v.purpose_hash, v.delivery_key_hash, v.auth_key, v.copy_hash].every(x => /^0{64}$/.test(x));
  return v.fields_mask > 0 && v.fields_mask <= 63 && v.max_uses >= 1 && v.max_uses <= 3 && v.expires_at > Date.now() && v.expires_at <= Date.now() + 15 * 60000;
}
export function validEncryptedPacket(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_ENCRYPTED_INPUT_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try { const bytes = decode(value); return bytes.length > 61 && bytes.length <= MAX_ENCRYPTED_INPUT_BYTES && bytes[0] === 1; } catch { return false; }
}
export async function signedAgentRequests(tokenId: string, fields: FieldId[], purpose: string, minutes: number, uses: number) {
  const { config, tee } = await settings();
  if (!/^facet_[a-f0-9]{32}$/.test(tokenId) || !Array.isArray(fields) || fields.length < 1 || new Set(fields).size !== fields.length || !fields.every(id => FIELDS.some(f => f.id === id)) || typeof purpose !== 'string' || !purpose.trim() || purpose.trim().length > 160 || ![5, 10, 15].includes(minutes) || !Number.isInteger(uses) || uses < 1 || uses > 3) throw new InputError('Choose credential fields, a purpose, five to fifteen minutes, and one to three executions.');
  const record = await view<ChainRecord | null>('get_record', { token_id: tokenId });
  if (!record || !record.private_copy || !config.issuer?.active || record.kind !== 'demo_issued' || record.revoked || record.expires_at <= Date.now()) throw new InputError('Store an active issuer-signed credential in the private vault first.');
  if (holderPublic(process.env.FACET_REQUEST_SEED!) !== config.request_public_key) throw new Error('Request key differs from registry');
  const created_at = Date.now(), expires_at = created_at + minutes * 60000;
  const requests: SignedRequest[] = Array.from({ length: uses }, () => { const payload = { version: 'facet-request-v1' as const, nonce: randomHex(), audience: tee.agent_id, purpose: purpose.trim(), fields, created_at, expires_at }; if (!validRequestShape({ payload, signature: '' })) throw new InputError('Invalid agent request.'); return { payload, signature: signJson(payload, process.env.FACET_REQUEST_SEED!) }; });
  return { requests, agent_id: tee.agent_id, expires_at, fields: maskFields(fields.reduce((m, id) => m | 1 << FIELDS.findIndex(f => f.id === id), 0)) };
}

export async function cleanPrivateIngress(job: PrivateJob) {
  if (!['copy', 'grant'].includes(job.kind) || !['ready', 'failed', 'blocked'].includes(job.state)) return;
  try {
    const { tee } = await settings();
    const query = await provider().query({ request_type: 'call_function', account_id: 'outlayer.testnet', method_name: 'get_secrets', args_base64: Buffer.from(JSON.stringify({ accessor: { Project: { project_id: job.project_id } }, profile: `f_${job.id}`, owner: tee.broker_id })).toString('base64'), finality: 'final' });
    if (!('result' in query) || !Array.isArray(query.result) || JSON.parse(Buffer.from(query.result).toString()) === null) return;
    await roleCall('broker', 'outlayer.testnet', 'delete_secrets', { accessor: { Project: { project_id: job.project_id } }, profile: `f_${job.id}` }, 0n, 50000000000000n);
  } catch { /* A failed cleanup does not change the sealed copy or permission. */ }
}

export async function submitPrivate(a: PrivateApproval, signature: string, encryptedInput: string, holderId: string) {
  const { tee } = await settings();
  if (!validPrivateApproval(a) || !validEncryptedPacket(encryptedInput) || a.worker_hash !== tee.worker_hash || a.project_id !== tee.project_id) throw new InputError('Approve an encrypted packet for the current private worker.');
  const record = await view<ChainRecord | null>('get_record', { token_id: a.token_id });
  if (!record || record.owner_id !== holderId || !verifyApproval(contractId(), a, signature, record.owner_id)) throw new InputError('The encrypted packet has no valid holder approval.');
  const existing = await view<PrivateJob | null>('get_private_job', { job_id: a.job_id });
  if (existing && (existing as PrivateJob & { approval_hash: string }).approval_hash !== hash(approvalText(contractId(), a))) throw new InputError('This request identifier already binds a different approval.');
  if (existing && existing.state !== 'staging') return { job: existing, transaction: null };
  const reserve = await send('issuer', 'reserve_private', { approval: a, holder_signature: signature }, 70000000000000n);
  if (!reserve.transaction.success || !reserve.result?.id) throw new InputError('NEAR declined this approval. Refresh the credential and permission limits.');
  const claim = await send('issuer', 'claim_private_ingress', { job_id: a.job_id }, 40000000000000n);
  if (!claim.transaction.success) return { job: await view<PrivateJob>('get_private_job', { job_id: a.job_id }), transaction: claim.transaction };
  try {
    const deposit = (BigInt(encryptedInput.length) + 2048n) * STORAGE_PRICE;
    const state = await provider().query({ request_type: 'view_account', account_id: tee.broker_id, finality: 'final' }) as { amount: string; storage_usage: number };
    if (BigInt(state.amount) < BigInt(state.storage_usage) * STORAGE_PRICE + deposit + 50000000000000000000000n) throw new InputError('The private testnet sponsor needs a refill. Your local document is still available.');
    const stored = await roleCall('broker', 'outlayer.testnet', 'store_secrets', {
      accessor: { Project: { project_id: a.project_id } }, profile: `f_${a.job_id}`, encrypted_secrets_base64: encryptedInput, vault_id: null,
      access: { Logic: { operator: 'And', conditions: [{ Predecessor: { condition: { Whitelist: { accounts: [contractId()] } } } }, { WasmHash: { hash: a.worker_hash } }, { ValidUntil: { until_ns: ((BigInt(Date.now()) + 10n * 60000n) * 1000000n).toString() } }] } },
    }, deposit, 100000000000000n);
    if (!stored.transaction.success) throw new InputError('Encrypted input storage was declined. Create a fresh request to retry.');
    const dispatched = await send('issuer', 'execute_private', { job_id: a.job_id }, 250000000000000n);
    if (!dispatched.transaction.success) throw new InputError('The permission expired or was revoked before private execution.');
    const job = dispatched.result as PrivateJob || await view<PrivateJob>('get_private_job', { job_id: a.job_id });
    await cleanPrivateIngress(job);
    return { job, transaction: dispatched.transaction, approval_transaction: reserve.transaction, ingress_transaction: stored.transaction };
  } catch (error) {
    const current = await view<PrivateJob>('get_private_job', { job_id: a.job_id });
    if (current?.state === 'uploading') { const failed = await send('issuer', 'fail_private_ingress', { job_id: a.job_id }, 40000000000000n); if (failed.transaction.success) await cleanPrivateIngress(failed.result); }
    throw error;
  }
}
export async function runAgent(grantId: string, jobId: string, signature: string) {
  if (!/^[a-f0-9]{32}$/.test(grantId) || !/^[a-f0-9]{32}$/.test(jobId) || !/^[a-f0-9]{128}$/.test(signature)) throw new InputError('Use a valid private agent access package.');
  const g = await view<AgentGrant | null>('get_agent_grant', { grant_id: grantId });
  if (!g || !verifyAgentRequest(grantId, jobId, signature, g.auth_key)) throw new InputError('This request has no approved agent capability.');
  const existing = await view<PrivateJob | null>('get_private_job', { job_id: jobId });
  if (existing) { if (existing.kind !== 'use' || existing.grant_id !== grantId) throw new InputError('This request identifier binds another permission.'); return { job: existing, transaction: null }; }
  if (!g.ready || g.revoked || g.expires_at <= Date.now() || g.used >= g.max_uses) throw new InputError('The agent permission is pending, revoked, expired, or exhausted.');
  const dispatched = await roleCall('agent', contractId(), 'execute_agent', { grant_id: grantId, job_id: jobId, request_signature: signature });
  if (!dispatched.transaction.success) throw new InputError('NEAR declined this agent execution. Refresh the permission.');
  return { job: dispatched.value as PrivateJob || await view<PrivateJob>('get_private_job', { job_id: jobId }), transaction: dispatched.transaction };
}

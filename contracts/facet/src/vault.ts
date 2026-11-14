import { near, assert, validateAccountId } from 'near-sdk-js';
declare const env: { ed25519_verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean };

const N = 10n ** 24n, TGAS = 10n ** 12n, COMPUTE = N / 50n;
type Host = { owner_id: string; issuer_account: string; issuer_active: boolean; request_public_key: string; tee_project_id: string; tee_worker_url: string; tee_worker_hash: string; tee_broker_id: string; tee_agent_id: string; tee_daily_limit: number; tee_day: string; tee_jobs_today: number; tee_jobs_total: number; records: number };
type Approval = { operation: 'copy' | 'grant'; job_id: string; token_id: string; packet_hash: string; fields_mask: number; expires_at: number; max_uses: number; purpose_hash: string; delivery_key_hash: string; auth_key: string; copy_hash: string; worker_hash: string; project_id: string };
type Grant = { id: string; owner_id: string; token_id: string; agent_id: string; fields_mask: number; expires_at: number; max_uses: number; used: number; purpose_hash: string; delivery_key_hash: string; auth_key: string; copy_hash: string; packet_hash: string; ready: boolean; revoked: boolean; created_at: number; worker_hash: string; project_id: string };
type Job = { id: string; kind: 'copy' | 'grant' | 'use' | 'recover'; owner_id: string; token_id: string; grant_id: string | null; packet_hash: string; state: string; created_at: number; output: any; error_code: string | null; usage_index?: number; recipient_public_key?: string; profile?: string; worker_hash: string; project_id: string; broker_id?: string; approval_hash?: string };
const load = <T = any>(key: string): T | null => { const s = near.storageRead(key); return s === null ? null : JSON.parse(s); };
const save = (key: string, value: unknown) => near.storageWrite(key, JSON.stringify(value));
const now = () => Number(near.blockTimestamp() / 1000000n);
const ascii = (s: string) => Uint8Array.from(s.split('').map(c => c.charCodeAt(0)));
const hexBytes = (s: string) => Uint8Array.from(s.match(/../g)!.map(v => parseInt(v, 16)));
const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
const opaque = (v: string) => assert(typeof v === 'string' && /^[a-f0-9]{64}$/.test(v), 'Invalid private commitment');
const jobId = (v: string) => assert(typeof v === 'string' && /^[a-f0-9]{32}$/.test(v), 'Invalid private request');
const record = (id: string) => { assert(/^facet_[a-f0-9]{32}$/.test(id), 'Invalid document record'); const r = load(`record:${id}`); assert(r, 'Document record not found'); return r; };
const emit = (event: string, data: unknown) => near.log('EVENT_JSON:' + JSON.stringify({ standard: 'facet', version: '1.0.0', event, data: [data] }));
function signed(message: string, signature: string, owner: string) { opaque(owner); assert(typeof signature === 'string' && /^[a-f0-9]{128}$/.test(signature) && env.ed25519_verify(hexBytes(signature), ascii(message), hexBytes(owner)), 'The required private approval signature is invalid'); }
function enabled(h: Host) { assert(h.tee_project_id && h.tee_worker_hash && h.tee_broker_id && h.tee_agent_id, 'Private execution is not configured'); }
// Upgraded registries predate these fields. Initialize only absent counters;
// retain all recorded limits and usage from previous private executions.
function counters(h: Host) { h.tee_day ??= ''; h.tee_jobs_today ??= 0; h.tee_jobs_total ??= 0; }
function quota(h: Host, reserve = N / 10n) { enabled(h); counters(h); const day = Math.floor(now() / 86400000).toString(); if (h.tee_day !== day) { h.tee_day = day; h.tee_jobs_today = 0; } assert(h.tee_jobs_today < h.tee_daily_limit && h.tee_jobs_total < 2048, 'The funded private demo allowance is full'); assert(near.accountBalance() > near.storageUsage() * (N / 100000n) + COMPUTE + reserve, 'The private demo sponsor needs a refill'); h.tee_jobs_today++; h.tee_jobs_total++; }
function validCredential(h: Host, r: any) { assert(h.issuer_active && r.kind === 'demo_issued' && !r.revoked && r.expires_at > now(), 'The credential is unverified, revoked, or expired'); }
export function teeConfig(h: Host) { return { configured: !!h.tee_project_id && !!h.tee_worker_hash, project_id: h.tee_project_id, worker_hash: h.tee_worker_hash, worker_url: h.tee_worker_url, outlayer_id: 'outlayer.testnet', broker_id: h.tee_broker_id, agent_id: h.tee_agent_id, daily_limit: h.tee_daily_limit, jobs_today: h.tee_day === Math.floor(now() / 86400000).toString() ? h.tee_jobs_today : 0 }; }
export function configureTee(h: Host, b: { project_id: string; worker_hash: string; worker_url: string; broker_id: string; agent_id: string; daily_limit?: number }) {
  assert(near.predecessorAccountId() === h.owner_id, 'Only the registry administrator can configure the private worker'); opaque(b.worker_hash);
  assert(typeof b.project_id === 'string' && b.project_id.length < 100 && /^[a-z0-9._-]+\.testnet\/[a-z0-9-]+$/.test(b.project_id), 'Use a dedicated testnet project');
  assert(typeof b.worker_url === 'string' && b.worker_url.startsWith('https://') && b.worker_url.endsWith(`${b.worker_hash}.wasm`) && b.worker_url.length < 240, 'Use the hash-pinned worker URL');
  assert(validateAccountId(b.broker_id) && b.broker_id.endsWith('.testnet') && validateAccountId(b.agent_id) && b.agent_id.endsWith('.testnet'), 'Use dedicated testnet identities');
  const cap = b.daily_limit ?? 32; assert(Number.isInteger(cap) && cap >= 1 && cap <= 100, 'Invalid private demo cap');
  counters(h);
  h.tee_project_id = b.project_id; h.tee_worker_url = b.worker_url; h.tee_worker_hash = b.worker_hash; h.tee_broker_id = b.broker_id; h.tee_agent_id = b.agent_id; h.tee_daily_limit = cap;
  return teeConfig(h);
}
function approvalText(a: Approval) { return ['facet-private-v1', near.currentAccountId(), a.operation, a.job_id, a.token_id, a.packet_hash, a.fields_mask, a.expires_at, a.max_uses, a.purpose_hash, a.delivery_key_hash, a.auth_key, a.copy_hash, a.worker_hash, a.project_id].join('\n'); }
export function reservePrivate(h: Host, a: Approval, signature: string) {
  enabled(h); assert(near.predecessorAccountId() === h.issuer_account, 'Only the sponsored relay may submit an approved private copy');
  jobId(a.job_id); for (const v of [a.packet_hash, a.purpose_hash, a.delivery_key_hash, a.auth_key, a.copy_hash, a.worker_hash]) opaque(v);
  assert(a.worker_hash === h.tee_worker_hash && a.project_id === h.tee_project_id, 'Approve the currently configured private worker');
  assert(a.operation === 'copy' || a.operation === 'grant', 'Invalid private operation'); const r = record(a.token_id); signed(approvalText(a), signature, r.owner_id);
  const approvalHash = toHex(near.sha256(ascii(approvalText(a))));
  const existing = load<Job>(`private_job:${a.job_id}`);
  if (existing) { assert(existing.approval_hash === approvalHash, 'Private request already binds different data'); return existing; }
  if (a.operation === 'grant') {
    validCredential(h, r); assert(r.private_copy?.packet_hash === a.copy_hash, 'Store the current private copy before granting agent access');
    assert(Number.isInteger(a.fields_mask) && a.fields_mask > 0 && a.fields_mask <= 63 && Number.isInteger(a.max_uses) && a.max_uses >= 1 && a.max_uses <= 3, 'Approve one to three uses and supported fields');
    assert(Number.isSafeInteger(a.expires_at) && a.expires_at > now() && a.expires_at <= now() + 15 * 60000, 'Choose a short-lived agent permission');
  } else assert(a.fields_mask === 0 && a.expires_at === 0 && a.max_uses === 0 && [a.purpose_hash, a.delivery_key_hash, a.auth_key, a.copy_hash].every(v => /^0{64}$/.test(v)), 'Invalid private copy approval');
  quota(h);
  const job: Job = { id: a.job_id, kind: a.operation, owner_id: r.owner_id, token_id: r.token_id, grant_id: a.operation === 'grant' ? a.job_id : null, packet_hash: a.packet_hash, state: 'staging', created_at: now(), output: null, error_code: null, profile: `f_${a.job_id}`, worker_hash: a.worker_hash, project_id: a.project_id, broker_id: h.tee_broker_id, approval_hash: approvalHash };
  if (a.operation === 'grant') { const g: Grant = { id: a.job_id, owner_id: r.owner_id, token_id: r.token_id, agent_id: h.tee_agent_id, fields_mask: a.fields_mask, expires_at: a.expires_at, max_uses: a.max_uses, used: 0, purpose_hash: a.purpose_hash, delivery_key_hash: a.delivery_key_hash, auth_key: a.auth_key, copy_hash: a.copy_hash, packet_hash: a.packet_hash, ready: false, revoked: false, created_at: now(), worker_hash: a.worker_hash, project_id: a.project_id }; save(`agent_grant:${g.id}`, g); }
  save(`private_job:${job.id}`, job); save(`private_index:${h.tee_jobs_total - 1}`, job.id); emit('private_request_approved', { job_id: job.id, token_id: job.token_id, kind: job.kind, packet_hash: job.packet_hash }); return job;
}
export function claimPrivateIngress(h: Host, id: string) { assert(near.predecessorAccountId() === h.issuer_account, 'Only the private relay may stage input'); jobId(id); const job = load<Job>(`private_job:${id}`); assert(job && job.state === 'staging', 'Private input is already claimed'); job.state = 'uploading'; save(`private_job:${id}`, job); return job; }
export function failPrivateIngress(h: Host, id: string) { assert(near.predecessorAccountId() === h.issuer_account, 'Only the private relay may close failed setup'); jobId(id); const job = load<Job>(`private_job:${id}`); assert(job && job.state === 'uploading', 'Private input is no longer in setup'); job.state = 'failed'; job.error_code = 'private_input_setup_failed'; save(`private_job:${id}`, job); return job; }
function execute(h: Host, job: Job, extra: object = {}, profile?: string) {
  const r = record(job.token_id), g = job.grant_id ? load<Grant>(`agent_grant:${job.grant_id}`) : null;
  const input = { schema: 'facet-tee-input-v1', operation: job.kind === 'copy' ? 'store_copy' : job.kind === 'grant' ? 'store_grant' : job.kind, facet_contract_id: near.currentAccountId(), job_id: job.id, owner_id: job.owner_id, token_id: job.token_id, packet_hash: job.packet_hash, record: r, request_public_key: h.request_public_key, grant: g, usage_index: job.usage_index ?? null, ...extra };
  const args = { source: { Project: { project_id: job.project_id, version_key: job.worker_hash } }, resource_limits: { max_instructions: 500000000, max_memory_mb: 128, max_execution_seconds: 45 }, response_format: 'Json', input_data: JSON.stringify(input), ...(profile ? { secrets_ref: { profile, account_id: job.broker_id } } : {}) };
  job.state = 'pending'; save(`private_job:${job.id}`, job);
  const p = near.promiseCreate('outlayer.testnet', 'request_execution', JSON.stringify(args), COMPUTE, 110n * TGAS);
  const done = near.promiseThen(p, near.currentAccountId(), 'on_private_execution', JSON.stringify({ job_id: job.id }), 0n, 60n * TGAS); near.promiseReturn(done);
}
export function executePrivate(h: Host, id: string) { enabled(h); assert(near.predecessorAccountId() === h.issuer_account, 'Only the sponsored relay may start an approved private copy'); jobId(id); const job = load<Job>(`private_job:${id}`); assert(job && (job.kind === 'copy' || job.kind === 'grant'), 'Private request not found'); if (job.state === 'pending' || job.state === 'ready' || job.state === 'failed') return job; assert(job.state === 'uploading', 'Claim private input before executing'); if (job.kind === 'grant') { const g = load<Grant>(`agent_grant:${id}`)!; assert(!g.revoked && g.expires_at > now(), 'The agent permission was revoked or expired'); validCredential(h, record(job.token_id)); } execute(h, job, {}, job.profile); }
export function executeAgent(h: Host, grantId: string, id: string, signature: string) {
  enabled(h); jobId(grantId); jobId(id); const g = load<Grant>(`agent_grant:${grantId}`); assert(g && near.predecessorAccountId() === g.agent_id, 'Only the approved agent can use this credential');
  signed(`facet-agent-request-v1\n${grantId}\n${id}`, signature, g.auth_key);
  const existing = load<Job>(`private_job:${id}`); if (existing) { assert(existing.kind === 'use' && existing.grant_id === grantId, 'Agent request already binds another permission'); return existing; }
  assert(g.ready && !g.revoked && g.expires_at > now() && g.used < g.max_uses, 'The agent permission is unavailable, revoked, expired, or exhausted'); validCredential(h, record(g.token_id)); quota(h);
  const job: Job = { id, kind: 'use', owner_id: g.owner_id, token_id: g.token_id, grant_id: g.id, packet_hash: g.packet_hash, state: 'pending', created_at: now(), output: null, error_code: null, usage_index: g.used++, worker_hash: g.worker_hash, project_id: g.project_id };
  save(`agent_grant:${g.id}`, g); save(`private_index:${h.tee_jobs_total - 1}`, id); execute(h, job);
}
export function revokeAgent(h: Host, id: string, signature: string) { enabled(h); jobId(id); const g = load<Grant>(`agent_grant:${id}`); assert(g, 'Agent permission not found'); signed(`facet-agent-revoke-v1\n${near.currentAccountId()}\n${id}`, signature, g.owner_id); g.revoked = true; save(`agent_grant:${id}`, g); emit('agent_permission_revoked', { grant_id: id, token_id: g.token_id }); return g; }
export function bindWallet(h: Host, wallet: string, holder: string, signature: string) { assert(near.predecessorAccountId() === h.issuer_account, 'Only the wallet authentication relay may record a binding'); assert(validateAccountId(wallet), 'Invalid wallet account'); signed(`facet-wallet-binding-v1\n${near.currentAccountId()}\n${wallet}\n${holder}`, signature, holder); const oldHolder = load<string>(`wallet_holder:${wallet}`), oldWallet = load<string>(`holder_wallet:${holder}`); assert((!oldHolder || oldHolder === holder) && (!oldWallet || oldWallet === wallet), 'This wallet or vault is already bound to another identity'); save(`wallet_holder:${wallet}`, holder); save(`holder_wallet:${holder}`, wallet); return { wallet_id: wallet, holder_id: holder }; }
export function walletRecords(h: Host, wallet: string) { assert(validateAccountId(wallet), 'Invalid wallet account'); const holder = load<string>(`wallet_holder:${wallet}`); if (!holder) return []; const out: any[] = []; for (let i = 0; i < h.records; i++) { const token = load<string>(`index:${i}`); if (token) { const r = record(token); if (r.owner_id === holder) out.push(r); } } return out; }
export function recoverCopy(h: Host, tokenId: string, id: string, publicKey: string) {
  enabled(h); jobId(id); opaque(publicKey); const r = record(tokenId); assert(r.private_copy && load<string>(`holder_wallet:${r.owner_id}`) === near.predecessorAccountId(), 'Only the connected owner wallet can recover this document');
  const existing = load<Job>(`private_job:${id}`); if (existing) { assert(existing.kind === 'recover' && existing.token_id === tokenId && existing.recipient_public_key === publicKey, 'Recovery request already binds another recipient'); return existing; }
  quota(h, 3n * N / 2n); const job: Job = { id, kind: 'recover', owner_id: r.owner_id, token_id: tokenId, grant_id: null, packet_hash: r.private_copy.packet_hash, state: 'pending', created_at: now(), output: null, error_code: null, recipient_public_key: publicKey, worker_hash: r.private_copy.worker_hash, project_id: r.private_copy.project_id }; save(`private_index:${h.tee_jobs_total - 1}`, id); execute(h, job, { recipient_public_key: publicKey, wallet_id: near.predecessorAccountId() });
}
export function getPrivateJob(id: string) { jobId(id); return load<Job>(`private_job:${id}`); }
export function getAgentGrant(id: string) { jobId(id); return load<Grant>(`agent_grant:${id}`); }
export function listAgentGrants(owner: string, from = 0, limit = 40, total = 0) { opaque(owner); assert(Number.isInteger(from) && from >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 100, 'Invalid permission pagination'); const out: Grant[] = []; let matched = 0; for (let i = 0; i < total && out.length < limit; i++) { const id = load<string>(`private_index:${i}`); if (id) { const g = load<Grant>(`agent_grant:${id}`); if (g?.owner_id === owner && matched++ >= from) out.push(g); } } return out; }
export function onPrivateExecution(h: Host, id: string) {
  assert(near.predecessorAccountId() === near.currentAccountId() && near.promiseResultsCount() === 1n, 'Only an authenticated execution callback is accepted');
  const job = load<Job>(`private_job:${id}`); assert(job && job.state === 'pending', 'Private execution is not pending'); let result: any;
  try { result = JSON.parse(near.promiseResult(0 as never)); } catch { result = null; }
  const operation = job.kind === 'copy' ? 'store_copy' : job.kind === 'grant' ? 'store_grant' : job.kind;
  const valid = result?.schema === 'facet-tee-output-v1' && result.job_id === id && result.operation === operation && (job.kind === 'copy' || job.kind === 'grant' ? result.stored === true && result.packet_hash === job.packet_hash : typeof result.ciphertext === 'string' && result.ciphertext.length < 250000 && (job.kind !== 'use' || result.grant_id === job.grant_id && result.usage_index === job.usage_index));
  if (!valid) { job.state = 'failed'; job.error_code = result?.code && /^[a-z_]{1,64}$/.test(result.code) ? result.code : 'private_execution_failed'; }
  else {
    if (job.kind === 'copy') { const r = record(job.token_id); r.private_copy = { packet_hash: job.packet_hash, job_id: id, stored_at: now(), worker_hash: job.worker_hash, project_id: job.project_id }; save(`record:${r.token_id}`, r); }
    if (job.kind === 'grant') { const g = load<Grant>(`agent_grant:${id}`)!; g.ready = true; save(`agent_grant:${id}`, g); }
    if (job.kind === 'use') { const g = load<Grant>(`agent_grant:${job.grant_id}`)!; const r = record(job.token_id); if (g.revoked || g.expires_at <= now() || r.revoked || r.expires_at <= now() || !h.issuer_active) { job.state = 'blocked'; job.error_code = 'permission_changed_during_execution'; } }
    if (job.state !== 'blocked') { job.state = 'ready'; job.output = result; }
  }
  save(`private_job:${id}`, job); emit('private_execution_recorded', { job_id: id, token_id: job.token_id, kind: job.kind, state: job.state, worker_hash: job.worker_hash }); return job;
}

import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Account, actions, type KeyPairString } from 'near-api-js';
import * as bbs from '@digitalbazaar/bbs-signatures';
import { canonical, checkPresentation, credentialHeader, decode, demoMessages, derivePresentation, encode, hash, holderPublic, randomHex, rememberIssuer, signJson, SUITE, utf8 } from '../shared/crypto.js';
import { documentCommitment } from '../shared/vault.js';
import { agentAuthPublic, openAgentDelivery, openOwnerDelivery, recoveryKeys, revokeText, sealToKeystore, signAgentRequest, signApproval, signText, walletBindingText, type AgentGrant, type CopyPacket, type GrantPacket, type PrivateApproval, type PrivateJob } from '../shared/agent.js';
import type { ChainRecord, Credential, DocumentItem, Issuer, SignedRequest } from '../shared/types.js';
import { cleanPrivateIngress, privateConfig, runAgent, submitPrivate } from '../server/tee.js';
import { view as facetView } from '../server/chain.js';
import { CurlProvider } from './curl-rpc.js';
import { closeBridge } from './tool-bridge.js';

await mkdir('.local', { recursive: true, mode: 0o700 });
const saved = JSON.parse(await readFile('.local/accounts.json', 'utf8')), deployed = JSON.parse(await readFile('deployments/private-testnet.json', 'utf8'));
const id = saved.checks.account_id, rpc = new CurlProvider('https://near-testnet.drpc.org'), admin = new Account(id, rpc, saved.checks.secret_key as KeyPairString), outsider = new Account(saved.root.account_id, rpc, saved.root.secret_key as KeyPairString), agent = new Account(saved.agent_checks.account_id, rpc, saved.agent_checks.secret_key as KeyPairString), wallet = new Account(saved.wallet.account_id, rpc, saved.wallet.secret_key as KeyPairString);
Object.assign(process.env, { FACET_CONTRACT_ID: id, FACET_ISSUER_ID: id, FACET_ISSUER_KEY: saved.checks.secret_key, FACET_VERIFIER_ID: id, FACET_VERIFIER_KEY: saved.checks.secret_key, FACET_BBS_SECRET: saved.bbs.secret_key, FACET_REQUEST_SEED: saved.request_seed, FACET_BROKER_ID: saved.broker.account_id, FACET_BROKER_KEY: saved.broker.secret_key, FACET_AGENT_ID: saved.agent_checks.account_id, FACET_AGENT_KEY: saved.agent_checks.secret_key, FACET_RPC_URL: 'https://near-testnet.drpc.org' });
let seed: string; try { seed = JSON.parse(await readFile('.local/live-tee-holder.json', 'utf8')).holder_seed; } catch { seed = randomHex(32); await writeFile('.local/live-tee-holder.json', JSON.stringify({ holder_seed: seed }), { mode: 0o600 }); }
const checks: string[] = [], transactions: { method: string; hash: string; success: boolean }[] = [], jobs: { id: string; kind: string; state: string; request_id: string | null; worker_hash: string }[] = [];
const pass = (message: string) => { checks.push(message); console.log('Passed:', message); };
async function call(method: string, args: object, success = true, signer = admin, receiver = id, deposit = 0n, gas = success && ['execute_agent', 'recover_private_copy'].includes(method) ? 250000000000000n : 100000000000000n) {
  // Server-side setup uses the same isolated issuer key. Refresh its nonce
  // instead of retaining an Account nonce from before those transactions.
  const fresh = new Account(signer.accountId, rpc, signer.getSigner());
  const r = await fresh.signAndSendTransaction({ receiverId: receiver, actions: [actions.functionCall(method, args, gas, deposit)], waitUntil: 'FINAL', throwOnFailure: false });
  const ok = typeof r.status === 'object' && 'SuccessValue' in r.status;
  assert.equal(ok, success, `${method}: ${JSON.stringify(r.status)}`); transactions.push({ method, hash: r.transaction.hash, success: ok });
  return ok && typeof r.status === 'object' && 'SuccessValue' in r.status && r.status.SuccessValue ? JSON.parse(Buffer.from(r.status.SuccessValue, 'base64').toString()) : null;
}
async function read<T = any>(method: string, args: object = {}): Promise<T> { const r: any = await rpc.query({ request_type: 'call_function', account_id: id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64'), finality: 'final' }); return JSON.parse(Buffer.from(r.result).toString()); }
async function finished(job: PrivateJob) {
  const deadline = Date.now() + 180000;
  while (!['ready', 'failed', 'blocked'].includes(job.state)) { assert.ok(Date.now() < deadline, 'Private job completion timeout'); await new Promise(resolve => setTimeout(resolve, 2000)); job = await read('get_private_job', { job_id: job.id }); }
  await cleanPrivateIngress(job);
  assert.equal(job.state, 'ready', `Private worker refused ${job.kind} ${job.id}: ${job.error_code}`);
  assert.ok(job.output?.outlayer_request_id, 'The live TEE must report its OutLayer request ID');
  jobs.push({ id: job.id, kind: job.kind, state: job.state, request_id: job.output!.outlayer_request_id || null, worker_hash: job.worker_hash }); return job;
}
const zero = '0'.repeat(64);
try {
  const config = await privateConfig(); assert.ok(config.ready && config.tee && config.encryption_public_key, 'Live keystore and private execution must be ready');
  assert.equal(config.tee.worker_hash, deployed.worker_hash); pass('Live NEAR configuration names the exact published worker and dedicated agent');
  await call('on_private_execution', { job_id: randomHex() }, false); pass('The private callback refuses a direct call without an authenticated promise result');
  const owner = holderPublic(seed);
  await call('bind_holder_wallet', { wallet_id: saved.wallet.account_id, holder_id: owner, holder_signature: signText(walletBindingText(id, saved.wallet.account_id, owner), seed) });
  assert.equal(await read('get_wallet_holder', { account_id: saved.wallet.account_id }), owner); pass('Holder signature binds the dedicated owner wallet on NEAR');
  const reuseId = process.argv[process.argv.indexOf('--reuse-copy') + 1];
  const reuse = process.argv.includes('--reuse-copy') ? await read<PrivateJob>('get_private_job', { job_id: reuseId }) : null;
  if (reuse) assert.ok(reuse.kind === 'copy' && reuse.state === 'ready' && reuse.owner_id === owner && reuse.worker_hash === config.tee.worker_hash, 'Reuse only a confirmed copy for this isolated holder and worker');
  const data = encode(utf8('Fictional Facet document for live private credential checks.')), salt = randomHex(32), tokenId = reuse?.token_id || 'facet_' + randomHex();
  let record: ChainRecord = reuse ? await read('get_record', { token_id: tokenId }) : await call('mint_record', { token_id: tokenId, owner_id: owner, commitment: documentCommitment(data, salt), kind: 'demo_issued', expires_at: Date.now() + 86400000 });
  const issuer: Issuer = await read('get_issuer'); rememberIssuer(issuer);
  const messages = demoMessages(record), header = credentialHeader(id, tokenId, issuer.id);
  const credential: Credential = { token_id: tokenId, issuer_id: issuer.id, signature: encode(await bbs.sign({ secretKey: decode(saved.bbs.secret_key), publicKey: decode(issuer.public_key), messages: messages.map(utf8), header: decode(header), ciphersuite: SUITE })), messages, header, record };
  const document: DocumentItem = { id: tokenId, title: 'Fictional live TEE check', filename: 'facet-private-check.txt', mime: 'text/plain', data, salt, commitment: record.commitment, created_at: Date.now(), record, credential, issuance_tx: null };
  const copy: CopyPacket = { version: 'facet-private-copy-v1', holder_seed: seed, document };
  const copyApproval: PrivateApproval = { operation: 'copy', job_id: reuse?.id || randomHex(), token_id: tokenId, packet_hash: reuse?.packet_hash || hash(canonical(copy)), fields_mask: 0, expires_at: 0, max_uses: 0, purpose_hash: zero, delivery_key_hash: zero, auth_key: zero, copy_hash: zero, worker_hash: config.tee.worker_hash, project_id: config.tee.project_id };
  await call('reserve_private', { approval: copyApproval, holder_signature: signApproval(id, copyApproval, randomHex(32)) }, false);
  await call('reserve_private', { approval: copyApproval, holder_signature: signApproval(id, copyApproval, seed) }, false, outsider);
  const wrongBuild = { ...copyApproval, worker_hash: randomHex(32) }; await call('reserve_private', { approval: wrongBuild, holder_signature: signApproval(id, wrongBuild, seed) }, false);
  pass('NEAR rejects a wrong holder, unauthorized relay and substituted worker before private storage');
  const stored = await submitPrivate(copyApproval, signApproval(id, copyApproval, seed), sealToKeystore(reuse ? { receipt_only: true } : copy, config.encryption_public_key), owner);
  if (stored.transaction) transactions.push(stored.transaction);
  const copyJob = await finished(stored.job); assert.equal(copyJob.output?.packet_hash, copyApproval.packet_hash);
  record = await read('get_record', { token_id: tokenId }); assert.equal(record.private_copy?.packet_hash, copyApproval.packet_hash);
  pass('A real OutLayer execution validates and seals the encrypted document/credential copy');
  const retry = await submitPrivate(copyApproval, signApproval(id, copyApproval, seed), sealToKeystore(reuse ? { receipt_only: true } : copy, config.encryption_public_key), owner); assert.equal(retry.job.id, copyJob.id); assert.equal(retry.transaction, null);
  pass('Repeating a completed signed copy request does not spend a new ingress deposit');
  const ingress: any = await rpc.query({ request_type: 'call_function', account_id: 'outlayer.testnet', method_name: 'get_secrets', args_base64: Buffer.from(JSON.stringify({ accessor: { Project: { project_id: config.tee.project_id } }, profile: `f_${copyApproval.job_id}`, owner: saved.broker.account_id })).toString('base64'), finality: 'final' }); assert.equal(JSON.parse(Buffer.from(ingress.result).toString()), null);
  pass('Consumed encrypted ingress is deleted while the sealed project copy remains available');

  async function grant(uses: number, lifetime = 600000) {
    const grantId = randomHex(), deliveryKey = randomHex(32), now = Date.now(), expires = now + lifetime;
    const requests: SignedRequest[] = Array.from({ length: uses }, () => { const payload = { version: 'facet-request-v1' as const, nonce: randomHex(), audience: config.tee!.agent_id, purpose: 'Verify fictional privacy training', fields: ['course', 'achievement'] as ('course' | 'achievement')[], created_at: now, expires_at: expires }; return { payload, signature: signJson(payload, saved.request_seed) }; });
    const presentations = []; for (const request of requests) presentations.push(await derivePresentation(credential, request, seed));
    const packet: GrantPacket = { version: 'facet-private-grant-v1', grant_id: grantId, owner_id: owner, token_id: tokenId, copy_hash: copyApproval.packet_hash, delivery_key: deliveryKey, presentations };
    const approval: PrivateApproval = { operation: 'grant', job_id: grantId, token_id: tokenId, packet_hash: hash(canonical(packet)), fields_mask: 3, expires_at: expires, max_uses: uses, purpose_hash: hash(requests[0].payload.purpose), delivery_key_hash: hash(deliveryKey), auth_key: agentAuthPublic(deliveryKey), copy_hash: packet.copy_hash, worker_hash: config.tee!.worker_hash, project_id: config.tee!.project_id };
    const response = await submitPrivate(approval, signApproval(id, approval, seed), sealToKeystore(packet, config.encryption_public_key), owner);
    if (response.transaction) transactions.push(response.transaction); await finished(response.job);
    return { id: grantId, deliveryKey, expires, approval };
  }
  const permission = await grant(2); pass('Browser-compatible BBS presentations persist under a two-execution NEAR permission');
  const badJob = randomHex();
  await call('execute_agent', { grant_id: permission.id, job_id: badJob, request_signature: signAgentRequest(permission.id, badJob, permission.deliveryKey) }, false, outsider);
  await call('execute_agent', { grant_id: permission.id, job_id: badJob, request_signature: '00'.repeat(64) }, false, agent);
  assert.equal((await read<AgentGrant>('get_agent_grant', { grant_id: permission.id })).used, 0);
  pass('A different agent or invalid request capability cannot consume the permission');
  let firstJobId = '';
  for (let index = 0; index < 2; index++) {
    const jobId = randomHex(); if (!index) firstJobId = jobId;
    const response = await runAgent(permission.id, jobId, signAgentRequest(permission.id, jobId, permission.deliveryKey));
    const job = await finished(response.job); if (response.transaction) transactions.push(response.transaction);
    assert.equal(job.output!.usage_index, index);
    assert.ok(!JSON.stringify(job).includes(seed) && !JSON.stringify(job).includes('Avery') && !JSON.stringify(job).includes('92 / 100'));
    const proof = await openAgentDelivery(job.output!, permission.deliveryKey);
    assert.deepEqual(proof.disclosed.map(d => d.index), [0,1,2,3,4,8,9]);
    assert.ok(!canonical(proof).includes('Avery') && !canonical(proof).includes('92 / 100'));
    assert.ok((await checkPresentation(proof, record, issuer, saved.request_seed ? holderPublic(saved.request_seed) : '', id)).every(c => c.ok));
    await call('record_verification', { nonce_hash: hash(proof.request.payload.nonce), token_id: tokenId, proof_hash: hash(canonical(proof)), expires_at: proof.request.payload.expires_at });
  }
  pass('Separate TEE executions read the saved credential and deliver only approved, verifiable BBS claims');
  const retried = await runAgent(permission.id, firstJobId, signAgentRequest(permission.id, firstJobId, permission.deliveryKey)); assert.equal(retried.job.id, firstJobId); assert.equal((await read<AgentGrant>('get_agent_grant', { grant_id: permission.id })).used, 2);
  pass('Replaying the same agent job retrieves its receipt without increasing usage');
  const exhaustedJob = randomHex(); await call('execute_agent', { grant_id: permission.id, job_id: exhaustedJob, request_signature: signAgentRequest(permission.id, exhaustedJob, permission.deliveryKey) }, false, agent); pass('NEAR refuses a third execution after the allowance is used');

  const revocable = await grant(1);
  await call('revoke_agent', { grant_id: revocable.id, holder_signature: signText(revokeText(id, revocable.id), randomHex(32)) }, false);
  await call('revoke_agent', { grant_id: revocable.id, holder_signature: signText(revokeText(id, revocable.id), seed) });
  const revokedJob = randomHex(); await call('execute_agent', { grant_id: revocable.id, job_id: revokedJob, request_signature: signAgentRequest(revocable.id, revokedJob, revocable.deliveryKey) }, false, agent); pass('Only the holder can revoke; a revoked permission refuses future TEE dispatch');
  const expiring = await grant(1, 180000);
  while (Date.now() <= expiring.expires + 1500) { const remaining = expiring.expires + 1600 - Date.now(); await new Promise(resolve => setTimeout(resolve, Math.min(remaining, 10000))); }
  const expiredJob = randomHex(); await call('execute_agent', { grant_id: expiring.id, job_id: expiredJob, request_signature: signAgentRequest(expiring.id, expiredJob, expiring.deliveryKey) }, false, agent); pass('An actually expired onchain grant refuses further execution');

  const recipient = recoveryKeys(), recoveryId = randomHex();
  await call('recover_private_copy', { token_id: tokenId, job_id: recoveryId, recipient_public_key: recipient.public_key }, false, outsider);
  const recoveryJob = await finished(await call('recover_private_copy', { token_id: tokenId, job_id: recoveryId, recipient_public_key: recipient.public_key }, true, wallet));
  const recovered = await openOwnerDelivery(recoveryJob.output!, recipient.secret); if (reuse) { assert.ok(recovered.holder_seed === seed && recovered.document.id === tokenId && hash(canonical(recovered)) === copyApproval.packet_hash); assert.equal(documentCommitment(recovered.document.data, recovered.document.salt), record.commitment); } else assert.ok(canonical(recovered) === canonical(copy));
  await assert.rejects(openOwnerDelivery(recoveryJob.output!, recoveryKeys().secret));
  pass('Only the bound wallet recovers the document and holder key; a different recipient key cannot decrypt');
  const listed = await read<ChainRecord[]>('list_wallet_records', { account_id: saved.wallet.account_id }); assert.ok(listed.some(r => r.token_id === tokenId)); assert.ok(!canonical(listed).includes(document.filename) && !canonical(listed).includes('Avery'));
  pass('Wallet lookup reveals public records without originals or hidden credential claims');
  const direct = await call('request_execution', { source: { Project: { project_id: config.tee.project_id, version_key: config.tee.worker_hash } }, resource_limits: { max_instructions: 500000000, max_memory_mb: 128, max_execution_seconds: 45 }, response_format: 'Json', input_data: JSON.stringify({ schema: 'facet-tee-input-v1', facet_contract_id: id, operation: 'recover', owner_id: owner, token_id: tokenId, job_id: randomHex(), packet_hash: copyApproval.packet_hash, recipient_public_key: recipient.public_key }) }, true, outsider, 'outlayer.testnet', 20000000000000000000000n);
  assert.equal(direct.code, 'caller_refused'); pass('A direct OutLayer call cannot impersonate the Facet contract or open its storage cell');
  await call('revoke_record', { token_id: tokenId });
  const afterRevocation = { ...revocable.approval, job_id: randomHex(), expires_at: Date.now() + 600000 }; await call('reserve_private', { approval: afterRevocation, holder_signature: signApproval(id, afterRevocation, seed) }, false); pass('Current credential revocation blocks fresh agent grants');
  const report = { status: 'passed', network: 'testnet', contract_id: id, main_contract_id: saved.contract.account_id, project_id: config.tee.project_id, worker_hash: config.tee.worker_hash, checked_at: new Date().toISOString(), fixture: 'All documents and issuer claims are fictional; NEAR transactions and OutLayer executions are real.', reused_copy_job: reuse?.id || null, checks, jobs, transactions, limits: { original_file_bytes: 65536, maximum_grant_executions: 3, maximum_grant_minutes: 15 }, attestation: 'OutLayer execution IDs are recorded. Facet does not independently verify the full TDX attestation chain.' };
  await writeFile('deployments/private-checks.json', JSON.stringify(report, null, 2));
  console.log('Passed all', checks.length, 'live NEAR and TEE checks.');
} catch (error) {
  await writeFile('.local/private-live-failure.json', JSON.stringify({ status: 'failed', network: 'testnet', contract_id: id, worker_hash: deployed.worker_hash, reused_copy_job: process.argv.includes('--reuse-copy') ? process.argv[process.argv.indexOf('--reuse-copy') + 1] : null, checked_at: new Date().toISOString(), error: (error as Error).message, checks, jobs, transactions }, null, 2), { mode: 0o600 });
  throw error;
} finally { closeBridge(); }

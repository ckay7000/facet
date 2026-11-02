import { Account, KeyPair, actions } from 'near-api-js';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { CurlProvider } from './curl-rpc.js';
import { closeBridge } from './tool-bridge.js';
import { randomHex, hash } from '../shared/crypto.js';
const saved = JSON.parse(await readFile('.local/accounts.json', 'utf8')), rpc = new CurlProvider();
const id = saved.checks.account_id, admin = new Account(id, rpc, saved.checks.secret_key), outsider = new Account(saved.root.account_id, rpc, saved.root.secret_key);
const checks: string[] = [], transactions: any[] = [];
async function view(method: string, args: object = {}) { const r: any = await rpc.query({ request_type: 'call_function', account_id: id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64'), finality: 'final' }); return JSON.parse(Buffer.from(r.result).toString()); }
async function call(method: string, args: object, success = true, signer = admin, deposit = 0n) {
  const r = await signer.signAndSendTransaction({ receiverId: id, actions: [actions.functionCall(method, args, 100000000000000n, deposit)], waitUntil: 'FINAL', throwOnFailure: false });
  const ok = typeof r.status === 'object' && 'SuccessValue' in r.status;
  assert.equal(ok, success, `${method}: ${JSON.stringify(r.status)}`); transactions.push({ method, hash: r.transaction.hash, success: ok });
  return ok && typeof r.status === 'object' && 'SuccessValue' in r.status && r.status.SuccessValue ? JSON.parse(Buffer.from(r.status.SuccessValue, 'base64').toString()) : null;
}
try {
  const token_id = 'facet_' + randomHex(), owner_id = randomHex(32), commitment = randomHex(32), expires_at = Date.now() + 86400000;
  const minted = await call('mint_record', { token_id, owner_id, commitment, kind: 'demo_issued', expires_at }); assert.equal(minted.owner_id, owner_id); checks.push('Registered issuer mints a holder-bound demo credential');
  const repeated = await call('mint_record', { token_id, owner_id, commitment, kind: 'demo_issued', expires_at }); assert.equal(repeated.issued_at, minted.issued_at); checks.push('Identical mint retries preserve the original record');
  await call('mint_record', { token_id, owner_id: randomHex(32), commitment, kind: 'demo_issued', expires_at }, false); checks.push('Mint retries cannot change the holder');
  await call('mint_record', { token_id: 'facet_' + randomHex(), owner_id, commitment, kind: 'demo_issued', expires_at }, false, outsider); checks.push('Unregistered accounts cannot mint credentials');
  await call('revoke_record', { token_id }, false, outsider); checks.push('Unregistered accounts cannot revoke credentials');
  const nft = await view('nft_token', { token_id }); assert.equal(nft.owner_id, owner_id); assert.equal(nft.metadata.media, null); assert.ok(!JSON.stringify(nft).includes('Avery')); assert.ok(!JSON.stringify(nft).includes('92 / 100')); checks.push('Public NFT metadata excludes filenames, documents and personal claims');
  await call('nft_transfer', { token_id, receiver_id: saved.root.account_id }, false, admin, 1n); await call('nft_approve', { token_id, account_id: saved.root.account_id }, false, admin, 1n); checks.push('Transfers and marketplace approvals refuse credential resale');
  const nonce_hash = hash(randomHex()), proof_hash = randomHex(32), requestExpiry = Date.now() + 600000;
  await call('record_verification', { token_id, nonce_hash, proof_hash, expires_at: requestExpiry }, false, outsider); checks.push('Only the designated verification relay records checks');
  await call('record_verification', { token_id, nonce_hash, proof_hash, expires_at: requestExpiry }); const receipt = await view('get_verification', { nonce_hash }); assert.equal(receipt.proof_hash, proof_hash); checks.push('A valid relay result records a publicly inspectable proof hash');
  await call('record_verification', { token_id, nonce_hash, proof_hash, expires_at: requestExpiry }, false); checks.push('A verification nonce cannot be reused');
  await call('record_verification', { token_id, nonce_hash: hash(randomHex()), proof_hash, expires_at: Date.now() - 1000 }, false); checks.push('Expired verification requests are refused');
  await call('set_issuer_active', { active: false }, false, outsider); await call('set_issuer_active', { active: false });
  await call('record_verification', { token_id, nonce_hash: hash(randomHex()), proof_hash, expires_at: requestExpiry }, false); await call('set_issuer_active', { active: true }); checks.push('Only the admin controls issuer trust; suspension blocks verification');
  await call('revoke_record', { token_id }); await call('record_verification', { token_id, nonce_hash: hash(randomHex()), proof_hash, expires_at: requestExpiry }, false); assert.equal((await view('get_record', { token_id })).revoked, true); checks.push('Live revocation blocks subsequent verification');
  const self = 'facet_' + randomHex(); await call('mint_record', { token_id: self, owner_id, commitment: randomHex(32), kind: 'self_recorded', expires_at: 0 }); await call('record_verification', { token_id: self, nonce_hash: hash(randomHex()), proof_hash, expires_at: requestExpiry }, false); checks.push('Self-recorded documents cannot verify qualifications');
  await call('mint_record', { token_id: 'facet_' + randomHex(), owner_id, commitment, kind: 'demo_issued', expires_at: Date.now() - 1000 }, false); checks.push('Already expired credentials cannot be minted');
  assert.equal(await view('nft_supply_for_owner', { account_id: owner_id }), '2'); assert.equal((await view('nft_tokens_for_owner', { account_id: owner_id, limit: 10 })).length, 2); checks.push('NFT owner enumeration returns the holder’s records');
  const report = { status: 'passed', network: 'testnet', contract_id: id, checked_at: new Date().toISOString(), checks, transactions }; await writeFile('deployments/contract-checks.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { closeBridge(); }

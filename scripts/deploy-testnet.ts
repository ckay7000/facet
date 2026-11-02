import { Account, KeyPair, actions, parseNearAmount } from 'near-api-js';
import type { KeyPairString } from 'near-api-js';
import * as bbs from '@digitalbazaar/bbs-signatures';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { CurlProvider, curlJson } from './curl-rpc.js';
import { bridgeRequest, closeBridge } from './tool-bridge.js';
import { encode, holderPublic, SUITE } from '../shared/crypto.js';
await mkdir('.local', { recursive: true, mode: 0o700 });
const file = '.local/accounts.json'; let saved: any;
try { saved = JSON.parse(await readFile(file, 'utf8')); } catch {
  const bbsKey = await bbs.generateKeyPair({ ciphersuite: SUITE });
  saved = { root: { account_id: 'facet-lab-1102.testnet', secret_key: KeyPair.fromRandom('ed25519').toString(), created: false }, checks: { account_id: 'facet-checks-1102.testnet', secret_key: KeyPair.fromRandom('ed25519').toString(), created: false }, bbs: { secret_key: encode(bbsKey.secretKey), public_key: encode(bbsKey.publicKey) }, request_seed: randomBytes(32).toString('hex') };
  await writeFile(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
}
const rpc = new CurlProvider();
for (const role of ['root', 'checks']) {
  const identity = saved[role]; if (identity.created) continue;
  const body = { newAccountId: identity.account_id, newAccountPublicKey: KeyPair.fromString(identity.secret_key).getPublicKey().toString() };
  const result = process.env.FACET_TOOL_BRIDGE === '1' ? await bridgeRequest('https://helper.testnet.near.org/account', 'POST', body) : await curlJson('https://helper.testnet.near.org/account', body);
  if (result.error) throw new Error('The faucet did not create the dedicated account.'); identity.created = true;
  await writeFile(file, JSON.stringify(saved, null, 2), { mode: 0o600 }); console.log('Created dedicated testnet account:', identity.account_id);
}
const root = new Account(saved.root.account_id, rpc, saved.root.secret_key as KeyPairString);
const transactions: string[] = [];
async function send(signer: Account, receiverId: string, transactionActions: any[]) {
  const result = await signer.signAndSendTransaction({ receiverId, actions: transactionActions, waitUntil: 'FINAL', throwOnFailure: false });
  if (typeof result.status !== 'object' || !('SuccessValue' in result.status)) throw new Error('Deployment transaction refused: ' + JSON.stringify(result.status));
  transactions.push(result.transaction.hash); console.log('Confirmed:', result.transaction.hash); return result;
}
const contractId = `credentials.${saved.root.account_id}`;
for (const [role, prefix, balance, methods] of [['contract', 'credentials', '6.5', []], ['issuer', 'issuer', '0.4', ['mint_record', 'revoke_record']], ['verifier', 'verifier', '0.4', ['record_verification']]] as const) {
  if (saved[role]) continue; const key = KeyPair.fromRandom('ed25519'), account_id = `${prefix}.${saved.root.account_id}`;
  await send(root, account_id, [actions.createAccount(), actions.transfer(BigInt(parseNearAmount(balance)!)), methods.length ? actions.addFunctionCallAccessKey(key.getPublicKey(), contractId, [...methods], BigInt(parseNearAmount('0.3')!)) : actions.addFullAccessKey(key.getPublicKey())]);
  saved[role] = { account_id, secret_key: key.toString() }; await writeFile(file, JSON.stringify(saved, null, 2), { mode: 0o600 }); console.log('Created isolated role:', role, account_id);
}
const binary = await readFile('contracts/facet/build/facet.wasm'), wasmHash = createHash('sha256').update(binary).digest('hex');
for (const role of ['contract', 'checks']) {
  const identity = saved[role], account = new Account(identity.account_id, rpc, identity.secret_key), state: any = await rpc.query({ request_type: 'view_account', account_id: identity.account_id, finality: 'final' });
  if (state.code_hash === '11111111111111111111111111111111') {
    await send(account, account.accountId, [actions.deployContract(binary), actions.functionCall('init', { owner_id: role === 'contract' ? saved.root.account_id : identity.account_id, issuer_account: role === 'contract' ? saved.issuer.account_id : identity.account_id, verifier_account: role === 'contract' ? saved.verifier.account_id : identity.account_id, issuer_key: saved.bbs.public_key, request_public_key: holderPublic(saved.request_seed), daily_cap: 40 }, 60000000000000n, 0n)]);
  } else {
    const code: any = await rpc.query({ request_type: 'view_code', account_id: identity.account_id, finality: 'final' });
    if (createHash('sha256').update(Buffer.from(code.code_base64, 'base64')).digest('hex') !== wasmHash) throw new Error('Existing code differs. Use a fresh deployment rather than overwriting it.');
  }
}
const permissions: any = {};
for (const role of ['issuer', 'verifier']) {
  const state: any = await rpc.query({ request_type: 'view_access_key', account_id: saved[role].account_id, public_key: KeyPair.fromString(saved[role].secret_key).getPublicKey().toString(), finality: 'final' });
  if (state.permission?.FunctionCall?.receiver_id !== contractId) throw new Error('Hosted key restriction did not match the contract.'); permissions[role] = state.permission;
}
const environment = { FACET_CONTRACT_ID: contractId, FACET_ISSUER_ID: saved.issuer.account_id, FACET_ISSUER_KEY: saved.issuer.secret_key, FACET_VERIFIER_ID: saved.verifier.account_id, FACET_VERIFIER_KEY: saved.verifier.secret_key, FACET_BBS_SECRET: saved.bbs.secret_key, FACET_REQUEST_SEED: saved.request_seed, FACET_RPC_URL: 'https://test.rpc.fastnear.com' };
await writeFile('.env.local', Object.entries(environment).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
await writeFile('deployments/testnet.json', JSON.stringify({ network: 'testnet', contract_id: contractId, checks_contract_id: saved.checks.account_id, root_id: saved.root.account_id, issuer_id: saved.issuer.account_id, verifier_id: saved.verifier.account_id, permissions, issuer_public_key: saved.bbs.public_key, request_public_key: holderPublic(saved.request_seed), wasm_sha256: wasmHash, wasm_bytes: binary.length, source_sha256: createHash('sha256').update(await readFile('contracts/facet/src/index.ts')).digest('hex'), transactions, deployed_at: new Date().toISOString() }, null, 2));
console.log('Facet contracts deployed with restricted hosted keys.'); closeBridge();

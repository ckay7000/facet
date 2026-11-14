import { Account, KeyPair, actions, type KeyPairString } from 'near-api-js';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { CurlProvider } from './curl-rpc.js';
import { closeBridge } from './tool-bridge.js';

type Identity = { account_id: string; secret_key: string };
const N = 10n ** 24n, TGAS = 10n ** 12n, rpc = new CurlProvider('https://near-testnet.drpc.org');
const saved: Record<string, any> = JSON.parse(await readFile('.local/accounts.json', 'utf8'));
if (saved.root.account_id !== 'facet-lab-1102.testnet' || saved.checks.account_id !== 'facet-checks-1102.testnet' || saved.contract.account_id !== 'credentials.facet-lab-1102.testnet') throw new Error('Use Facet’s isolated testnet deployment.');
const account = (identity: Identity) => new Account(identity.account_id, rpc, identity.secret_key as KeyPairString);
const root = account(saved.root), checks = account(saved.checks), transactions: { method: string; receiver_id: string; hash: string }[] = [];
const persist = () => writeFile('.local/accounts.json', JSON.stringify(saved, null, 2), { mode: 0o600 });
async function viewAt<T = any>(id: string, method: string, args: object = {}): Promise<T> { const response: any = await rpc.query({ request_type: 'call_function', account_id: id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64'), finality: 'final' }); return JSON.parse(Buffer.from(response.result).toString()); }
async function send(signer: Account, id: string, actionList: any[], method: string) {
  const response = await signer.signAndSendTransaction({ receiverId: id, actions: actionList, waitUntil: 'FINAL', throwOnFailure: false });
  if (typeof response.status !== 'object' || !('SuccessValue' in response.status)) throw new Error(`Testnet deployment declined ${method}: ${JSON.stringify(response.status)}`);
  transactions.push({ method, receiver_id: id, hash: response.transaction.hash }); console.log('Confirmed', method, id, response.transaction.hash); return response;
}
const call = (signer: Account, id: string, method: string, args: object, deposit = 0n, gas = 100n * TGAS) => send(signer, id, [actions.functionCall(method, args, gas, deposit)], method);
function identity(role: string, id: string) { if (!saved[role]) saved[role] = { account_id: id, secret_key: KeyPair.fromRandom('ed25519').toString() }; if (saved[role].account_id !== id) throw new Error('Unexpected role identity'); return saved[role] as Identity; }
const issuerMethods = ['mint_record', 'revoke_record', 'reserve_private', 'claim_private_ingress', 'fail_private_ingress', 'execute_private', 'revoke_agent', 'bind_holder_wallet'];
const relayId = `relay.${saved.root.account_id}`, agentId = `agent.${saved.checks.account_id}`;
const issuerAdmin = identity('issuer_admin', relayId), issuer = identity('issuer_private', relayId), broker = identity('broker', `broker.${saved.checks.account_id}`), agentAdmin = identity('agent_admin', agentId), agent = identity('agent', agentId), agentChecks = identity('agent_checks', agentId), wallet = identity('wallet', `wallet.${saved.checks.account_id}`);
await persist();
async function exists(id: string) { try { await rpc.query({ request_type: 'view_account', account_id: id, finality: 'final' }); return true; } catch (e) { if ((e as Error).message.includes('UNKNOWN_ACCOUNT') || (e as Error).message.includes('does not exist')) return false; throw e; } }
async function create(signer: Account, admin: Identity, amount: bigint, extras: any[] = []) {
  if (await exists(admin.account_id)) { await rpc.query({ request_type: 'view_access_key', account_id: admin.account_id, public_key: KeyPair.fromString(admin.secret_key as KeyPairString).getPublicKey().toString(), finality: 'final' }); return; }
  await send(signer, admin.account_id, [actions.createAccount(), actions.transfer(amount), actions.addFullAccessKey(KeyPair.fromString(admin.secret_key as KeyPairString).getPublicKey()), ...extras], 'create_dedicated_account');
}
async function topUp(signer: Account, id: string, target: bigint) { const state: any = await rpc.query({ request_type: 'view_account', account_id: id, finality: 'final' }); const amount = target - BigInt(state.amount); if (amount > 0n) await send(signer, id, [actions.transfer(amount)], 'fund_testnet_demo'); }

await mkdir('public/wasm', { recursive: true });
const wasm = await readFile('workers/target/wasm32-wasip2/release/facet-private-vault.wasm'), workerHash = createHash('sha256').update(wasm).digest('hex');
const wasmUrl = `https://facet-near.vercel.app/wasm/${workerHash}.wasm`, projectId = `${saved.root.account_id}/facet-vault`;
await writeFile(`public/wasm/${workerHash}.wasm`, wasm);
const metadata = { network: 'testnet', contract_id: saved.contract.account_id, checks_contract_id: saved.checks.account_id, outlayer_id: 'outlayer.testnet', project_id: projectId, worker_hash: workerHash, worker_url: wasmUrl, worker_bytes: wasm.length, manifest: JSON.parse(await readFile('workers/manifest.json', 'utf8')), broker_id: broker.account_id, agent_id: agent.account_id, wallet_fixture_id: wallet.account_id, outlayer_api_url: 'https://testnet-api.outlayer.ai', daily_limit: 32, max_file_bytes: 65536, compute_deposit: (N / 50n).toString(), prepared_at: new Date().toISOString(), transactions };

try {
  if (process.argv.includes('--prepare')) {
    await create(root, issuerAdmin, 4n * N / 10n, [actions.addFunctionCallAccessKey(KeyPair.fromString(issuer.secret_key as KeyPairString).getPublicKey(), saved.contract.account_id, issuerMethods, 6n * N / 10n)]);
    await create(checks, broker, 2n * N);
    await create(checks, agentAdmin, 4n * N / 10n, [actions.addFunctionCallAccessKey(KeyPair.fromString(agent.secret_key as KeyPairString).getPublicKey(), saved.contract.account_id, ['execute_agent'], 6n * N / 10n), actions.addFunctionCallAccessKey(KeyPair.fromString(agentChecks.secret_key as KeyPairString).getPublicKey(), saved.checks.account_id, ['execute_agent'], 6n * N / 10n)]);
    await create(checks, wallet, N / 4n);
    await topUp(root, saved.contract.account_id, 75n * N / 10n);
    await topUp(root, saved.checks.account_id, 79n * N / 10n);
    await writeFile('deployments/private-testnet.json', JSON.stringify(metadata, null, 2));
    console.log('Prepared dedicated NEAR testnet roles and hash-named WASI worker. Publish the web artifact, then run --activate.');
  } else if (process.argv.includes('--activate')) {
    const published = await fetch(wasmUrl); if (!published.ok || createHash('sha256').update(Buffer.from(await published.arrayBuffer())).digest('hex') !== workerHash) throw new Error('Publish and verify the exact worker URL before registering it.');
    const source = { WasmUrl: { url: wasmUrl, hash: workerHash, build_target: 'wasm32-wasip2' } };
    let project = await viewAt('outlayer.testnet', 'get_project', { project_id: projectId });
    if (!project) { await call(root, 'outlayer.testnet', 'create_project', { name: 'facet-vault', source }, N / 10n); project = await viewAt('outlayer.testnet', 'get_project', { project_id: projectId }); }
    if (project.owner !== saved.root.account_id) throw new Error('Unexpected OutLayer project owner');
    let version = await viewAt('outlayer.testnet', 'get_version', { project_id: projectId, version_key: workerHash });
    if (!version) { await call(root, 'outlayer.testnet', 'add_version', { project_name: 'facet-vault', source, set_active: true }, N / 10n); version = await viewAt('outlayer.testnet', 'get_version', { project_id: projectId, version_key: workerHash }); }
    if (version.wasm_hash !== workerHash) throw new Error('The registered version differs from the compiled worker');
    if (project.active_version !== workerHash) await call(root, 'outlayer.testnet', 'set_active_version', { project_name: 'facet-vault', version_key: workerHash });
    const binary = await readFile('contracts/facet/build/facet.wasm'), contractHash = createHash('sha256').update(binary).digest('hex');
    for (const role of ['checks', 'contract']) {
      const signer = account(saved[role]), id = saved[role].account_id, before = await viewAt(id, 'get_config');
      const code: any = await rpc.query({ request_type: 'view_code', account_id: id, finality: 'final' });
      if (createHash('sha256').update(Buffer.from(code.code_base64, 'base64')).digest('hex') !== contractHash) await send(signer, id, [actions.deployContract(binary)], 'upgrade_without_reinitializing');
      const after = await viewAt(id, 'get_config');
      if (before.records !== after.records || before.checks !== after.checks || before.request_public_key !== after.request_public_key) throw new Error('Upgrade must preserve the existing collection and request key');
      await call(role === 'checks' ? signer : root, id, 'configure_tee', { project_id: projectId, worker_hash: workerHash, worker_url: wasmUrl, broker_id: broker.account_id, agent_id: agent.account_id, daily_limit: role === 'checks' ? 100 : 32 });
    }
    await call(root, saved.contract.account_id, 'set_issuer_relay', { account_id: issuer.account_id });
    if (!saved.issuer_legacy) saved.issuer_legacy = saved.issuer;
    saved.issuer = issuer; await persist();
    for (const [admin, keyIdentity, receiver, methods] of [[issuerAdmin, issuer, saved.contract.account_id, issuerMethods], [agentAdmin, agent, saved.contract.account_id, ['execute_agent']], [agentAdmin, agentChecks, saved.checks.account_id, ['execute_agent']]] as [Identity, Identity, string, string[]][]) {
      const publicKey = KeyPair.fromString(keyIdentity.secret_key as KeyPairString).getPublicKey();
      const state: any = await rpc.query({ request_type: 'view_access_key', account_id: keyIdentity.account_id, public_key: publicKey.toString(), finality: 'final' });
      if (state.permission?.FunctionCall?.receiver_id !== receiver || state.permission.FunctionCall.method_names.join(',') !== methods.join(',')) throw new Error('Keep the existing role method restrictions.');
      if (BigInt(state.permission.FunctionCall.allowance || '0') < 35n * N / 100n) await send(account(admin), keyIdentity.account_id, [actions.deleteKey(publicKey), actions.addFunctionCallAccessKey(publicKey, receiver, methods, 6n * N / 10n)], 'refill_restricted_testnet_gas_allowance');
    }
    const environment: Record<string, string> = Object.fromEntries((await readFile('.env.local', 'utf8')).trim().split('\n').filter(Boolean).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
    Object.assign(environment, { FACET_ISSUER_ID: issuer.account_id, FACET_ISSUER_KEY: issuer.secret_key, FACET_BROKER_ID: broker.account_id, FACET_BROKER_KEY: broker.secret_key, FACET_AGENT_ID: agent.account_id, FACET_AGENT_KEY: agent.secret_key, FACET_RPC_URL: 'https://near-testnet.drpc.org' });
    await writeFile('.env.local', Object.entries(environment).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
    const permissions: Record<string, any> = {};
    for (const role of ['issuer', 'agent']) { const key = KeyPair.fromString(saved[role].secret_key as KeyPairString).getPublicKey().toString(); const state: any = await rpc.query({ request_type: 'view_access_key', account_id: saved[role].account_id, public_key: key, finality: 'final' }); if (state.permission?.FunctionCall?.receiver_id !== saved.contract.account_id) throw new Error('Hosted permission restriction differs'); permissions[role] = state.permission; }
    const previous = JSON.parse(await readFile('deployments/testnet.json', 'utf8'));
    const sourceHashes: Record<string, string> = {}; for (const file of ['contracts/facet/src/index.ts', 'contracts/facet/src/vault.ts', 'contracts/facet/src/native-ed25519.c.inc', 'contracts/facet/scripts/prepare-sdk.mjs', 'workers/src/lib.rs', 'workers/src/main.rs', 'workers/Cargo.lock']) sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
    await writeFile('deployments/testnet.json', JSON.stringify({ ...previous, issuer_id: issuer.account_id, permissions: { ...previous.permissions, issuer: permissions.issuer, agent: permissions.agent }, wasm_sha256: contractHash, wasm_bytes: binary.length, source_files_sha256: sourceHashes, private_upgrade: { at: new Date().toISOString(), preserved_collection: true, transactions }, tee: metadata }, null, 2));
    await writeFile('deployments/private-testnet.json', JSON.stringify({ ...metadata, permissions, contract_hash: contractHash, source_files_sha256: sourceHashes, activated_at: new Date().toISOString(), transactions }, null, 2));
    console.log('Activated NEAR wallet grants, native signature checks and pinned private worker. Redeploy the hosted app with the updated restricted relay keys.');
  } else throw new Error('Choose --prepare or --activate.');
} finally { closeBridge(); }

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { Account, KeyPair, actions, type KeyPairString } from 'near-api-js';
import { canonical, encode, holderPublic } from '../shared/crypto.js';
import { openVault } from '../shared/vault.js';
import { nep413Digest, type WalletChallenge } from '../shared/wallet-auth.js';
import type { VaultEnvelope, VerificationResult } from '../shared/types.js';
import { readAgentPackage, useAgentAccess } from './agent-client.js';
import { CurlProvider } from './curl-rpc.js';
import { closeBridge } from './tool-bridge.js';

const baseURL = process.env.FACET_BASE_URL || 'http://127.0.0.1:5370';
const base = new URL(baseURL), password = 'facet-private-browser-fixture-password';
const recoveryPassword = 'facet-private-browser-new-password';
const saved = JSON.parse(await readFile('.local/accounts.json', 'utf8'));
const walletKey = KeyPair.fromString(saved.wallet.secret_key as KeyPairString);
const accountId = saved.wallet.account_id, contractId = saved.contract.account_id;
const wallet = new Account(accountId, new CurlProvider('https://near-testnet.drpc.org'), saved.wallet.secret_key as KeyPairString);
const identityFile = '.local/private-browser-identity.json';
await mkdir('.local/ui-checks', { recursive: true, mode: 0o700 });
const checks: string[] = [], transactions: { method: string; hash: string }[] = [];
const screenshots: string[] = [], errors: string[] = [], sent: { path: string; body: string }[] = [];
let stage = 'start';
const pass = (message: string) => { checks.push(message); console.log('Passed:', message); };
const short = (s: string) => `${s.slice(0, 8)}…${s.slice(-6)}`;

// The dedicated wallet key remains in Node. The page receives signatures only.
// This harness verifies NEAR Connect's injected-wallet flow; it is not a manual
// Meteor or Intear wallet compatibility claim.
async function injectWallet(context: BrowserContext) {
  await context.exposeBinding('__facetTestWallet', async ({ page }, input: any) => {
    assert.equal(new URL(page.url()).origin, base.origin, 'Wallet calls must originate from the tested Facet app');
    const params = input.params;
    if (input.method === 'signMessage') {
      assert.equal(params.network, 'testnet');
      assert.equal(params.recipient, base.host);
      assert.equal(params.callbackUrl, `${base.origin}/vault`);
      assert.ok(params.message.startsWith('Sign in to Facet on NEAR testnet.'));
      const challenge: WalletChallenge = { message: params.message, nonce: encode(Uint8Array.from(params.nonce)), recipient: params.recipient, callbackUrl: params.callbackUrl, state: params.state, expires_at: Date.now() + 60000 };
      return { accountId, publicKey: walletKey.getPublicKey().toString(), signature: encode(walletKey.sign(nep413Digest(challenge)).signature), state: params.state };
    }
    assert.equal(input.method, 'recover');
    assert.equal(params.network, 'testnet');
    assert.equal(params.signerId, accountId);
    assert.equal(params.receiverId, contractId);
    assert.equal(params.actions.length, 1);
    const action = params.actions[0];
    assert.equal(action.type, 'FunctionCall');
    assert.equal(action.params.methodName, 'recover_private_copy');
    assert.equal(action.params.deposit, '0');
    assert.equal(action.params.gas, '250000000000000');
    const result = await wallet.signAndSendTransaction({ receiverId: contractId, actions: [actions.functionCall('recover_private_copy', action.params.args, 250000000000000n, 0n)], waitUntil: 'FINAL', throwOnFailure: false });
    assert.ok(typeof result.status === 'object' && 'SuccessValue' in result.status, 'Owner wallet recovery must succeed on NEAR');
    transactions.push({ method: 'recover_private_copy', hash: result.transaction.hash });
    return result;
  });
  const initialize = ({ accountId, publicKey, origin }: { accountId: string; publicKey: string; origin: string }) => {
    let signedIn = false;
    const sign = (params: any) => (window as any).__facetTestWallet({ method: 'signMessage', params: { ...params, nonce: Array.from(params.nonce) } });
    const testWallet = {
      manifest: { id: 'facet-test-wallet', name: 'Facet test wallet', type: 'injected', version: '1.0.0', website: origin, icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E%3Crect width="32" height="32" rx="8" fill="%235e62ff"/%3E%3C/svg%3E', features: { testnet: true, signMessage: true, signInAndSignMessage: true, signAndSendTransaction: true }, permissions: {}, platform: {} },
      signIn: async () => { signedIn = true; return [{ accountId, publicKey }]; },
      signInAndSignMessage: async (params: any) => { const signedMessage = await sign({ ...params.messageParams, network: params.network }); signedIn = true; return [{ accountId, publicKey, signedMessage }]; },
      signMessage: sign,
      signOut: async () => { signedIn = false; },
      getAccounts: async () => signedIn ? [{ accountId, publicKey }] : [],
      signAndSendTransaction: async (params: any) => (window as any).__facetTestWallet({ method: 'recover', params }),
    };
    window.addEventListener('near-selector-ready', () => window.dispatchEvent(new CustomEvent('near-wallet-injected', { detail: testWallet })));
  };
  // tsx preserves function names with an esbuild helper inside serialized
  // callbacks. Supply that test-only helper before the injected code runs.
  await context.addInitScript({ content: `globalThis.__name = (fn) => fn; (${initialize.toString()})(${JSON.stringify({ accountId, publicKey: walletKey.getPublicKey().toString(), origin: base.origin })});` });
}
function watch(page: Page) {
  page.setDefaultTimeout(45000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) sent.push({ path: new URL(request.url()).pathname, body: request.postData() || '' }); });
}
async function fit(page: Page) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The agent page must fit the viewport'); }
async function screenshot(page: Page, name: string) { const path = `.local/ui-checks/${base.protocol === 'https:' ? 'hosted' : 'local'}-${name}.png`; await page.screenshot({ path, fullPage: true, animations: 'disabled' }); screenshots.push(path); }
async function visit(page: Page, path: string) {
  const link = page.locator(`a[href="${path}"]:visible`).first();
  await link.click(); await page.waitForURL(`${base.origin}${path}`);
}
async function downloaded(scope: Page | ReturnType<Page['locator']>, page: Page, name: string) {
  const pending = page.waitForEvent('download'); void pending.catch(() => {}); await scope.getByRole('button', { name, exact: true }).click();
  const file = await pending, path = await file.path(); assert.ok(path); const data = await readFile(path); await file.delete(); return data;
}
async function postFromClick(page: Page, click: () => Promise<void>, path: string, matches: (body: any) => boolean) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/${path}` && r.request().method() === 'POST' && matches(r.request().postDataJSON()), { timeout: 180000 });
  void response.catch(() => {});
  await click(); const value = await response, result = await value.json(); assert.ok(value.ok(), result.error || 'Facet API request must succeed'); return result;
}
async function connect(page: Page) {
  const pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/wallet' && r.request().postDataJSON()?.operation === 'finish', { timeout: 90000 });
  void pending.catch(() => {});
  await page.getByRole('button', { name: 'Connect NEAR wallet', exact: true }).click();
  await page.getByText('Facet test wallet', { exact: true }).click();
  const response = await pending; assert.ok(response.ok(), 'Signed wallet login must succeed');
  const state = await response.json(); assert.equal(state.wallet.account_id, accountId);
  await page.getByText('Wallet authenticated', { exact: true }).waitFor();
  const cookie = (await page.context().cookies()).find(c => c.name === 'facet_wallet');
  assert.ok(cookie?.httpOnly && (base.protocol !== 'https:' || cookie.secure), 'Wallet session cookies must be HttpOnly and secure when hosted');
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
let recoveryContext: BrowserContext | undefined;
try {
  await injectWallet(context); const page = await context.newPage(); watch(page);
  stage = 'vault identity'; await page.goto('/vault', { waitUntil: 'domcontentloaded' });
  let identity: VaultEnvelope | null = null;
  try { identity = JSON.parse(await readFile(identityFile, 'utf8')); } catch { /* first fixture run */ }
  if (identity) {
    await page.locator('input[type=file]').setInputFiles({ name: 'facet-private-identity.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(identity)) });
    await page.getByLabel('Vault password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Restore vault', exact: true }).click();
  } else {
    await page.getByLabel('Vault password', { exact: true }).fill(password); await page.getByLabel('Confirm password').fill(password);
    await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Encrypted backup', exact: true }).waitFor();
  if (!identity) { identity = JSON.parse((await downloaded(page, page, 'Encrypted backup')).toString()); await writeFile(identityFile, JSON.stringify(identity), { mode: 0o600 }); }
  const identityData = (await openVault(identity!, password)).data;
  pass('The browser creates or restores the same encrypted holder fixture without exposing its key');

  stage = 'wallet authentication'; await visit(page, '/agents'); await connect(page);
  const walletState = await (await page.request.get('/api/wallet')).json();
  if (!walletState.holder_id) {
    const binding = await postFromClick(page, () => page.getByRole('button', { name: 'Bind wallet to this vault', exact: true }).click(), 'wallet', b => b.operation === 'bind');
    transactions.push({ method: 'bind_holder_wallet', hash: binding.transaction.hash });
  } else assert.equal(walletState.holder_id, holderPublic(identityData.holder_seed), 'The fixture wallet must bind the saved holder identity');
  await page.getByText('This wallet is bound to your unlocked vault.', { exact: false }).waitFor();
  pass('NEAR Connect signs a real NEP-413 login and the holder binding is confirmed on NEAR');

  stage = 'credential issuance'; await visit(page, '/vault');
  const issue = await postFromClick(page, () => page.getByRole('button', { name: 'Issue demo credential', exact: true }).click(), 'action', b => b.step === 'execute');
  transactions.push({ method: 'mint_record', hash: issue.transaction.hash });
  await page.getByRole('button', { name: 'Prove selected fields', exact: true }).waitFor();
  const backup = JSON.parse((await downloaded(page, page, 'Encrypted backup')).toString());
  const local = (await openVault(backup, password)).data, document = local.documents.find(d => d.id === issue.record.token_id)!;
  assert.ok(document?.credential, 'The fictional credential must have a real issuer signature');
  pass('A fictional issuer-signed credential is created through the hosted restricted NEAR relay');

  stage = 'private copy'; await visit(page, '/agents');
  const storeButton = page.getByRole('button', { name: 'Save private TEE copy', exact: true });
  assert.ok(await storeButton.isDisabled(), 'Private storage must require explicit consent');
  await page.getByLabel('I approve storing this document, credential and holder key', { exact: false }).check();
  const stored = await postFromClick(page, () => storeButton.click(), 'agent', b => b.operation === 'store' && b.approval.operation === 'copy');
  transactions.push({ method: 'execute_private_copy', hash: stored.transaction.hash });
  await page.getByText('Private TEE copy recorded', { exact: true }).waitFor({ timeout: 180000 });
  pass('Explicit consent encrypts the original, credential and holder key before real persistent TEE storage');

  stage = 'agent approval'; await page.getByLabel('Agent execution allowance').selectOption('2'); await page.getByLabel('Agent permission duration').selectOption('15');
  assert.equal(await page.locator('.agent-preview .hidden').count(), 4);
  await page.getByLabel('I approve only the selected facts', { exact: false }).check();
  const granted = await postFromClick(page, () => page.getByRole('button', { name: 'Approve agent permission', exact: true }).click(), 'agent', b => b.operation === 'store' && b.approval.operation === 'grant');
  transactions.push({ method: 'execute_private_grant', hash: granted.transaction.hash });
  const grantId = granted.job.id, card = page.locator('.agent-grant').filter({ hasText: short(grantId) });
  await card.getByText('Active', { exact: true }).waitFor({ timeout: 180000 });
  assert.equal(await card.locator('.field-chips .badge').count(), 2);
  const exported = await downloaded(card, page, 'Export private agent access');
  const accessFile = '.local/private-browser-agent-access.json'; await writeFile(accessFile, exported, { mode: 0o600 });
  const access = await readAgentPackage(accessFile); assert.deepEqual(access.access.fields, ['course', 'achievement']);
  pass('The holder approves exactly two fields, an expiry and two executions on NEAR');

  stage = 'demo agent';
  const verified: VerificationResult = await postFromClick(page, () => card.getByRole('button', { name: 'Run demo agent', exact: true }).click(), 'verify', b => !!b.presentation);
  assert.ok(verified.accepted && verified.checks.every(c => c.ok));
  assert.deepEqual(verified.claims.map(c => c.field), ['course', 'achievement']);
  transactions.push({ method: 'record_verification', hash: verified.transaction!.hash });
  await page.getByRole('heading', { name: 'The agent proved your approved facts.', exact: true }).waitFor();
  const useBodies = sent.filter(r => r.path === '/api/verify').map(r => r.body);
  assert.ok(useBodies.length && useBodies.every(b => !b.includes('Avery') && !b.includes('92 / 100')));
  await fit(page); await screenshot(page, 'agent-approved-desktop');
  await page.setViewportSize({ width: 390, height: 844 }); await fit(page); await screenshot(page, 'agent-approved-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  pass('The demo agent receives only approved BBS claims with a live NEAR verification receipt');

  stage = 'external agent while locked'; await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await page.getByRole('heading', { name: 'Unlock your vault to approve an agent.', exact: true }).waitFor();
  const external = await useAgentAccess(baseURL, access);
  assert.deepEqual(external.verification.claims.map(c => c.field), ['course', 'achievement']);
  assert.ok(!canonical(external.proof).includes(local.holder_seed) && !canonical(external.proof).includes('Avery') && !canonical(external.proof).includes(document.data));
  transactions.push({ method: 'external_execute_agent', hash: external.transaction!.hash }, { method: 'external_record_verification', hash: external.verification.transaction!.hash });
  await assert.rejects(useAgentAccess(baseURL, access), /exhausted|unavailable|permission/i);
  pass('An independent walletless agent uses the saved TEE credential while the local vault is locked; a third execution is refused');

  stage = 'revocation'; await visit(page, '/vault'); await page.getByLabel('Vault password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock vault', exact: true }).click(); await page.getByRole('button', { name: 'Encrypted backup', exact: true }).waitFor();
  await visit(page, '/agents');
  const revoked = await postFromClick(page, () => page.locator('.agent-grant').filter({ hasText: short(grantId) }).getByRole('button', { name: 'Revoke permission', exact: true }).click(), 'agent', b => b.operation === 'revoke');
  transactions.push({ method: 'revoke_agent', hash: revoked.transaction.hash });
  await page.locator('.agent-grant').filter({ hasText: short(grantId) }).getByText('Revoked', { exact: true }).waitFor();
  await assert.rejects(useAgentAccess(baseURL, access), /revoked|unavailable|permission/i);
  pass('The holder revokes access from the UI and the external capability stops working');

  stage = 'new-device wallet recovery'; recoveryContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await injectWallet(recoveryContext); const mobile = await recoveryContext.newPage(); watch(mobile); await mobile.goto('/agents', { waitUntil: 'domcontentloaded' });
  await connect(mobile);
  const recoveryRow = mobile.locator('.recovery-records > div').filter({ hasText: short(document.id) });
  await recoveryRow.getByRole('button', { name: 'Recover copy', exact: true }).click();
  await mobile.getByLabel('Recovered vault password').waitFor({ timeout: 180000 });
  await mobile.getByLabel('Recovered vault password').fill(recoveryPassword); await mobile.getByLabel('Confirm recovered vault password').fill(recoveryPassword);
  await mobile.getByRole('button', { name: 'Create vault from recovery', exact: true }).click();
  await mobile.waitForURL(`${base.origin}/vault`); await mobile.getByRole('button', { name: 'Download original', exact: true }).waitFor();
  const restoredBackup = JSON.parse((await downloaded(mobile, mobile, 'Encrypted backup')).toString());
  const restored = (await openVault(restoredBackup, recoveryPassword)).data;
  assert.ok(restored.holder_seed === local.holder_seed, 'Wallet recovery must restore the original holder identity');
  assert.ok(restored.documents.find(d => d.id === document.id)?.data === document.data, 'The recovered original must match the saved file bytes');
  assert.ok(!restored.agent_access?.length && restored.receipts.length === 0, 'Recovery must not invent local consent history or old agent capabilities');
  await fit(mobile); await screenshot(mobile, 'wallet-recovered-mobile');
  pass('A separate browser recovers the saved document and holder key using only the owner wallet, then chooses a new password');

  stage = 'privacy checks';
  for (const request of sent) {
    assert.ok(!request.body.includes(password) && !request.body.includes(recoveryPassword), 'Passwords must never appear in API requests');
    assert.ok(!request.body.includes(local.holder_seed) && !request.body.includes(document.data) && !request.body.includes(document.filename), 'Holder keys and original documents must reach the backend only as ciphertext');
    if (request.path === '/api/agent' && request.body.includes('encrypted_input')) assert.ok(!request.body.includes('Avery') && !request.body.includes('92 / 100'), 'Private ingress must conceal undisclosed credential claims');
  }
  assert.deepEqual(errors, []); pass('Passwords, holder seeds and original files are absent from API request plaintext; tested desktop/mobile flows have no browser exceptions');
  const report = { status: 'passed', base_url: baseURL, checked_at: new Date().toISOString(), wallet_testing: 'Injected NEAR Connect harness with real testnet wallet signatures and transactions; manual Meteor/Intear login not tested.', checks, transactions, screenshots, browser_errors: errors };
  await writeFile(`.local/private-browser-${base.protocol === 'https:' ? 'hosted' : 'local'}.json`, JSON.stringify(report, null, 2));
  console.log('Passed all', checks.length, 'wallet, TEE and external agent browser checks.');
} catch (error) {
  const report = { status: 'failed', stage, error: (error as Error).message.slice(0, 2400), checks, transactions, screenshots, browser_errors: errors };
  await writeFile(`.local/private-browser-${base.protocol === 'https:' ? 'hosted' : 'local'}.json`, JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report)); process.exitCode = 1;
} finally { await recoveryContext?.close(); await context.close(); await browser.close(); closeBridge(); }

// Capture fictional hosted workflows. Wallet secrets stay in this Node process.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, type BrowserContext } from '@playwright/test';
import { KeyPair, type KeyPairString } from 'near-api-js';
import { captureFacet } from './demo-capture/facet.js';
import { recorder, clickResponse, navigate, type Shot } from './demo-capture/common.js';
import { encode, holderPublic } from '../shared/crypto.js';
import { openVault } from '../shared/vault.js';
import { nep413Digest, type WalletChallenge } from '../shared/wallet-auth.js';

const baseURL = process.env.DEMO_BASE_URL || 'https://facet-near.vercel.app';
const origin = new URL(baseURL).origin;
const browser = await chromium.launch({ headless: true });
await mkdir('.local', { recursive: true, mode: 0o700 });
async function walletFixture(context: BrowserContext) {
  const accounts = JSON.parse(await readFile('.local/accounts.json', 'utf8'));
  const accountId = accounts.wallet.account_id;
  const key = KeyPair.fromString(accounts.wallet.secret_key as KeyPairString);
  await context.exposeBinding('__facetCaptureWallet', async ({ page }, params: any) => {
    assert.equal(new URL(page.url()).origin, origin);
    assert.equal(params.network, 'testnet');
    assert.equal(params.recipient, new URL(baseURL).host);
    assert.equal(params.callbackUrl, origin + '/vault');
    assert.ok(params.message.startsWith('Sign in to Facet on NEAR testnet.'));
    const challenge: WalletChallenge = { ...params, nonce: encode(Uint8Array.from(params.nonce)), expires_at: Date.now() + 60000 };
    return { accountId, publicKey: key.getPublicKey().toString(), signature: encode(key.sign(nep413Digest(challenge)).signature), state: params.state };
  });
  const initialize = ({ accountId, publicKey, origin }: { accountId: string; publicKey: string; origin: string }) => {
    let signedIn = false;
    const sign = (params: any) => (window as any).__facetCaptureWallet({ ...params, nonce: Array.from(params.nonce) });
    const wallet = {
      manifest: { id: 'facet-capture-wallet', name: 'Facet demo wallet', type: 'injected', version: '1.0.0', website: origin, icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E%3Crect width="32" height="32" rx="8" fill="%23304ffe"/%3E%3C/svg%3E', features: { testnet: true, signMessage: true, signInAndSignMessage: true }, permissions: {}, platform: {} },
      signIn: async () => { signedIn = true; return [{ accountId, publicKey }]; },
      signInAndSignMessage: async (params: any) => { const signedMessage = await sign({ ...params.messageParams, network: params.network }); signedIn = true; return [{ accountId, publicKey, signedMessage }]; },
      signMessage: sign,
      signOut: async () => { signedIn = false; },
      getAccounts: async () => signedIn ? [{ accountId, publicKey }] : [],
    };
    window.addEventListener('near-selector-ready', () => window.dispatchEvent(new CustomEvent('near-wallet-injected', { detail: wallet })));
  };
  // Browser serialization must receive only public account information.
  await context.addInitScript({ content: `globalThis.__name = (fn) => fn; (${initialize.toString()})(${JSON.stringify({ accountId, publicKey: key.getPublicKey().toString(), origin })});` });
  return accountId;
}
try {
  const report = await captureFacet(browser);
  if (report.status !== 'passed') throw new Error(`Hosted credential capture failed at ${report.stage}: ${report.error}`);
  const shots = report.shots as Shot[];
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const accountId = await walletFixture(context);
  const page = await context.newPage(); page.setDefaultTimeout(45000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const shot = recorder(page, shots);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1 }).waitFor(); await shot('20-product-intro', '.hero');
  const envelope = JSON.parse(await readFile('.local/private-browser-identity.json', 'utf8'));
  const password = (await readFile('.local/private-browser-password', 'utf8')).trim();
  const fixture = (await openVault(envelope, password)).data;
  await page.goto('/vault', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type=file]').setInputFiles({ name: 'facet-demo-encrypted-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(envelope)) });
  await page.getByLabel('Vault password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Restore vault', exact: true }).click();
  await page.getByRole('button', { name: 'Encrypted backup', exact: true }).waitFor();
  await navigate(page, '/agents');
  const finish = page.waitForResponse(r => new URL(r.url()).pathname === '/api/wallet' && r.request().method() === 'POST' && r.request().postDataJSON()?.operation === 'finish');
  await page.getByRole('button', { name: 'Connect NEAR wallet', exact: true }).click();
  await page.getByText('Facet demo wallet', { exact: true }).click();
  const login = await finish; assert.ok(login.ok());
  const state = await (await page.request.get(baseURL + '/api/wallet')).json();
  assert.equal(state.wallet.account_id, accountId);
  assert.equal(state.holder_id, holderPublic(fixture.holder_seed));
  await page.getByText('Wallet authenticated', { exact: true }).waitFor(); await shot('21-wallet-identity', '.wallet-panel');
  await navigate(page, '/vault');
  await page.getByRole('button', { name: 'Issue demo credential', exact: true }).waitFor();
  const issued = await clickResponse(page, 'Issue demo credential', 'action');
  assert.equal(issued.record.kind, 'demo_issued');
  report.evidence.push({ name: 'Wallet-fixture fictional credential', token_id: issued.record.token_id, transaction: issued.transaction });
  await navigate(page, '/agents');
  await page.getByRole('heading', { name: 'Choose what the agent sees.', exact: true }).waitFor();
  await page.getByLabel('Agent purpose').fill('Confirm training eligibility');
  await shot('22-agent-fields-preview', '.agent-consent-panel fieldset');
  await page.getByLabel('Agent permission duration').selectOption('10');
  await page.getByLabel('Agent execution allowance').selectOption('2');
  await page.getByLabel('I approve only the selected facts', { exact: false }).check();
  assert.ok(await page.getByRole('button', { name: 'Approve agent permission', exact: true }).isDisabled());
  await shot('23-agent-limits-preview', '.agent-limits');
  await navigate(page, '/near');
  await page.getByRole('link', { name: 'credentials.facet-lab-1102.testnet', exact: true }).waitFor();
  await shot('24-near-roles', '.near-role-grid'); await shot('25-private-execution-status', '.near-evidence'); await shot('26-contract-and-worker', '.near-details');
  assert.deepEqual(errors, []); await context.close();
  const directory = 'docs/demo-captures/2026-11-14'; await mkdir(directory, { recursive: true });
  for (const s of shots) {
    const bytes = Buffer.from(s.data, 'base64');
    await writeFile(`${directory}/${s.name}.jpg`, bytes);
  }
  const evidence = { ...report, checked_at: new Date().toISOString(), shots: shots.map(({ data, ...s }) => ({ ...s, file: `${directory}/${s.name}.jpg`, sha256: createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex') })), wallet: { status: 'passed', method: 'Injected NEAR Connect fixture with real NEP-413 signature and live wallet-to-holder binding', account_id: accountId, signing_keys_excluded: true }, agent_screen: { status: 'preview_only', fields: ['course', 'achievement'], minutes: 10, maximum_executions: 2, grant_created: false, tee_dispatch_recorded: false }, private_execution: { status: 'experimental', evidence: 'public/near-verification.json', note: 'Earlier individual TEE operations are verified; the complete private browser workflow remains incomplete.' } };
  await writeFile('deployments/demo-capture-2026-11-14.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Captured ${shots.length} real hosted frames; login and direct proof verified; agent screens clearly marked as previews.`);
} catch (error) {
  await writeFile('.local/demo-capture-failure.json', JSON.stringify({ status: 'failed', message: (error as Error).message.slice(0, 1600) }));
  throw error;
} finally { await browser.close(); }

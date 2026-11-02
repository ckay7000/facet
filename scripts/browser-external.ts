import assert from 'node:assert/strict';
import { derivePresentation, holderPublic, randomHex, rememberIssuer, signJson } from '../shared/crypto.js';
import type { Credential } from '../shared/types.js';
export async function externalScenario(browser: any, baseURL: string) {
  const checks: string[] = [], screenshots: { name: string; data: string }[] = [], errors: string[] = [], evidence: any[] = [];
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, acceptDownloads: true }); const page = await context.newPage(); page.setDefaultTimeout(45000); page.on('pageerror', (e: Error) => errors.push(e.message));
  async function post(path: string, data: unknown) { const r = await context.request.post(`/api/${path}`, { data }); const value = await r.json(); assert.ok(r.ok(), JSON.stringify(value)); return value; }
  try {
    const config = await (await context.request.get('/api/config')).json(); rememberIssuer(config.issuer);
    const seed = randomHex(32), action = { operation: 'mint', owner_id: holderPublic(seed), token_id: 'facet_' + randomHex(), commitment: randomHex(32), kind: 'demo_issued' };
    const challenge = (await post('action', { step: 'challenge', action })).challenge;
    const issued = await post('action', { step: 'execute', challenge, holder_signature: signJson(challenge, seed) });
    const request = (await post('request', { audience: 'Independent verifier demo', purpose: 'Confirm training without collecting a name or score', fields: ['course', 'achievement'] })).request;
    const p = await derivePresentation(issued.credential as Credential, request, seed);
    await page.goto('/verify', { waitUntil: 'domcontentloaded' }); await page.getByRole('button', { name: 'Verify proof', exact: true }).waitFor();
    await page.locator('.desk-tools input[type=file]').nth(1).setInputFiles({ name: 'facet-selective-proof.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(p)) });
    await page.waitForFunction(() => !(Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Verify proof') as HTMLButtonElement)?.disabled);
    const waiting = page.waitForResponse((r: any) => r.url().includes('/api/verify') && r.request().method() === 'POST', { timeout: 90000 }); await page.getByRole('button', { name: 'Verify proof', exact: true }).click();
    const result = await (await waiting).json(); assert.equal(result.accepted, true); assert.ok(result.checks.every((c: any) => c.ok));
    await page.getByRole('heading', { name: 'The proof checks out.', exact: true }).waitFor(); assert.deepEqual(result.claims.map((c: any) => c.field), ['course', 'achievement']);
    assert.equal(await page.getByRole('button', { name: 'Lock vault', exact: true }).count(), 0); assert.ok(!(await page.locator('body').innerText()).includes('Avery Morgan')); assert.ok(!(await page.locator('body').innerText()).includes('92 / 100'));
    checks.push('A separate verifier imports and accepts an active proof without creating or unlocking a vault'); checks.push('Verifier UI shows requested course and completion fields while omitting hidden name and score');
    evidence.push({ name: 'external verifier acceptance', token_id: issued.record.token_id, mint_transaction: issued.transaction, verification_transaction: result.transaction });
    for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); if (width !== 320) screenshots.push({ name: width === 1440 ? 'desktop-external-verifier' : 'mobile-external-verifier', data: (await page.screenshot({ fullPage: false, timeout: 15000 })).toString('base64') }); }
    checks.push('Verified results fit desktop, 390px and 320px viewports');
    const denied = await context.request.post('/api/action', { data: { step: 'execute', challenge, holder_signature: signJson(challenge, randomHex(32)) } }); assert.equal(denied.status(), 400); checks.push('The hosted API rejects an action signed by a different holder');
    const tampered = structuredClone(p); tampered.disclosed.find(d => d.index === 4)!.value = 'Distinction'; tampered.holder_signature = signJson({ version: tampered.version, token_id: tampered.token_id, request: tampered.request, proof: tampered.proof, disclosed: tampered.disclosed }, seed);
    const invalid = await post('verify', { presentation: tampered }); assert.equal(invalid.accepted, false); assert.equal(invalid.checks.find((c: any) => c.id === 'proof').ok, false); checks.push('The hosted API rejects a changed claim even when the legitimate holder resigns it');
    assert.deepEqual(errors, []); checks.push('No browser exceptions in independent-verifier checks');
    return { status: 'passed', checked_at: new Date().toISOString(), checks, evidence, browser_errors: errors, screenshots };
  } catch (e) { try { screenshots.push({ name: 'external-failure', data: (await page.screenshot({ fullPage: false, timeout: 10000 })).toString('base64') }); } catch {} return { status: 'failed', error: (e as Error).message.slice(0, 1400), checks, evidence, browser_errors: errors, screenshots }; }
  finally { await context.close(); }
}

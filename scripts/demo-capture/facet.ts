import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { clickResponse, downloaded, navigate, recorder, type Shot } from './common.js';
export async function captureFacet(browser: any) {
  const baseURL = process.env.DEMO_BASE_URL || 'https://facet-near.vercel.app', shots: Shot[] = [], evidence: any[] = [], errors: string[] = [];
  let stage = 'open vault';
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, acceptDownloads: true }), page = await context.newPage();
  page.setDefaultTimeout(45000); page.on('pageerror', (e: Error) => errors.push(e.message)); const shot = recorder(page, shots);
  const password = randomBytes(18).toString('base64url');
  try {
    await page.goto('/vault', { waitUntil: 'domcontentloaded' }); await page.getByLabel('Vault password', { exact: true }).waitFor();
    await shot('01-vault', '.vault-gate');
    await page.getByLabel('Vault password', { exact: true }).fill(password); await page.getByLabel('Confirm password').fill(password); await page.getByRole('button', { name: 'Create vault', exact: true }).click(); await page.getByLabel('Upload a private document').waitFor();
    stage = 'record private document';
    await page.getByLabel('Upload a private document').setInputFiles({ name: 'training-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Fictional training notes for the Facet product demonstration. This original file should remain on the holder device.') });
    await page.getByRole('heading', { name: 'training-notes', exact: true }).waitFor(); await shot('02-encrypted-original', '.file-preview');
    const recorded = await clickResponse(page, 'Create private NFT', 'action'); assert.equal(recorded.record.kind, 'self_recorded'); evidence.push({ name: 'self-recorded document', token_id: recorded.record.token_id, transaction: recorded.transaction });
    await page.getByText('Self-recorded · unverified', { exact: true }).first().waitFor(); await shot('03-self-recorded-nft', '.detail-panel');
    stage = 'issue demo credential'; const issued = await clickResponse(page, 'Issue demo credential', 'action'); assert.equal(issued.record.kind, 'demo_issued'); assert.ok(issued.credential.signature); evidence.push({ name: 'fictional issuer-signed credential', token_id: issued.record.token_id, transaction: issued.transaction });
    await page.getByRole('button', { name: 'Prove selected fields', exact: true }).waitFor(); await shot('04-issued-credential', '.certificate-preview');
    stage = 'request and consent'; await page.getByRole('button', { name: 'Prove selected fields', exact: true }).click(); await page.getByRole('button', { name: 'Create signed request', exact: true }).waitFor();
    await page.getByLabel('Requesting party').fill('Example hiring team'); await page.getByLabel('Why you need this').fill('Confirm completion of privacy training'); await shot('05-request-fields', '.request-panel fieldset');
    await clickResponse(page, 'Create signed request', 'request'); await page.getByRole('button', { name: 'Approve & create proof', exact: true }).waitFor(); await shot('06-disclosure-preview', '.disclosure-preview');
    await page.getByRole('button', { name: 'Approve & create proof', exact: true }).click(); await page.getByText('Disclosure approved · proof ready', { exact: true }).waitFor(); await shot('07-owner-approval', '.consent-panel');
    const proof = JSON.parse((await downloaded(page, 'Export proof')).toString()); assert.deepEqual(proof.disclosed.map((d: any) => d.index), [0,1,2,3,4,8,9]); assert.ok(!JSON.stringify(proof).includes('Avery Morgan')); assert.ok(!JSON.stringify(proof).includes('92 / 100'));
    stage = 'external verifier'; const external = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, acceptDownloads: true }), verifier = await external.newPage(); verifier.setDefaultTimeout(45000); verifier.on('pageerror', (e: Error) => errors.push(e.message)); const verifierShot = recorder(verifier, shots);
    await verifier.goto('/verify', { waitUntil: 'domcontentloaded' }); await verifier.locator('.desk-tools input[type=file]').nth(1).setInputFiles({ name: 'facet-selective-proof.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(proof)) }); await verifier.getByRole('button', { name: 'Verify proof', exact: true }).waitFor(); await verifierShot('08-external-verifier', '.consent-panel');
    const accepted = await clickResponse(verifier, 'Verify proof', 'verify'); assert.equal(accepted.accepted, true); evidence.push({ name: 'external verification', transaction: accepted.transaction, proof_hash: accepted.proof_hash }); await verifier.getByRole('heading', { name: 'The proof checks out.', exact: true }).waitFor(); await verifierShot('09-verified-claims', '.verified-claims'); await verifierShot('10-verification-checks', '.verification-checks');
    stage = 'consent history'; await navigate(page, '/activity'); await page.getByText('Disclosure approved', { exact: true }).waitFor(); await shot('11-consent-history', '.history-panel');
    stage = 'cryptographic lab'; await navigate(page, '/lab'); await page.getByRole('button', { name: 'Run 8 proof checks', exact: true }).click(); await page.getByRole('heading', { name: '8 / 8 behaved as expected', exact: true }).waitFor({ timeout: 90000 }); await shot('12-proof-lab', '.lab-results');
    stage = 'fresh proof for revocation'; await navigate(page, '/verify'); await page.getByRole('button', { name: 'Start fresh', exact: true }).click(); await clickResponse(page, 'Create signed request', 'request'); await page.getByRole('button', { name: 'Approve & create proof', exact: true }).click(); await page.getByText('Disclosure approved · proof ready', { exact: true }).waitFor(); const unusedProof = JSON.parse((await downloaded(page, 'Export proof')).toString());
    await navigate(page, '/vault'); await page.getByRole('button', { name: 'Revoke record', exact: true }).click(); await shot('13-revocation-consent', '.revoke-confirm'); const revoked = await clickResponse(page, 'Confirm revocation', 'action'); assert.equal(revoked.record.revoked, true); evidence.push({ name: 'live revocation', transaction: revoked.transaction });
    await verifier.locator('.desk-tools input[type=file]').nth(1).setInputFiles({ name: 'unused-facet-proof.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(unusedProof)) });
    const blocked = await clickResponse(verifier, 'Verify proof', 'verify'); assert.equal(blocked.accepted, false); assert.equal(blocked.checks.find((c: any) => c.id === 'nonce').ok, true); assert.equal(blocked.checks.find((c: any) => c.id === 'proof').ok, true); assert.equal(blocked.checks.find((c: any) => c.id === 'revocation').ok, false); await verifier.getByRole('heading', { name: 'This proof was not accepted.', exact: true }).waitFor(); await verifierShot('14-revoked-proof', '.verification-checks');
    await external.close(); assert.deepEqual(errors, []);
    return { status: 'passed', project: 'Facet', source: 'Actual hosted UI captures, edited into a narrated walkthrough', fictional_data: true, private_keys_excluded: true, hidden_claims_excluded_from_proof: true, independent_verifier_has_no_vault: true, revocation_rejected_unused_proof: true, checked_at: new Date().toISOString(), evidence, browser_errors: errors, shots };
  } catch (e) { try { await shot('failure'); } catch {} return { status: 'failed', project: 'Facet', stage, error: (e as Error).message.slice(0, 1400), evidence, browser_errors: errors, shots }; }
  finally { await context.close(); }
}

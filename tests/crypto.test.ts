import { beforeAll, describe, expect, it } from 'vitest';
import * as bbs from '@digitalbazaar/bbs-signatures';
import { checkPresentation, credentialHeader, decode, demoMessages, derivePresentation, encode, holderPublic, holderStatement, randomHex, rememberIssuer, signJson, SUITE, utf8, validPresentationShape } from '../shared/crypto.js';
import { documentCommitment, emptyVault, openVault, sealVault, vaultKey } from '../shared/vault.js';
import { authorize, challenge } from '../server/actions.js';
import type { ChainRecord, Credential, Issuer, Presentation, SignedRequest } from '../shared/types.js';
const seed = randomHex(32), requestSeed = randomHex(32), now = Date.now(), contract = 'credentials.facet.testnet';
const record: ChainRecord = { token_id: 'facet_' + randomHex(), owner_id: holderPublic(seed), commitment: randomHex(32), kind: 'demo_issued', issuer_id: 'facet-test-academy-v1', issued_at: now, expires_at: now + 86400000, revoked: false, revoked_at: null };
let issuer: Issuer, credential: Credential, p: Presentation, request: SignedRequest;
const checked = (proof = p, r = record, i = issuer, time = now) => checkPresentation(proof, r, i, holderPublic(requestSeed), contract, time);
beforeAll(async () => {
  const keys = await bbs.generateKeyPair({ ciphersuite: SUITE }); issuer = { id: record.issuer_id!, public_key: encode(keys.publicKey), name: 'Facet Test Academy', active: true, demo: true }; rememberIssuer(issuer);
  const messages = demoMessages(record), header = credentialHeader(contract, record.token_id, issuer.id);
  const signature = await bbs.sign({ secretKey: keys.secretKey, publicKey: keys.publicKey, messages: messages.map(utf8), header: decode(header), ciphersuite: SUITE });
  credential = { token_id: record.token_id, issuer_id: issuer.id, signature: encode(signature), messages, header, record };
  const payload = { version: 'facet-request-v1' as const, nonce: randomHex(), audience: 'Example employer', purpose: 'Check training completion', fields: ['course', 'achievement'] as ('course' | 'achievement')[], created_at: now, expires_at: now + 600000 };
  request = { payload, signature: signJson(payload, requestSeed) }; p = await derivePresentation(credential, request, seed);
}, 20000);
describe('real selective disclosure', () => {
  it('verifies a genuine issuer proof and holder approval', async () => { expect(validPresentationShape(p)).toBe(true); expect((await checked()).every(c => c.ok)).toBe(true); });
  it('does not put hidden name, score or reference into the presentation', () => { const json = JSON.stringify(p); expect(json).not.toContain('Avery'); expect(json).not.toContain('92 / 100'); expect(p.disclosed.map(d => d.index)).toEqual([0,1,2,3,4,8,9]); });
  it('randomizes derived BBS proofs', async () => { const second = await derivePresentation(credential, request, seed); expect(second.proof).not.toBe(p.proof); });
  it('rejects altered fields even after a legitimate holder resigns them', async () => { const changed = structuredClone(p); changed.disclosed.find(d => d.index === 4)!.value = 'Distinction'; changed.holder_signature = signJson(holderStatement(changed), seed); expect((await checked(changed)).find(c => c.id === 'proof')?.ok).toBe(false); });
  it('rejects a holder signature from another key', async () => { const changed = structuredClone(p); changed.holder_signature = signJson(holderStatement(changed), randomHex(32)); expect((await checked(changed)).find(c => c.id === 'holder')?.ok).toBe(false); });
  it('refuses proof derivation by a different holder', async () => { await expect(derivePresentation(credential, request, randomHex(32))).rejects.toThrow('another holder'); });
  it('rejects changed request audience and purpose', async () => { const changed = structuredClone(p); changed.request.payload.audience = 'Different recipient'; expect((await checked(changed)).find(c => c.id === 'request')?.ok).toBe(false); });
  it('rejects expired and future requests', async () => { expect((await checked(p, record, issuer, request.payload.expires_at)).find(c => c.id === 'freshness')?.ok).toBe(false); expect((await checked(p, record, issuer, now - 31000)).find(c => c.id === 'freshness')?.ok).toBe(false); });
  it('rejects an extra unrequested field', async () => { const changed = structuredClone(p); changed.disclosed.push({ index: 5, value: 'Avery Morgan' }); changed.holder_signature = signJson(holderStatement(changed), seed); expect((await checked(changed)).find(c => c.id === 'disclosure')?.ok).toBe(false); });
  it('rejects altered proof bytes', async () => { const changed = structuredClone(p), bytes = decode(changed.proof); bytes[45] ^= 1; changed.proof = encode(bytes); expect((await checked(changed)).find(c => c.id === 'proof')?.ok).toBe(false); });
  it('rejects revoked, expired and self-recorded credentials', async () => { expect((await checked(p, { ...record, revoked: true })).find(c => c.id === 'revocation')?.ok).toBe(false); expect((await checked(p, { ...record, expires_at: now - 1 })).every(c => c.ok)).toBe(false); expect((await checked(p, { ...record, kind: 'self_recorded', issuer_id: null })).find(c => c.id === 'issuer')?.ok).toBe(false); });
  it('rejects a suspended, mismatched or substituted issuer', async () => { expect((await checked(p, record, { ...issuer, active: false })).find(c => c.id === 'issuer')?.ok).toBe(false); expect((await checked(p, record, { ...issuer, id: 'other' })).every(c => c.ok)).toBe(false); const key = await bbs.generateKeyPair({ ciphersuite: SUITE }); expect((await checked(p, record, { ...issuer, public_key: encode(key.publicKey) })).find(c => c.id === 'proof')?.ok).toBe(false); });
  it('rejects malformed presentation input before cryptography', () => { for (const value of [null, {}, { ...p, disclosed: null }, { ...p, disclosed: [{ index: -1, value: 1 }] }, { ...p, request: { payload: { ...request.payload, fields: ['unknown'] } } }]) expect(validPresentationShape(value)).toBe(false); });
});
describe('local vault protection', () => {
  it('encrypts and recovers bytes while refusing wrong passwords and changes', async () => {
    const data = emptyVault(), salt = encode(crypto.getRandomValues(new Uint8Array(16))), key = await vaultKey('a strong demo password', salt), sealed = await sealVault(data, key, salt);
    expect(JSON.stringify(sealed)).not.toContain(data.holder_seed); expect((await openVault(sealed, 'a strong demo password')).data).toEqual(data);
    await expect(openVault(sealed, 'a wrong demo password')).rejects.toThrow('password');
    const bytes = decode(sealed.ciphertext); bytes[15] ^= 1; await expect(openVault({ ...sealed, ciphertext: encode(bytes) }, 'a strong demo password')).rejects.toThrow('changed');
    const again = await sealVault(data, key, salt); expect(again.iv).not.toBe(sealed.iv); expect(again.ciphertext).not.toBe(sealed.ciphertext);
  });
  it('refuses weak passwords and downgraded encryption settings', async () => { await expect(vaultKey('weak', encode(new Uint8Array(16)))).rejects.toThrow('10'); await expect(vaultKey('strong enough password', encode(new Uint8Array(16)), 1)).rejects.toThrow('Unsupported'); });
  it('salts document commitments so identical documents have different public fingerprints', () => { const data = encode(utf8('my private document')); expect(documentCommitment(data, randomHex(32))).not.toBe(documentCommitment(data, randomHex(32))); });
});
describe('owner authorization', () => {
  it('binds minting to the exact approved action and holder', () => { const action = { operation: 'mint' as const, owner_id: holderPublic(seed), token_id: record.token_id, kind: 'demo_issued' as const, commitment: record.commitment }; const c = challenge(action, requestSeed, now); expect(authorize(c, signJson(c, seed), holderPublic(requestSeed), now)).toEqual(action); const changed = structuredClone(c); changed.payload.action.commitment = randomHex(32); expect(() => authorize(changed, signJson(changed, seed), holderPublic(requestSeed), now)).toThrow('approval'); expect(() => authorize(c, signJson(c, randomHex(32)), holderPublic(requestSeed), now)).toThrow('approval'); expect(() => authorize(c, signJson(c, seed), holderPublic(requestSeed), now + 300001)).toThrow('approval'); });
});

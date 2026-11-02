import * as bbs from '@digitalbazaar/bbs-signatures';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base64 } from '@scure/base';
import type { ChainRecord, Check, Credential, FieldId, Issuer, Presentation, SignedRequest, VerificationRequest } from './types.js';
export const utf8 = (value: string) => new TextEncoder().encode(value);
export const encode = (value: Uint8Array) => base64.encode(value);
export const decode = (value: string) => base64.decode(value);
export const hex = bytesToHex;
export const unhex = hexToBytes;
export const hash = (value: Uint8Array | string) => hex(sha256(typeof value === 'string' ? utf8(value) : value));
export const randomHex = (bytes = 16) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
export const holderPublic = (seed: string) => hex(ed25519.getPublicKey(unhex(seed)));
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value as object).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
}
export const FIELDS: { id: FieldId; index: number; label: string; sensitive?: boolean }[] = [
  { id: 'course', index: 3, label: 'Course' }, { id: 'achievement', index: 4, label: 'Completion status' },
  { id: 'learner', index: 5, label: 'Learner name', sensitive: true }, { id: 'score', index: 6, label: 'Assessment score', sensitive: true },
  { id: 'completed', index: 7, label: 'Completion date' }, { id: 'reference', index: 10, label: 'Student reference', sensitive: true },
];
export const MANDATORY = [0, 1, 2, 8, 9];
export const SUITE = 'BLS12-381-SHA-256';
export function requestIndexes(request: VerificationRequest) { return [...new Set([...MANDATORY, ...request.fields.map(id => FIELDS.find(f => f.id === id)!.index)])].sort((a, b) => a - b); }
export function credentialHeader(contract: string, tokenId: string, issuerId: string) { return encode(utf8(`facet-credential-v1:testnet:${contract}:${issuerId}:${tokenId}`)); }
export function demoMessages(record: ChainRecord): string[] { return [record.owner_id, record.token_id, 'CourseCompletionCredential', 'Data Privacy Foundations', 'Completed', 'Avery Morgan', '92 / 100', '2026-11-02', String(record.expires_at), record.commitment, `FA-${record.token_id.slice(-8).toUpperCase()}`]; }
export function signJson(value: unknown, seed: string) { return encode(ed25519.sign(utf8(canonical(value)), unhex(seed))); }
export function verifyJson(value: unknown, signature: string, publicKey: string) { try { return ed25519.verify(decode(signature), utf8(canonical(value)), unhex(publicKey)); } catch { return false; } }
export function validRequestShape(value: unknown): value is SignedRequest {
  if (!value || typeof value !== 'object') return false; const r = value as SignedRequest, p = r.payload;
  return !!p && p.version === 'facet-request-v1' && /^[a-f0-9]{32}$/.test(p.nonce) && typeof p.audience === 'string' && p.audience.length >= 2 && p.audience.length <= 64 && typeof p.purpose === 'string' && p.purpose.length <= 160 && Array.isArray(p.fields) && p.fields.length > 0 && p.fields.length <= FIELDS.length && new Set(p.fields).size === p.fields.length && p.fields.every(id => FIELDS.some(f => f.id === id)) && Number.isSafeInteger(p.created_at) && Number.isSafeInteger(p.expires_at) && p.expires_at > p.created_at && p.expires_at - p.created_at <= 15 * 60 * 1000 && typeof r.signature === 'string' && r.signature.length < 160;
}
export function presentationHash(presentation: Presentation) { return hash(canonical(presentation)); }
export function validPresentationShape(value: unknown): value is Presentation {
  if (!value || typeof value !== 'object') return false;
  const p = value as Presentation;
  return p.version === 'facet-presentation-v1' && /^facet_[a-f0-9]{32}$/.test(p.token_id) && validRequestShape(p.request) && typeof p.proof === 'string' && p.proof.length > 100 && p.proof.length < 5000 && typeof p.holder_signature === 'string' && p.holder_signature.length < 160 && Array.isArray(p.disclosed) && p.disclosed.length <= 11 && p.disclosed.every(d => d && Number.isInteger(d.index) && d.index >= 0 && d.index <= 10 && typeof d.value === 'string' && d.value.length < 512);
}
export function holderStatement(presentation: Omit<Presentation, 'holder_signature'> | Presentation) { return { version: presentation.version, token_id: presentation.token_id, request: presentation.request, proof: presentation.proof, disclosed: presentation.disclosed }; }
export async function derivePresentation(credential: Credential, request: SignedRequest, seed: string): Promise<Presentation> {
  if (holderPublic(seed) !== credential.record.owner_id) throw new Error('This credential belongs to another holder.');
  const indexes = requestIndexes(request.payload);
  const proof = await bbs.deriveProof({ publicKey: decode(credentialIssuerKey(credential)), signature: decode(credential.signature), header: decode(credential.header), messages: credential.messages.map(utf8), presentationHeader: utf8(canonical(request)), disclosedMessageIndexes: indexes, ciphersuite: SUITE });
  const body: Omit<Presentation, 'holder_signature'> = { version: 'facet-presentation-v1', token_id: credential.token_id, request, proof: encode(proof), disclosed: indexes.map(index => ({ index, value: credential.messages[index] })) };
  return { ...body, holder_signature: signJson(body, seed) };
}
// Public issuer keys are carried locally for proof generation and independently resolved on verification.
const issuerKeys = new Map<string, string>();
export function rememberIssuer(issuer: Issuer) { issuerKeys.set(issuer.id, issuer.public_key); }
function credentialIssuerKey(credential: Credential) { const key = issuerKeys.get(credential.issuer_id); if (!key) throw new Error('Refresh the issuer registry before creating a proof.'); return key; }
export async function checkPresentation(p: Presentation, record: ChainRecord, issuer: Issuer, requestKey: string, contract: string, now = Date.now()): Promise<Check[]> {
  const signed = validRequestShape(p.request) && verifyJson(p.request.payload, p.request.signature, requestKey);
  const fresh = signed && now >= p.request.payload.created_at - 30000 && now < p.request.payload.expires_at;
  const indexes = signed ? requestIndexes(p.request.payload) : [];
  const values = new Map(p.disclosed.map(d => [d.index, d.value]));
  const exact = p.disclosed.length === indexes.length && p.disclosed.every((d, i) => d.index === indexes[i] && typeof d.value === 'string' && d.value.length < 512);
  const binding = exact && values.get(0) === record.owner_id && values.get(1) === record.token_id && p.token_id === record.token_id && values.get(2) === 'CourseCompletionCredential' && values.get(8) === String(record.expires_at) && values.get(9) === record.commitment;
  let proof = false;
  if (signed && exact && binding) { try { proof = await bbs.verifyProof({ publicKey: decode(issuer.public_key), proof: decode(p.proof), header: decode(credentialHeader(contract, p.token_id, issuer.id)), presentationHeader: utf8(canonical(p.request)), disclosedMessages: p.disclosed.map(d => utf8(d.value)), disclosedMessageIndexes: indexes, ciphersuite: SUITE }); } catch {} }
  const holder = binding && verifyJson(holderStatement(p), p.holder_signature, record.owner_id);
  return [
    { id: 'request', label: 'Signed verification request', ok: signed, detail: 'The request, audience and selected fields are authenticated.' },
    { id: 'freshness', label: 'Request still has time remaining', ok: fresh, detail: 'Proofs are bound to a short-lived request and its nonce.' },
    { id: 'disclosure', label: 'Only requested fields disclosed', ok: exact, detail: 'Unrequested personal fields cannot be silently added.' },
    { id: 'issuer', label: 'Registered issuer is active', ok: issuer.active && issuer.demo && record.kind === 'demo_issued' && record.issuer_id === issuer.id, detail: 'This is Facet Test Academy, a clearly labeled demo issuer.' },
    { id: 'proof', label: 'BBS proof checks out', ok: proof, detail: 'Disclosed fields come from the issuer-signed credential.' },
    { id: 'holder', label: 'Holder authorizes this exact proof', ok: holder, detail: 'The presenter controls the key bound to the credential.' },
    { id: 'expiry', label: 'Credential has not expired', ok: record.expires_at > now, detail: 'Expiry is checked against the signed credential and chain record.' },
    { id: 'revocation', label: 'Credential has not been revoked', ok: !record.revoked, detail: 'Status is read from the NEAR contract at finality.' },
  ];
}

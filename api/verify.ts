import type { VercelRequest, VercelResponse } from '@vercel/node';
import { configuration, contractId, send, view } from '../server/chain.js';
import { guard, failure, InputError } from '../server/http.js';
import { checkPresentation, FIELDS, hash, presentationHash, validPresentationShape } from '../shared/crypto.js';
import type { ChainRecord, Presentation, VerificationResult } from '../shared/types.js';
export default async function handler(req: VercelRequest, res: VercelResponse) { try {
  if (!guard(req, res, 'POST')) return;
  if (!req.body || Object.keys(req.body).some(k => k !== 'presentation') || !validPresentationShape(req.body.presentation)) throw new InputError('Import a valid Facet proof package.');
  const p: Presentation = req.body.presentation, config = await configuration();
  if (!config.configured || !config.issuer) throw new Error('Verification relay not configured.');
  const record = await view<ChainRecord | null>('get_record', { token_id: p.token_id });
  if (!record) throw new InputError('This credential is not registered on NEAR testnet.');
  const checks = await checkPresentation(p, record, config.issuer, config.request_public_key, contractId());
  const nonce_hash = hash(p.request.payload.nonce), proof_hash = presentationHash(p);
  const used = await view('get_verification', { nonce_hash });
  checks.push({ id: 'nonce', label: 'Request has not been used', ok: !used, detail: 'A successful request can be recorded only once on NEAR.' });
  let transaction = null;
  if (checks.every(c => c.ok)) {
    const receipt = await send('verifier', 'record_verification', { nonce_hash, token_id: p.token_id, proof_hash, expires_at: p.request.payload.expires_at });
    transaction = receipt.transaction;
    checks.push({ id: 'chain', label: 'Verification receipt confirmed on NEAR', ok: transaction.success, detail: 'The contract rechecks expiry, revocation, issuer status and nonce reuse.' });
  }
  const accepted = checks.every(c => c.ok) && !!transaction?.success;
  const result: VerificationResult = { accepted, checks, claims: accepted ? p.request.payload.fields.map(field => { const f = FIELDS.find(f => f.id === field)!; return { field, label: f.label, value: p.disclosed.find(d => d.index === f.index)!.value }; }) : [], checked_at: Date.now(), record, issuer: config.issuer, transaction, proof_hash, request: p.request.payload };
  res.json(result);
} catch (e) { failure(res, e); } }

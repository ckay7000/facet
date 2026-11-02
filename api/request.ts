import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FIELDS, randomHex, signJson, validRequestShape, holderPublic } from '../shared/crypto.js';
import type { VerificationRequest } from '../shared/types.js';
import { configuration } from '../server/chain.js';
import { guard, failure, InputError } from '../server/http.js';
export default async function handler(req: VercelRequest, res: VercelResponse) { try {
  if (!guard(req, res, 'POST')) return;
  const b = req.body;
  if (!b || Object.keys(b).some(k => !['audience', 'purpose', 'fields'].includes(k)) || typeof b.audience !== 'string' || typeof b.purpose !== 'string' || !Array.isArray(b.fields)) throw new InputError('Choose who is requesting which credential fields.');
  const payload: VerificationRequest = { version: 'facet-request-v1', nonce: randomHex(), audience: b.audience.trim(), purpose: b.purpose.trim(), fields: b.fields, created_at: Date.now(), expires_at: Date.now() + 10 * 60000 };
  if (!payload.purpose || !validRequestShape({ payload, signature: '' }) || !payload.fields.every(f => FIELDS.some(field => field.id === f))) throw new InputError('Use a name of 2–64 characters, a purpose of 1–160 characters, and at least one field.');
  const config = await configuration();
  if (!config.configured || holderPublic(process.env.FACET_REQUEST_SEED!) !== config.request_public_key) throw new Error('Request key does not match the chain.');
  res.json({ request: { payload, signature: signJson(payload, process.env.FACET_REQUEST_SEED!) } });
} catch (e) { failure(res, e); } }

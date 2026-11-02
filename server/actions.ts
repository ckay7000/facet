import { InputError } from './http.js';
import { canonical, signJson, verifyJson, randomHex } from '../shared/crypto.js';
export type OwnerAction = { operation: 'mint' | 'revoke'; owner_id: string; token_id: string; commitment?: string; kind?: 'self_recorded' | 'demo_issued' };
export type ActionChallenge = { payload: { version: 'facet-action-v1'; action: OwnerAction; nonce: string; created_at: number; expires_at: number }; signature: string };
export function validAction(value: unknown): value is OwnerAction {
  if (!value || typeof value !== 'object') return false;
  const a = value as OwnerAction;
  return ['mint', 'revoke'].includes(a.operation) && /^[a-f0-9]{64}$/.test(a.owner_id) && /^facet_[a-f0-9]{32}$/.test(a.token_id) && (a.operation === 'revoke' || (typeof a.commitment === 'string' && /^[a-f0-9]{64}$/.test(a.commitment) && ['self_recorded', 'demo_issued'].includes(a.kind || ''))) && Object.keys(a).every(k => ['operation', 'owner_id', 'token_id', 'commitment', 'kind'].includes(k));
}
export function challenge(action: OwnerAction, seed: string, now = Date.now()): ActionChallenge {
  if (!validAction(action)) throw new InputError('Invalid owner action.');
  const payload = { version: 'facet-action-v1' as const, action, nonce: randomHex(), created_at: now, expires_at: now + 5 * 60000 };
  return { payload, signature: signJson(payload, seed) };
}
export function authorize(value: unknown, holderSignature: unknown, requestKey: string, now = Date.now()): OwnerAction {
  const c = value as ActionChallenge;
  if (!c?.payload || c.payload.version !== 'facet-action-v1' || !validAction(c.payload.action) || !/^[a-f0-9]{32}$/.test(c.payload.nonce) || !Number.isSafeInteger(c.payload.created_at) || !Number.isSafeInteger(c.payload.expires_at) || c.payload.expires_at - c.payload.created_at !== 5 * 60000 || now < c.payload.created_at - 30000 || now >= c.payload.expires_at || !verifyJson(c.payload, c.signature, requestKey) || typeof holderSignature !== 'string' || !verifyJson(c, holderSignature, c.payload.action.owner_id)) throw new InputError('This action has no valid, current holder approval.');
  if (canonical(c).length > 3000) throw new InputError('Invalid action challenge.');
  return c.payload.action;
}

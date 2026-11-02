import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as bbs from '@digitalbazaar/bbs-signatures';
import { authorize, challenge, validAction } from '../server/actions.js';
import { configuration, contractId, send, view } from '../server/chain.js';
import { guard, failure, InputError } from '../server/http.js';
import { credentialHeader, decode, demoMessages, encode, holderPublic, SUITE, utf8 } from '../shared/crypto.js';
import type { ChainRecord, Credential } from '../shared/types.js';
export default async function handler(req: VercelRequest, res: VercelResponse) { try {
  if (!guard(req, res, 'POST')) return;
  const b = req.body, config = await configuration();
  if (!config.configured || !config.issuer || holderPublic(process.env.FACET_REQUEST_SEED!) !== config.request_public_key) throw new Error('Relay not configured.');
  if (b?.step === 'challenge') {
    if (Object.keys(b).some(k => !['step', 'action'].includes(k)) || !validAction(b.action)) throw new InputError('Invalid owner action.');
    return res.json({ challenge: challenge(b.action, process.env.FACET_REQUEST_SEED!) });
  }
  if (b?.step !== 'execute' || Object.keys(b).some(k => !['step', 'challenge', 'holder_signature'].includes(k))) throw new InputError('Invalid owner approval.');
  const a = authorize(b.challenge, b.holder_signature, config.request_public_key);
  let result: { transaction: import('../shared/types.js').Tx; result: ChainRecord };
  if (a.operation === 'revoke') {
    const record = await view<ChainRecord | null>('get_record', { token_id: a.token_id });
    if (!record || record.owner_id !== a.owner_id) throw new InputError('Only the holder can request this revocation.');
    result = await send('issuer', 'revoke_record', { token_id: a.token_id });
  } else {
    const existing = await view<ChainRecord | null>('get_record', { token_id: a.token_id });
    if (existing && (existing.owner_id !== a.owner_id || existing.commitment !== a.commitment || existing.kind !== a.kind || existing.revoked)) throw new InputError('This identifier is already bound to another or revoked record.');
    result = await send('issuer', 'mint_record', { token_id: a.token_id, owner_id: a.owner_id, commitment: a.commitment, kind: a.kind, expires_at: existing?.expires_at ?? (a.kind === 'demo_issued' ? Date.now() + 365 * 86400000 : 0) });
  }
  if (!result.transaction.success || !result.result) return res.status(409).json({ error: 'The contract refused this action. The demo may have reached its funded minting limit.', transaction: result.transaction });
  let credential: Credential | null = null;
  if (a.operation === 'mint' && result.result.kind === 'demo_issued') {
    const record = result.result, header = credentialHeader(contractId(), record.token_id, config.issuer.id), messages = demoMessages(record);
    const signature = await bbs.sign({ secretKey: decode(process.env.FACET_BBS_SECRET!), publicKey: decode(config.issuer.public_key), header: decode(header), messages: messages.map(utf8), ciphersuite: SUITE });
    credential = { token_id: record.token_id, issuer_id: config.issuer.id, signature: encode(signature), header, messages, record };
  }
  res.json({ record: result.result, credential, transaction: result.transaction });
} catch (e) { failure(res, e); } }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { guard, failure, InputError } from '../server/http.js';
import { contractId, send, view } from '../server/chain.js';
import { currentWallet } from '../server/wallet-session.js';
import { cleanPrivateIngress, privateConfig, runAgent, signedAgentRequests, submitPrivate, validPrivateApproval } from '../server/tee.js';
import { revokeText, type AgentGrant, type PrivateJob } from '../shared/agent.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { utf8, unhex } from '../shared/crypto.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      if (!guard(req, res, 'GET')) return;
      if (req.query.job) { if (typeof req.query.job !== 'string' || !/^[a-f0-9]{32}$/.test(req.query.job)) throw new InputError('Invalid private job.'); return res.json({ job: await view('get_private_job', { job_id: req.query.job }) }); }
      if (req.query.grant) { if (typeof req.query.grant !== 'string' || !/^[a-f0-9]{32}$/.test(req.query.grant)) throw new InputError('Invalid permission.'); return res.json({ grant: await view('get_agent_grant', { grant_id: req.query.grant }) }); }
      if (req.query.owner) { if (typeof req.query.owner !== 'string' || !/^[a-f0-9]{64}$/.test(req.query.owner)) throw new InputError('Invalid holder.'); return res.json({ grants: await view('list_agent_grants', { owner_id: req.query.owner, from_index: 0, limit: 100 }) }); }
      if (req.query.wallet === 'records') { const wallet = currentWallet(req.headers.cookie); if (!wallet) throw new InputError('Authenticate your NEAR wallet first.'); return res.json({ records: await view('list_wallet_records', { account_id: wallet.account_id }) }); }
      return res.json(await privateConfig());
    }
    const b = req.body;
    if (!guard(req, res, 'POST', b?.operation === 'store' ? 190000 : 20000)) return;
    const exact = (keys: string[]) => b && typeof b === 'object' && Object.keys(b).every(k => keys.includes(k));
    if (b?.operation === 'requests' && exact(['operation', 'token_id', 'fields', 'purpose', 'minutes', 'max_uses'])) return res.json(await signedAgentRequests(b.token_id, b.fields, b.purpose, b.minutes, b.max_uses));
    if (b?.operation === 'store' && exact(['operation', 'approval', 'holder_signature', 'encrypted_input']) && validPrivateApproval(b.approval)) {
      const wallet = currentWallet(req.headers.cookie); if (!wallet) throw new InputError('Connect your NEAR wallet before storing a private copy or approving an agent.');
      const holder = await view<string | null>('get_wallet_holder', { account_id: wallet.account_id });
      if (!holder) throw new InputError('Bind the unlocked vault to your authenticated wallet first.');
      return res.json(await submitPrivate(b.approval, b.holder_signature, b.encrypted_input, holder));
    }
    if (b?.operation === 'run' && exact(['operation', 'grant_id', 'job_id', 'request_signature'])) return res.json(await runAgent(b.grant_id, b.job_id, b.request_signature));
    if (b?.operation === 'revoke' && exact(['operation', 'grant_id', 'holder_signature']) && /^[a-f0-9]{32}$/.test(b.grant_id) && /^[a-f0-9]{128}$/.test(b.holder_signature)) {
      const grant = await view<AgentGrant | null>('get_agent_grant', { grant_id: b.grant_id });
      if (!grant || !ed25519.verify(unhex(b.holder_signature), utf8(revokeText(contractId(), b.grant_id)), unhex(grant.owner_id))) throw new InputError('Only the credential holder can revoke this permission.');
      const result = await send('issuer', 'revoke_agent', { grant_id: b.grant_id, holder_signature: b.holder_signature });
      if (!result.transaction.success) throw new InputError('NEAR declined permission revocation.'); return res.json({ grant: result.result, transaction: result.transaction });
    }
    if (b?.operation === 'cleanup' && exact(['operation', 'job_id']) && /^[a-f0-9]{32}$/.test(b.job_id)) { const job = await view<PrivateJob | null>('get_private_job', { job_id: b.job_id }); if (!job) throw new InputError('Private job not found.'); await cleanPrivateIngress(job); return res.json({ job }); }
    throw new InputError('Invalid private credential request. Send only encrypted copies and signed approvals.');
  } catch (error) { failure(res, error); }
}

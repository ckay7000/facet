import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { encode, holderPublic, unhex } from '../shared/crypto.js';
import { nep413Digest } from '../shared/wallet-auth.js';
import { newChallenge, sealCookie } from '../server/wallet-session.js';

const mocks = vi.hoisted(() => ({ query: vi.fn(), view: vi.fn() }));
vi.mock('../server/chain.js', () => ({ provider: () => ({ query: mocks.query }), view: mocks.view, configuration: vi.fn(), send: vi.fn(), contractId: () => 'credentials.facet-lab-1102.testnet' }));
import handler from '../api/wallet.js';
const seed = '77'.repeat(32), host = 'facet-near.vercel.app', origin = `https://${host}`;
beforeEach(() => { process.env.FACET_REQUEST_SEED = '88'.repeat(32); mocks.query.mockReset(); mocks.query.mockResolvedValue({ permission: 'FullAccess' }); });
async function login(permission: unknown) {
  const c = newChallenge(host, origin), signed_message = { accountId: 'fixture.testnet', publicKey: `ed25519:${base58.encode(unhex(holderPublic(seed)))}`, signature: encode(ed25519.sign(nep413Digest(c), unhex(seed))), state: c.state };
  mocks.query.mockResolvedValue({ permission });
  const req = { method: 'POST', headers: { host, origin, 'content-type': 'application/json', cookie: `facet_wallet_challenge=${sealCookie(c)}` }, body: { operation: 'finish', signed_message } } as unknown as VercelRequest;
  let status = 200, body: any, headers: Record<string, unknown> = {};
  const res = { setHeader: (k: string, v: unknown) => { headers[k] = v; }, status: (n: number) => { status = n; return res; }, json: (v: unknown) => { body = v; return res; } } as unknown as VercelResponse;
  await handler(req, res); return { status, body, headers };
}
describe('wallet API validates live key authority', () => {
  it('accepts a real full-access key and issues an HttpOnly session', async () => { const r = await login('FullAccess'); expect(r.status).toBe(200); expect(r.body.wallet.account_id).toBe('fixture.testnet'); expect(String(r.headers['Set-Cookie'])).toContain('HttpOnly'); expect(String(r.headers['Set-Cookie'])).toContain('Secure'); expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({ request_type: 'view_access_key', finality: 'final' })); });
  it('refuses a valid signature from a function-call key', async () => { const r = await login({ FunctionCall: { receiver_id: 'app.testnet', method_names: ['execute_agent'], allowance: '1000' } }); expect(r.status).toBe(400); expect(r.body.error).toContain('full-access'); expect(String(r.headers['Set-Cookie'])).not.toContain('facet_wallet='); });
});

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { guard, failure, InputError } from '../server/http.js';
import { configuration, provider, send, contractId, view } from '../server/chain.js';
import { cookieValue, currentWallet, newChallenge, openCookie, sealCookie, sessionCookie } from '../server/wallet-session.js';
import { verifyWalletSignature, type WalletChallenge, type WalletSignature } from '../shared/wallet-auth.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { unhex, utf8 } from '../shared/crypto.js';
import { walletBindingText } from '../shared/agent.js';
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') { if (!guard(req, res, 'GET')) return; const wallet = currentWallet(req.headers.cookie); return res.json({ wallet, holder_id: wallet ? await view<string | null>('get_wallet_holder', { account_id: wallet.account_id }) : null }); }
    if (!guard(req, res, 'POST')) return;
    const b = req.body, host = req.headers.host!, origin = req.headers.origin!;
    if (!origin || new URL(origin).host !== host) throw new InputError('Open Facet to authenticate your wallet.');
    if (b?.operation === 'begin' && Object.keys(b).length === 1) { const challenge = newChallenge(host, origin); res.setHeader('Set-Cookie', sessionCookie('facet_wallet_challenge', sealCookie(challenge), host, 300)); return res.json({ challenge }); }
    if (b?.operation === 'finish' && Object.keys(b).every(k => ['operation', 'signed_message'].includes(k))) {
      const token = cookieValue(req.headers.cookie, 'facet_wallet_challenge'); if (!token) throw new InputError('Start a fresh wallet sign-in.');
      const challenge = openCookie<WalletChallenge>(token), signed = b.signed_message as WalletSignature;
      if (!signed || !verifyWalletSignature(challenge, signed) || challenge.recipient !== host || challenge.callbackUrl !== `${origin}/vault`) throw new InputError('This wallet signature is invalid or expired.');
      const access = await provider().query({ request_type: 'view_access_key', account_id: signed.accountId, public_key: signed.publicKey, finality: 'final' });
      if (!('permission' in access) || access.permission !== 'FullAccess') throw new InputError('Sign with a full-access wallet key, not an application key.');
      const wallet = { account_id: signed.accountId, public_key: signed.publicKey, expires_at: Date.now() + 4 * 3600000 };
      res.setHeader('Set-Cookie', [sessionCookie('facet_wallet', sealCookie(wallet), host, 14400), sessionCookie('facet_wallet_challenge', '', host, 0)]); return res.json({ wallet });
    }
    if (b?.operation === 'disconnect' && Object.keys(b).length === 1) { res.setHeader('Set-Cookie', sessionCookie('facet_wallet', '', host, 0)); return res.json({ wallet: null }); }
    if (b?.operation === 'bind' && Object.keys(b).every(k => ['operation', 'holder_id', 'holder_signature'].includes(k))) {
      const wallet = currentWallet(req.headers.cookie); if (!wallet) throw new InputError('Connect and authenticate your NEAR wallet first.');
      if (!/^[a-f0-9]{64}$/.test(b.holder_id) || !/^[a-f0-9]{128}$/.test(b.holder_signature) || !ed25519.verify(unhex(b.holder_signature), utf8(walletBindingText(contractId(), wallet.account_id, b.holder_id)), unhex(b.holder_id))) throw new InputError('Only the unlocked vault holder can bind this wallet.');
      const config = await configuration(); if (!config.contract?.tee?.configured) throw new InputError('Wallet vault recovery is being configured.');
      const result = await send('issuer', 'bind_holder_wallet', { wallet_id: wallet.account_id, holder_id: b.holder_id, holder_signature: b.holder_signature });
      if (!result.transaction.success) throw new InputError('This wallet or vault is already bound to another identity.');
      return res.json({ wallet, binding: result.result, transaction: result.transaction });
    }
    throw new InputError('Invalid wallet request.');
  } catch (e) { failure(res, e); }
}

import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { decode, utf8 } from './crypto.js';
export type WalletChallenge = { message: string; nonce: string; recipient: string; callbackUrl: string; state: string; expires_at: number };
export type WalletSignature = { accountId: string; publicKey: string; signature: string; state?: string };
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const string = (s: string) => { const bytes = utf8(s), out = new Uint8Array(bytes.length + 4); out.set(u32(bytes.length)); out.set(bytes, 4); return out; };
export const validWalletAccount = (id: string) => typeof id === 'string' && id.length >= 2 && id.length <= 64 && /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/.test(id);
export function nep413Digest(c: WalletChallenge, includeCallback = true) {
  const nonce = decode(c.nonce);
  if (nonce.length !== 32) throw new Error('Invalid wallet nonce.');
  const parts = [u32(2147484061), string(c.message), nonce, string(c.recipient), ...(includeCallback ? [new Uint8Array([1]), string(c.callbackUrl)] : [new Uint8Array([0])])];
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return sha256(bytes);
}
export function verifyWalletSignature(c: WalletChallenge, s: WalletSignature, now = Date.now()) {
  try {
    if (now >= c.expires_at || s.state !== c.state || !validWalletAccount(s.accountId) || !s.publicKey.startsWith('ed25519:')) return false;
    const publicKey = base58.decode(s.publicKey.slice(8));
    // NEP-413 makes callbackUrl optional; injected wallets often omit it.
    // Both variants still bind the same server nonce, recipient and message.
    return publicKey.length === 32 && (ed25519.verify(decode(s.signature), nep413Digest(c), publicKey) || ed25519.verify(decode(s.signature), nep413Digest(c, false), publicKey));
  } catch { return false; }
}

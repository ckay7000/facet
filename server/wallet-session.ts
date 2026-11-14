import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { WalletChallenge } from '../shared/wallet-auth.js';
import { encode } from '../shared/crypto.js';
import { InputError } from './http.js';
type Session = { account_id: string; public_key: string; expires_at: number };
function mac(value: string) { const seed = process.env.FACET_REQUEST_SEED; if (!seed || !/^[a-f0-9]{64}$/.test(seed)) throw new Error('Wallet authentication is not configured.'); return createHmac('sha256', Buffer.from(seed, 'hex')).update('facet-http-cookie-v1:' + value).digest('base64url'); }
export function sealCookie(value: unknown) { const text = Buffer.from(JSON.stringify(value)).toString('base64url'); return `${text}.${mac(text)}`; }
export function openCookie<T>(value: string): T { const parts = value.split('.'); if (parts.length !== 2) throw new InputError('Invalid wallet session.'); const expected = Buffer.from(mac(parts[0])), actual = Buffer.from(parts[1]); if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new InputError('Invalid wallet session.'); return JSON.parse(Buffer.from(parts[0], 'base64url').toString()); }
export function cookieValue(header: string | undefined, name: string) { const value = (header || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '=')); return value ? value.slice(name.length + 1) : null; }
export function sessionCookie(name: string, value: string, host: string, maxAge: number) { return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${host.startsWith('localhost') || host.startsWith('127.0.0.1') ? '' : '; Secure'}`; }
export function currentWallet(header: string | undefined): Session | null { try { const value = cookieValue(header, 'facet_wallet'); if (!value) return null; const s = openCookie<Session>(value); return s.expires_at > Date.now() ? s : null; } catch { return null; } }
export function newChallenge(host: string, origin: string): WalletChallenge { return { message: 'Sign in to Facet on NEAR testnet. This identifies your wallet; documents are shared only with your approval.', nonce: encode(randomBytes(32)), recipient: host, callbackUrl: `${origin}/vault`, state: randomBytes(16).toString('hex'), expires_at: Date.now() + 5 * 60000 }; }

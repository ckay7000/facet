import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TESTNET_RPC_FALLBACKS } from '../shared/near-network.js';

// A fresh CSP nonce permits NEAR Connect's sandboxed wallet scripts without
// allowing arbitrary inline scripts in the holder's vault page.
export const contentSecurityPolicy = (nonce: string) => [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https://raw.githubusercontent.com https://storage.herewallet.app",
  `connect-src 'self' ${TESTNET_RPC_FALLBACKS.join(' ')} https://raw.githubusercontent.com https://rpc.testnet.near.org https://archival-rpc.testnet.near.org https://wallet.intear.tech https://logout-bridge-service.intear.tech wss://logout-bridge-service.intear.tech https://wallet.meteorwallet.app https://mc.meteorwallet.app`,
  "frame-src 'self' https://wallet.intear.tech https://wallet.meteorwallet.app",
  "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
].join('; ');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET', 'HEAD'].includes(req.method || '')) return res.status(405).end();
  const nonce = randomBytes(24).toString('base64');
  const html = await readFile(join(process.cwd(), 'dist/index.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', contentSecurityPolicy(nonce));
  return res.status(200).send(req.method === 'HEAD' ? '' : html.replace('<head>', `<head><meta name="facet-csp-nonce" content="${nonce}">`));
}

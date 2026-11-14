import type { VercelRequest, VercelResponse } from '@vercel/node';
export class InputError extends Error {}
export function guard(req: VercelRequest, res: VercelResponse, method: string, maxBodyBytes = 20000) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== method) { res.setHeader('Allow', method); res.status(405).json({ error: 'Method not allowed.' }); return false; }
  if (method === 'POST') {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use JSON for this request.');
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin && new URL(origin).host !== host) throw new InputError('Use Facet to approve this action.');
    if (Buffer.byteLength(JSON.stringify(req.body ?? null)) > maxBodyBytes) throw new InputError('The request is too large. Send only approved proofs or encrypted private packets.');
  }
  return true;
}
export function failure(res: VercelResponse, error: unknown) {
  if (error instanceof InputError) return res.status(400).json({ error: error.message });
  const detail = ((error as Error)?.message || '').replace(/ed25519:\S+/g, '[key]').replace(/[a-f0-9]{64,}/gi, '[opaque]').replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[opaque]').slice(0, 350);
  console.error('Facet request failed', (error as Error)?.name || 'UnknownError', detail);
  return res.status(503).json({ error: 'The testnet service could not complete this request. Refresh its NEAR status before retrying; your vault stays on this device.' });
}

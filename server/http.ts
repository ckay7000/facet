import type { VercelRequest, VercelResponse } from '@vercel/node';
export class InputError extends Error {}
export function guard(req: VercelRequest, res: VercelResponse, method: string) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== method) { res.setHeader('Allow', method); res.status(405).json({ error: 'Method not allowed.' }); return false; }
  if (method === 'POST') {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use JSON for this request.');
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin && new URL(origin).host !== host) throw new InputError('Use Facet to approve this action.');
    if (JSON.stringify(req.body ?? null).length > 20000) throw new InputError('The request is too large. Documents must stay in your vault.');
  }
  return true;
}
export function failure(res: VercelResponse, error: unknown) {
  if (error instanceof InputError) return res.status(400).json({ error: error.message });
  console.error('Facet request failed', (error as Error)?.name || 'UnknownError');
  return res.status(503).json({ error: 'The testnet service could not complete this request. Try again; your vault stays on this device.' });
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { configuration } from '../server/chain.js';
import { guard, failure } from '../server/http.js';
export default async function handler(req: VercelRequest, res: VercelResponse) { try { if (!guard(req, res, 'GET')) return; res.json(await configuration()); } catch (e) { failure(res, e); } }

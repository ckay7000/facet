import type { VercelRequest, VercelResponse } from '@vercel/node';
import { view } from '../server/chain.js';
import { guard, failure, InputError } from '../server/http.js';
export default async function handler(req: VercelRequest, res: VercelResponse) { try { if (!guard(req, res, 'GET')) return; const id = req.query.token; if (typeof id !== 'string' || !/^facet_[a-f0-9]{32}$/.test(id)) throw new InputError('Invalid record identifier.'); res.json({ record: await view('get_record', { token_id: id }) }); } catch (e) { failure(res, e); } }

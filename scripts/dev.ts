import { createServer } from 'node:http';
import { createServer as viteServer } from 'vite';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import config from '../api/config.js'; import action from '../api/action.js'; import request from '../api/request.js'; import verify from '../api/verify.js'; import record from '../api/record.js';
import wallet from '../api/wallet.js'; import agent from '../api/agent.js';
const handlers: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = { '/api/config': config, '/api/action': action, '/api/request': request, '/api/verify': verify, '/api/record': record, '/api/wallet': wallet, '/api/agent': agent };
const server = createServer(async (incoming, response) => {
  const url = new URL(incoming.url || '/', 'http://127.0.0.1:5371'), handler = handlers[url.pathname]; response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!handler) { response.writeHead(404); return response.end(JSON.stringify({ error: 'Not found.' })); }
  let raw = ''; for await (const chunk of incoming) { raw += chunk; if (Buffer.byteLength(raw) > (url.pathname === '/api/agent' ? 190000 : 20000)) { response.writeHead(413); return response.end(JSON.stringify({ error: 'Request too large.' })); } }
  const req = incoming as VercelRequest; req.query = Object.fromEntries(url.searchParams);
  try { req.body = raw ? JSON.parse(raw) : undefined; } catch { response.writeHead(400); return response.end(JSON.stringify({ error: 'Invalid JSON.' })); }
  const res = response as VercelResponse; res.status = code => { response.statusCode = code; return res; }; res.json = value => { response.end(JSON.stringify(value)); return res; }; await handler(req, res);
});
server.listen(5371, '127.0.0.1'); const vite = await viteServer(); await vite.listen(); console.log('Facet: http://127.0.0.1:5370');
async function stop() { await vite.close(); server.close(); process.exit(0); } process.on('SIGTERM', stop); process.on('SIGINT', stop);

import { createInterface } from 'node:readline';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
let sequence = 0; let waiting: (() => void) | null = null;
let lane = Promise.resolve();
const enabled = process.env.FACET_TOOL_BRIDGE === '1';
const input = enabled ? createInterface({ input: process.stdin }) : null;
input?.on('line', line => { if (line.trim() === 'continue' && waiting) { const next = waiting; waiting = null; next(); } });
export async function bridgeRequest(url: string, method: string, payload?: unknown, headerFile?: string, binaryFile?: string) {
  const previous = lane; let release!: () => void; lane = new Promise<void>(resolve => { release = resolve; }); await previous;
  try {
  if (!['https://api.vercel.com', 'https://test.rpc.fastnear.com', 'https://helper.testnet.near.org'].includes(new URL(url).origin)) throw new Error('Unapproved bridge origin.');
  await mkdir('.local/bridge', { recursive: true, mode: 0o700 }); const prefix = path.resolve(`.local/bridge/request-${process.pid}-${randomUUID()}-${++sequence}`);
  const file = binaryFile || `${prefix}.json`; const response = `${prefix}-response.json`;
  if (payload !== undefined) await writeFile(file, JSON.stringify(payload), { mode: 0o600 });
  const ready = new Promise<void>(resolve => { waiting = resolve; });
  console.log('FACET_HTTP_REQUEST ' + JSON.stringify({ url, method, file: payload !== undefined || binaryFile ? file : null, response, headerFile: headerFile || null }));
  await ready;
  const result = JSON.parse(await readFile(response, 'utf8'));
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result;
  } finally { release(); }
}
export function closeBridge() { input?.close(); }

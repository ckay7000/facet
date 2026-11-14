import { createInterface } from 'node:readline';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
let sequence = 0; let waiting: (() => void) | null = null;
let lane = Promise.resolve();
const enabled = process.env.FACET_TOOL_BRIDGE === '1';
const input = enabled ? createInterface({ input: process.stdin }) : null;
input?.on('line', line => { if (line.trim() === 'continue' && waiting) { const next = waiting; waiting = null; next(); } });
export async function bridgeRequest(url: string, method: string, payload?: unknown, headerFile?: string, binaryFile?: string) {
  const previous = lane; let release!: () => void; lane = new Promise<void>(resolve => { release = resolve; }); await previous;
  try {
  if (!['https://api.vercel.com', 'https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org', 'https://near-testnet.drpc.org', 'https://testnet-rpc.intea.rs', 'https://helper.testnet.near.org'].includes(new URL(url).origin)) throw new Error('Unapproved bridge origin.');
  await mkdir('.local/bridge', { recursive: true, mode: 0o700 }); const prefix = path.resolve(`.local/bridge/request-${process.pid}-${randomUUID()}-${++sequence}`);
  const file = binaryFile || `${prefix}.json`; const response = `${prefix}-response.json`;
  try {
  if (payload !== undefined) await writeFile(file, JSON.stringify(payload), { mode: 0o600 });
  if (!enabled) {
    const args = ['-fsSL', '--max-time', '90', '-X', method];
    if (headerFile) args.push('--header', `@${headerFile}`); else args.push('--header', 'Content-Type: application/json');
    if (payload !== undefined || binaryFile) args.push('--data-binary', `@${file}`);
    args.push(url);
    const out = await new Promise<string>((resolve, reject) => execFile('curl', args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => error ? reject(new Error('The HTTPS service request failed.')) : resolve(stdout)));
    const result = JSON.parse(out);
    if (result.error) throw new Error('The HTTPS service declined this request.');
    return result;
  }
  const ready = new Promise<void>(resolve => { waiting = resolve; });
  console.log('FACET_HTTP_REQUEST ' + JSON.stringify({ url, method, file: payload !== undefined || binaryFile ? file : null, response, headerFile: headerFile || null }));
  await ready;
  const result = JSON.parse(await readFile(response, 'utf8'));
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result;
  } finally {
    if (payload !== undefined && !binaryFile) await rm(file, { force: true });
    await rm(response, { force: true });
  }
  } finally { release(); }
}
export function closeBridge() { input?.close(); }

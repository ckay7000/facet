import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { bridgeRequest, closeBridge } from './tool-bridge.js';
const auth = process.env.VERCEL_TOKEN ? { token: process.env.VERCEL_TOKEN } : JSON.parse(await readFile('/root/.local/share/com.vercel.cli/auth.json', 'utf8'));
const current = JSON.parse(await readFile('deployments/web.json', 'utf8'));
if (current.state !== 'READY') throw new Error('The final production deployment must be ready before cleaning test deployments.');
const old: string[] = JSON.parse(await readFile('.local/temporary-deployments.json', 'utf8'));
if (old.includes(current.deployment_id)) throw new Error('Refusing to delete the production release.');
await mkdir('.local/bridge', { recursive: true, mode: 0o700 }); const headerFile = path.resolve('.local/bridge/vercel.headers');
await writeFile(headerFile, `Authorization: Bearer ${auth.token}\nContent-Type: application/json\n`, { mode: 0o600 });
try {
  for (const id of old) { if (!/^dpl_[A-Za-z0-9]+$/.test(id)) throw new Error('Unexpected deployment identifier.'); await bridgeRequest(`https://api.vercel.com/v13/deployments/${id}?teamId=team_osASFxy0lZFhvkPehOUzYAXS`, 'DELETE', undefined, headerFile); console.log('Removed temporary deployment:', id); }
  await writeFile('deployments/cleanup.json', JSON.stringify({ removed_temporary_deployments: old, production_deployment_id: current.deployment_id, browser_endpoint_removed: true, browser_secret_removed: true, checked_at: new Date().toISOString() }, null, 2));
} finally { await rm(headerFile, { force: true }); closeBridge(); }

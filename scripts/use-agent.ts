import { writeFile } from 'node:fs/promises';
import { readAgentPackage, useAgentAccess } from './agent-client.js';

const args = process.argv.slice(2);
function option(name: string) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
const accessFile = option('--access');
if (!accessFile) throw new Error('Usage: npm run agent:use -- --access /path/to/facet-private-agent-access.json [--url https://facet-near.vercel.app] [--proof /path/to/approved-proof.json]');
const packet = await readAgentPackage(accessFile);
const result = await useAgentAccess(option('--url') || 'https://facet-near.vercel.app', packet);
const proofFile = option('--proof');
if (proofFile) await writeFile(proofFile, JSON.stringify(result.proof, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  accepted: result.verification.accepted,
  claims: result.verification.claims,
  near_execution: result.transaction?.hash || null,
  near_verification: result.verification.transaction?.hash || null,
  outlayer_request_id: result.job.output?.outlayer_request_id || null,
  worker_hash: result.job.worker_hash,
}, null, 2));

import { readFile } from 'node:fs/promises';
import { agentAuthPublic, fieldMask, openAgentDelivery, signAgentRequest, type AgentAccess, type AgentGrant, type PrivateJob } from '../shared/agent.js';
import { checkPresentation, hash, randomHex, validPresentationShape } from '../shared/crypto.js';
import type { ChainRecord, Config, Presentation, VerificationResult } from '../shared/types.js';

export type AgentPackage = {
  version: 'facet-agent-access-v1'; network: 'testnet';
  contract_id: string; agent_id: string; access: AgentAccess;
};

export async function readAgentPackage(file: string): Promise<AgentPackage> {
  const value = JSON.parse(await readFile(file, 'utf8')) as AgentPackage;
  const a = value?.access;
  if (value?.version !== 'facet-agent-access-v1' || value.network !== 'testnet' ||
      !value.contract_id?.endsWith('.testnet') || !value.agent_id?.endsWith('.testnet') ||
      !a || !/^[a-f0-9]{32}$/.test(a.grant_id) || !/^facet_[a-f0-9]{32}$/.test(a.token_id) ||
      !/^[a-f0-9]{64}$/.test(a.delivery_key) || typeof a.purpose !== 'string' ||
      !Array.isArray(a.fields) || !a.fields.length || !Number.isSafeInteger(a.expires_at)) {
    throw new Error('Use the private agent access file exported from Facet.');
  }
  fieldMask(a.fields);
  return value;
}

// This client has no owner wallet, vault password or original document.
// Only the capability signature is sent to the execution broker.
export async function useAgentAccess(baseURL: string, packet: AgentPackage) {
  const base = new URL(baseURL);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) {
    throw new Error('Use HTTPS for the hosted app, or localhost for development.');
  }
  const request = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(new URL(`/api/${path}`, base), {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error || `Facet returned HTTP ${response.status}.`);
    return result;
  };
  const config = await request<Config>('config');
  if (!config.contract || !config.issuer || config.contract.contract_id !== packet.contract_id ||
      config.contract.tee?.agent_id !== packet.agent_id) throw new Error('The access file belongs to a different Facet deployment.');
  const { access } = packet;
  const { grant } = await request<{ grant: AgentGrant | null }>(`agent?grant=${access.grant_id}`);
  if (!grant || grant.token_id !== access.token_id || grant.agent_id !== packet.agent_id ||
      grant.fields_mask !== fieldMask(access.fields) || grant.expires_at !== access.expires_at ||
      grant.purpose_hash !== hash(access.purpose) || grant.delivery_key_hash !== hash(access.delivery_key) ||
      grant.auth_key !== agentAuthPublic(access.delivery_key)) throw new Error('The access file differs from the signed NEAR permission.');
  const jobId = randomHex();
  const execution = await request<{ job: PrivateJob; transaction: { hash: string } | null }>('agent', {
    operation: 'run', grant_id: grant.id, job_id: jobId,
    request_signature: signAgentRequest(grant.id, jobId, access.delivery_key),
  });
  let job = execution.job;
  const deadline = Date.now() + 180000;
  while (!['ready', 'failed', 'blocked'].includes(job.state)) {
    if (Date.now() >= deadline) throw new Error(`NEAR job ${jobId} is still pending; inspect its public receipt before retrying.`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const status = await request<{ job: PrivateJob | null }>(`agent?job=${jobId}`);
    if (!status.job) throw new Error('The execution receipt is missing.');
    job = status.job;
  }
  if (job.state !== 'ready' || !job.output || job.grant_id !== grant.id ||
      job.worker_hash !== grant.worker_hash || job.project_id !== grant.project_id) {
    throw new Error(`The private execution was declined: ${job.error_code || job.state}.`);
  }
  const proof: Presentation = await openAgentDelivery(job.output, access.delivery_key);
  if (!validPresentationShape(proof) || proof.token_id !== access.token_id ||
      proof.request.payload.audience !== packet.agent_id ||
      fieldMask(proof.request.payload.fields) !== grant.fields_mask ||
      proof.request.payload.purpose !== access.purpose ||
      proof.request.payload.expires_at !== grant.expires_at) throw new Error('The delivered proof differs from the approved scope.');
  const { record } = await request<{ record: ChainRecord }>(`record?token=${grant.token_id}`);
  const checks = await checkPresentation(proof, record, config.issuer, config.request_public_key, packet.contract_id);
  if (checks.some(check => !check.ok)) throw new Error(`Independent verification failed: ${checks.filter(check => !check.ok).map(check => check.id).join(', ')}.`);
  const verification = await request<VerificationResult>('verify', { presentation: proof });
  if (!verification.accepted) throw new Error('The live verification service declined the approved proof.');
  return { job, transaction: execution.transaction, checks, verification, proof };
}

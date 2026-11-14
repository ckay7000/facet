import { Account, JsonRpcProvider, actions, encodeTransaction } from 'near-api-js';
import type { KeyPairString } from 'near-api-js';
import { createHash } from 'node:crypto';
import { base58 } from '@scure/base';
import type { ChainConfig, Config, Issuer, Tx } from '../shared/types.js';
import { TESTNET_RPC_FALLBACKS, TESTNET_RPC_URL } from '../shared/near-network.js';
export const contractId = () => process.env.FACET_CONTRACT_ID || '';
export function configured() { return contractId().endsWith('.testnet') && !!process.env.FACET_ISSUER_KEY && !!process.env.FACET_VERIFIER_KEY && !!process.env.FACET_BBS_SECRET && !!process.env.FACET_REQUEST_SEED; }
export class FacetProvider extends JsonRpcProvider {
  endpoints: JsonRpcProvider[];
  constructor(url: string) { super({ url }); this.endpoints = [...new Set([url, ...TESTNET_RPC_FALLBACKS])].map(endpoint => new JsonRpcProvider({ url: endpoint }, { retries: 1 })); }
  async sendJsonRpc(method: Parameters<JsonRpcProvider['sendJsonRpc']>[0], params: any): Promise<any> {
    let last: unknown;
    for (const endpoint of this.endpoints) {
      try { return await endpoint.sendJsonRpc(method, params); }
      catch (error) { last = error; const status = (error as { cause?: unknown }).cause; if (![408, 429, 500, 502, 503, 504].includes(Number(status)) && !/429|rate limit|fetch failed|failed to fetch|fetch error|timeout|timed out|5\d\d|internal server error|ECONN|ENOTFOUND/i.test((error as Error).message)) throw error; }
    }
    throw last;
  }
}
export function provider() { return new FacetProvider(process.env.FACET_RPC_URL || TESTNET_RPC_URL); }
export async function view<T = any>(method: string, args: object = {}): Promise<T> {
  if (!configured()) throw new Error('Facet testnet is not configured.');
  const response = await provider().query({ request_type: 'call_function', account_id: contractId(), method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64'), finality: 'final' });
  if (!('result' in response) || !Array.isArray(response.result)) throw new Error('The chain record could not be read.');
  return JSON.parse(Buffer.from(response.result).toString());
}
export async function configuration(): Promise<Config> {
  if (!configured()) return { configured: false, contract: null, issuer: null, request_public_key: '', network: 'testnet', explorer: 'https://testnet.nearblocks.io' };
  const [contract, issuer] = await Promise.all([view<ChainConfig>('get_config'), view<Issuer>('get_issuer')]);
  return { configured: true, contract, issuer, request_public_key: contract.request_public_key, network: 'testnet', explorer: 'https://testnet.nearblocks.io' };
}
// Submit once, then wait only for Facet's dispatch receipt. OutLayer's yield
// can outlive an RPC's HTTP timeout; the browser polls the public job itself.
export async function dispatchPrivate(accountId: string, key: KeyPairString, method: 'execute_private' | 'execute_agent', args: object, jobId: string, gas: bigint) {
  if (!accountId.endsWith('.testnet') || !contractId().endsWith('.testnet') || !/^[a-f0-9]{32}$/.test(jobId)) throw new Error('Use a dedicated testnet private request.');
  const rpc = provider(), signed = await new Account(accountId, rpc, key).createSignedTransaction({ receiverId: contractId(), actions: [actions.functionCall(method, args, gas, 0n)] });
  const txHash = base58.encode(createHash('sha256').update(encodeTransaction(signed.transaction)).digest());
  await rpc.sendTransactionUntil(signed, 'INCLUDED_FINAL');
  const deadline = Date.now() + 45000;
  do {
    const job = await view<import('../shared/agent.js').PrivateJob | null>('get_private_job', { job_id: jobId });
    if (job && ['pending', 'ready', 'failed', 'blocked'].includes(job.state)) return { transaction: { hash: txHash, method, success: true }, result: job };
    const outcome = await rpc.sendJsonRpc('tx', { tx_hash: txHash, sender_account_id: accountId, wait_until: 'NONE' });
    if (typeof outcome.status === 'object' && 'Failure' in outcome.status) throw new Error(`NEAR refused private dispatch ${txHash}. Check the current permission and sponsor allowance.`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  } while (Date.now() < deadline);
  throw new Error(`NEAR dispatch ${txHash} is still pending for job ${jobId}. Inspect that job before another request.`);
}
// Only fixed role methods are exposed; the deployment gives both hosted keys function-call restrictions.
export async function send(role: 'issuer' | 'verifier', method: string, args: object, gas = 100000000000000n): Promise<{ transaction: Tx; result: any }> {
  if (!configured()) throw new Error('Facet testnet is not configured.');
  if (!(role === 'issuer' ? ['mint_record', 'revoke_record', 'reserve_private', 'claim_private_ingress', 'fail_private_ingress', 'execute_private', 'revoke_agent', 'bind_holder_wallet'] : ['record_verification']).includes(method)) throw new Error('Unsupported relay method.');
  const id = process.env[role === 'issuer' ? 'FACET_ISSUER_ID' : 'FACET_VERIFIER_ID']!;
  const key = process.env[role === 'issuer' ? 'FACET_ISSUER_KEY' : 'FACET_VERIFIER_KEY'] as KeyPairString;
  if (!id.endsWith('.testnet')) throw new Error('Only NEAR testnet is supported.');
  if (role === 'issuer' && method === 'execute_private') return dispatchPrivate(id, key, method, args, (args as { job_id: string }).job_id, gas);
  const response = await new Account(id, provider(), key).signAndSendTransaction({ receiverId: contractId(), actions: [actions.functionCall(method, args, gas, 0n)], waitUntil: 'FINAL', throwOnFailure: false });
  const success = typeof response.status === 'object' && 'SuccessValue' in response.status;
  let result = null;
  if (success && typeof response.status === 'object' && 'SuccessValue' in response.status && response.status.SuccessValue) result = JSON.parse(Buffer.from(response.status.SuccessValue, 'base64').toString());
  return { transaction: { hash: response.transaction.hash, success, method }, result };
}

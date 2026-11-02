import { Account, JsonRpcProvider, actions } from 'near-api-js';
import type { KeyPairString } from 'near-api-js';
import type { ChainConfig, Config, Issuer, Tx } from '../shared/types.js';
export const contractId = () => process.env.FACET_CONTRACT_ID || '';
export function configured() { return contractId().endsWith('.testnet') && !!process.env.FACET_ISSUER_KEY && !!process.env.FACET_VERIFIER_KEY && !!process.env.FACET_BBS_SECRET && !!process.env.FACET_REQUEST_SEED; }
export function provider() { return new JsonRpcProvider({ url: process.env.FACET_RPC_URL || 'https://test.rpc.fastnear.com' }); }
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
// Only fixed role methods are exposed; the deployment gives both hosted keys function-call restrictions.
export async function send(role: 'issuer' | 'verifier', method: string, args: object): Promise<{ transaction: Tx; result: any }> {
  if (!configured()) throw new Error('Facet testnet is not configured.');
  if (!(role === 'issuer' ? ['mint_record', 'revoke_record'] : ['record_verification']).includes(method)) throw new Error('Unsupported relay method.');
  const id = process.env[role === 'issuer' ? 'FACET_ISSUER_ID' : 'FACET_VERIFIER_ID']!;
  const key = process.env[role === 'issuer' ? 'FACET_ISSUER_KEY' : 'FACET_VERIFIER_KEY'] as KeyPairString;
  if (!id.endsWith('.testnet')) throw new Error('Only NEAR testnet is supported.');
  const response = await new Account(id, provider(), key).signAndSendTransaction({ receiverId: contractId(), actions: [actions.functionCall(method, args, 100000000000000n, 0n)], waitUntil: 'FINAL', throwOnFailure: false });
  const success = typeof response.status === 'object' && 'SuccessValue' in response.status;
  let result = null;
  if (success && typeof response.status === 'object' && 'SuccessValue' in response.status && response.status.SuccessValue) result = JSON.parse(Buffer.from(response.status.SuccessValue, 'base64').toString());
  return { transaction: { hash: response.transaction.hash, success, method }, result };
}

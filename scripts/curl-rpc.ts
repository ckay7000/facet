import { execFile } from 'node:child_process';
import { JsonRpcProvider } from 'near-api-js';
import { bridgeRequest } from './tool-bridge';
import { TESTNET_RPC_FALLBACKS, TESTNET_RPC_URL } from '../shared/near-network.js';
// curl honors this workspace's approved proxy/CA setup. Payloads go through stdin.
export function curlJson(url: string, value: unknown): Promise<any> { if (!url.startsWith('https://')) throw new Error('Use an HTTPS RPC endpoint.'); return new Promise((resolve, reject) => { const child = execFile('curl', ['-sSL', '--max-time', '90', '-H', 'Content-Type: application/json', '--data-binary', '@-', url], { maxBuffer: 8 * 1024 * 1024 }, (err, out) => { if (err) return reject(new Error('The HTTPS RPC request failed.')); try { resolve(JSON.parse(out)); } catch { reject(new Error('The HTTPS RPC response was not JSON.')); } }); child.stdin!.end(JSON.stringify(value)); }); }
export class CurlProvider extends JsonRpcProvider {
  rpcUrl: string;
  constructor(url = TESTNET_RPC_URL) { super({ url }); this.rpcUrl = url; }
  async sendJsonRpc(method: string, params: any): Promise<any> {
    const body = { jsonrpc: '2.0', id: 'facet', method, params };
    let last: unknown;
    for (const url of new Set([this.rpcUrl, ...TESTNET_RPC_FALLBACKS])) {
      try { const value = process.env.FACET_TOOL_BRIDGE === '1' ? await bridgeRequest(url, 'POST', body) : await curlJson(url, body); if (value.error) throw new Error(JSON.stringify(value.error)); return value.result; }
      catch (error) { last = error; if (!/429|rate limit|HTTPS RPC request failed|HTTPS RPC response was not JSON|timeout|5\d\d/i.test((error as Error).message)) throw error; }
    }
    throw last;
  }
}

import { describe, expect, it, vi } from 'vitest';
import { FacetProvider } from '../server/chain.js';
import { TESTNET_RPC_URL } from '../shared/near-network.js';

describe('NEAR RPC availability', () => {
  it('uses another public provider after a rate limit', async () => {
    const rpc = new FacetProvider(TESTNET_RPC_URL), params = { request_type: 'view_account', account_id: 'fixture.testnet', finality: 'final' };
    vi.spyOn(rpc.endpoints[0], 'sendJsonRpc').mockRejectedValue(new Error('RPC -429: Rate limits exceeded'));
    const next = vi.spyOn(rpc.endpoints[1], 'sendJsonRpc').mockResolvedValue({ amount: '1000' });
    expect(await rpc.sendJsonRpc('query', params)).toEqual({ amount: '1000' });
    expect(next).toHaveBeenCalledWith('query', params);
  });
  it('does not retry a definitive contract refusal', async () => {
    const rpc = new FacetProvider(TESTNET_RPC_URL);
    vi.spyOn(rpc.endpoints[0], 'sendJsonRpc').mockRejectedValue(new Error('Smart contract panicked: caller refused'));
    const next = vi.spyOn(rpc.endpoints[1], 'sendJsonRpc');
    await expect(rpc.sendJsonRpc('query', {})).rejects.toThrow('caller refused');
    expect(next).not.toHaveBeenCalled();
  });
  it('fails over when a provider reports HTTP 500 without a numeric message', async () => {
    const rpc = new FacetProvider(TESTNET_RPC_URL);
    vi.spyOn(rpc.endpoints[0], 'sendJsonRpc').mockRejectedValue(Object.assign(new Error('Internal server error'), { cause: 500 }));
    vi.spyOn(rpc.endpoints[1], 'sendJsonRpc').mockResolvedValue({ amount: '1000' });
    expect(await rpc.sendJsonRpc('query', {})).toEqual({ amount: '1000' });
  });
  it('preserves the same signed transaction during transport failover', async () => {
    const rpc = new FacetProvider(TESTNET_RPC_URL), params = { signed_tx_base64: 'signed-test-fixture', wait_until: 'INCLUDED_FINAL' };
    vi.spyOn(rpc.endpoints[0], 'sendJsonRpc').mockRejectedValue(new Error('fetch failed'));
    const next = vi.spyOn(rpc.endpoints[1], 'sendJsonRpc').mockResolvedValue({ transaction: { hash: 'same-transaction' } });
    expect(await rpc.sendJsonRpc('send_tx', params)).toEqual({ transaction: { hash: 'same-transaction' } });
    expect(next).toHaveBeenCalledWith('send_tx', params);
  });
});

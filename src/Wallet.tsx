import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { NearConnector, NearWalletBase } from '@hot-labs/near-connect';
import { Link } from 'react-router-dom';
import { Wallet, Link2, LogOut, ShieldCheck } from 'lucide-react';
import { api } from './api';
import { decode, holderPublic } from '../shared/crypto.js';
import { signText, walletBindingText } from '../shared/agent.js';
import type { WalletChallenge, WalletSignature } from '../shared/wallet-auth.js';
import { TESTNET_RPC_FALLBACKS } from '../shared/near-network.js';

type WalletSession = { account_id: string; public_key: string; expires_at: number };
type WalletState = { wallet: WalletSession | null; holder: string | null; busy: boolean; error: string; clearError: () => void; connect: () => Promise<void>; disconnect: () => Promise<void>; bind: (seed: string, contract: string) => Promise<void>; recover: (contract: string, token: string, job: string, recipient: string) => Promise<string | null> };
const Context = createContext<WalletState | null>(null);
const CHALLENGE = 'facet_wallet_challenge';

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletSession | null>(null), [holder, setHolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const connector = useRef<NearConnector | null>(null), connecting = useRef(false);
  async function getConnector() {
    if (!connector.current) {
      const { NearConnector } = await import('@hot-labs/near-connect');
      connector.current = new NearConnector({ network: 'testnet', autoConnect: false, features: { testnet: true, signMessage: true }, manifest: '/wallets/manifest.json', cspNonce: document.querySelector<HTMLMetaElement>('meta[name="facet-csp-nonce"]')?.content, providers: { testnet: TESTNET_RPC_FALLBACKS }, footerBranding: { heading: 'Connect to Facet', link: 'https://docs.near.org/wallets', linkText: 'NEAR wallets' } });
    }
    return connector.current;
  }
  async function refresh() { const state = await api<{ wallet: WalletSession | null; holder_id: string | null }>('wallet'); setWallet(state.wallet); setHolder(state.holder_id); }
  async function finish(signed: WalletSignature, challenge: WalletChallenge) {
    await api('wallet', { operation: 'finish', signed_message: { ...signed, state: signed.state ?? challenge.state } });
    sessionStorage.removeItem(CHALLENGE); await refresh();
  }
  useEffect(() => {
    let active = true;
    async function start() {
      const fragment = new URLSearchParams(location.hash.slice(1));
      if (fragment.has('signature')) {
        const raw = sessionStorage.getItem(CHALLENGE);
        window.history.replaceState(null, '', location.pathname + location.search);
        if (!raw) throw new Error('Start a new wallet connection; this signature has no matching challenge.');
        const challenge = JSON.parse(raw) as WalletChallenge;
        await finish({ accountId: fragment.get('accountId') || fragment.get('account_id') || '', publicKey: fragment.get('publicKey') || fragment.get('public_key') || '', signature: fragment.get('signature') || '', state: fragment.get('state') || '' }, challenge);
      } else if (active) await refresh();
    }
    void start().catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  async function connect() {
    if (connecting.current) return;
    connecting.current = true; setBusy(true); setError('');
    try {
      const { challenge } = await api<{ challenge: WalletChallenge }>('wallet', { operation: 'begin' });
      sessionStorage.setItem(CHALLENGE, JSON.stringify(challenge));
      const c = await getConnector();
      const params = { message: challenge.message, nonce: decode(challenge.nonce), recipient: challenge.recipient, callbackUrl: challenge.callbackUrl, state: challenge.state };
      let signed: WalletSignature | undefined;
      const listener = (event: { accounts: { signedMessage: WalletSignature }[] }) => { signed = event.accounts[0]?.signedMessage; };
      c.on('wallet:signInAndSignMessage', listener);
      try {
        let current: NearWalletBase | null = null;
        try { current = (await c.getConnectedWallet()).wallet; } catch { /* first connection */ }
        if (current) signed = await current.signMessage(params);
        else await c.connect({ signMessageParams: params });
      } finally { c.off('wallet:signInAndSignMessage', listener); }
      if (!signed) throw new Error('The wallet did not return a signed login. Approve sign-in in your NEAR testnet wallet.');
      await finish(signed, challenge);
    } catch (e) { setError((e as Error)?.message || 'Wallet connection was canceled.'); }
    finally { connecting.current = false; setBusy(false); }
  }
  async function disconnect() {
    if (busy) return; setBusy(true); setError('');
    try { await api('wallet', { operation: 'disconnect' }); if (connector.current) await connector.current.disconnect().catch(() => {}); sessionStorage.removeItem(CHALLENGE); setWallet(null); setHolder(null); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function bind(seed: string, contract: string) {
    if (!wallet) throw new Error('Connect your NEAR wallet first.');
    const holder_id = holderPublic(seed);
    await api('wallet', { operation: 'bind', holder_id, holder_signature: signText(walletBindingText(contract, wallet.account_id, holder_id), seed) });
    await refresh();
  }
  async function recover(contract: string, token: string, job: string, recipient: string) {
    if (!wallet) throw new Error('Authenticate your NEAR wallet first.');
    const c = await getConnector(), current = await c.getConnectedWallet();
    if (!current.accounts.some(a => a.accountId === wallet.account_id)) throw new Error('Reconnect the authenticated wallet before recovering a document.');
    const result = await current.wallet.signAndSendTransaction({ network: 'testnet', signerId: wallet.account_id, receiverId: contract, actions: [{ type: 'FunctionCall', params: { methodName: 'recover_private_copy', args: { token_id: token, job_id: job, recipient_public_key: recipient }, gas: '250000000000000', deposit: '0' } }] });
    if (typeof result.status === 'object' && 'Failure' in result.status) throw new Error('NEAR declined this recovery. Check wallet ownership and the testnet allowance.');
    return result.transaction?.hash || null;
  }
  return <Context.Provider value={{ wallet, holder, busy, error, clearError: () => setError(''), connect, disconnect, bind, recover }}>{children}</Context.Provider>;
}
export function useWallet() { const value = useContext(Context); if (!value) throw new Error('Wallet provider is missing'); return value; }
export function WalletButton({ disabled = false }: { disabled?: boolean }) {
  const w = useWallet();
  return w.wallet ? <Link className="button small outline wallet-button" to="/agents" title={w.wallet.account_id} aria-label={`Connected wallet ${w.wallet.account_id}`}><Wallet size={15}/><span>{w.wallet.account_id.length > 19 ? `${w.wallet.account_id.slice(0, 11)}…${w.wallet.account_id.slice(-7)}` : w.wallet.account_id}</span></Link> : <button className="button small outline wallet-button" aria-label={w.busy ? 'Connecting wallet' : 'Connect wallet'} disabled={disabled || w.busy} onClick={() => void w.connect()}><Wallet size={15}/><span>{w.busy ? 'Connecting…' : 'Connect wallet'}</span></button>;
}
export function WalletPanel({ seed, contract, busy, run }: { seed?: string; contract?: string; busy: boolean; run: (label: string, fn: () => Promise<void>) => Promise<void> }) {
  const w = useWallet(), localHolder = seed ? holderPublic(seed) : null;
  return <section className="panel wallet-panel"><div className="wallet-panel-heading"><div className="tile-icon"><Wallet/></div><div><h2>Your NEAR connection.</h2><p>{w.wallet ? w.wallet.account_id : 'Connect a testnet wallet to find and recover your private credentials.'}</p></div>{w.wallet && <span className="badge blue"><ShieldCheck size={13}/>Wallet authenticated</span>}</div><p className="panel-description">Signing in identifies your wallet. Your documents open only after you approve recovery, and applications receive only the fields you approve.</p><div className="detail-actions">{!w.wallet ? <button className="button primary" disabled={busy || w.busy} onClick={() => void w.connect()}><Wallet size={16}/>Connect NEAR wallet</button> : <>{localHolder && contract && !w.holder && <button className="button primary" disabled={busy || w.busy} onClick={() => void run('Binding your wallet to this vault on NEAR…', () => w.bind(seed!, contract))}><Link2 size={16}/>Bind wallet to this vault</button>}<button className="button quiet" disabled={busy || w.busy} onClick={() => void w.disconnect()}><LogOut size={15}/>Disconnect</button></>}</div>{w.holder && <p className="footnote">{localHolder === w.holder ? 'This wallet is bound to your unlocked vault. It can authorize document recovery on another device.' : localHolder ? 'This wallet belongs to a different holder. Recover its documents or connect the wallet bound to this vault.' : 'Wallet binding found. Use the recovery panel below to open a document with your wallet.'}</p>}{w.wallet && !w.holder && !seed && <p className="footnote">Unlock or create your local vault to bind it to this wallet and save a recoverable TEE copy.</p>}</section>;
}

import { Link } from 'react-router-dom';
import { ArrowUpRight, Bot, Fingerprint, Layers3, LockKeyhole, ShieldCheck, Wallet } from 'lucide-react';
import type { Config } from '../shared/types.js';

export default function NearIntegration({ config }: { config: Config | null }) {
  const contract = config?.contract, tee = contract?.tee;
  return <main className="workspace-main near-page">
    <div className="page-intro"><span className="eyebrow">BUILT ON NEAR</span><h1>Permissions with a public record.<br/>Credentials with a private home.</h1><p>NEAR controls who may use a credential. OutLayer’s confidential worker stores private copies and returns only the approved proof.</p></div>
    <div className="near-role-grid">
      <section className="panel"><div className="tile-icon"><Wallet/></div><h2>NEAR wallet identity</h2><p>NEP-413 signed login authenticates the wallet against a live NEAR full-access key. A holder-signed binding lets the wallet find its records and sign recovery transactions.</p><code>bind_holder_wallet · recover_private_copy</code></section>
      <section className="panel"><div className="tile-icon"><Fingerprint/></div><h2>Credentials and consent</h2><p>A NEAR contract records salted document fingerprints, issuer keys, expiry and revocation. Signed agent grants specify the approved fields, agent identity, duration and execution allowance.</p><code>mint_record · reserve_private · revoke_agent</code></section>
      <section className="panel"><div className="tile-icon"><Bot/></div><h2>Confidential execution</h2><p>Facet calls OutLayer from the NEAR contract using a hash-pinned Rust WASI worker. Each authorized run checks permission and usage, then encrypts a browser-prepared BBS presentation for the approved recipient.</p><code>execute_agent → request_execution → on_private_execution</code></section>
    </div>
    <section className="panel near-evidence" aria-label="Integration verification status">
      <span className="badge">Partial verification</span><h2>Real testnet receipts. Incomplete browser coverage.</h2>
      <p>Live NEAR and OutLayer executions demonstrate sealed copies, scoped agent deliveries and owner recovery. The full private browser workflow has not passed: some OutLayer executions settle after their NEAR callback expires. A pending or failed receipt does not establish successful storage or disclosure.</p>
      <p>The external agent with a locked vault has not been verified through live HTTP. Manual Meteor/Intear wallet compatibility and the complete hosted private browser workflow remain untested.</p>
      <a className="text-link" href="/near-verification.json" target="_blank" rel="noreferrer">Inspect results and transactions<ArrowUpRight size={14}/></a>
    </section>
    <section className="panel near-details">
      <div className="panel-heading"><h2>Inspect the testnet integration.</h2><Layers3 size={20}/></div>
      <p>Wallet bindings, issuer status, grants and receipts are public. Original files, holder secrets and hidden credential fields remain in the local encrypted vault or the optional TEE copy.</p>
      <dl><dt>Network</dt><dd>NEAR testnet</dd><dt>Facet contract</dt><dd>{contract ? <a className="text-link" href={`https://testnet.nearblocks.io/address/${contract.contract_id}`} target="_blank" rel="noreferrer">{contract.contract_id}<ArrowUpRight size={14}/></a> : 'Loading live configuration…'}</dd><dt>OutLayer contract</dt><dd><a className="text-link" href="https://testnet.nearblocks.io/address/outlayer.testnet" target="_blank" rel="noreferrer">outlayer.testnet<ArrowUpRight size={14}/></a></dd><dt>Private worker project</dt><dd><code>{tee?.project_id || 'Not configured'}</code></dd><dt>Exact worker SHA-256</dt><dd><code>{tee?.worker_hash || 'Not configured'}</code></dd></dl>
      <div className="detail-actions"><Link className="button primary" to="/agents"><Bot size={16}/>Try wallet and agent access</Link><a className="button outline" href="/near-verification.json" target="_blank" rel="noreferrer"><ShieldCheck size={16}/>Inspect integration checks</a>{tee?.worker_url && <a className="button quiet" href={tee.worker_url} download><Layers3 size={16}/>Download worker</a>}<a className="text-link" href="https://github.com/ckay7000/facet/tree/main/contracts/facet" target="_blank" rel="noreferrer">Contract source<ArrowUpRight size={14}/></a></div>
    </section>
    <section className="panel near-trust"><LockKeyhole size={22}/><div><h2>What these checks establish.</h2><p>BBS mathematics run in the browser and verification service. The TEE checks holder/request signatures and exact disclosure scope, and delivers preapproved presentations; it does not verify BBS mathematics itself. OutLayer supplies execution attestations. Facet does not independently verify the complete attestation chain, and project administrators can publish other versions with access to project-bound keys.</p><p>This is a funded testnet prototype with fictional issuer claims and a deterministic demo agent. A real AI agent can call the same scoped capability API.</p><Link className="text-link" to="/privacy">Privacy and trust boundaries<ArrowUpRight size={14}/></Link></div></section>
  </main>;
}

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Bot, Check, Download, EyeOff, FileCheck2, Fingerprint, LockKeyhole, RefreshCw, ShieldCheck, ShieldX, Wallet } from 'lucide-react';
import type { ChainRecord, Config, DocumentItem, FieldId, Presentation, SignedRequest, VaultData, VerificationResult } from '../shared/types.js';
import { agentAuthPublic, fieldMask, maskFields, MAX_TEE_FILE_BYTES, openAgentDelivery, openOwnerDelivery, recoveryKeys, revokeText, sealToKeystore, signAgentRequest, signApproval, signText, type AgentAccess, type AgentGrant, type CopyPacket, type GrantPacket, type PrivateApproval, type PrivateJob } from '../shared/agent.js';
import { canonical, checkPresentation, decode, derivePresentation, FIELDS, hash, holderPublic, randomHex, validRequestShape, verifyJson } from '../shared/crypto.js';
import type { PrivateConfig } from '../server/tee.js';
import { download } from './storage';
import { api } from './api';
import { WalletPanel, useWallet } from './Wallet';

type Props = { data: VaultData | null; config: Config | null; busy: boolean; hasLocalVault: boolean; save: (data: VaultData) => Promise<void>; restore: (copy: CopyPacket, password: string) => Promise<void>; run: (label: string, fn: () => Promise<void>) => Promise<void>; notify: (text: string) => void; refreshConfig: () => Promise<void> };
type Recovery = { job_id: string; token_id: string; secret: string; public_key: string; account_id: string; contract_id: string; expires_at: number };
const PENDING_RECOVERY = 'facet_pending_recovery';
const date = (n: number) => new Date(n).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const short = (s: string) => `${s.slice(0, 8)}…${s.slice(-6)}`;
const terminal = (job: PrivateJob) => ['ready', 'failed', 'blocked'].includes(job.state);
export async function waitPrivateJob(jobId: string, initial?: PrivateJob, onUpdate?: (job: PrivateJob) => void) {
  let job = initial;
  const until = Date.now() + 150000;
  while (!job || !terminal(job)) {
    if (Date.now() > until) throw new Error('Private execution is still pending. Your request is on NEAR; refresh its status before creating another.');
    await new Promise(resolve => setTimeout(resolve, 2000));
    job = (await api<{ job: PrivateJob | null }>(`agent?job=${jobId}`)).job || undefined;
    if (job) onUpdate?.(job);
  }
  onUpdate?.(job);
  if (['copy', 'grant'].includes(job.kind)) await api('agent', { operation: 'cleanup', job_id: job.id }).catch(() => {});
  if (job.state !== 'ready' || !job.output) throw new Error(`The private worker declined this job: ${(job.error_code || job.state).replaceAll('_', ' ')}.`);
  return job;
}
function Receipt({ hash }: { hash: string }) { return <a className="text-link" href={`https://testnet.nearblocks.io/txns/${hash}`} target="_blank" rel="noreferrer">View NEAR receipt<ArrowUpRight size={14}/></a>; }

export default function Agents(p: Props) {
  const w = useWallet(), current = useRef(p); current.current = p;
  const [privateSettings, setPrivateSettings] = useState<PrivateConfig | null>(null), [selected, setSelected] = useState('');
  const [fields, setFields] = useState<FieldId[]>(['course', 'achievement']), [purpose, setPurpose] = useState('Confirm completion of privacy training');
  const [minutes, setMinutes] = useState(10), [uses, setUses] = useState(1), [copyConsent, setCopyConsent] = useState(false), [agentConsent, setAgentConsent] = useState(false);
  const [grants, setGrants] = useState<AgentGrant[]>([]), [jobs, setJobs] = useState<{ job: PrivateJob; transaction: string | null }[]>([]);
  const [result, setResult] = useState<VerificationResult | null>(null), [records, setRecords] = useState<ChainRecord[]>([]);
  const [recovery, setRecovery] = useState<Recovery | null>(null), [recovered, setRecovered] = useState<CopyPacket | null>(null), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [replaceConsent, setReplaceConsent] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const documents = p.data?.documents || [], item = documents.find(d => d.id === selected) || documents[documents.length - 1];
  const holder = p.data ? holderPublic(p.data.holder_seed) : w.holder;
  const bound = !!p.data && !!w.wallet && w.holder === holder;
  const recordCopy = item?.tee_copy || item?.record?.private_copy;
  const eligible = !!item?.credential && !!item.record && !item.record.revoked && item.record.expires_at > clock;
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(t); }, []);
  async function refresh() {
    const tasks: Promise<unknown>[] = [api<PrivateConfig>('agent').then(setPrivateSettings)];
    if (holder) tasks.push(api<{ grants: AgentGrant[] }>(`agent?owner=${holder}`).then(r => setGrants(r.grants)));
    if (w.wallet) tasks.push(api<{ records: ChainRecord[] }>('agent?wallet=records').then(r => setRecords(r.records)));
    const results = await Promise.allSettled(tasks);
    for (const r of results) if (r.status === 'rejected') throw r.reason;
  }
  useEffect(() => { void refresh().catch(() => {}); }, [holder, w.wallet?.account_id]);
  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_RECOVERY); if (!raw) return;
    try { const value = JSON.parse(raw) as Recovery; if (value.expires_at > Date.now() && /^[a-f0-9]{64}$/.test(value.secret)) setRecovery(value); else sessionStorage.removeItem(PENDING_RECOVERY); } catch { sessionStorage.removeItem(PENDING_RECOVERY); }
  }, []);
  useEffect(() => { setCopyConsent(false); setAgentConsent(false); }, [item?.id, fields.join(','), purpose, minutes, uses]);
  function track(job: PrivateJob, transaction: string | null = null) { setJobs(list => [{ job, transaction }, ...list.filter(j => j.job.id !== job.id)].slice(0, 8)); }
  async function refreshJob(jobId: string, transaction: string | null) {
    const job = (await api<{ job: PrivateJob | null }>(`agent?job=${jobId}`)).job;
    if (!job) throw new Error('This execution receipt was not found on NEAR.');
    track(job, transaction);
    if (terminal(job) && ['copy', 'grant'].includes(job.kind)) await api('agent', { operation: 'cleanup', job_id: job.id }).catch(() => {});
    const vault = current.current.data;
    if (job.kind === 'copy' && job.state === 'ready' && vault && job.owner_id === holderPublic(vault.holder_seed)) {
      const record = (await api<{ record: ChainRecord }>(`record?token=${job.token_id}`)).record;
      await p.save({ ...vault, documents: vault.documents.map(d => d.id === job.token_id ? { ...d, record, tee_copy: record.private_copy, credential: d.credential ? { ...d.credential, record } : null } : d) });
    }
    await refresh();
    p.notify(`NEAR execution status: ${job.state}${job.error_code ? ` · ${job.error_code.replaceAll('_', ' ')}` : ''}.`);
  }
  async function ready() { const c = await api<PrivateConfig>('agent'); setPrivateSettings(c); if (!c.ready || !c.tee || !p.config?.contract) throw new Error(c.message || 'Private execution is not ready.'); return c as PrivateConfig & { tee: NonNullable<PrivateConfig['tee']> }; }
  async function storeCopy() {
    if (!p.data || !item?.record || !bound || !copyConsent) throw new Error('Bind your wallet and approve this private copy first.');
    if (decode(item.data).length > MAX_TEE_FILE_BYTES) throw new Error('The TEE demo supports original files up to 64 KiB. Your larger local copy remains encrypted and available.');
    const c = await ready(), { tee_copy: _copy, ...document } = item;
    const packet: CopyPacket = { version: 'facet-private-copy-v1', holder_seed: p.data.holder_seed, document };
    const zero = '0'.repeat(64), approval: PrivateApproval = { operation: 'copy', job_id: randomHex(), token_id: item.id, packet_hash: hash(canonical(packet)), fields_mask: 0, expires_at: 0, max_uses: 0, purpose_hash: zero, delivery_key_hash: zero, auth_key: zero, copy_hash: zero, worker_hash: c.tee.worker_hash, project_id: c.tee.project_id };
    const response = await api<{ job: PrivateJob; transaction: { hash: string } | null }>('agent', { operation: 'store', approval, holder_signature: signApproval(p.config!.contract!.contract_id, approval, p.data.holder_seed), encrypted_input: sealToKeystore(packet, c.encryption_public_key) });
    track(response.job, response.transaction?.hash || null);
    await waitPrivateJob(approval.job_id, response.job, job => track(job, response.transaction?.hash || null));
    const record = (await api<{ record: ChainRecord }>(`record?token=${item.id}`)).record;
    await p.save({ ...current.current.data!, documents: current.current.data!.documents.map(d => d.id === item.id ? { ...d, record, tee_copy: record.private_copy, credential: d.credential ? { ...d.credential, record } : null } : d) });
    setCopyConsent(false); await refresh(); p.notify('Your recoverable private copy is sealed in the TEE. NEAR recorded its fingerprint and execution receipt.');
  }
  async function approveAgent() {
    if (!p.data || !item?.credential || !recordCopy || !bound || !agentConsent || !fields.length) throw new Error('Select an active private credential and explicitly approve the fields and limits.');
    const c = await ready(), contract = p.config!.contract!.contract_id;
    const prepared = await api<{ requests: SignedRequest[]; agent_id: string; expires_at: number }>('agent', { operation: 'requests', token_id: item.id, fields, purpose, minutes, max_uses: uses });
    if (prepared.requests.length !== uses || prepared.agent_id !== c.tee.agent_id || prepared.requests.some(r => !validRequestShape(r) || !verifyJson(r.payload, r.signature, p.config!.request_public_key) || r.payload.audience !== c.tee.agent_id || r.payload.purpose !== purpose.trim() || r.payload.expires_at !== prepared.expires_at || fieldMask(r.payload.fields) !== fieldMask(fields))) throw new Error('The agent request differs from the fields you approved.');
    const presentations: Presentation[] = [];
    for (const request of prepared.requests) presentations.push(await derivePresentation(item.credential, request, p.data.holder_seed));
    const grantId = randomHex(), deliveryKey = randomHex(32);
    const packet: GrantPacket = { version: 'facet-private-grant-v1', grant_id: grantId, owner_id: holder!, token_id: item.id, copy_hash: recordCopy.packet_hash, delivery_key: deliveryKey, presentations };
    const approval: PrivateApproval = { operation: 'grant', job_id: grantId, token_id: item.id, packet_hash: hash(canonical(packet)), fields_mask: fieldMask(fields), expires_at: prepared.expires_at, max_uses: uses, purpose_hash: hash(purpose.trim()), delivery_key_hash: hash(deliveryKey), auth_key: agentAuthPublic(deliveryKey), copy_hash: recordCopy.packet_hash, worker_hash: c.tee.worker_hash, project_id: c.tee.project_id };
    const access: AgentAccess = { grant_id: grantId, token_id: item.id, delivery_key: deliveryKey, purpose: purpose.trim(), fields, expires_at: prepared.expires_at };
    // Preserve the private delivery capability before dispatch, including if an HTTP reply is lost.
    await p.save({ ...current.current.data!, agent_access: [...(current.current.data!.agent_access || []), access], receipts: [...current.current.data!.receipts, { id: grantId, document_id: item.id, audience: c.tee.agent_id, purpose: `${purpose.trim()} · ${uses} execution${uses === 1 ? '' : 's'} until ${date(prepared.expires_at)}`, fields, when: Date.now(), accepted: false, proof_hash: approval.packet_hash, transaction_hash: null }] });
    const response = await api<{ job: PrivateJob; transaction: { hash: string } | null }>('agent', { operation: 'store', approval, holder_signature: signApproval(contract, approval, p.data.holder_seed), encrypted_input: sealToKeystore(packet, c.encryption_public_key) });
    track(response.job, response.transaction?.hash || null);
    await waitPrivateJob(grantId, response.job, job => track(job, response.transaction?.hash || null));
    await p.save({ ...current.current.data!, receipts: current.current.data!.receipts.map(r => r.id === grantId ? { ...r, transaction_hash: response.transaction?.hash || null } : r) });
    setAgentConsent(false); await refresh(); p.notify('Agent permission recorded on NEAR. The agent can request only your approved proof within these limits.');
  }
  async function useGrant(grant: AgentGrant, access: AgentAccess) {
    setResult(null); const jobId = randomHex();
    const response = await api<{ job: PrivateJob; transaction: { hash: string } }>('agent', { operation: 'run', grant_id: grant.id, job_id: jobId, request_signature: signAgentRequest(grant.id, jobId, access.delivery_key) });
    track(response.job, response.transaction.hash);
    const job = await waitPrivateJob(jobId, response.job, job => track(job, response.transaction.hash));
    const proof = await openAgentDelivery(job.output!, access.delivery_key);
    const config = await api<Config>('config'), record = (await api<{ record: ChainRecord }>(`record?token=${grant.token_id}`)).record;
    if (!config.issuer || !config.contract || proof.request.payload.audience !== grant.agent_id || fieldMask(proof.request.payload.fields) !== grant.fields_mask || proof.request.payload.expires_at !== grant.expires_at) throw new Error('The delivered proof differs from the approved agent permission.');
    const checks = await checkPresentation(proof, record, config.issuer, config.request_public_key, config.contract.contract_id);
    if (!checks.every(c => c.ok)) throw new Error('The agent proof failed independent browser checks.');
    const verified = await api<VerificationResult>('verify', { presentation: proof }); setResult(verified);
    if (current.current.data) await p.save({ ...current.current.data, receipts: [...current.current.data.receipts, { id: proof.request.payload.nonce, document_id: proof.token_id, audience: proof.request.payload.audience, purpose: proof.request.payload.purpose, fields: proof.request.payload.fields, when: Date.now(), accepted: verified.accepted, proof_hash: verified.proof_hash, transaction_hash: verified.transaction?.hash || null }] });
    await refresh(); await p.refreshConfig(); p.notify(verified.accepted ? 'The demo agent proved the approved training facts. Hidden credential fields and the original document stayed private.' : 'The agent proof was rejected by current credential checks.');
  }
  async function revoke(grant: AgentGrant) {
    if (!current.current.data || !p.config?.contract) throw new Error('Unlock the holder vault to revoke permission.');
    const response = await api<{ transaction: { hash: string } }>('agent', { operation: 'revoke', grant_id: grant.id, holder_signature: signText(revokeText(p.config.contract.contract_id, grant.id), current.current.data.holder_seed) });
    await refresh(); p.notify('Revoked on NEAR. Future agent executions are blocked; previously delivered proofs can still be retained.');
    if (current.current.data) await p.save({ ...current.current.data, receipts: current.current.data.receipts.map(r => r.id === grant.id ? { ...r, transaction_hash: response.transaction.hash } : r) });
  }
  async function finishRecovery(value: Recovery, transaction: string | null = null) {
    if (!w.wallet || value.account_id !== w.wallet.account_id || value.contract_id !== p.config?.contract?.contract_id || value.expires_at <= Date.now()) throw new Error('Reconnect the owner wallet and start a fresh recovery.');
    const job = await waitPrivateJob(value.job_id, undefined, job => track(job, transaction));
    const copy = await openOwnerDelivery(job.output!, value.secret);
    if (holderPublic(copy.holder_seed) !== w.holder || copy.document.id !== value.token_id) throw new Error('The recovered document does not belong to this wallet.');
    setRecovered(copy); setRecovery(null); sessionStorage.removeItem(PENDING_RECOVERY); p.notify('Your wallet-authorized copy opened in this browser. Save it into your local encrypted vault below.');
  }
  async function recover(record: ChainRecord) {
    if (!w.wallet || !p.config?.contract) throw new Error('Connect the owner wallet first.');
    const keys = recoveryKeys(), value: Recovery = { job_id: randomHex(), token_id: record.token_id, secret: keys.secret, public_key: keys.public_key, account_id: w.wallet.account_id, contract_id: p.config.contract.contract_id, expires_at: Date.now() + 10 * 60000 };
    sessionStorage.setItem(PENDING_RECOVERY, JSON.stringify(value)); setRecovery(value);
    const transaction = await w.recover(value.contract_id, value.token_id, value.job_id, value.public_key);
    await finishRecovery(value, transaction);
  }
  async function saveRecovered() {
    if (!recovered) return;
    if (!p.data && (password.length < 10 || password !== confirmation)) throw new Error('Use a matching new password of at least 10 characters.');
    if (!p.data && p.hasLocalVault && !replaceConsent) throw new Error('Approve replacing this device’s locked vault before restoring.');
    await p.restore(recovered, password); setRecovered(null); setPassword(''); setConfirmation(''); setReplaceConsent(false); await refresh();
  }
  return <main className="workspace-main agents-page"><div className="page-intro"><span className="eyebrow">WALLET. VAULT. PERMISSION.</span><h1>Let your agent prove just enough.</h1><p>Keep a recoverable private copy. Approve specific facts. Let NEAR enforce each use.</p></div>
    <section className="panel private-availability" aria-label="Private execution availability"><h2>Experimental TEE access.</h2><p>OutLayer testnet jobs can expire before confirmation. A copy or permission is saved only when its receipt says ready. Refresh a pending receipt before retrying; failed agent runs consume the allowance.</p><Link className="text-link" to="/near">See current integration evidence<ArrowUpRight size={14}/></Link></section>
    <WalletPanel seed={p.data?.holder_seed} contract={p.config?.contract?.contract_id} busy={p.busy} run={p.run}/>
    <div className="agent-steps"><span><Wallet size={17}/>Connect your wallet</span><span><LockKeyhole size={17}/>Save a private copy</span><span><Bot size={17}/>Approve agent access</span></div>
    {p.data ? <div className="agent-setup-grid"><section className="panel agent-copy-panel"><div className="panel-heading"><h2>Keep a recoverable copy.</h2><LockKeyhole size={19}/></div><p className="panel-description">The original, signed credential and holder key are encrypted here before the TEE receives them. Your connected wallet can recover that copy on another device.</p>
      {documents.length ? <><label>Private document<select aria-label="Private document for agent" value={item?.id || ''} onChange={e => setSelected(e.target.value)} disabled={p.busy}>{documents.map(d => <option key={d.id} value={d.id}>{d.title}{d.credential ? ' · issuer signed' : ' · self-recorded'}</option>)}</select></label><div className="private-copy-status"><FileCheck2/><div><strong>{recordCopy ? 'Private TEE copy recorded' : item?.record ? 'Ready for your approval' : 'Create its NEAR record first'}</strong><small>{recordCopy ? `Commitment ${short(recordCopy.packet_hash)}` : 'Local original stays encrypted on this device'}</small></div><span className={`badge ${recordCopy ? 'blue' : ''}`}>{recordCopy ? 'Stored' : 'Local only'}</span></div>
      {!recordCopy && <><label className="consent-check"><input type="checkbox" checked={copyConsent} onChange={e => setCopyConsent(e.target.checked)} disabled={p.busy}/>I approve storing this document, credential and holder key in the TEE for wallet recovery and scoped agent use.</label><button className="button primary full" disabled={p.busy || !bound || !item?.record || !copyConsent || !privateSettings?.ready || decode(item?.data || '').length > MAX_TEE_FILE_BYTES} onClick={() => void p.run('Encrypting and sealing your private copy through NEAR…', storeCopy)}><LockKeyhole size={16}/>Save private TEE copy</button></>}
      {item && decode(item.data).length > MAX_TEE_FILE_BYTES && <p className="form-error">This original exceeds the TEE demo’s 64 KiB limit. Its larger local encrypted copy is still available.</p>}{recordCopy && <a className="text-link" href={`https://testnet-api.outlayer.ai`} target="_blank" rel="noreferrer">Private execution recorded on NEAR<ArrowUpRight size={14}/></a>}</> : <div className="agent-empty"><FileCheck2/><h3>Start with a private credential.</h3><p>Issue the fictional training credential in your vault, then return here.</p><Link className="button outline" to="/vault">Open vault<ArrowUpRight size={16}/></Link></div>}
      <p className="footnote">Originals up to 64 KiB in this funded testnet demo. The TEE copy uses project-bound keys; the worker and project administrators are part of the trust boundary. <Link className="text-link" to="/privacy">Read the details</Link></p></section>
    <section className="panel agent-consent-panel"><div className="panel-heading"><h2>Choose what the agent sees.</h2><Bot size={19}/></div><p className="panel-description">The training eligibility agent checks the facts you select. This demo uses a deterministic agent; an AI agent can use the same scoped access package.</p><fieldset><legend>Approved credential fields</legend><div className="field-options">{FIELDS.map(f => <label className="field-option" key={f.id}><input type="checkbox" checked={fields.includes(f.id)} disabled={p.busy} onChange={() => setFields(list => list.includes(f.id) ? list.filter(v => v !== f.id) : [...list, f.id])}/><span>{f.label}</span>{f.sensitive && <EyeOff size={14}/>}</label>)}</div></fieldset>
      <div className="disclosure-preview agent-preview">{FIELDS.map(f => <div className={fields.includes(f.id) ? 'revealed' : 'hidden'} key={f.id}><span>{f.label}</span><strong>{fields.includes(f.id) && eligible ? item!.credential!.messages[f.index] : fields.includes(f.id) ? 'Credential needed' : 'Kept private'}</strong>{fields.includes(f.id) ? <Check size={14}/> : <EyeOff size={14}/>}</div>)}</div><label>Purpose<input aria-label="Agent purpose" value={purpose} maxLength={160} onChange={e => setPurpose(e.target.value)} disabled={p.busy}/></label><div className="agent-limits"><label>Permission expires<select aria-label="Agent permission duration" value={minutes} onChange={e => setMinutes(Number(e.target.value))} disabled={p.busy}><option value={5}>In 5 minutes</option><option value={10}>In 10 minutes</option><option value={15}>In 15 minutes</option></select></label><label>Execution allowance<select aria-label="Agent execution allowance" value={uses} onChange={e => setUses(Number(e.target.value))} disabled={p.busy}>{[1, 2, 3].map(n => <option key={n} value={n}>{n} execution{n === 1 ? '' : 's'}</option>)}</select></label></div><label className="consent-check"><input type="checkbox" checked={agentConsent} onChange={e => setAgentConsent(e.target.checked)} disabled={p.busy}/>I approve only the selected facts for this purpose, duration and execution allowance.</label><button className="button primary full" disabled={p.busy || !bound || !eligible || !recordCopy || !fields.length || !purpose.trim() || !agentConsent || !privateSettings?.ready} onClick={() => void p.run('Preparing your approved BBS proofs and recording agent permission on NEAR…', approveAgent)}><Fingerprint size={17}/>Approve agent permission</button><p className="footnote">Required public bindings also accompany every proof: holder ID, token ID, credential type, expiry and salted fingerprint. Failed executions consume the allowance. Revocation blocks future requests.</p></section></div> : <section className="panel agent-locked"><LockKeyhole/><div><h2>Unlock your vault to approve an agent.</h2><p>Wallet recovery is available below if this is another device or you no longer have the local password.</p><Link className="text-link" to="/vault">Unlock or create a vault<ArrowUpRight size={15}/></Link></div></section>}
    {privateSettings && !privateSettings.ready && <p className="footnote" role="status">{privateSettings.message}</p>}
    <section className="panel agent-grants"><div className="panel-heading"><h2>Your agent permissions.</h2><button className="text-link" disabled={p.busy} onClick={() => void p.run('Refreshing NEAR permissions…', refresh)}><RefreshCw size={14}/>Refresh</button></div>{!grants.length ? <p className="panel-description">Your approved agent permissions will appear here with their current status on NEAR.</p> : grants.slice().reverse().map(g => { const access = p.data?.agent_access?.find(a => a.grant_id === g.id), active = g.ready && !g.revoked && g.expires_at > clock && g.used < g.max_uses; const status = g.revoked ? 'Revoked' : g.expires_at <= clock ? 'Expired' : g.used >= g.max_uses ? 'Allowance used' : g.ready ? 'Active' : 'Pending'; return <article className="agent-grant" key={g.id}><div className="tile-icon lavender"><Bot/></div><div className="agent-grant-details"><strong>Training eligibility agent</strong><p>{access?.purpose || 'Purpose stored as a private commitment'}</p><div className="field-chips">{maskFields(g.fields_mask).map(id => <span className="badge" key={id}>{FIELDS.find(f => f.id === id)?.label}</span>)}</div><small>{g.used} / {g.max_uses} executions · expires {date(g.expires_at)} · <code>{short(g.id)}</code></small><a className="text-link" href={`https://testnet.nearblocks.io/address/${g.agent_id}`} target="_blank" rel="noreferrer">Agent’s NEAR identity<ArrowUpRight size={13}/></a></div><div className="agent-grant-actions"><span className={`badge ${active ? 'blue' : g.revoked ? 'red' : ''}`}>{status}</span><button className="button primary small" disabled={p.busy || !active || !access} onClick={() => void p.run('Agent requesting an approved proof from the TEE through NEAR…', () => useGrant(g, access!))}><Bot size={15}/>Run demo agent</button>{access && <button className="text-link" disabled={p.busy} onClick={() => download('facet-private-agent-access.json', JSON.stringify({ version: 'facet-agent-access-v1', network: 'testnet', contract_id: p.config?.contract?.contract_id, agent_id: g.agent_id, access }))}><Download size={13}/>Export private agent access</button>}{!g.revoked && p.data && <button className="text-link danger" disabled={p.busy} onClick={() => void p.run('Revoking agent permission on NEAR…', () => revoke(g))}>Revoke permission</button>}</div></article>; })}<p className="footnote">An agent access export is a private capability. Give it only to the intended agent. The broker receives a signed request; the agent decrypts the approved proof with the delivery key. Locking the local vault does not revoke an existing grant.</p></section>
    {result && <section className="panel agent-result" aria-live="polite"><div className="panel-heading"><h2>{result.accepted ? 'The agent proved your approved facts.' : 'The proof was rejected.'}</h2>{result.accepted ? <ShieldCheck/> : <ShieldX/>}</div><div className="verified-claims">{result.claims.map(c => <div key={c.field}><span>{c.label}</span><strong>{c.value}</strong><Check size={16}/></div>)}</div><p className="panel-description">The recipient decrypted and independently verified this BBS presentation. Unselected personal fields and the original document are absent.</p>{result.transaction && <Receipt hash={result.transaction.hash}/>}</section>}
    <section className="panel wallet-recovery"><div className="panel-heading"><h2>Recover on this device.</h2><Wallet size={19}/></div><p className="panel-description">Your owner wallet signs a NEAR recovery request. The TEE encrypts the copy for a fresh key in this browser, where you choose a new local vault password.</p>{!w.wallet ? <p className="footnote">Connect your owner wallet to find recoverable records.</p> : records.some(r => r.private_copy) ? <div className="recovery-records">{records.filter(r => r.private_copy).map(r => <div key={r.token_id}><div><strong>{r.kind === 'demo_issued' ? 'Private training credential' : 'Private document'}</strong><code>{short(r.token_id)}</code></div><button className="button outline small" disabled={p.busy} onClick={() => void p.run('Waiting for your wallet-approved NEAR recovery and private delivery…', () => recover(r))}><Download size={15}/>Recover copy</button></div>)}</div> : <p className="footnote">No TEE copies are bound to this wallet yet. Save a private copy from an unlocked vault first.</p>}
      {recovery && recovery.account_id === w.wallet?.account_id && <div className="recovery-pending"><p>A recovery request is saved in this tab. Finish after the wallet transaction confirms.</p><button className="button outline small" disabled={p.busy} onClick={() => void p.run('Opening your wallet-authorized private delivery…', () => finishRecovery(recovery))}>Finish pending recovery</button><button className="button quiet small" disabled={p.busy} onClick={() => { setRecovery(null); sessionStorage.removeItem(PENDING_RECOVERY); }}>Clear pending request</button></div>}
      {recovered && <form className="recovery-save" onSubmit={e => { e.preventDefault(); void p.run('Saving the recovered document into your encrypted local vault…', saveRecovered); }}><div className="private-copy-status"><ShieldCheck/><div><strong>{recovered.document.title}</strong><small>Recovered in this browser · holder and file bindings checked</small></div></div>{!p.data && <><label>New local vault password<input aria-label="Recovered vault password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={e => setPassword(e.target.value)} disabled={p.busy}/></label><label>Confirm new password<input aria-label="Confirm recovered vault password" type="password" autoComplete="new-password" required minLength={10} value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={p.busy}/></label>{p.hasLocalVault && <label className="consent-check"><input type="checkbox" required checked={replaceConsent} onChange={e => setReplaceConsent(e.target.checked)} disabled={p.busy}/>Replace this device’s locked encrypted vault. I have saved any backup I need.</label>}</>}<button className="button primary" disabled={p.busy}><LockKeyhole size={16}/>{p.data ? 'Add to unlocked vault' : 'Create vault from recovery'}</button><button className="button quiet" type="button" disabled={p.busy} onClick={() => { setRecovered(null); setPassword(''); setConfirmation(''); }}>Close private copy</button></form>}
      <p className="footnote">Recovery restores each saved document and the holder key. Local consent history and prior agent delivery keys need your encrypted backup. Wallet access is powerful: keep your wallet keys safe.</p></section>
    {jobs.length > 0 && <section className="panel private-jobs"><div className="panel-heading"><h2>Private execution receipts.</h2><ShieldCheck size={19}/></div>{jobs.map(({ job, transaction }) => <div className="private-job" key={job.id}><div><strong>{{ copy: 'Store private copy', grant: 'Prepare agent permission', use: 'Deliver agent proof', recover: 'Recover owner copy' }[job.kind]}</strong><small><code>{short(job.id)}</code> · {job.state} · worker <code>{short(job.worker_hash)}</code></small></div>{transaction && <Receipt hash={transaction}/>}<button className="text-link" disabled={p.busy} onClick={() => void p.run('Reading the execution receipt from NEAR…', () => refreshJob(job.id, transaction))}><RefreshCw size={13}/>Refresh receipt</button><button className="text-link" disabled={p.busy} onClick={() => download(`facet-private-job-${job.id}.json`, JSON.stringify(job))}>Inspect public receipt<ArrowUpRight size={13}/></button></div>)}</section>}
    <div className="vault-tip"><ShieldCheck size={19}/><p>NEAR records wallet bindings, issuer status, signed permissions, revocations and execution receipts. Private credentials live in encrypted TEE storage. <Link className="text-link" to="/near">See how Facet uses NEAR<ArrowUpRight size={14}/></Link></p></div>
  </main>;
}

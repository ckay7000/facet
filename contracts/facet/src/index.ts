import { NearBindgen, near, initialize, call, view, assert, validateAccountId } from 'near-sdk-js';
import { teeConfig, configureTee, reservePrivate, claimPrivateIngress, failPrivateIngress, executePrivate, executeAgent, revokeAgent, bindWallet, walletRecords, recoverCopy, getPrivateJob, getAgentGrant, listAgentGrants, onPrivateExecution } from './vault.js';
type RecordKind = 'self_recorded' | 'demo_issued';
type Record = { token_id: string; owner_id: string; commitment: string; kind: RecordKind; issuer_id: string | null; issued_at: number; expires_at: number; revoked: boolean; revoked_at: number | null };
function load<T>(key: string): T | null { const value = near.storageRead(key); return value === null ? null : JSON.parse(value) as T; }
function save(key: string, value: unknown) { near.storageWrite(key, JSON.stringify(value)); }
function now() { return Number(near.blockTimestamp() / 1000000n); }
function tokenId(id: string) { assert(typeof id === 'string' && /^facet_[a-f0-9]{32}$/.test(id), 'Invalid credential identifier'); }
function hash(value: string) { assert(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'Invalid opaque commitment'); }
function event(event: string, data: unknown) { near.log('EVENT_JSON:' + JSON.stringify({ standard: 'facet', version: '1.0.0', event, data: [data] })); }

@NearBindgen({ requireInit: true })
export class Facet {
  owner_id = ''; issuer_account = ''; verifier_account = ''; request_public_key = ''; issuer_key = ''; issuer_active = true;
  records = 0; checks = 0; daily_cap = 40; day = ''; minted_today = 0;
  tee_project_id = ''; tee_worker_url = ''; tee_worker_hash = ''; tee_broker_id = ''; tee_agent_id = ''; tee_daily_limit = 32; tee_day = ''; tee_jobs_today = 0; tee_jobs_total = 0;
  @initialize({})
  init({ owner_id, issuer_account, verifier_account, request_public_key, issuer_key, daily_cap = 40 }: { owner_id: string; issuer_account: string; verifier_account: string; request_public_key: string; issuer_key: string; daily_cap?: number }) {
    assert(validateAccountId(owner_id) && validateAccountId(issuer_account) && validateAccountId(verifier_account), 'Invalid authority');
    hash(request_public_key); assert(typeof issuer_key === 'string' && issuer_key.length === 128, 'Invalid BBS issuer key');
    assert(Number.isInteger(daily_cap) && daily_cap >= 1 && daily_cap <= 100, 'Invalid daily cap');
    this.owner_id = owner_id; this.issuer_account = issuer_account; this.verifier_account = verifier_account; this.request_public_key = request_public_key; this.issuer_key = issuer_key; this.daily_cap = daily_cap;
  }
  @view({}) get_config() { return { network: 'testnet', contract_id: near.currentAccountId(), issuer_account: this.issuer_account, verifier_account: this.verifier_account, request_public_key: this.request_public_key, records: this.records, checks: this.checks, daily_cap: this.daily_cap, minted_today: this.day === Math.floor(now() / 86400000).toString() ? this.minted_today : 0, tee: teeConfig(this) }; }
  @view({}) get_issuer({ issuer_id = 'facet-test-academy-v1' }: { issuer_id?: string } = {}) { return issuer_id === 'facet-test-academy-v1' ? { id: issuer_id, name: 'Facet Test Academy', public_key: this.issuer_key, active: this.issuer_active, demo: true } : null; }
  @call({}) set_issuer_active({ active }: { active: boolean }) { assert(near.predecessorAccountId() === this.owner_id, 'Only the registry administrator may change issuer trust'); assert(typeof active === 'boolean', 'Invalid issuer status'); this.issuer_active = active; }
  @call({}) set_issuer_relay({ account_id }: { account_id: string }) { assert(near.predecessorAccountId() === this.owner_id, 'Only the registry administrator may rotate the issuer relay'); assert(validateAccountId(account_id) && account_id.endsWith('.testnet'), 'Use an isolated testnet relay'); this.issuer_account = account_id; return { issuer_account: account_id }; }
  @call({}) mint_record({ token_id, owner_id, commitment, kind, expires_at }: { token_id: string; owner_id: string; commitment: string; kind: RecordKind; expires_at: number }) {
    assert(near.predecessorAccountId() === this.issuer_account, 'Only the registered issuer relay may mint records'); tokenId(token_id); hash(owner_id); hash(commitment);
    assert(kind === 'self_recorded' || kind === 'demo_issued', 'Invalid attestation type');
    const existing = load<Record>('record:' + token_id);
    if (existing) { assert(existing.owner_id === owner_id && existing.commitment === commitment && existing.kind === kind, 'Credential identifier already binds a different record'); return existing; }
    if (kind === 'demo_issued') assert(this.issuer_active, 'The demo issuer is suspended');
    assert(this.records < 500, 'The funded collection is full');
    const day = Math.floor(now() / 86400000).toString(); if (this.day !== day) { this.day = day; this.minted_today = 0; }
    assert(this.minted_today < this.daily_cap, 'Today’s funded minting allowance is full');
    assert(Number.isSafeInteger(expires_at) && (kind === 'self_recorded' ? expires_at === 0 : expires_at > now() && expires_at <= now() + 2 * 365 * 86400000), 'Invalid credential expiry');
    const record: Record = { token_id, owner_id, commitment, kind, issuer_id: kind === 'demo_issued' ? 'facet-test-academy-v1' : null, issued_at: now(), expires_at, revoked: false, revoked_at: null };
    save('record:' + token_id, record); save('index:' + this.records++, token_id); this.minted_today++;
    near.log('EVENT_JSON:' + JSON.stringify({ standard: 'nep171', version: '1.0.0', event: 'nft_mint', data: [{ owner_id, token_ids: [token_id] }] }));
    event('record_created', { token_id, kind }); return record;
  }
  @call({}) revoke_record({ token_id }: { token_id: string }) { assert(near.predecessorAccountId() === this.issuer_account, 'Only the registered issuer relay may revoke'); tokenId(token_id); const record = load<Record>('record:' + token_id); assert(record, 'Credential not found'); if (!record.revoked) { record.revoked = true; record.revoked_at = now(); save('record:' + token_id, record); event('credential_revoked', { token_id }); } return record; }
  @call({}) record_verification({ nonce_hash, token_id, proof_hash, expires_at }: { nonce_hash: string; token_id: string; proof_hash: string; expires_at: number }) {
    assert(near.predecessorAccountId() === this.verifier_account, 'Only the verification relay may record proof checks');
    hash(nonce_hash); hash(proof_hash); tokenId(token_id); assert(load('check:' + nonce_hash) === null, 'This verification request was already used');
    assert(Number.isSafeInteger(expires_at) && expires_at > now() && expires_at <= now() + 15 * 60000, 'The verification request has expired');
    const record = load<Record>('record:' + token_id); assert(record && record.kind === 'demo_issued' && !record.revoked && record.expires_at > now(), 'The credential is revoked, expired, or unverified');
    assert(this.issuer_active, 'The issuer is suspended');
    const check = { nonce_hash, token_id, proof_hash, checked_at: now() }; save('check:' + nonce_hash, check); this.checks++; event('proof_checked', check); return check;
  }
  @view({}) get_record({ token_id }: { token_id: string }) { tokenId(token_id); return load<Record>('record:' + token_id); }
  @view({}) get_verification({ nonce_hash }: { nonce_hash: string }) { hash(nonce_hash); return load('check:' + nonce_hash); }
  @view({}) nft_metadata() { return { spec: 'nft-1.0.0', name: 'Facet private credential records', symbol: 'FACET', icon: null, base_uri: null, reference: null, reference_hash: null }; }
  token(record: Record) { return { token_id: record.token_id, owner_id: record.owner_id, approved_account_ids: {}, metadata: { title: 'Facet private record', description: 'Holder-bound record. Document contents remain encrypted offchain.', media: null, media_hash: null, copies: 1, issued_at: String(record.issued_at), expires_at: record.expires_at ? String(record.expires_at) : null, starts_at: null, updated_at: record.revoked_at ? String(record.revoked_at) : null, extra: JSON.stringify({ kind: record.kind, commitment: record.commitment, issuer_id: record.issuer_id, revoked: record.revoked }), reference: null, reference_hash: null } }; }
  @view({}) nft_token({ token_id }: { token_id: string }) { const record = load<Record>('record:' + token_id); return record ? this.token(record) : null; }
  @view({}) nft_total_supply() { return String(this.records); }
  @view({}) nft_supply_for_owner({ account_id }: { account_id: string }) { let total = 0; for (let i = 0; i < this.records; i++) { const id = load<string>('index:' + i); const record = id && load<Record>('record:' + id); if (record && record.owner_id === account_id) total++; } return String(total); }
  @view({}) nft_tokens({ from_index = '0', limit = 30 }: { from_index?: string; limit?: number } = {}) { const start = Number(from_index); assert(Number.isSafeInteger(start) && start >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 100, 'Invalid pagination'); const tokens = []; for (let i = start; i < Math.min(this.records, start + limit); i++) { const id = load<string>('index:' + i); if (id) tokens.push(this.token(load<Record>('record:' + id)!)); } return tokens; }
  @view({}) nft_tokens_for_owner({ account_id, from_index = '0', limit = 30 }: { account_id: string; from_index?: string; limit?: number }) { const start = Number(from_index); assert(Number.isSafeInteger(start) && start >= 0 && Number.isInteger(limit) && limit > 0 && limit <= 100, 'Invalid pagination'); const out = []; let found = 0; for (let i = 0; i < this.records; i++) { const id = load<string>('index:' + i); const r = id && load<Record>('record:' + id); if (r && r.owner_id === account_id) { if (found++ >= start && out.length < limit) out.push(this.token(r)); } } return out; }
  @call({ payableFunction: true }) nft_transfer() { assert(false, 'Credential NFTs are holder-bound and cannot be transferred'); }
  @call({ payableFunction: true }) nft_transfer_call() { assert(false, 'Credential NFTs are holder-bound and cannot be transferred'); }
  @call({ payableFunction: true }) nft_approve() { assert(false, 'Credential NFTs do not allow marketplace approvals'); }
  @call({}) configure_tee(b: any) { return configureTee(this, b); }
  @call({}) reserve_private({ approval, holder_signature }: { approval: any; holder_signature: string }) { return reservePrivate(this, approval, holder_signature); }
  @call({}) execute_private({ job_id }: { job_id: string }) { return executePrivate(this, job_id); }
  @call({}) claim_private_ingress({ job_id }: { job_id: string }) { return claimPrivateIngress(this, job_id); }
  @call({}) fail_private_ingress({ job_id }: { job_id: string }) { return failPrivateIngress(this, job_id); }
  @call({}) execute_agent({ grant_id, job_id, request_signature }: { grant_id: string; job_id: string; request_signature: string }) { return executeAgent(this, grant_id, job_id, request_signature); }
  @call({}) revoke_agent({ grant_id, holder_signature }: { grant_id: string; holder_signature: string }) { return revokeAgent(this, grant_id, holder_signature); }
  @call({}) bind_holder_wallet({ wallet_id, holder_id, holder_signature }: { wallet_id: string; holder_id: string; holder_signature: string }) { return bindWallet(this, wallet_id, holder_id, holder_signature); }
  @call({}) recover_private_copy({ token_id, job_id, recipient_public_key }: { token_id: string; job_id: string; recipient_public_key: string }) { return recoverCopy(this, token_id, job_id, recipient_public_key); }
  @view({}) list_wallet_records({ account_id }: { account_id: string }) { return walletRecords(this, account_id); }
  @view({}) get_wallet_holder({ account_id }: { account_id: string }) { assert(validateAccountId(account_id), 'Invalid wallet account'); return load<string>(`wallet_holder:${account_id}`); }
  @view({}) get_private_job({ job_id }: { job_id: string }) { return getPrivateJob(job_id); }
  @view({}) get_agent_grant({ grant_id }: { grant_id: string }) { return getAgentGrant(grant_id); }
  @view({}) list_agent_grants({ owner_id, from_index = 0, limit = 40 }: { owner_id: string; from_index?: number; limit?: number }) { return listAgentGrants(owner_id, from_index, limit, this.tee_jobs_total); }
  @call({ privateFunction: true }) on_private_execution({ job_id }: { job_id: string }) { return onPrivateExecution(this, job_id); }
}

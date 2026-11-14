import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { canonical, decode, encode, hash, hex, unhex, utf8, FIELDS } from './crypto.js';
import type { DocumentItem, FieldId, Presentation } from './types.js';

export const MAX_TEE_FILE_BYTES = 64 * 1024;
export const MAX_ENCRYPTED_INPUT_BYTES = 128 * 1024;
export const fieldMask = (fields: FieldId[]) => fields.reduce((mask, id) => {
  const index = FIELDS.findIndex(f => f.id === id);
  if (index < 0 || mask & (1 << index)) throw new Error('Choose distinct supported credential fields.');
  return mask | (1 << index);
}, 0);
export const maskFields = (mask: number): FieldId[] => FIELDS.filter((_, i) => mask & (1 << i)).map(f => f.id);

export type PrivateApproval = {
  operation: 'copy' | 'grant'; job_id: string; token_id: string; packet_hash: string;
  fields_mask: number; expires_at: number; max_uses: number; purpose_hash: string;
  delivery_key_hash: string; auth_key: string; copy_hash: string;
  worker_hash: string; project_id: string;
};
export type TeeCopy = { packet_hash: string; job_id: string; stored_at: number; worker_hash: string; project_id: string };
export type AgentGrant = {
  id: string; owner_id: string; token_id: string; agent_id: string; fields_mask: number;
  expires_at: number; max_uses: number; used: number; purpose_hash: string;
  delivery_key_hash: string; auth_key: string; copy_hash: string; packet_hash: string;
  ready: boolean; revoked: boolean; created_at: number;
  worker_hash: string; project_id: string;
};
export type AgentOutput = {
  schema: string; operation: string; job_id: string; grant_id?: string; packet_hash?: string;
  stored?: boolean; ciphertext?: string; outlayer_request_id?: string; transaction_hash?: string;
  usage_index?: number; code?: string;
};
export type PrivateJob = {
  id: string; kind: 'copy' | 'grant' | 'use' | 'recover'; owner_id: string; token_id: string;
  grant_id: string | null; packet_hash: string; state: 'staging' | 'uploading' | 'pending' | 'ready' | 'failed' | 'blocked';
  created_at: number; output: AgentOutput | null; error_code: string | null; usage_index?: number;
  worker_hash: string; project_id: string;
  approval_hash?: string;
};
export type TeeConfig = {
  configured: boolean; project_id: string; worker_hash: string; worker_url: string;
  outlayer_id: string; broker_id: string; agent_id: string; daily_limit: number; jobs_today: number;
};
export type AgentAccess = { grant_id: string; token_id: string; delivery_key: string; purpose: string; fields: FieldId[]; expires_at: number };
export type CopyPacket = { version: 'facet-private-copy-v1'; holder_seed: string; document: Omit<DocumentItem, 'tee_copy'> };
export type GrantPacket = { version: 'facet-private-grant-v1'; grant_id: string; owner_id: string; token_id: string; copy_hash: string; delivery_key: string; presentations: Presentation[] };

// ASCII-only, fixed field order; the contract verifies these exact bytes.
export function approvalText(contract: string, a: PrivateApproval) {
  return ['facet-private-v1', contract, a.operation, a.job_id, a.token_id, a.packet_hash,
    a.fields_mask, a.expires_at, a.max_uses, a.purpose_hash, a.delivery_key_hash, a.auth_key, a.copy_hash, a.worker_hash, a.project_id].join('\n');
}
export const signApproval = (contract: string, a: PrivateApproval, seed: string) => hex(ed25519.sign(utf8(approvalText(contract, a)), unhex(seed)));
export function verifyApproval(contract: string, a: PrivateApproval, signature: string, owner: string) {
  try { return ed25519.verify(unhex(signature), utf8(approvalText(contract, a)), unhex(owner)); } catch { return false; }
}
export const revokeText = (contract: string, id: string) => `facet-agent-revoke-v1\n${contract}\n${id}`;
export const walletBindingText = (contract: string, account: string, holder: string) => `facet-wallet-binding-v1\n${contract}\n${account}\n${holder}`;
export const signText = (text: string, seed: string) => hex(ed25519.sign(utf8(text), unhex(seed)));
const authSeed = (key: string) => sha256(utf8(`facet-agent-auth-v1:${key}`));
export const agentAuthPublic = (key: string) => hex(ed25519.getPublicKey(authSeed(key)));
export const agentRequestText = (grant: string, job: string) => `facet-agent-request-v1\n${grant}\n${job}`;
export const signAgentRequest = (grant: string, job: string, key: string) => hex(ed25519.sign(utf8(agentRequestText(grant, job)), authSeed(key)));
export function verifyAgentRequest(grant: string, job: string, signature: string, publicKey: string) {
  try { return ed25519.verify(unhex(signature), utf8(agentRequestText(grant, job)), unhex(publicKey)); } catch { return false; }
}

// OutLayer ECIES v1. Only the keystore TEE has the matching private key.
export function sealToKeystore(value: unknown, recipientHex: string) {
  const recipient = unhex(recipientHex);
  if (recipient.length !== 32) throw new Error('The private vault encryption key is unavailable.');
  const ephemeral = crypto.getRandomValues(new Uint8Array(32));
  const pub = x25519.getPublicKey(ephemeral), shared = x25519.getSharedSecret(ephemeral, recipient);
  const key = hkdf(sha256, shared, undefined, utf8('outlayer-keystore-v1'), 32);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = chacha20poly1305(key, nonce).encrypt(utf8(canonical({ FACET_PACKET: canonical(value) })));
  const wire = new Uint8Array(45 + ciphertext.length);
  wire[0] = 1; wire.set(pub, 1); wire.set(nonce, 33); wire.set(ciphertext, 45);
  ephemeral.fill(0); shared.fill(0); key.fill(0);
  if (wire.length > MAX_ENCRYPTED_INPUT_BYTES) throw new Error('This private copy is too large for the testnet TEE demo. Your local encrypted copy remains available.');
  return encode(wire);
}
const buffer = (bytes: Uint8Array) => new Uint8Array(bytes).buffer;
export const agentAad = (grant: string, job: string, index: number) => utf8(`facet-agent-delivery-v1:${grant}:${job}:${index}`);
export async function openAgentDelivery(output: AgentOutput, deliveryKey: string): Promise<Presentation> {
  if (!output.ciphertext || !output.grant_id || !Number.isInteger(output.usage_index)) throw new Error('The agent delivery is incomplete.');
  const bytes = decode(output.ciphertext);
  if (bytes[0] !== 1 || bytes.length < 30) throw new Error('The agent delivery format is invalid.');
  const key = await crypto.subtle.importKey('raw', buffer(unhex(deliveryKey)), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(bytes.slice(1, 13)), additionalData: buffer(agentAad(output.grant_id, output.job_id, output.usage_index!)) }, key, buffer(bytes.slice(13)));
  return JSON.parse(new TextDecoder().decode(plain));
}
export function recoveryKeys() { const secret = crypto.getRandomValues(new Uint8Array(32)); return { secret: hex(secret), public_key: hex(x25519.getPublicKey(secret)) }; }
export async function openOwnerDelivery(output: AgentOutput, secretHex: string): Promise<CopyPacket> {
  if (!output.ciphertext) throw new Error('The recovery delivery is incomplete.');
  const bytes = decode(output.ciphertext);
  if (bytes[0] !== 2 || bytes.length < 62) throw new Error('The recovery delivery format is invalid.');
  const shared = x25519.getSharedSecret(unhex(secretHex), bytes.slice(1, 33));
  const rawKey = hkdf(sha256, shared, undefined, utf8('facet-owner-delivery-v1'), 32);
  const key = await crypto.subtle.importKey('raw', buffer(rawKey), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(bytes.slice(33, 45)), additionalData: buffer(utf8(`facet-owner-delivery-v1:${output.job_id}`)) }, key, buffer(bytes.slice(45)));
  shared.fill(0); rawKey.fill(0);
  const value = JSON.parse(new TextDecoder().decode(plain));
  if (value.version !== 'facet-private-copy-v1' || !/^[a-f0-9]{64}$/.test(value.holder_seed) || !value.document?.id) throw new Error('The recovered private copy is invalid.');
  return value;
}

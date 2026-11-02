import { decode, encode, hash, holderPublic, randomHex, unhex } from './crypto.js';
import type { VaultData, VaultEnvelope } from './types.js';
export const ITERATIONS = 600000;
const buffer = (bytes: Uint8Array) => new Uint8Array(bytes).buffer;
export async function vaultKey(password: string, salt: string, iterations = ITERATIONS) {
  if (password.length < 10) throw new Error('Use a vault password with at least 10 characters.');
  if (iterations !== ITERATIONS) throw new Error('Unsupported vault protection settings.');
  const source = await crypto.subtle.importKey('raw', buffer(new TextEncoder().encode(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: buffer(decode(salt)), iterations }, source, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function sealVault(data: VaultData, key: CryptoKey, salt: string): Promise<VaultEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buffer(iv), additionalData: buffer(new TextEncoder().encode('facet-encrypted-vault-v1')) }, key, buffer(new TextEncoder().encode(JSON.stringify(data))));
  return { version: 'facet-encrypted-vault-v1', algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', iterations: ITERATIONS, salt, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}
export async function openVault(envelope: VaultEnvelope, password: string) {
  if (envelope.version !== 'facet-encrypted-vault-v1' || envelope.algorithm !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2-SHA-256' || envelope.iterations !== ITERATIONS || decode(envelope.salt).length !== 16 || decode(envelope.iv).length !== 12 || envelope.ciphertext.length > 45000000) throw new Error('This is not a supported encrypted Facet vault.');
  const key = await vaultKey(password, envelope.salt, envelope.iterations);
  try {
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(decode(envelope.iv)), additionalData: buffer(new TextEncoder().encode(envelope.version)) }, key, buffer(decode(envelope.ciphertext)));
    const data = JSON.parse(new TextDecoder().decode(bytes)) as VaultData;
    if (data.version !== 'facet-vault-data-v1' || !/^[a-f0-9]{64}$/.test(data.holder_seed) || !Array.isArray(data.documents) || !Array.isArray(data.receipts)) throw new Error('Invalid vault data.');
    holderPublic(data.holder_seed); return { key, data };
  } catch { throw new Error('The password could not unlock this vault, or the backup was changed.'); }
}
export function emptyVault(): VaultData { return { version: 'facet-vault-data-v1', holder_seed: randomHex(32), documents: [], receipts: [] }; }
export function documentCommitment(data: string, salt: string) { const bytes = decode(data), prefix = unhex(salt); const joined = new Uint8Array(prefix.length + bytes.length); joined.set(prefix); joined.set(bytes, prefix.length); return hash(joined); }

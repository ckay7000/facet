import type { VaultEnvelope } from '../shared/types.js';
const STORE = 'vault';
export async function storedVault(value?: VaultEnvelope): Promise<VaultEnvelope | null> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('facet-private-v1', 1); request.onupgradeneeded = () => request.result.createObjectStore(STORE); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('This browser could not open local vault storage.')); });
  try { return await new Promise((resolve, reject) => { const tx = db.transaction(STORE, value ? 'readwrite' : 'readonly'), store = tx.objectStore(STORE); const req = value ? store.put(value, 'encrypted') : store.get('encrypted'); let result: VaultEnvelope | null = null; req.onsuccess = () => { result = value || req.result || null; }; tx.oncomplete = () => resolve(result); tx.onerror = () => reject(new Error('Your browser could not save the encrypted vault. Export a backup before leaving.')); tx.onabort = tx.onerror; }); } finally { db.close(); }
}
export function download(name: string, data: Blob | string, type = 'application/json') { const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
export async function jsonFile(file: File, max = 45000000) { if (file.size > max) throw new Error('This file is too large.'); return JSON.parse(await file.text()); }

import { readFile } from 'node:fs/promises';
import { checkPresentation, hash, presentationHash, validPresentationShape } from './crypto.js';
const filename = process.argv[2]; if (!filename) throw new Error('Usage: node --import tsx verify.ts proof.json');
const proof = JSON.parse(await readFile(filename, 'utf8')); if (!validPresentationShape(proof)) throw new Error('Invalid Facet proof package.');
const deployment = JSON.parse(await readFile(new URL('./testnet.json', import.meta.url), 'utf8'));
async function view(method: string, args: object = {}) {
  const r = await fetch('https://test.rpc.fastnear.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'facet-independent', method: 'query', params: { request_type: 'call_function', account_id: deployment.contract_id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64'), finality: 'final' } }) });
  const json = await r.json(); if (!r.ok || json.error || !Array.isArray(json.result?.result)) throw new Error('The finality read failed.'); return JSON.parse(Buffer.from(json.result.result).toString());
}
const [config, issuer, record, receipt] = await Promise.all([view('get_config'), view('get_issuer'), view('get_record', { token_id: proof.token_id }), view('get_verification', { nonce_hash: hash(proof.request.payload.nonce) })]);
if (!record) throw new Error('The credential is not registered.');
const checks = await checkPresentation(proof, record, issuer, config.request_public_key, deployment.contract_id);
checks.push({ id: 'nonce', label: 'Request has not been used', ok: !receipt, detail: 'A consumed request cannot be accepted again.' });
console.log(JSON.stringify({ checked_at: new Date().toISOString(), source: 'direct chain reads and local BBS verification', accepted_for_new_verification: checks.every(c => c.ok), prior_receipt_matches_proof: !!receipt && receipt.proof_hash === presentationHash(proof), checks }, null, 2));
if (!checks.every(c => c.ok)) process.exitCode = 1;

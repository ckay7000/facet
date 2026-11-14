import { readFile, stat, writeFile } from 'node:fs/promises';

// Release artifacts include only named checks and public receipts. Private
// fixtures, screenshots, capabilities, keys and raw RPC output are excluded.
async function report(file: string) {
  const value = JSON.parse(await readFile(file, 'utf8'));
  return { ...value, checked_at: value.checked_at || new Date((await stat(file)).mtimeMs).toISOString() };
}
function select(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}
function checks(value: any) { return select(value, ['status', 'checked_at', 'checks', 'transactions', 'evidence', 'browser_errors']); }

const deployment = await report('deployments/private-testnet.json');
const units = await report('.local/unit-tests.json');
const worker = await report('.local/worker-checks.json');
const localBrowser = await report('.local/browser-report.json');
const privateBrowser = await report('.local/private-browser-local.json');
const recovery = await report('.local/recovery-live-check.json');
const layout = await report('.local/near-layout-checks.json');
const incompleteOperation = await report('.local/native-last-failure.json').catch(() => null);
const latestLive = (await Promise.all([
  report('deployments/private-checks.json').catch(() => null),
  report('.local/private-live-failure.json').catch(() => null),
])).filter(Boolean).sort((a, b) => Date.parse(b.checked_at) - Date.parse(a.checked_at))[0];
if (!latestLive) throw new Error('No live NEAR integration report exists.');
const live = {
  ...select(latestLive, ['status', 'checked_at', 'checks', 'jobs', 'transactions', 'reused_copy_job']),
  contract_id: deployment.checks_contract_id,
  worker_hash: deployment.worker_hash,
  ...(latestLive.status === 'failed' && incompleteOperation ? { incomplete_operation: select(incompleteOperation, ['job_id', 'kind', 'state', 'error_code', 'transaction_hash', 'outlayer_request_id', 'provider_job_id', 'provider_status', 'provider_error', 'provider_settlement_transaction', 'independently_decrypted', 'checked_at']) } : {}),
  ...(latestLive.status === 'failed' ? { stopped_at: latestLive.stopped_at || (/TIMEOUT_ERROR/.test(latestLive.error || '') ? 'Wallet recovery settlement' : 'Live integration test'), reason: latestLive.reason || (/TIMEOUT_ERROR/.test(latestLive.error || '') ? 'The RPC timed out waiting for FINAL while the recovery transaction was INCLUDED_FINAL. Completed checks and the separate successful recovery test remain evidence; the complete native suite did not pass.' : 'The live integration suite stopped before completion. Individual completed checks remain evidence.') } : {}),
};
const evidence = {
  application: 'Facet',
  status: 'partial',
  prototype: true, independently_audited: false, network: 'testnet',
  checked_at: new Date().toISOString(),
  url: 'https://facet-near.vercel.app',
  main_contract_id: deployment.contract_id, project_id: deployment.project_id, worker_hash: deployment.worker_hash,
  fixture: 'All documents and issuer claims are fictional. NEAR transactions and OutLayer executions are real.',
  unit_tests: { status: units.success && units.numFailedTests === 0 ? 'passed' : 'failed', checked_at: new Date(units.startTime).toISOString(), tests: units.numTotalTests, command: 'npm test' },
  worker_interoperability: { ...checks(worker), rust_tests: worker.rust_interoperability_tests },
  native_near_and_tee: live,
  separately_verified_recovery: select(recovery, ['status', 'checked_at', 'contract_id', 'original_copy_job', 'job_id', 'transaction_hash', 'outlayer_request_id', 'worker_hash', 'checks', 'transactions']),
  browser: {
    local_vault_and_direct_bbs: checks(localBrowser),
    near_page: checks(layout),
    private_workflow: { ...checks(privateBrowser), stopped_at: privateBrowser.stage, scope: 'Injected NEAR Connect wallet with real NEP-413 signatures and testnet transactions. Full private browser workflow did not pass.', reason: 'Private-copy confirmation timed out. Some OutLayer executions settle after the NEAR yield expires.' },
    complete_hosted_private_workflow: { status: 'not_run' },
    manual_meteor_intear_compatibility: { status: 'not_run' },
    locked_vault_external_agent_over_http: { status: 'not_run' },
  },
  availability: { status: 'intermittent', detail: 'Some jobs succeed promptly. Others run after the NEAR yield expires and provider settlement reports Execution request not found. A pending or failed job is not a saved copy or successful disclosure.' },
  boundaries: [
    'Browser encryption keeps original documents, holder keys and hidden claims out of backend plaintext and public NEAR state.',
    'The optional TEE copy includes the holder key with explicit user consent.',
    'The browser prepares BBS presentations at approval time. The TEE checks signed bindings and exact scope; recipients independently verify BBS mathematics.',
    'The demo agent is deterministic. No language model inference is implemented.',
    'Facet records OutLayer execution IDs but does not independently verify the complete TDX attestation chain.',
    'Project administrators can publish future versions with access to project-bound storage keys.',
    'Failed executions consume allowance. Revocation cannot erase retained disclosures or reliably cancel an in-flight delivery.',
  ],
};
await writeFile('deployments/near-verification.json', JSON.stringify(evidence, null, 2) + '\n');
await writeFile('deployments/private-checks.json', JSON.stringify(live, null, 2) + '\n');
await writeFile('public/near-verification.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(`Published partial integration evidence: ${units.numTotalTests} unit tests, ${latestLive.checks.length} completed native checks, browser private workflow ${privateBrowser.status}.`);

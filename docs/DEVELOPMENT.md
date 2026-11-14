# Develop and verify Facet

## Credential-free app checks

Use Node 24 and npm. From a fresh clone:

```bash
npm ci
npm test
npm run build
cp .env.example .env.local
npm run dev
```

Open http://127.0.0.1:5370. Vault encryption works locally. Chain actions require a configured testnet relay. CI runs `npm test` and `npm run build` on Node 24.

## Contract build

```bash
npm ci --prefix contracts/facet
npm run build:contract
```

NEAR SDK JS downloads its compiler tooling during install; network access is required. The WASM is written to `contracts/facet/build/facet.wasm`. The prebuild script adds NEAR's native Ed25519 binding to the pinned SDK 2.0.0 builder and refuses an unexpected builder hash. Public deployment hashes and transactions are in `deployments/testnet.json`.

## Private worker build

Use Rust 1.90 or a compatible toolchain with the WASI Preview 2 target:

```bash
rustup target add wasm32-wasip2
npm run build:worker
npm run test:worker
```

The locked worker release appears in `workers/target/wasm32-wasip2/release/`. Interoperability checks generate real JavaScript BBS presentations, validate bindings in Rust, and independently decrypt Rust agent/recovery deliveries in JavaScript. They need no live TEE or private accounts.

## Configuration

`.env.example` lists variables with empty secret values. Set them only in ignored `.env.local` or encrypted host settings. Issuer, verifier and agent use dedicated NEAR testnet accounts with function-call-restricted hosted keys. Contract, project and role admin keys remain local. The ingress broker uses its own limited testnet balance and has no contract/project administrator authority; its key pays secret-storage deposits.

`scripts/deploy-testnet.ts` documents initial provisioning. `scripts/deploy-private-testnet.ts` prepares dedicated private-execution roles and publishes a hash-named worker, then upgrades the existing registry without reinitializing its records. The registered OutLayer project version and approved worker SHA-256 must match. These helpers expect this project's isolated fixture accounts; inspect and adapt them before using your own accounts.

`shared/near-network.ts` names the public dRPC, Intear and FastNEAR testnet RPCs listed in [NEAR’s provider documentation](https://docs.near.org/api/rpc/providers). `server/chain.ts` falls back on transport/rate-limit failures. Private dispatch returns after its NEAR receipt and polls the public job, avoiding an HTTP connection held open for the OutLayer yield. Hosting serves SPA HTML through `api/app.ts` with a fresh CSP nonce for NEAR Connect's sandbox scripts.

## Independent proof check — read only

Export a proof from the app, then:

```bash
node --import tsx scripts/check-proof.ts path/to/facet-selective-proof.json
```

This verifies BBS math, signatures and current chain state without minting or recording a receipt. An expired, revoked or previously consumed proof can correctly fail freshness checks. Keep a fresh proof for a current-state demonstration.

## Credentialed integration checks

`npm run test:live` uses ignored `.local/accounts.json` and an isolated checks contract. `npm run test:browser` requires a locally running configured server, Chromium (`npx playwright install chromium`), and fictional inputs. Set `FACET_BASE_URL` for your own hosted deployment. Do not run fixture-based live tests against an unrelated production issuer registry.

```bash
npm run test:private-live
npm run test:private-browser
FACET_BASE_URL=https://facet-near.vercel.app npm run test:private-browser
```

Private live checks use the isolated checks registry and real OutLayer runs: persistent copies, signed grants, caller/capability refusal, replay and usage limits, revocation, actual expiry, ingress cleanup and owner recovery. Add `-- --reuse-copy JOB_ID` to reuse an existing ready copy for the same fixture holder and worker; the report names the reused copy and does not claim a fresh upload. Browser checks attempt explicit consent, wallet binding, approved-field delivery, an external agent with the vault locked, revocation and another-device recovery. The complete private browser suite has not passed; its latest run stops at expired private-copy settlement. Do not run both suites concurrently: they share dedicated funded broker/agent fixture accounts.

Browser wallet checks use an injected NEAR Connect harness. Wallet keys remain in Node; the page receives real NEP-413 signatures and recovery transaction results. This does not claim manual Meteor/Intear sign-in compatibility. A private encrypted empty-vault fixture persists under `.local/` so repeated runs retain the wallet's permanently bound holder identity. Reports and screenshots stay private there; sanitized public release evidence includes only checks, receipts and fictional-fixture descriptions.

`node --import tsx scripts/publish-near-evidence.ts` combines the latest local reports into `deployments/near-verification.json` and `public/near-verification.json`. It excludes screenshots and raw RPC errors, preserves failed/incomplete suites, and distinguishes separately verified recovery from the unfinished native run. Run `npm test -- --reporter=json --outputFile=.local/unit-tests.json` and `npm run test:worker` to supply current local reports. Publishing evidence does not run or attest to missing browser checks.

## External agent

Export private agent access from a grant with remaining allowance, then run:

```bash
npm run agent:use -- --access /path/to/facet-private-agent-access.json
```

Add `--url http://127.0.0.1:5370` for local development. This client uses no owner wallet, vault password or original file. It sends a capability signature, decrypts the approved proof, checks BBS mathematics and current scope/status, and records a verification receipt. The exported delivery capability is private.

The public [release report](../deployments/verification.json) separates unit tests, live contract checks and real hosted browser checks. Browser tooling and hosted capture credentials are temporary and are removed after use. The test report is evidence, not a security audit.

## Read the implementation

Start with `shared/crypto.ts` for BBS proofs, `shared/vault.ts` for local encryption, `shared/agent.ts` for private approval/delivery, `contracts/facet/src/vault.ts` for NEAR permissions, `workers/src/main.rs` for sealed execution and `server/tee.ts` for the funded bridge. [Engineering reference](ENGINEERING.md).

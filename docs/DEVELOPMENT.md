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

NEAR SDK JS downloads its compiler tooling during install; network access is required. The WASM is written to `contracts/facet/build/facet.wasm`. Public deployment hashes and transactions are in `deployments/testnet.json`.

## Configuration

`.env.example` lists the variables, with empty secret values. Set them only in ignored `.env.local` or your host’s encrypted environment. Use your own dedicated NEAR testnet issuer and verifier accounts with function-call-restricted keys. Keep full-access admin keys out of hosting. `scripts/deploy-testnet.ts` documents the project’s isolated-account provisioning approach; inspect before adapting it to your accounts.

## Independent proof check — read only

Export a proof from the app, then:

```bash
node --import tsx scripts/check-proof.ts path/to/facet-selective-proof.json
```

This verifies BBS math, signatures and current chain state without minting or recording a receipt. An expired, revoked or previously consumed proof can correctly fail freshness checks. Keep a fresh proof for a current-state demonstration.

## Credentialed integration checks

`npm run test:live` uses ignored `.local/accounts.json` and an isolated checks contract. `npm run test:browser` requires a locally running configured server, Chromium (`npx playwright install chromium`), and fictional inputs. Set `FACET_BASE_URL` for your own hosted deployment. Do not run fixture-based live tests against an unrelated production issuer registry.

The public [release report](../deployments/verification.json) separates unit tests, live contract checks and real hosted browser checks. Browser tooling and hosted capture credentials are temporary and are removed after use. The test report is evidence, not a security audit.

## Read the implementation

Start with `shared/crypto.ts` for proof binding and verification, `shared/vault.ts` for encrypted storage, `server/actions.ts` for relay policy, and `contracts/facet/src/index.ts` for onchain state. [Engineering reference](ENGINEERING.md).

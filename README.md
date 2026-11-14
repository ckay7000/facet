# Facet

Facet is a private document and credential vault built on NEAR. Connect a wallet, approve the facts an application may see, and let an agent use a saved credential within limits you control.

An application can verify course completion without receiving the learner's name, score or original certificate. NEAR records wallet bindings, credential status, signed permissions and execution receipts. An optional OutLayer TEE copy stores the document, credential and holder key for wallet recovery and scoped agent use.

[Open Facet](https://facet-near.vercel.app) · [Wallet and agent access](https://facet-near.vercel.app/agents) · [Inspect the NEAR integration](https://facet-near.vercel.app/near)

**Verification is partial.** Real testnet executions have confirmed sealed copies, approved agent deliveries and owner recovery. The complete private browser workflow has not passed: some OutLayer workers settle after their NEAR callback expires. Locked-vault external-agent access through live HTTP, manual Meteor/Intear compatibility and the complete hosted private browser flow remain unverified. The [current evidence](https://facet-near.vercel.app/near-verification.json) separates these results.

## How Facet uses NEAR

| NEAR technology | Implemented behavior |
| --- | --- |
| NEAR Connect and NEP-413 | A wallet signs a login challenge; the service checks the signing key's full-access authority on NEAR. The holder approves binding that wallet to the vault. |
| NEAR contract and holder-bound NFT records | Salted document fingerprints, issuer keys, credential expiry and revocation are registered on testnet. Original files and private filenames are excluded. |
| Native Ed25519 verification | The contract checks the holder's exact approval: credential, fields, recipient capability, expiry, allowance and worker hash. |
| Onchain agent grants | The configured agent account dispatches with a valid capability signature. NEAR enforces current status, revocation, expiry and a one-to-three execution allowance. |
| NEAR cross-contract calls to OutLayer | Facet requests a hash-pinned Rust WASI worker that seals private copies and returns encrypted approved presentations, with public execution receipts. |
| Wallet-signed recovery | The bound wallet requests delivery to a fresh browser key. The browser decrypts the saved copy and chooses a new local password. |

NEAR authorizes each private execution. An independent agent client can use an existing grant while the holder's local vault is locked.

[Submission wording: how Facet uses NEAR](docs/SUBMISSION.md).

## What is stored where

| Browser encrypted vault | Optional TEE copy | Public NEAR records |
| --- | --- | --- |
| Original files, private filenames and salts | Approved document, credential and holder key | Token/holder identifiers, wallet binding and salted fingerprints |
| Holder key and complete credentials | Preapproved BBS presentations and delivery material | Issuer keys, credential expiry and revocation |
| Local history and private agent access packages | Persistent project-bound sealed storage | Agent identity, field mask, expiry, usage, worker hash and encrypted delivery receipts |

The browser encrypts TEE ingress before it reaches the backend. Passwords remain local. Agent recipients receive approved issuer-signed fields and required public proof bindings: holder ID, token ID, credential type, expiry and fingerprint. They receive neither the original document nor the holder key.

The local vault uses AES-256-GCM and PBKDF2-SHA-256 with 600,000 iterations. An encrypted backup preserves documents, the holder key, history and existing agent capabilities. Wallet recovery restores each saved TEE document and the holder key; local history and prior agent delivery keys still need the encrypted backup.

## Try wallet and agent access

Use fictional documents and a NEAR **testnet** wallet.

This is an experimental workflow. Continue only after each private receipt becomes `ready`; use **Refresh receipt** to inspect pending or failed work before creating another request.

1. Create a password in **My vault**, export an encrypted backup, and select **Issue demo credential**.
2. Open **Agent access**, connect your wallet, sign the login, and bind it to this vault.
3. Approve storing the document, credential and holder key, then select **Save private TEE copy**.
4. Preview the fields, purpose, expiry and execution allowance. Approve the agent permission.
5. Select **Run demo agent**. The recipient independently verifies the BBS presentation and records a NEAR verification receipt.
6. Export private agent access for an external client. Locking the local vault leaves the grant usable until its allowance, expiry or revocation stops it.
7. Revoke permission to block future requests. On another browser, connect the bound wallet, approve **Recover copy**, and choose a new password.

The demo agent checks training eligibility deterministically. No language model or paid inference is used; an AI agent can call the same scoped capability API.

### External agent example

Export **private agent access** from a grant with an execution remaining. Keep the file private and give it only to the intended agent.

```bash
npm run agent:use -- --access /path/to/facet-private-agent-access.json
```

The client signs a capability request, decrypts the delivery, independently checks its scope and BBS signature, and requests a verification receipt. It prints approved claims and execution identifiers. No vault password, original document or owner wallet is required. Add `--url http://127.0.0.1:5370` for development or `--proof /path/to/approved-proof.json` to save the disclosed presentation.

## Local documents and direct verification

Local storage works without a wallet. Upload a file to keep it encrypted; select **Create private NFT** to register its fingerprint. Personal uploads are **Self-recorded · unverified**. Registration does not authenticate a document or confer legal ownership.

For issuer-signed credentials, the holder can approve a one-off BBS proof at the verification desk. A recipient imports it without a vault and checks the issuer, holder signature and current NEAR status. Reused requests, edited claims and revoked credentials are refused. The **Proof lab** exercises cryptographic rejection paths.

[Walkthrough and original demo video](docs/DEMO.md) · [Engineering reference](docs/ENGINEERING.md)

## Inspect the implementation

[/near](https://facet-near.vercel.app/near) displays live configuration, the contract address and exact worker hash. Public artifacts are in `deployments/`; [/near-verification.json](https://facet-near.vercel.app/near-verification.json) serves the private integration evidence. **Agent access** offers public execution receipts.

- `contracts/facet/src/vault.ts`: signature checks, wallet binding, grant limits, OutLayer calls and callbacks.
- `workers/src/lib.rs`: sealed storage, signed-presentation validation and encrypted deliveries.
- `shared/agent.ts`: approval/capability bindings, ingress encryption and recipient decryption.
- `scripts/agent-client.ts`: walletless external agent and independent proof verification.

## Run locally

Use Node 24 and npm. Unit tests and the frontend build require no keys.

```bash
git clone https://github.com/NSEVEjk0/facet.git
cd facet
npm ci
npm test
npm run build
cp .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:5370`. Local vault encryption works without configuration; chain and TEE actions need dedicated testnet roles. [Builds, deployment and integration checks](docs/DEVELOPMENT.md).

## Prototype boundaries

Facet Test Academy and its claims are fictional. Real issuer onboarding is future work. BBS mathematics run in the browser and verification service. The TEE checks signatures, bindings and disclosure scope, then delivers browser-prepared presentations; it does not derive new BBS proofs at execution time. The contract authorizes execution and records the verification relay's result.

OutLayer supplies confidential execution and attestations. Facet does not independently verify the complete TDX attestation chain. Project-bound storage persists across runs; project administrators can publish future versions with access to those keys. Hash pinning identifies the approved version but does not remove administrator trust.

Private execution depends on OutLayer testnet availability. A pending or failed job is not a stored copy or successful disclosure; inspect its NEAR receipt before creating another request. TEE originals are limited to 64 KiB; local files support up to 5 MB. Grants permit one to three executions within five to fifteen minutes. Failed executions consume allowance. Public wallet/holder/token activity remains linkable. Revocation cannot erase retained disclosures or reliably cancel an in-flight delivery. This testnet prototype has no independent security audit.

[MIT license](LICENSE). Dependency licenses apply to their respective code.

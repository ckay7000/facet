# Facet

Private documents and selectively disclosed credentials on NEAR testnet.

**Live app:** https://facet-near.vercel.app

Facet lets a person preserve a document privately, then prove selected issuer-signed claims without handing over the whole document. The prototype demonstrates training completion: a verifier receives the course and completion status while the BBS presentation omits the learner’s name, score and student reference.

## Try the working flow

1. Open **My vault**, create a strong password, and export an encrypted backup.
2. Upload a fictional document and select **Create private NFT**. It is explicitly **self-recorded and unverified**. The original stays on your device; NEAR receives a salted fingerprint and holder ID.
3. Select **Issue demo credential**. Facet Test Academy issues a fictional certificate with a real BBS signature, anchored to a holder-bound NEAR NFT.
4. At the verification desk, create a request for course and completion status. A separate verifier can export a request or copy its link and send it to the holder.
5. The holder imports the request, previews revealed and hidden fields, and approves a selective-disclosure proof.
6. Export the proof. A verifier can import and check it without creating a vault. Successful verification records a single-use receipt on NEAR.
7. Use **Check again** to demonstrate replay rejection. Run the **Proof lab** to test modified claims, wrong-holder signatures and other rejection paths.
8. Revoke an issued credential in the vault. Future checks of its exported proof reject the live revocation status.

## What is implemented

- Local AES-256-GCM encrypted vault in IndexedDB; password-derived keys use PBKDF2-SHA-256 with 600,000 iterations, random salt, and a fresh random IV for each save.
- Password, original files and holder secret key never go to the backend. Decrypted vault data stays in memory while unlocked.
- Explicit locking, five-minute idle lock, encrypted export and restore on another browser.
- Salted document commitments; generic public NFT metadata; holder-bound NFTs refuse transfers and approvals.
- Real BBS signatures and randomized selective-disclosure proofs using the maintained `@digitalbazaar/bbs-signatures` implementation, pinned to 3.1.0.
- Exact requested-field enforcement. Mandatory public bindings are holder ID, token ID, credential type, expiry and document fingerprint.
- Signed, short-lived requests bind audience, purpose, fields and nonce. The holder signs the exact proof and request using Ed25519.
- Independent backend verification against issuer keys and live finality reads. Onchain receipt recording rechecks expiry, revocation, issuer suspension and nonce reuse.
- Owner-signed minting/revocation challenges; the backend rejects arbitrary action fields and original-file uploads.
- Consent history, downloadable proof packages, live transaction links, search and a cryptographic attack lab.

## Trust and privacy boundaries

Uploading a document **does not establish authenticity**. Only the fixed, fictional demo issuer produces verifiable claims. The demo does not imply institutional accreditation. Issuers know the claims they issue; in this prototype, fictional learner and score values are fixed and documented.

NFT ownership and activity are public. So are token IDs, salted fingerprints, issuer IDs, expiry and revocation. Document content privacy does not hide this blockchain metadata or make the holder anonymous.

BBS math runs in browsers and the verification backend, **not inside the NEAR contract**. The chain anchors the issuer key and credential status and accepts receipts only from its designated verification relay. A compromised relay could record a false receipt. Independent verifiers can run the same cryptographic checks and read current chain state without relying on that relay’s accepted flag.

Requesting-party labels are self-declared; their package signature authenticates the request, not the organization’s identity. Disclosed fields can be retained by a verifier. Neither revocation nor locking can erase previously shared information.

The custom demo credential schema is not a complete interoperable W3C VC implementation or a numerical predicate proof system. BBS proves selected signed fields while hiding the other messages. It does not independently prove a degree is genuine, or prove an age threshold from an arbitrary uploaded ID.

There is no password recovery. Browser storage may be cleared. Encrypted backups remain susceptible to offline password guessing; use a strong, unique password. Compromised devices or injected application code can access an unlocked vault. This is a testnet prototype, not an audited production credential service.

## Run locally

Node 24 is the deployment target.

```bash
npm ci
npm test
npm run build
npm run build:contract
```

Copy the private deployment settings into `.env.local`, then run:

```bash
npm run dev
```

The app opens at `http://127.0.0.1:5370`. Without configuration, the encrypted local vault works and chain-dependent actions remain disabled.

The environment requires `FACET_CONTRACT_ID`, `FACET_ISSUER_ID`, `FACET_ISSUER_KEY`, `FACET_VERIFIER_ID`, `FACET_VERIFIER_KEY`, `FACET_BBS_SECRET`, `FACET_REQUEST_SEED`, and optionally `FACET_RPC_URL`. Only function-call-restricted issuer/verifier keys belong in the hosted app. Admin and contract full-access keys remain in private local deployment storage.

```bash
npm run test:live
npx playwright install chromium
npm run test:browser
```

Live contract tests use the isolated checks contract, never modify the app’s issuer trust registry, and write transaction evidence to `deployments/contract-checks.json`. Browser tests use synthetic documents and fictional credentials and write their report privately under `.local/`.

To independently check an exported proof against the actual contract:

```bash
node --import tsx scripts/check-proof.ts path/to/facet-selective-proof.json
```

This performs read-only cryptographic and chain checks. It does not mint or record a verification result. A proof may correctly fail current freshness after its request expires.

## Deployment

`deployments/testnet.json` records contract IDs, public issuer/request keys, restricted access-key permissions, source/WASM hashes and deployment transactions. `deployments/verification.json` and the app’s `/verification.json` publish release checks without vault data or secret keys.

Deployment helpers create dedicated testnet accounts and an independent Vercel project. They read existing private credentials without printing them. Testnet relays are funded and bounded by the daily mint cap of 40 and collection cap of 500. A local vault allows 8 documents, 5 MB per document and approximately 20 MB total.


## References

- [NEAR NFT documentation](https://docs.near.org/primitives/nft)
- [Digital Bazaar BBS implementation](https://github.com/digitalbazaar/bbs-signatures)
- [W3C VC data model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)

The repository retains the project MIT license. Dependency licenses, including the BBS package’s BSD-3-Clause license, apply to their respective code.

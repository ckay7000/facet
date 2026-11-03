# Facet

Facet is an application that lets people prove facts from signed credentials without sharing their full documents.

A recipient may need to know that someone completed a course without receiving their name, grade or original certificate. Facet keeps documents in an encrypted local vault and lets the holder approve a proof of selected issuer-signed fields. Verification checks that proof against current credential ownership and status on NEAR.

[Open the app](https://facet-near.vercel.app) · [Watch the demo](https://facet-near.vercel.app/media/facet-demo-20261103.mp4)

## How it works

1. **Keep the original private.** Documents and the holder key stay in a password-protected AES-256-GCM vault on the device. The vault supports locking and encrypted backup recovery.
2. **Distinguish records from credentials.** A personal upload can create a salted, holder-bound document fingerprint on NEAR, marked **Self-recorded · unverified**. An issued credential carries an issuer’s cryptographic signature.
3. **Approve a limited disclosure.** BBS selective-disclosure proofs reveal only the requested signed fields. The holder reviews the request and signs the approved presentation.
4. **Check current status.** The verifier checks the proof, holder binding, issuer, expiry, revocation and request reuse. The original document and vault password are not needed for verification.

The proof lab demonstrates tampered claims, substituted holders, excess disclosure, expiry and replay refusal. Revocation blocks future verification; an encrypted backup restores the vault and holder key.

## Why this approach

Sending a certificate gives the recipient every visible field and a copy to retain. Manually redacting it changes the document the issuer signed. A document fingerprint establishes a record of bytes, but does not establish the truth of a credential’s claims.

Facet combines issuer-signed selective disclosure with a private vault, explicit holder approval and current onchain status checks. The recipient gets the approved claims and a verifiable proof while the holder keeps the rest of the document private.

## Example: prove course completion

A learner receives a signed training credential from the fictional **Facet Test Academy**. A hiring team requests the course name and completion status. The learner previews those fields, approves the request and exports a BBS proof; the name, score and certificate stay hidden.

The team imports the proof in another browser and verifies the issuer signature, holder binding and current NEAR status. Reusing the same request is refused. Editing a claim invalidates the proof, and revoking the credential blocks later verification. The learner can lock the vault and restore it from an encrypted backup with the original password. The academy and learner are fictional; cryptographic signatures and testnet receipts are real.

## Try it

The sponsored demo requires no blockchain wallet. Use fictional documents.

| Action | Expected result |
| --- | --- |
| Create a password in **My vault** and upload a file | The original is stored encrypted on the device |
| Select **Create private NFT** for that file | A holder-bound fingerprint record is marked unverified |
| Select **Issue demo credential**, then **Prove selected fields** | The preview shows the approved claims and hidden fields |
| Export the proof and import it in **Verify** in another browser | The signature and current credential status are checked |
| Reuse, alter or revoke the proof’s credential | The relevant verification check refuses it |

[Full walkthrough](docs/DEMO.md) · [Recorded verification evidence](deployments/verification.json)

## Run locally

Use Node 24 and npm. Application tests and the frontend build require no keys.

```bash
git clone https://github.com/NSEVEjk0/facet.git
cd facet
npm ci
npm test
npm run build
cp .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:5370`. The encrypted vault works locally without relay credentials; chain actions require your own configured testnet relay. [Development and deployment](docs/DEVELOPMENT.md).

## Technical reference

[Architecture, proof verification and privacy](docs/ENGINEERING.md) · [Independent proof checker](scripts/check-proof.ts)

Facet uses React, Vite, NEAR SDK JS, Noble/Scure cryptography and Digital Bazaar’s BBS implementation. Build and deployment tooling is shared with Kiosk; the vault, credential and proof workflows are separate. Dependency versions are pinned. [MIT license](LICENSE); third-party licenses apply to dependencies.

Public holder and token IDs, issuer, expiry, revocation and salted fingerprints remain visible. Recipients can retain disclosed claims. The testnet issuer is fictional, requester labels are self-declared and the service relies on its designated verification relay. A vault password cannot be reset; keep an encrypted backup.

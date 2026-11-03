# Facet

Facet is an application that lets people prove selected facts from an issuer-signed credential without sharing the whole document.

You keep the original in an encrypted vault and approve which claims a recipient can see. The recipient checks the proof and the credential’s current status, while the undisclosed fields stay private.

[Try the app](https://facet-near.vercel.app) · [Watch the demo](https://facet-near.vercel.app/media/facet-demo-20261103.mp4) · [New to this repo? Start here](docs/REPO_GUIDE.md)

Fresh hosted feature checks passed on November 3, 2026. [What the recording shows and what was tested](docs/DEMO_2026-11-03.md) · [Public receipts and check evidence](deployments/demo-2026-11-03.json).

## An example you can try

You completed a course. A hiring team needs to know **which course** and **whether you completed it**. It does not need your grade, student number or the original certificate.

In Facet, you approve those two fields. The hiring team checks the proof in another browser and sees just the approved claims and required public identifiers. Your name and score remain hidden.

The demo learner and **Facet Test Academy** are fictional. The cryptographic signatures and NEAR testnet transactions are real. Real institution onboarding is future work.

![Facet's private credential workspace](docs/images/desktop-home.png)

## Two features, different meanings

| Feature | What you get |
| --- | --- |
| **Upload a document → Create private NFT** | An encrypted original on your device and a public fingerprint record. It says **Self-recorded · unverified**. Uploading does not prove authenticity |
| **Issue demo credential → Prove selected fields** | Claims signed by the fictional issuer, with a proof that reveals only the fields you approve |

The document itself is not exposed inside the NFT. The NFT records ownership and status. [What stays private and what is public](docs/REPO_GUIDE.md#what-is-private-and-what-is-public).

## Try it in five steps

Use fictional files. No blockchain wallet is needed in the sponsored demo.

1. Open [My vault](https://facet-near.vercel.app/vault), create a password and save an encrypted backup. There is no password reset.
2. Click **Issue demo credential**. You get the fictional learner's signed training credential.
3. Click **Prove selected fields** and request course and completion. Read the preview: those fields are shared; name and score are hidden. Approve, then **Export proof**.
4. Open [Verify](https://facet-near.vercel.app/verify) in another browser. Import the proof and click **Verify proof**. No vault or original certificate is needed there.
5. Try that proof again: reuse is rejected. The [Proof lab](https://facet-near.vercel.app/lab) also demonstrates tampering, expiry and revocation failures.

For your own file, upload it in the vault and choose **Create private NFT**. It remains explicitly unverified. [Full walkthrough, including revocation](docs/DEMO.md).

## Why NEAR is part of the product

NEAR records the issuer's public key, credential ownership, expiry and revocation. A one-use verification receipt helps separate verifiers reject reused requests.

The selective-disclosure mathematics, called **BBS proofs**, runs in the browser and backend. The smart contract checks live status and request reuse; a designated verification relay records receipts. [Technical design and trust boundaries](docs/ENGINEERING.md) · [Independent proof checker](scripts/check-proof.ts).

## Run or review the code

Use **Node 24** and npm. Tests and the build require no private keys.

```bash
git clone https://github.com/NSEVEjk0/facet.git
cd facet
npm ci
npm test
npm run build
cp .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:5370`. The local encrypted vault works without relay credentials; chain actions need your own configured testnet service.

[Repository map and plain-English glossary](docs/REPO_GUIDE.md) · [Development and tests](docs/DEVELOPMENT.md) · [Other use cases](docs/USE_CASES.md) · [Release test evidence](deployments/verification.json).

## Current limits

Public holder and token IDs, issuer, expiry, revocation and salted fingerprints remain visible. Recipients can keep claims you share. Revocation stops future verification; it cannot erase past disclosures.

This is a testnet prototype, not an audited identity service. A compromised device, website or relay remains a trust risk. Requester names are self-declared; real issuer onboarding and full W3C credential interoperability are future work. [Detailed limits](docs/ENGINEERING.md).

## Project history and attribution

Built with AI assistance in October and November 2026. Facet reuses the author’s Kiosk build setup, deployment/testing patterns and NEAR SDK tooling. The reused tooling and credential-specific implementation are disclosed here. React, Vite, NEAR SDK JS, Noble/Scure and Digital Bazaar’s BBS implementation supply the listed libraries; dependency versions are pinned. Credential-specific vault, consent, proof, registry and verifier behavior is the Facet implementation.

[Sealwork](https://github.com/NSEVEjk0/sealwork), [Accord](https://github.com/NSEVEjk0/accord) and [Kiosk](https://github.com/NSEVEjk0/kiosk) are separate products with their own workflows and deployments.

[MIT license](LICENSE). Third-party licenses apply to their respective dependencies, including the BBS package’s BSD-3-Clause license.

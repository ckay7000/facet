# Facet

**Prove what matters. Keep the rest private.**

Facet lets you prove selected facts from a signed credential without handing over your entire document.

[Try the app](https://facet-near.vercel.app) · [Watch the demo](https://facet-near.vercel.app/media/facet-demo.mp4) · [New to this repo? Start here](docs/REPO_GUIDE.md)

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
git clone https://github.com/NSEVEjk0/facet-near.git
cd facet-near
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

## NEAR HACKATHON disclosure

Built with AI assistance during the eligible October 19–November 14, 2026 window. Facet reuses the author’s Kiosk build setup, deployment/testing patterns and NEAR SDK tooling. Kiosk is not a separate entry. React, Vite, NEAR SDK JS, Noble/Scure and Digital Bazaar’s BBS implementation supply the listed libraries; dependency versions are pinned. Credential-specific vault, consent, proof, registry and verifier behavior is the Facet implementation.

The author’s other independent entry is **[Sealwork](https://github.com/NSEVEjk0/sealwork)**: confidential financial-agent work with conditional escrow payment. Facet handles credential disclosure; Sealwork handles paid task execution. Their contracts, deployments and application flows are separate.

Proposed tracks: **`nfts`, `privacy`**. [Rule-by-rule alignment](docs/HACKATHON_ALIGNMENT.md) · [Human submission checklist](docs/SUBMISSION_CHECKLIST.md) · [Dated official HACKATHON.md](docs/HACKATHON.md). Deadline: **November 14, 2026 at 23:59 UTC**; re-read the [live guide](https://nearhackathon.com/HACKATHON.md) before submitting.

[MIT license](LICENSE). Third-party licenses apply to their respective dependencies, including the BBS package’s BSD-3-Clause license.

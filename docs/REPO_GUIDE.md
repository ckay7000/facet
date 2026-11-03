# Facet: a guide to this repository

## The idea in one everyday example

You completed a course. A hiring team needs to check that you completed it. It does not need your grade, student number or a copy of the entire certificate.

Facet lets you share **the course and completion status**, while keeping the other details hidden. The hiring team checks that those claims were signed by the issuer and that the credential is still valid. It can do this in a separate browser without opening your document vault.

The demo uses **Facet Test Academy**, a fictional issuer, and **Avery Morgan**, a fictional learner. The signatures and NEAR transactions are real testnet operations. A real school's identity and authority would need to be established before its credentials could be trusted.

## Two different things you can create

| In the app | What it means | What it does not establish |
| --- | --- | --- |
| Upload your own document and create a private NFT | Keep the original encrypted on your device and record a fingerprint on NEAR | That the document is genuine. It is labeled **Self-recorded · unverified** |
| Issue a demo credential | The fictional issuer signs a set of claims; you can prove selected claims | That a real school or government issued it. Real institution onboarding is future work |

**Turning a file into an NFT does not make the file true.** Verification depends on an issuer whose identity and authority the verifier accepts.

## What is private, and what is public?

The original file, your password and your private holder key stay in your encrypted browser vault. They are not written into a public NFT.

The NFT is a public **credential record**, not a container exposing your document. Its holder ID, token ID, issuer, expiry, revocation and salted fingerprint remain public. When you approve a proof, selected claims and necessary public bindings are shared. A recipient can keep anything you disclose.

## Words you will see

- **Vault:** the encrypted document storage on your device. Save an encrypted backup; there is no password reset.
- **Issuer:** the organization signing the claims. In this demo it is fictional Facet Test Academy.
- **Credential:** a signed statement, such as “this person completed this course.”
- **NFT:** a unique blockchain record linking the credential to its holder and current status.
- **Selective disclosure / BBS proof:** cryptographic evidence for just the approved fields, without sending the whole signed credential.
- **Verifier:** the person or organization checking the shared claims.
- **Revocation:** withdrawing a credential from future verification. It cannot erase fields already shared.
- **Nonce:** a one-use request number that helps stop a proof from being reused.
- **Testnet:** a blockchain testing network. The demo does not spend real money.

## Pick the right document

| You want to… | Open… |
| --- | --- |
| Try it without reading code | [README](../README.md) or [live vault](https://facet-near.vercel.app/vault) |
| Watch the example | [Demo and captions](DEMO.md) |
| Understand possible applications | [Use cases and limits](USE_CASES.md) |
| Understand the proof and trust assumptions | [Engineering](ENGINEERING.md) |
| Run or modify the app | [Development](DEVELOPMENT.md) |

## Where the code lives

`src/` is the website: vault, consent screen, verification desk and proof lab. `shared/` contains encryption and proof mathematics. `server/` and `api/` handle the demo issuer and verification service. `contracts/facet/` records issuers, ownership, expiry, revocation and used requests on NEAR. `tests/` checks valid proofs and rejection cases. `deployments/` contains public evidence.

BBS proof mathematics runs in the browser and backend, outside the smart contract. The contract checks current status and request reuse, and permits a designated relay to record verification receipts. The [independent CLI](../scripts/check-proof.ts) can inspect proof mathematics without relying only on that relay's accepted flag.

This is a working testnet prototype, not an audited identity service. A compromised device, website or relay remains a trust risk. It does not yet provide real institution onboarding or full W3C credential interoperability.

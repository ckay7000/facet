# Facet demo

[Watch the demo](https://facet-near.vercel.app/media/facet-demo-20261103.mp4) · [Open the app](https://facet-near.vercel.app) · [Public test evidence](../deployments/demo-2026-11-03.json)

The captioned video shows the hosted application. Its fingerprint, size and feature-check results are recorded in the linked evidence file.

## What was verified

The primary-browser recording shows the local encrypted vault, an unverified self-recorded NFT, a signed fictional training credential, owner-approved BBS disclosure, successful proof verification, replay refusal, the proof lab and vault locking.

During the same run, an encrypted backup restored the vault in another browser. That restored holder revoked the credential in a real transaction, and subsequent verification rejected it. Those second-browser actions are recorded in the linked test evidence; they are not part of this primary-browser video.

Desktop, 390px and 320px layout checks passed after fixing the mobile hero buttons. The workflow checked ciphertext in IndexedDB and that API requests did not contain the vault password, original document bytes or private filename. The issuer and training claims are fictional. Cryptographic proofs and NEAR receipts are real; institution onboarding remains future work.

## Reproduce the features

Follow the complete workflow in the [README](../README.md). The checked-in browser helpers are `scripts/browser-scenario.ts`. Live workflows require available demo sponsorship or your own isolated testnet configuration. Application tests and frontend builds need no private keys.

Live workflows use fictional inputs and real NEAR testnet transactions. Application tests and frontend builds need no private keys.

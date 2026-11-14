# Facet demo

[Watch the demo](https://facet-near.vercel.app/media/facet-demo-20261103.mp4) · [Open the app](https://facet-near.vercel.app) · [Public test evidence](../deployments/demo-2026-11-03.json)

The captioned November 3 video shows the original encrypted-vault and BBS workflow. Its fingerprint, size and checks are recorded in the linked evidence. The newer wallet, persistent TEE and scoped agent prototype is at [Agent access](https://facet-near.vercel.app/agents), with contracts and execution evidence at [/near](https://facet-near.vercel.app/near).

**The complete private browser walkthrough has not passed.** Wallet authentication and binding work in the injected-wallet browser checks, and separate live executions establish sealed copies, scoped disclosure and recovery. The browser run stopped at private-copy confirmation because OutLayer settlement expired. Locked-vault external-agent use through live HTTP and the full hosted private browser run remain untested. Treat the walkthrough below as implemented steps to try, rather than a recording of a verified browser run.

## Wallet, TEE and agent walkthrough

1. Create a local vault, save an encrypted backup and issue the fictional training credential.
2. Open **Agent access**, connect a NEAR testnet wallet, sign in and bind it to the vault.
3. Approve the original, credential and holder-key TEE copy, then select **Save private TEE copy**.
4. Leave learner and score private. Choose course and achievement, purpose, expiry and two executions. Approve the permission.
5. Run the demo agent and inspect approved claims, the NEAR receipt and public private-job receipt.
6. Export private agent access, lock the vault, and run the external client with the remaining execution:

```bash
npm run agent:use -- --access /path/to/facet-private-agent-access.json
```

7. Unlock the holder vault and revoke the grant. Future requests are refused.
8. On a separate browser, connect the same wallet, approve **Recover copy**, and choose a new password. The saved original and holder key return from the TEE; local history and old capabilities still need the encrypted backup.

NEAR authorizes each use through signed grants, caller restrictions, current credential status, expiry, usage and revocation. Facet calls OutLayer through the NEAR contract using a published worker hash. Agent recipients independently verify the browser-prepared BBS presentations. The example agent is deterministic; it uses no language model.

[Private integration evidence](https://facet-near.vercel.app/near-verification.json) records testnet transactions and OutLayer execution IDs. Wallet browser automation uses an injected NEAR Connect harness with real signatures and transactions; manual Meteor/Intear login is not covered. Facet does not independently verify the complete TDX attestation chain.

## What was verified

The original primary-browser recording shows the local encrypted vault, an unverified self-recorded NFT, a signed fictional training credential, owner-approved BBS disclosure, successful proof verification, replay refusal, the proof lab and vault locking.

During the same run, an encrypted backup restored the vault in another browser. That restored holder revoked the credential in a real transaction, and subsequent verification rejected it. Those second-browser actions are recorded in the linked test evidence; they are not part of this primary-browser video.

Desktop, 390px and 320px layout checks passed after fixing the mobile hero buttons. The workflow checked ciphertext in IndexedDB and that API requests did not contain the vault password, original document bytes or private filename. The issuer and training claims are fictional. Cryptographic proofs and NEAR receipts are real; institution onboarding remains future work.

## Reproduce the features

Follow the complete workflow in the [README](../README.md). The checked-in browser helpers are `scripts/browser-scenario.ts`. Live workflows require available demo sponsorship or your own isolated testnet configuration. Application tests and frontend builds need no private keys.

Live workflows use fictional inputs and real NEAR testnet transactions. [Submission wording](SUBMISSION.md) explains the concrete NEAR roles and current limits.

# How Facet uses NEAR

Facet is a private credential vault that lets people connect a NEAR wallet and approve exactly which credential facts an application or agent may receive. Users can keep encrypted digital documents and optionally save a recoverable copy in an OutLayer TEE. The agent receives an approved proof; the original document and hidden claims stay private.

## Answer for the submission form

> Facet uses NEAR as its identity, credential-status and consent layer. NEAR Connect and NEP-413 authenticate the user's wallet. A deployed NEAR contract registers holder-bound credential records, issuer keys, expiry and revocation, and verifies signed agent permissions specifying fields, recipient, duration, usage allowance and worker hash. Each agent request is authorized on NEAR before a cross-contract call invokes OutLayer's confidential Rust WASI worker. The worker uses persistent sealed storage and encrypts a preapproved selective-disclosure proof for the recipient. NEAR records the execution receipt, and the bound wallet can authorize recovery of the saved document and holder key on another device. Original documents and hidden credential claims are excluded from public chain state.

## Concrete integration

| Technology | What it does in Facet |
| --- | --- |
| NEAR Connect + NEP-413 | Authenticates a testnet wallet with a signed challenge and checks its live full-access key. |
| NEAR credential contract | Registers salted fingerprints, holder identity, issuer status, expiry and revocation. Personal uploads remain unverified. |
| NEAR native Ed25519 verification | Checks the holder's exact consent and the agent's capability signature. |
| Onchain agent grants | Enforces approved field scope, caller identity, expiry, revocation and execution allowance. |
| NEAR cross-contract calls + OutLayer | Dispatches a published worker version for private storage, approved disclosure and owner recovery. |
| Wallet-signed recovery | Delivers the saved copy encrypted to a fresh key in the owner's browser. |

**Public integration:** [facet-near.vercel.app/near](https://facet-near.vercel.app/near) · **Evidence:** [near-verification.json](https://facet-near.vercel.app/near-verification.json) · **Main contract:** [credentials.facet-lab-1102.testnet](https://testnet.nearblocks.io/address/credentials.facet-lab-1102.testnet).

## Honest prototype status

Real NEAR and OutLayer transactions demonstrate sealed document copies, scoped agent delivery and wallet-authorized recovery. The local encrypted-vault and direct BBS browser workflow also passed. The complete private browser workflow has not passed: some OutLayer workers settle after their NEAR callback expires. Locked-vault external-agent use through live HTTP, manual Meteor/Intear compatibility and the full hosted private browser run remain unverified.

The demo agent is deterministic; an AI agent can integrate the same capability API. BBS proofs are prepared when the owner approves permission and independently verified by recipients. The TEE checks signed bindings and scope but does not derive fresh BBS proofs or verify their mathematics during use. Facet records OutLayer execution IDs without independently verifying the full TDX attestation chain. Project administrators remain trusted because future versions can access project-bound keys. This is a testnet prototype with fictional issuer claims and no independent security audit.

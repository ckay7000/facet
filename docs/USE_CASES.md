# Facet: examples and product scope

## Training completion — implemented demonstration

A hiring team needs proof of a completed privacy course. Facet Test Academy issues Avery Morgan a fictional certificate for Data Privacy Foundations: Completed, 92 / 100. The holder approves course and completion disclosure. The hiring team verifies those fields without learning the name, score or student reference from the proof. Holder ID, token ID, credential type, expiry and salted fingerprint remain visible as required bindings.

The signature proves what the demo issuer signed. It does not independently certify the institution’s legitimacy. The verifier checks current issuer trust, revocation, expiry, holder approval and nonce use. A second check of the same request is refused.

## Private document record — implemented

An individual stores training notes in a password-protected browser vault and records a salted fingerprint on NEAR. They can download the original unchanged and back up the encrypted vault. The NFT is self-recorded and unverified: it cannot become proof of a qualification simply because it was minted.

## Membership or workplace access — future integration

A club or employer could issue a credential and ask for membership or completed training at access time. The selective-disclosure and revocation primitives exist; real issuer onboarding, organization identity verification and an access-control integration do not.

## Education credential exchange — future integration

A university could issue genuine qualification claims directly. Verification would require its trusted issuer key, appropriate schemas, expiry/revocation policies and an institutional enrollment process. Uploading a scanned diploma is not enough.

## What this prototype cannot demonstrate

It does not turn arbitrary identity documents into authenticated credentials, implement age-threshold predicates, hide public NFT activity, recover forgotten vault passwords, or erase previously disclosed information. Its custom proof schema is not a complete W3C VC interoperability implementation.

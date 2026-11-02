Facet independent verification code

Download these files into one directory from https://facet-near.vercel.app/proof-code/:
package.json, crypto.ts, types.ts, bbs.d.ts, testnet.json, verify.ts

With Node 24 or newer:
  npm install
  node --import tsx verify.ts path/to/facet-selective-proof.json

This verifies BBS signatures, holder approval, request authenticity, expiry,
issuer trust, current revocation and request reuse. It reads NEAR directly and
does not trust the hosted service's accepted flag. It performs no transactions.

A used request fails acceptance for a new verification, even if its stored receipt
matches the proof. Expired requests fail freshness. A real institution would need
to be onboarded as a trusted issuer; this registry contains a fictional demo issuer.

The demo uses a custom credential schema and is not a complete W3C VC suite.
The project code is MIT licensed; the pinned BBS implementation is BSD-3-Clause.

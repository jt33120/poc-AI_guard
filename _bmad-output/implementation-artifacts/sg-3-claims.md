# Story SG.3: Every promise backed by a test (P2)

Status: review

## Story

As the xSOM owner selling Secret Guard,
I want each user-facing claim mapped to the test or CI gate that proves it,
so that we never sell a promise the product does not keep.

## Acceptance Criteria

1. `docs/secret-guard/CLAIMS.md` lists every user-facing claim (extension README/Marketplace
   description, `package.json` description, tooltip/dashboard texts, the public page copy
   `frontend/components/secret-guard/secret-guard-copy.ts`, read-only) → proof → status.
2. Missing proofs are added as tests or gates, e.g. a static gate that the detection path of
   core/runner imports no network module (« sans LLM · sans réseau · avant l’envoi »).
3. Claims that cannot be proven go to « À corriger » with the exact copy change recommended;
   frontend copy is not edited.
4. `docs/secret-guard/IMPLEMENTATION-STATUS.md` updated honestly.

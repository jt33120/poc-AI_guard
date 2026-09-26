# Story SG.2: xSOM custom rules on the workstation (P1)

Status: review

## Story

As a Secret Guard Équipe customer,
I want the extension to apply the rules pack that xSOM calibrated and signed for my tenant,
so that my own sensitive data (customer ids, project code names, internal hosts) is stopped
before it reaches an AI assistant, locally, with no LLM and no network on the detection path.

## Acceptance Criteria

Normative sources, frozen: `secret-guard/contracts/RULES-PACK.md`, `rules-pack.schema.json`,
`fixtures/rules-pack-vectors.json`. They are never edited.

1. **Contract vectors** — a TypeScript contract test passes every vector: 59 grammar codes,
   20 detection vectors (exact substrings, in order), terms digests, 10 pack-validity codes,
   the signature vector (keyId, canonical form, digest, signature) and the tampered rejection.
2. **Core stays pure** — `packages/core` keeps zero runtime dependencies, no `node:` import,
   synchronous API. SHA-256 is implemented in TypeScript and tested against NIST vectors and
   `node:crypto`.
3. **Safe patterns** — validator + compiler to an ECMAScript RegExp source without `u`, with
   `\d \w \s` expanded to explicit ASCII classes. Detection runs on a step-counted backtracking
   matcher with exact ECMAScript leftmost-first semantics (differential test against the
   compiled RegExp).
4. **Bounded time** — literal prefilter (anchor or context keyword) and a work budget per scan;
   budget exceeded ⇒ BLOCK, `complete:false`, never a pass. A valid but pathological pattern on
   1 MiB adversarial input returns within the budget.
5. **Scan pipeline** — custom findings add to built-in ones (verdict = the stricter); a
   built-in secret is still detected with a pack loaded; Expurger masks custom findings with a
   placeholder built from the detector label; `ScanResult` never carries a detected value.
6. **Authority keys** — the envelope is verified only against Ed25519 public keys compiled into
   the build (`XSOM_RULES_AUTHORITY_KEYS`, esbuild `define`), looked up by `keyId`; a key carried
   by the envelope is never trusted; a build without keys refuses every pack and says so.
   The public TEST key of the vectors can never reach a VSIX.
7. **Acceptance rules** — validity (§2, self-tests included), tenant = enrolled tenant,
   anti-downgrade per `packId` persisted on disk, expired pack still applied and flagged,
   refused/absent pack leaves built-in rules intact. The hook runner re-verifies what it loads.
8. **Sync & posture** — `GET /v1/extension/rules-pack` next to the policy sync; posture/event
   fields of contract §7 (`rules_pack_synced`, `rules_pack_id/version/digest`,
   `custom_findings`, `custom_detector_ids`, reasons `rules_pack_rejected`/`rules_pack_expired`).
9. **Status** — tooltip + dashboard show the state in few words; no checkbox, no user-editable
   rule; the 7 existing tooltip controls are kept.
10. **Key ceremony** — `scripts/generate-rules-authority-key.mjs` (seed written 0600 outside the
    repo), runbook section, release workflow reading a repository variable. No production key
    generated or committed.
11. **Benchmark** — the gate includes the largest valid pack (200 detectors, 20 000 digests);
    numbers recorded. Version 0.7.0 with a CHANGELOG entry (no tag, no release).

## Tasks / Subtasks

- [x] Core: `sha256.ts`, `custom/pattern.ts` (parser, codes, compiler, matcher), `custom/terms.ts`,
      `custom/schema.ts`, `custom/pack.ts` (validity, compile), `custom/detect.ts`, scanner (AC 1–5)
- [x] Runner: `rules-pack.ts` (canonical form, keyId, authority keys, verify, accept, state) (AC 6–7)
- [x] VS Code: build define, `rules-pack-sync.ts`, `rules-pack-view.ts`, hook-entry loading,
      extension scans with the pack, events/posture, tooltip + dashboard, offline import (AC 6–9)
- [x] Scripts/docs/CI: key script, runbook, release workflow, VSIX inspection of keys (AC 6, 10)
- [x] Tests: contract, hostile, bundled hook, Extension Host, benchmark (AC 1, 4, 7, 11)

## Dev Notes

- Detection semantics are the contract's, on the original text only (no NFKC/decoded views):
  what xSOM calibrates on the platform is exactly what the workstation does.
- Enrolled tenant: the platform does not return `tenant_id` on `/v1/extension/register` today.
  Order of trust: `tenant_id` from register when present → `tenantId` of the verified managed
  policy → tenant of the first pack received over this workstation's authenticated channel,
  pinned until disconnection. A later pack for another tenant is refused.
- Rules pack response can reach ~2.5 MB (20 000 digests + 400 test texts): dedicated bounded
  fetch (4 MiB), not the 64 kB policy reader.
- Only additive: a pack never disables or weakens a built-in rule.

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- All 59 grammar, 20 detection, 7 terms, 10 pack-validity vectors and the signature vector pass
  (`tests/core/rules-pack-contract.test.ts`, `tests/runner/rules-pack.test.ts`).
- Matcher proven equal to ECMAScript `matchAll` by a differential fuzz (> 3 000 cases) and on
  anchor-restricted scanning.
- Custom detections are never delegated to the Claude relay (it does not know the tuning).
- Largest pack: 16 KiB 16 ms, 256 KiB 250 ms, 1 MiB ≈ 1 s p95 (complete); hook load 28 ms.

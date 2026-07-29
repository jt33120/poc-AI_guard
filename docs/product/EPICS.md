---
title: "xSOM AI Guard v2 — Epics and Stories"
product: xSOM AI Guard
release: v2.0
status: draft
owner: Scrum Master / PO (BMAD)
created: 2026-07-27
updated: 2026-07-27
implements: docs/product/PRD.md (FR-1 … FR-152), docs/product/ARCHITECTURE-V2.md
authority: CLAUDE.md §4 (non-negotiable invariants) > docs/product/PRD.md > docs/product/ARCHITECTURE-V2.md > this document
stepsCompleted:
  - load-input-documents
  - extract-requirements-inventory
  - build-fr-coverage-map
  - decompose-into-epics
  - decompose-into-stories
  - write-acceptance-criteria
  - flag-invariant-touching-stories
  - validate-coverage-completeness
inputDocuments:
  - docs/product/PRD.md
  - docs/product/ARCHITECTURE-V2.md
  - CLAUDE.md
  - README.md
  - docs/DEPLOY.md
  - docs/SECURITY.md
  - docs/ADR-0001-ai-observability.md
---

# xSOM AI Guard v2 — Epics and Stories

## Overview

This document decomposes the v2 PRD (152 functional requirements) and the v2 technical
architecture into **14 epics** and **163 implementable stories**. It is the hand-off artifact
between product/architecture and implementation: a developer should be able to pick any single
story, know exactly which files it touches, and know exactly which test would fail if the story
regressed.

**What v2 is.** xSOM AI Guard is an MCP action-control gateway: every tool call an agent makes
passes through a deterministic authorization pipeline, irreversible actions are held for a named
human, and every decision is written to an append-only hash-chained audit log. v2 does not change
that thesis. It closes the four gaps around it — **deployment**, **transparency**, **coverage**,
and **enforcement-core hardening** — so that a stranger can self-host it in ten minutes, every
administrative change is recorded, every decision explains itself, and an auditor can verify the
record without trusting us.

### How to read a story

Each story carries a one-line metadata block:

```
Effort: S | M | L   ·   Files: the real paths it touches   ·   FRs: the requirements it delivers
```

- **Effort.** `S` = a focused change in one or two files with its test (hours). `M` = a module plus
  its API/console edge and tests (a day or two). `L` = a new module or a cross-cutting refactor with
  a migration, an API surface and a console surface (several days). Every story is still a *single
  focused change* — an `L` is large in volume, never in number of concerns.
- **Files.** Concrete paths read from the repository at `HEAD`. A path that does not exist yet is
  marked `(new)`. Migration numbers follow `docs/product/ARCHITECTURE-V2.md` §4; the ledger's
  contiguity rule (Story 1.7) assigns the real number at implementation time if the order shifts.
- **⚠ INVARIANT.** A story marked this way touches one of the CLAUDE.md §4 non-negotiables and
  **requires a second reviewer plus an explicit invariant assertion in the PR description**. The
  specific invariant is named. No story in this document may violate an invariant: where the PRD
  implies one (erasure vs. append-only, framework-owned HITL, storing arguments), the story is
  written to *enforce* the invariant and to disclose the resolution.

### Sequencing rationale

Epics are ordered by delivery value with dependencies respected, against the user's stated
priorities: **(1) ultra-easy deployment, (2) transparency, (3) exhaustive coverage.**

1. **Epic 1 is deployment** and ships first. It is also the *gate*: after Epic 1, nothing merges
   that does not pass the deployment smoke workflow (Story 1.24). This is deliberate — the five
   deployment defects that shipped to main were all invisible to a correctness-only CI.
2. **Epics 2–3 are transparency**, in dependency order: the provenance annex must exist before
   checkpoints can digest it, and exports must carry hashes before a standalone verifier is
   meaningful.
3. **Epic 4** ("supervising the supervisors") comes next because a tamper-evident record that omits
   the administrator who changed the rules is not evidence — it is the single largest credibility
   gap and it depends only on Epic 2's actor dimension.
4. **Epic 5 (the guard pipeline) precedes Epic 6 (Emergency Stop).** This deliberately deviates from
   `ARCHITECTURE-V2.md` Appendix C, which sequences halt/resume in step 4 and the refactor in step 5.
   Risk **R-1** states the stronger rule: *ship the refactor before any new guard so the two changes
   are never entangled*. Halt is a new guard. Implementing it twice (once per ingress path) and then
   refactoring would entangle the two riskiest changes in the release. The pipeline lands first,
   behind the golden-decision corpus (Story 5.1); halt then lands once, as guard #1.
5. **Epics 7–12 are coverage and the remaining planes**, each depending on the pipeline and the
   provenance record beneath them.
6. **Epic 13 is the operator and public surface**, last because FR-110's rule — *a backend capability
   without a console surface has not shipped* — is enforced there as a gate over everything before it.
7. **Epic 14 is the post-v2.0 backlog**: every FR that PRD §6.2 defers, written as a real story so
   the coverage map is complete and nothing is silently dropped.

### Definition of done (per story)

A story is done when: its acceptance criteria pass as automated tests; `make verify` is green
(ruff, mypy, pytest, eslint, tsc, Playwright smoke, `scripts/audit_security.py`); the deployment
smoke workflow is green (from Story 1.24 onward); and — for any story that adds an enforcement
branch — the branch is **off by default** (NFR-7) and its default is stated in `docs/CAPABILITIES.md`.

---

## Requirements Inventory

### Functional Requirements

Source: `docs/product/PRD.md` §4. `[MVP]` = in scope for the v2.0 release per §6.1. Requirements
without the tag are deferred to post-v2.0 per §6.2 and are covered by Epic 14 (or, where the PRD
splits them, by a v2.0 story that lands the non-deferred half).

**Group A — Enforcement Core (the thesis, hardened)**

| FR | Requirement | MVP |
|---|---|---|
| FR-1 | Single guard pipeline across all ingress paths | ✅ |
| FR-2 | Declared guard coverage on every decision response | ✅ |
| FR-3 | Enforcement Mode recorded on every audit entry | ✅ |
| FR-4 | Session-aware HTTP ingress | ✅ |
| FR-5 | Streamed tool-call inspection | — |
| FR-6 | Multilingual and opaque tool classification | ✅ |
| FR-7 | Fail-closed on guard unavailability | ✅ |
| FR-8 | Immutable policy versions | ✅ |
| FR-9 | Policy version stamped on decisions | ✅ |
| FR-10 | Policy diff and rollback | ✅ |
| FR-11 | Policy simulation | ✅ |
| FR-12 | Staged policy rollout | — |
| FR-13 | Policy templates | ✅ |
| FR-14 | Deterministic policy export | — |
| FR-15 | Human decision chained at decision time | ✅ |
| FR-16 | Mandatory justification on a decision | ✅ |
| FR-17 | Decision Brief presented to the approver | ✅ |
| FR-18 | Effective expiry derived in the read path | ✅ |
| FR-19 | Separation of duties | ✅ |
| FR-20 | Approver routing with escalation | ✅ |
| FR-21 | Decide where the human works (signed channel) | ✅ |
| FR-22 | Native protocol elicitation | — |
| FR-23 | Halt scopes (tenant, agent, tool) | ✅ |
| FR-24 | Halt effective on live sessions | ✅ |
| FR-25 | Halt fails closed | ✅ |
| FR-26 | Halt reachable in one action | ✅ |
| FR-27 | Halt is audited | ✅ |
| FR-28 | Automatic containment | — |
| FR-29 | Persist the risk score and its factors | ✅ |
| FR-30 | Return the risk score and band | ✅ |
| FR-31 | Score distribution for band tuning | ✅ |
| FR-32 | Per-agent Earned Trust | ✅ |
| FR-33 | The irreversible floor holds | ✅ |
| FR-34 | Tenant-scoped judge budget | — |

**Group B — Exhaustive Supervision Coverage**

| FR | Requirement | MVP |
|---|---|---|
| FR-35 | Actor dimension on audit entries | ✅ |
| FR-36 | Every control-plane mutation is chained | ✅ |
| FR-37 | Content discipline on control-plane events | ✅ |
| FR-38 | Attribution is mandatory | ✅ |
| FR-39 | Control-plane review surface | — |
| FR-40 | Agent attribution on every path | ✅ |
| FR-41 | AI System registry | ✅ |
| FR-42 | Registry completeness gate | ✅ |
| FR-43 | Delegation lineage captured | ✅ |
| FR-44 | Scoped child credentials | — |
| FR-45 | Federated agent identity | — |
| FR-46 | Credential hygiene surfaced | ✅ |
| FR-47 | Revocation effective immediately | ✅ |
| FR-48 | Client SDK (Python + TypeScript) | ✅ |
| FR-49 | Client-side fail-closed | ✅ |
| FR-50 | Framework adapters | ✅ |
| FR-51 | Honest strength labelling | ✅ |
| FR-52 | Standards-shaped decision façade | — |
| FR-53 | Tool annotations as a safety floor | ✅ |
| FR-54 | Annotations in the fingerprint | ✅ |
| FR-55 | Forward compatibility with stateless MCP | — |
| FR-56 | Durable Session identity | ✅ |
| FR-57 | Session and trace on audit entries | ✅ |
| FR-58 | Stable correlation id per call | ✅ |
| FR-59 | Session timeline | ✅ |
| FR-60 | Evaluate-only replay | ✅ |
| FR-61 | Inspector shows the runtime truth | ✅ |
| FR-62 | Persisted taint | ✅ |
| FR-63 | Taint is visible | ✅ |
| FR-64 | DLP participates in post-taint decisions | — |
| FR-65 | Behavioural baseline | ✅ |
| FR-66 | Behavioural Drift raises an event | ✅ |
| FR-67 | Drift feeds the risk score | — |
| FR-68 | Poison reason persisted and shown | ✅ |
| FR-69 | Capture action outcome | ✅ |
| FR-70 | Outcome rates per agent and tool | ✅ |
| FR-71 | Operator incident labelling | — |
| FR-72 | Post-incident linkage | — |
| FR-73 | No model quality claims | ✅ |
| FR-74 | Tenant-keyed rate limiting with shared storage | ✅ |
| FR-75 | Budgets | ✅ |
| FR-76 | Budget events are audited | ✅ |
| FR-77 | Cost correctness (cache / reasoning tokens) | ✅ |
| FR-78 | Connection efficiency (pooling) | — |
| FR-79 | Membership plane | ✅ |
| FR-80 | `human_dual` becomes reachable | ✅ |
| FR-81 | Scoped operators | — |
| FR-82 | Identity federation (OIDC) | — |
| FR-83 | Step-up for high-risk approvals | — |
| FR-84 | Break-glass is explicit | ✅ |

**Group C — Ultra-Easy Deployment**

| FR | Requirement | MVP |
|---|---|---|
| FR-85 | `docker compose up` brings up a working stack | ✅ |
| FR-86 | The console is containerised | ✅ |
| FR-87 | Auth is not a hard SaaS dependency | ✅ |
| FR-88 | The image can migrate itself | ✅ |
| FR-89 | No vendor URL in any artifact | ✅ |
| FR-90 | Orchestrated deployment (Helm) | — |
| FR-91 | Bootstrap without SQL | ✅ |
| FR-92 | Signup enabled by default where it can be | ✅ |
| FR-93 | Errors are actionable | ✅ |
| FR-94 | CLI surface (`xsom`) | ✅ |
| FR-95 | Destructive CLI operations are guarded | ✅ |
| FR-96 | Correct integration snippets | ✅ |
| FR-97 | Migration ledger | ✅ |
| FR-98 | Idempotent forward-only runner | ✅ |
| FR-99 | Migration integrity enforced in CI | ✅ |
| FR-100 | Documented, tested upgrade path | ✅ |
| FR-101 | Placeholders, not vendor values | ✅ |
| FR-102 | Liveness and readiness are separate | ✅ |
| FR-103 | Capability reporting on readiness | ✅ |
| FR-104 | Environment file boots | ✅ |
| FR-105 | Deployment smoke in CI | ✅ |
| FR-106 | Demo needs only Docker | ✅ |
| FR-107 | Safe defaults everywhere | ✅ |
| FR-108 | Guided first policy | ✅ |
| FR-109 | Progressive capability activation | ✅ |
| FR-110 | Every shipped control has an operator surface | ✅ |
| FR-111 | Bounded, validated server configuration | ✅ |
| FR-112 | Console language parity (EN/FR) | ✅ |

**Group D — Transparency**

| FR | Requirement | MVP |
|---|---|---|
| FR-113 | Decision Reason and Escalation Source persisted | ✅ |
| FR-114 | `error` means error | ✅ |
| FR-115 | Gate events are first-class | ✅ |
| FR-116 | Audit explorer shows the truth | ✅ |
| FR-117 | Explanation is machine-readable | ✅ |
| FR-118 | No generated prose in verdicts | ✅ |
| FR-119 | Exports carry the proof | ✅ |
| FR-120 | Standalone verifier | ✅ |
| FR-121 | Signed Checkpoints | ✅ |
| FR-122 | External Anchors | ✅ |
| FR-123 | Truncation is detectable | ✅ |
| FR-124 | Verification as an endpoint | ✅ |
| FR-125 | Honest documentation of limits | ✅ |
| FR-126 | Published threat model | — |
| FR-127 | Evidence Packs contain the evidence | ✅ |
| FR-128 | Oversight sourced from the chain | ✅ |
| FR-129 | Tenant-scoped compliance computation | ✅ |
| FR-130 | Retention reported from observation | ✅ |
| FR-131 | Multi-framework mapping | ✅ |
| FR-132 | Signed impact assessment | — |
| FR-133 | Data Manifest | ✅ |
| FR-134 | Manifest enforced in CI | ✅ |
| FR-135 | Erasure is operable and audited | ✅ |
| FR-136 | Opt-in Argument Vault | — |
| FR-137 | Ingested telemetry content-free by rule | ✅ |
| FR-138 | Per-tenant retention and residency | — |
| FR-139 | Published API specification | ✅ |
| FR-140 | Product version on every decision | ✅ |
| FR-141 | SBOM and provenance | ✅ |
| FR-142 | Licence and changelog | ✅ |
| FR-143 | Documentation matches the product | ✅ |
| FR-144 | Published coverage map | ✅ |
| FR-145 | Supply-chain scanning breadth | — |
| FR-146 | Signed webhook egress | ✅ |
| FR-147 | SIEM-shaped format | ✅ |
| FR-148 | Trace export | ✅ |
| FR-149 | Per-tenant notification channels | ✅ |
| FR-150 | Alert on what matters | ✅ |
| FR-151 | Telemetry ingestion tracks the current standard | ✅ |
| FR-152 | Standard correlation keys preferred | ✅ |

### Non-Functional Requirements

Source: `docs/product/PRD.md` §10. These apply to **every** story; the "enforced by" column names the
stories where the NFR becomes an executable gate rather than a convention.

| NFR | Requirement | Enforced by |
|---|---|---|
| NFR-1 | Determinism on the hot path — no LLM participates in an authorization decision | 5.2, 5.10, 11.5 |
| NFR-2 | Fail-closed by construction — absence of a decision is never an allow | 5.4, 6.3, 8.3 |
| NFR-3 | Latency budget — one shared connection per call; p95 overhead budgeted (CM-3) | 5.2, 6.2, 10.2 |
| NFR-4 | Tenant isolation in the database — RLS from the creating migration, two-tenant test per table | 1.11, 4.10, 7.9, every migration story |
| NFR-5 | Bounded validation — every new input length- and shape-bounded | 1.23, 4.7, 12.1 |
| NFR-6 | Content discipline — no content, result bodies or PII in any new column, log, span, payload or export | 2.6, 4.4, 7.14, 11.9, 11.11, 12.3 |
| NFR-7 | Backward compatibility of controls — every new enforcement branch opt-in, off by default | 1.20, 5.1, 5.7, 7.2, 7.12 |
| NFR-8 | Chain stability across change — no Payload v1 shape change; upgrade verified | 1.8, 2.1, 2.2, 3.4 |
| NFR-9 | Testability — every FR has at least one automated test that fails on regression | every story's AC |
| NFR-10 | Accessibility and clarity — approval and audit surfaces keyboard-navigable and labelled | 2.10, 4.15, 13.3 |
| NFR-11 | Dependency discipline — no dependency outside CLAUDE.md §3 without written PR justification | 12.4, 14.15 |
| NFR-12 | Availability posture — control-plane unavailability must not silently degrade enforcement | 5.4, 6.3 |

**Cross-cutting constraint families** also binding on every story, carried from the PRD:
safety guardrails **G-S1…G-S6** (§11.1), privacy guardrails **G-P1…G-P7** (§11.2), cost guardrails
**G-C1…G-C6** (§11.3), compliance positions **C-1…C-10** (§13), API contracts **API-1…API-8** (§14),
versioning policy **V-1…V-9** (§15), operational requirements **OP-1…OP-10** (§16), data governance
**DG-1…DG-10** (§17) and the audit-trail constitution **AT-1…AT-10** (§18).

### FR Coverage Map

Every FR in the PRD maps to at least one story. **An uncovered FR is a defect**; this table is the
proof of completeness and is validated by `scripts/audit_security.py`-style discipline at review
time (and, once Story 13.8 lands, published alongside `docs/COVERAGE.md`).

**Coverage: 152 / 152 FRs. Uncovered: none.**

| FR | Requirement | Covering stories |
|---|---|---|
| FR-1 | Single guard pipeline | 5.2 |
| FR-2 | Declared guard coverage | 5.3 |
| FR-3 | Enforcement Mode recorded | 2.2, 5.3 |
| FR-4 | Session-aware HTTP ingress | 5.5 |
| FR-5 | Streamed tool-call inspection | 14.1 |
| FR-6 | Multilingual / opaque classification | 5.8 |
| FR-7 | Fail-closed on guard unavailability | 5.4 |
| FR-8 | Immutable policy versions | 9.1, 9.5 |
| FR-9 | Policy version stamped on decisions | 9.2 |
| FR-10 | Policy diff and rollback | 9.3, 9.5 |
| FR-11 | Policy simulation | 9.4 |
| FR-12 | Staged policy rollout | 14.2 |
| FR-13 | Policy templates | 1.19 |
| FR-14 | Deterministic policy export | 14.3 |
| FR-15 | Human decision chained at decision time | 4.6 |
| FR-16 | Mandatory justification | 4.7 |
| FR-17 | Decision Brief | 4.15 |
| FR-18 | Effective expiry | 4.9 |
| FR-19 | Separation of duties | 4.8 |
| FR-20 | Approver routing | 4.13 |
| FR-21 | Decide in a signed channel message | 4.14 |
| FR-22 | Native protocol elicitation | 14.4 |
| FR-23 | Halt scopes | 6.1 |
| FR-24 | Halt effective on live sessions | 6.2 |
| FR-25 | Halt fails closed | 6.3 |
| FR-26 | Halt reachable in one action | 6.5 |
| FR-27 | Halt is audited | 6.4 |
| FR-28 | Automatic containment | 14.5 |
| FR-29 | Persist risk score and factors | 2.6 |
| FR-30 | Return risk score and band | 2.7 |
| FR-31 | Score distribution for tuning | 13.1 |
| FR-32 | Per-agent Earned Trust | 7.2 |
| FR-33 | The irreversible floor holds | 5.9 |
| FR-34 | Tenant-scoped judge budget | 14.6 |
| FR-35 | Actor dimension | 2.2 |
| FR-36 | Every control-plane mutation chained | 4.1, 4.2, 4.3 |
| FR-37 | Content discipline on control-plane events | 4.4 |
| FR-38 | Attribution is mandatory | 4.1 |
| FR-39 | Control-plane review surface | 4.5 |
| FR-40 | Agent attribution on every path | 7.1 |
| FR-41 | AI System registry | 7.3 |
| FR-42 | Registry completeness gate | 7.4 |
| FR-43 | Delegation lineage captured | 7.5 |
| FR-44 | Scoped child credentials | 14.7 |
| FR-45 | Federated agent identity | 14.8 |
| FR-46 | Credential hygiene surfaced | 6.8 |
| FR-47 | Revocation effective immediately | 6.7 |
| FR-48 | Client SDK | 8.1, 8.2 |
| FR-49 | Client-side fail-closed | 8.3 |
| FR-50 | Framework adapters | 8.4, 8.5 |
| FR-51 | Honest strength labelling | 8.6 |
| FR-52 | Standards-shaped façade | 14.9 |
| FR-53 | Tool annotations as a floor | 5.6 |
| FR-54 | Annotations in the fingerprint | 5.7 |
| FR-55 | Forward compatibility with stateless MCP | 7.7, 14.10 |
| FR-56 | Durable Session identity | 7.6 |
| FR-57 | Session and trace on audit entries | 2.2 |
| FR-58 | Stable correlation id per call | 2.2, 2.4 |
| FR-59 | Session timeline | 7.8 |
| FR-60 | Evaluate-only replay | 5.10 |
| FR-61 | Inspector shows the runtime truth | 5.11 |
| FR-62 | Persisted taint | 7.9 |
| FR-63 | Taint is visible | 7.10 |
| FR-64 | DLP in post-taint decisions | 14.11 |
| FR-65 | Behavioural baseline | 7.11 |
| FR-66 | Behavioural Drift event | 7.12 |
| FR-67 | Drift feeds the risk score | 14.12 |
| FR-68 | Poison reason persisted and shown | 7.13 |
| FR-69 | Capture action outcome | 7.14 |
| FR-70 | Outcome rates per agent and tool | 7.15 |
| FR-71 | Operator incident labelling | 14.13 |
| FR-72 | Post-incident linkage | 14.14 |
| FR-73 | No model quality claims | 7.16 |
| FR-74 | Tenant-keyed rate limiting | 10.1 |
| FR-75 | Budgets | 10.2, 10.5 |
| FR-76 | Budget events audited | 10.3 |
| FR-77 | Cost correctness | 10.4 |
| FR-78 | Connection pooling | 14.15 |
| FR-79 | Membership plane | 4.10 |
| FR-80 | `human_dual` reachable | 4.11 |
| FR-81 | Scoped operators | 14.16 |
| FR-82 | Identity federation (OIDC) | 14.17 |
| FR-83 | Step-up for high-risk approvals | 14.18 |
| FR-84 | Break-glass is explicit | 4.16 |
| FR-85 | `docker compose up` works | 1.13 |
| FR-86 | Console containerised | 1.12 |
| FR-87 | Auth is not a hard SaaS dependency | 1.10, 1.11 |
| FR-88 | The image can migrate itself | 1.9 |
| FR-89 | No vendor URL in any artifact | 1.4 |
| FR-90 | Helm chart | 14.19 |
| FR-91 | Bootstrap without SQL | 1.15 |
| FR-92 | Signup enabled where it can be | 1.2 |
| FR-93 | Errors are actionable | 1.3 |
| FR-94 | CLI surface | 1.15, 1.16, 1.18, 3.8, 6.6 |
| FR-95 | Destructive CLI ops guarded | 1.17 |
| FR-96 | Correct integration snippets | 1.5 |
| FR-97 | Migration ledger | 1.6 |
| FR-98 | Idempotent forward-only runner | 1.6 |
| FR-99 | Migration integrity in CI | 1.7 |
| FR-100 | Documented upgrade path | 1.8 |
| FR-101 | Placeholders, not vendor values | 1.26 |
| FR-102 | Liveness / readiness split | 1.14 |
| FR-103 | Capability reporting | 1.14 |
| FR-104 | Environment file boots | 1.1 |
| FR-105 | Deployment smoke in CI | 1.24 |
| FR-106 | Demo needs only Docker | 1.25 |
| FR-107 | Safe defaults everywhere | 1.20 |
| FR-108 | Guided first policy | 1.21 |
| FR-109 | Progressive capability activation | 1.22 |
| FR-110 | Operator surface for every control | 13.2 |
| FR-111 | Bounded server configuration | 1.23 |
| FR-112 | Console language parity | 13.3 |
| FR-113 | Decision Reason / Escalation Source persisted | 2.1, 2.2, 2.3 |
| FR-114 | `error` means error | 2.5 |
| FR-115 | Gate events are first-class | 2.4 |
| FR-116 | Audit explorer shows the truth | 2.10 |
| FR-117 | Explanation is machine-readable | 2.8 |
| FR-118 | No generated prose in verdicts | 11.5 |
| FR-119 | Exports carry the proof | 3.1 |
| FR-120 | Standalone verifier | 3.2, 3.3 |
| FR-121 | Signed Checkpoints | 3.4, 3.5 |
| FR-122 | External Anchors | 3.6 |
| FR-123 | Truncation is detectable | 2.1, 3.5 |
| FR-124 | Verification as an endpoint | 3.7 |
| FR-125 | Honest documentation of limits | 3.9 |
| FR-126 | Published threat model | 14.20 |
| FR-127 | Evidence Packs contain the evidence | 11.4, 11.7 |
| FR-128 | Oversight sourced from the chain | 11.2 |
| FR-129 | Tenant-scoped compliance computation | 11.1 |
| FR-130 | Retention reported from observation | 11.3 |
| FR-131 | Multi-framework mapping | 11.6 |
| FR-132 | Signed impact assessment | 14.21 |
| FR-133 | Data Manifest | 11.8 |
| FR-134 | Manifest enforced in CI | 11.9 |
| FR-135 | Erasure operable and audited | 11.10 |
| FR-136 | Opt-in Argument Vault | 14.22 |
| FR-137 | Content-free ingestion by rule | 11.11 |
| FR-138 | Per-tenant retention and residency | 14.23 |
| FR-139 | Published API specification | 13.4 |
| FR-140 | Product version on every decision | 2.2, 2.9 |
| FR-141 | SBOM and provenance | 13.5 |
| FR-142 | Licence and changelog | 13.6 |
| FR-143 | Documentation matches the product | 13.7 |
| FR-144 | Published coverage map | 13.8 |
| FR-145 | Supply-chain scanning breadth | 14.24 |
| FR-146 | Signed webhook egress | 12.1, 12.2, 12.8 |
| FR-147 | SIEM-shaped format | 12.3 |
| FR-148 | Trace export | 12.4 |
| FR-149 | Per-tenant notification channels | 4.12 |
| FR-150 | Alert on what matters | 12.5 |
| FR-151 | Ingestion tracks the current standard | 12.6 |
| FR-152 | Standard correlation keys preferred | 12.7 |

---

## Epic List

| # | Epic | Goal in one line | Stories | Depends on |
|---|---|---|---|---|
| 1 | **Ultra-Easy Deployment** | `git clone` → a blocked irreversible action in ten minutes, zero SQL, zero SaaS accounts. | 26 | — |
| 2 | **Self-Explaining Decisions** | Every audit entry answers *why*, *by which guard*, *in which mode*, without interpretation. | 10 | 1 |
| 3 | **Independent Verification** | An auditor recomputes our chain on their laptop and checks it against an anchor we do not control. | 9 | 2 |
| 4 | **Supervising the Supervisors** | Every administrative change and every human decision is chained, attributed and effective. | 16 | 2 |
| 5 | **One Guard Pipeline** | One ordered guard sequence, executed identically by every ingress path. | 11 | 2, 4 |
| 6 | **Emergency Stop and Containment** | An operator stops an agent in one action, effective on already-authenticated sessions. | 8 | 5 |
| 7 | **Agent Plane Coverage** | Identity, systems, sessions, taint, drift and outcomes — the supervised unit becomes real. | 16 | 5 |
| 8 | **Universal Ingress** | Non-MCP agents come under the same policy, with the weaker trust boundary disclosed. | 6 | 5 |
| 9 | **Policy Lifecycle** | Policy becomes an append-only, diffable, rollback-able, simulable artifact. | 5 | 2, 4 |
| 10 | **Budgets, Limits and Cost** | Spend and volume are enforced, not merely measured. | 5 | 5, 7 |
| 11 | **Evidence Packs and Data Governance** | The compliance plane ships the evidence it computes, and declares what it stores. | 11 | 3, 4 |
| 12 | **Event Egress and Alerting** | The decision stream reaches the SIEM, the trace backend and the on-call human. | 8 | 2, 4 |
| 13 | **Operator and Public Surface** | Every shipped control has a console page; every claim has a published artifact. | 8 | 1–12 |
| 14 | **Post-v2.0 Backlog** | Everything PRD §6.2 defers, written down so nothing is silently dropped. | 24 | v2.0 |

---

## Epic 1: Ultra-Easy Deployment — one command, zero SQL, zero SaaS

**Goal.** Turn the deployment story from a three-vendor, hand-written-SQL quickstart that does not
boot into a single `docker compose up` plus a single `xsom init`. A platform engineer who has never
seen the product reaches a demonstrably blocked irreversible action in **≤ 10 minutes median**,
with **0 hand-written SQL statements** and **0 SaaS accounts** (SM-1, UJ-1). This epic ends with a
CI gate (Story 1.24) that every later epic must keep green — deployability stops being a claim and
becomes a build gate.

**Why first.** It is the user's stated priority #1, it is the cheapest gap to close (roughly 70% of
the bootstrap already exists in `core/signup.py` and is merely unreachable), and it unblocks
evaluation by air-gapped and sovereign buyers who cannot evaluate the product at all today.

---

### Story 1.1: The shipped environment file boots the application

**As a** platform engineer, **I want** copying `.env.example` to `.env` and starting the app to
succeed, **So that** the documented quickstart does not crash two minutes in.

`Effort: S` · `Files: core/config.py, .env.example, tests/test_env_example.py (new)` · `FRs: FR-104`

**Acceptance Criteria**
1. **Given** the repository's shipped `.env.example`, **When** `Settings(_env_file=".env.example")`
   is instantiated, **Then** it returns a valid settings object and does not raise `SettingsError`.
2. **Given** `cors_allow_origins` is annotated `Annotated[list[str], NoDecode]`, **When** the value
   `http://localhost:3000,http://localhost:3001` is supplied by environment file or variable,
   **Then** the existing `_split_origins` validator owns parsing and yields two origins.
3. **Given** `CORS_ALLOW_ORIGINS=*`, **When** settings are instantiated, **Then** the existing
   wildcard rejection still raises — the fix must not widen the allowlist rule (CLAUDE.md §4.8).
4. **Given** the new `tests/test_env_example.py`, **When** it copies `.env.example` to a temp dir and
   calls `create_app()`, **Then** the application boots; the test passes the file, never init kwargs,
   so it is not structurally blind the way `tests/test_config.py` is.
5. **Given** `pydantic-settings>=2.14.2` is already pinned, **When** the change lands, **Then** no new
   dependency is added (CLAUDE.md §3).

---

### Story 1.2: Every configuration key the runtime reads is documented and signup is enabled where it can be

**As a** new deployer, **I want** the example environment file to contain every key the application
actually reads, **So that** self-serve provisioning is not permanently disabled by an undocumented
variable.

`Effort: S` · `Files: .env.example, core/config.py, docs/DEPLOY.md` · `FRs: FR-92`

**Acceptance Criteria**
1. **Given** `core/config.py::Settings`, **When** a test enumerates its fields, **Then** every field
   appears in `.env.example` with a comment stating its default and whether it is required.
2. **Given** the auth service key, `SIGNUP_RATE_LIMIT` and `AUTHORIZE_RATE_LIMIT` were settings with
   no documentation, **When** the change lands, **Then** each is present in `.env.example` carrying an
   explicit **backend-only** warning (CLAUDE.md §4.6) and is repeated in `docs/DEPLOY.md`.
3. **Given** the auth service key is configured, **When** the API starts, **Then** self-serve signup is
   enabled without any further flag; **Given** it is absent, **Then** signup is disabled and reported
   as an unconfigured capability rather than as a failure.
4. **Given** the key is renamed for issuer-neutrality, **When** the previous name is set, **Then** it is
   still accepted and a deprecation warning is logged exactly once (PRD V-6).

---

### Story 1.3: Disabled and misconfigured capabilities return actionable errors

**As a** deployer hitting a dead signup page, **I want** the error to name the setting that would
enable it, **So that** I can fix it without reading the source.

`Effort: S` · `Files: api/signup.py, api/errors.py, core/config.py, tests/test_signup.py` · `FRs: FR-93`

**Acceptance Criteria**
1. **Given** signup is disabled, **When** `POST /v1/signup` is called, **Then** the response is
   `{"code": "signup_disabled", "detail": "signup disabled: set AUTH_SERVICE_KEY on the backend"}`.
2. **Given** any capability-gated route, **When** its prerequisite is unset, **Then** the error names
   the missing setting **and never** its value, a DSN, a stack trace or any secret (CLAUDE.md §4.8).
3. **Given** `ENV=prod`, **When** any such error is returned, **Then** the response body is identical
   to the development response — no additional detail leaks by environment.
4. **Given** a test asserting the error contract, **When** a new capability gate is added later,
   **Then** the shared error helper is the only way to construct it. ⚠ **INVARIANT: CLAUDE.md §4.8**
   (no stack trace, no secret to the client).

---

### Story 1.4: No vendor URL appears in any generated artifact

**As a** self-hosting customer, **I want** no artifact to point at a vendor-operated host, **So that**
my own provider API keys are never routed through someone else's server.

`Effort: S` · `Files: frontend/lib/config.ts, frontend/app/(app)/onboarding/page.tsx, frontend/.env.example (new), frontend/e2e/smoke.spec.ts` · `FRs: FR-89`

**Acceptance Criteria**
1. **Given** `frontend/app/(app)/onboarding/page.tsx` currently hardcodes a vendor Railway hostname,
   **When** this story lands, **Then** the constant is deleted and the value is read from
   `frontend/lib/config.ts` as `xsomApiUrl = process.env.NEXT_PUBLIC_XSOM_API_URL ?? window.location.origin`.
2. **Given** a Playwright assertion over every rendered onboarding artifact (snippets, copy buttons,
   generated configuration blocks), **When** the page renders with no `NEXT_PUBLIC_XSOM_API_URL` set,
   **Then** no string in the DOM matches a vendor hostname pattern, and the test fails if one reappears.
3. **Given** `frontend/.env.example`, **When** it is read, **Then** it documents
   `NEXT_PUBLIC_XSOM_API_URL`, `CONTROL_API_URL`, `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and contains no secret values.
   ⚠ **INVARIANT: CLAUDE.md §4.6** — this is a credential-routing defect, not a cosmetic one.

---

### Story 1.5: Generated integration snippets use the variable names the runtime actually reads

**As an** agent engineer, **I want** the snippet I copy to work unmodified, **So that** my first
integration attempt does not fail on a variable name nothing reads.

`Effort: S` · `Files: frontend/app/(app)/onboarding/page.tsx, gateway/server.py, docs/DEPLOY.md, frontend/e2e/smoke.spec.ts` · `FRs: FR-96`

**Acceptance Criteria**
1. **Given** `gateway/server.py` reads `XSOM_TENANT_TOKEN`, **When** the onboarding wizard emits an MCP
   snippet, **Then** it exports `XSOM_TENANT_TOKEN` — the current `XSOM_GATEWAY_TOKEN` mismatch is gone.
2. **Given** a test that greps the repository, **When** it collects every environment variable name
   emitted by the console and every name read by the runtime, **Then** the two sets agree, and the test
   fails on any future divergence.
3. **Given** the MCP path, **When** the snippet renders, **Then** it contains a complete, copy-pasteable
   `mcpServers` configuration block — the placeholder comment is replaced by a real block including
   command, args and env.
4. **Given** a renamed variable in future, **When** it ships, **Then** the old name is accepted and warned
   for at least two minor releases (PRD V-6).

---

### Story 1.6: A migration ledger and a forward-only runner owned by production code

**As an** operator, **I want** to know exactly which schema versions are applied, **So that** I can
upgrade and diagnose without guessing.

`Effort: M` · `Files: core/migrate.py (new), supabase/migrations/0016_schema_migrations.sql (new), scripts/migrate.py (new), tests/conftest.py, scripts/demo.py, tests/test_migrate.py (new)` · `FRs: FR-97, FR-98`

**Acceptance Criteria**
1. **Given** a fresh database, **When** `core.migrate.run(dsn)` executes, **Then** it creates
   `schema_migrations(version, checksum, applied_at, applied_by)` idempotently, applies every pending
   `supabase/migrations/*.sql` in filename order, each inside its own transaction, and records version
   plus sha256 checksum.
2. **Given** an already-migrated database, **When** the runner is re-run, **Then** it applies nothing and
   exits 0 — the runner is safely re-runnable.
3. **Given** an applied migration whose file content changed, **When** the runner starts, **Then** it
   fails with a checksum-mismatch **error**, never a warning.
4. **Given** two replicas starting simultaneously, **When** both run migrations, **Then** a Postgres
   advisory lock serialises them and exactly one applies each file.
5. **Given** the dependency direction is inverted, **When** the change lands, **Then** `tests/conftest.py`
   and `scripts/demo.py` import `core.migrate` and contain **no** migration logic of their own, and
   `core/migrate.py` imports nothing from `tests`.

---

### Story 1.7: Migration integrity is a CI gate

**As a** reviewer, **I want** CI to reject a renumbered, gapped or edited migration, **So that** a
silent schema divergence cannot recur.

`Effort: S` · `Files: tests/test_migrations.py (new), .github/workflows/ci.yml, docs/AUDIT_FORMAT.md (new)` · `FRs: FR-99`

**Acceptance Criteria**
1. **Given** `supabase/migrations/`, **When** the test runs, **Then** filenames are unique, prefixes are
   monotonically increasing, and **no new gap** appears after `0015`.
2. **Given** the existing `0012` gap, **When** the test runs, **Then** it passes because the gap is
   explicitly grandfathered and recorded in `docs/AUDIT_FORMAT.md` — renumbering a released migration
   would violate PRD V-4.
3. **Given** a released migration file is modified, **When** CI runs, **Then** the checksum-stability
   assertion fails and names the file.

---

### Story 1.8: Baseline adoption and a tested previous-release-to-head upgrade

**As an** operator of an existing deployment, **I want** the ledger to adopt my database without
re-running history, **So that** upgrading does not corrupt or duplicate schema objects.

`Effort: M` · `Files: core/migrate.py, .github/workflows/ci.yml, docs/DEPLOY.md, tests/test_migrate_upgrade.py (new)` · `FRs: FR-100`

**Acceptance Criteria**
1. **Given** a database that already has `audit_log` but no ledger, **When** the runner starts, **Then**
   it probes a sentinel object per file group and records `0001…0015` as applied **without executing
   them**.
2. **Given** `--dry-run`, **When** the runner is invoked, **Then** it prints the adoption and application
   plan and changes nothing.
3. **Given** a CI job that seeds a database at the previous released version and migrates it to the
   bundled head, **When** the job finishes, **Then** `core.audit.verify_chain` returns `ok=True` and the
   entry count is unchanged. ⚠ **INVARIANT: CLAUDE.md §4.2 / NFR-8** — the chain must survive schema
   evolution; this job is the executable proof.
4. **Given** a non-idempotent historical migration (e.g. `0015`'s `set not null` after a backfill),
   **When** adoption runs against a database that already satisfies it, **Then** it is not re-executed.

---

### Story 1.9: The container image can migrate itself

**As a** deployer, **I want** the API image to contain its own migrations and runner, **So that** the
one-shot migrate service is possible at all.

`Effort: S` · `Files: .dockerignore, Dockerfile, tests/test_docker_context.py (new)` · `FRs: FR-88`

**Acceptance Criteria**
1. **Given** `.dockerignore` currently excludes `supabase` and `scripts`, **When** this story lands,
   **Then** `supabase/migrations`, `core/migrate.py`, `scripts/migrate.py` and the `cli/` package are in
   the build context, while `tests`, `frontend` and `docs` remain excluded.
2. **Given** the built image, **When** a test runs `xsom migrate --dry-run` **inside** it against a
   throwaway database, **Then** it discovers every migration file and exits 0.
3. **Given** the image, **When** its contents are enumerated, **Then** no `.env`, no key material and no
   test fixture is present (CLAUDE.md §4.7).

---

### Story 1.10: Authentication resolves through a pluggable JWKS issuer

**As a** self-hosting customer, **I want** to point the API at any OIDC-shaped issuer, **So that** the
hosted identity provider is optional rather than required.

`Effort: M` · `Files: api/security.py, core/config.py, tests/test_security.py, docs/DEPLOY.md` · `FRs: FR-87`

**Acceptance Criteria**
1. **Given** `AUTH_ISSUER_URL` and `AUTH_JWKS_URL`, **When** `api/security.py::build_verifier` runs,
   **Then** the verifier is constructed from those values and the hosted provider becomes one issuer
   among several.
2. **Given** the existing provider-specific keys, **When** they are set, **Then** they are still accepted
   and deprecated per PRD V-6, with the derived JWKS URL preserved.
3. **Given** a token signed by the configured issuer with RS256/ES256, **When** it is verified, **Then**
   verification succeeds; **Given** a token signed by any other issuer, **Then** it is rejected.
4. **Given** `AUTH_ISSUER_MODE=selfhost_shared_secret` and `ENV=prod`, **When** the app starts, **Then**
   it refuses to start; **Given** `ENV=dev`, **Then** it starts and `/health/ready` reports the mode as a
   degraded capability. ⚠ **INVARIANT: CLAUDE.md §4.5/§4.8** — tokens stay in `httpOnly`+`Secure`+
   `SameSite` cookies and no weaker mode is reachable in production.

---

### Story 1.11: A supported auth compatibility layer keeps RLS genuinely enforced

**As a** security reviewer, **I want** the self-host database to enforce tenant isolation exactly as
the hosted one does, **So that** self-hosting is not a silent downgrade of the isolation boundary.

`Effort: M` · `Files: deploy/auth_compat.sql (new, promoted from tests/fixtures/), tests/test_rls.py, docs/DEPLOY.md` · `FRs: FR-87`

**Acceptance Criteria**
1. **Given** `deploy/auth_compat.sql` applied to a plain Postgres 16 database, **When** it completes,
   **Then** `auth.jwt()`, `auth.uid()`, `auth.role()` exist and the roles `anon`, `authenticated` and
   `service_role` exist, with **`service_role` carrying `BYPASSRLS`** exactly as the hosted provider does.
2. **Given** an identity container that owns `auth.users`, **When** the compat file runs, **Then**
   `auth.users` is created only `if not exists` so the identity service's own migration wins.
3. **Given** `tests/test_rls.py`, **When** it runs **unmodified** against the compose database, **Then**
   every two-tenant isolation assertion passes.
   ⚠ **INVARIANT: CLAUDE.md §4.3** — isolation is Postgres RLS, never application logic. A weaker
   `service_role` here would silently disable isolation product-wide (risk R-12).

---

### Story 1.12: The console ships as a container image built in CI

**As a** deployer, **I want** the console deployable by the same mechanism as the API, **So that**
self-hosting does not require a separate hosting vendor for the frontend.

`Effort: S` · `Files: frontend/Dockerfile (new), frontend/next.config.mjs, .github/workflows/ci.yml, frontend/app/api/health/route.ts (new)` · `FRs: FR-86`

**Acceptance Criteria**
1. **Given** `frontend/Dockerfile`, **When** it is built, **Then** it produces a Next.js 14 standalone
   image that runs as a non-root user and exposes a configurable port.
2. **Given** the running container, **When** `GET /api/health` is called, **Then** it returns 200 — the
   compose healthcheck target.
3. **Given** CI, **When** the workflow runs, **Then** the frontend image is built on every pull request
   and the build failure is a CI failure.
4. **Given** the image environment, **When** it is inspected, **Then** it receives only `NEXT_PUBLIC_*`
   values and `CONTROL_API_URL` — never the privileged database credential or the auth service key.
   ⚠ **INVARIANT: CLAUDE.md §4.6.**

---

### Story 1.13: `docker compose up` brings up a working, seeded stack

**As** Nadia the platform engineer, **I want** one command to give me database, identity, API, worker
and console, **So that** I can evaluate the product without a cloud account or a security review.

`Effort: L` · `Files: docker-compose.yml (new), Makefile, deploy/ (new), docs/DEPLOY.md, README.md` · `FRs: FR-85`

**Acceptance Criteria**
1. **Given** a clean checkout with Docker installed, **When** `docker compose up -d --wait` runs,
   **Then** services `db`, `auth`, `migrate`, `api`, `worker` and `web` start, all bound to `127.0.0.1`
   by default, and the command returns only when every healthcheck is green.
2. **Given** `depends_on`, **When** the stack starts, **Then** `api` and `worker` wait on
   `migrate: {condition: service_completed_successfully}` — the stack cannot report healthy on an
   unmigrated database.
3. **Given** no cloud account and no hand-written SQL, **When** the stack is up, **Then** the console is
   reachable and the API's readiness endpoint returns 200.
4. **Given** `DATABASE_URL` is overridden to a managed Postgres, **When** the stack starts, **Then** the
   bundled `db` service is bypassed and everything else works unchanged.
5. **Given** the seeded demo tenant, **When** `ENV=prod` is set without an explicit opt-in flag,
   **Then** the seed refuses to run and says so.
6. **Given** the compose environment, **When** it is inspected, **Then** the privileged database DSN and
   the auth service key are present only on `api`, `worker` and `migrate`.
   ⚠ **INVARIANT: CLAUDE.md §4.6/§4.7.**

---

### Story 1.14: Liveness and readiness are separate, and readiness tells the truth

**As a** platform, **I want** the healthcheck to fail when the deployment cannot work, **So that** a
completely non-functional deploy stops reporting healthy.

`Effort: M` · `Files: api/health.py (new), api/main.py, railway.json, docker-compose.yml, tests/test_health.py` · `FRs: FR-102, FR-103`

**Acceptance Criteria**
1. **Given** `GET /health`, **When** it is called, **Then** it remains static, unauthenticated and
   liveness-only — unchanged behaviour.
2. **Given** `GET /health/ready`, **When** the database cannot connect, or `schema_migrations` head does
   not equal the bundled head, or the JWKS issuer does not resolve, **Then** it returns 503 naming which
   check failed as a boolean.
3. **Given** all three checks pass, **When** it is called, **Then** it returns 200 with a `capabilities`
   map (`signup`, `judge`, `dlp`, `egress`, `anchors`, `worker_fresh`) whose unconfigured entries are
   reported as **warnings, not failures**.
4. **Given** any response, **When** it is inspected, **Then** it contains booleans, counts and capability
   names only — **never** a DSN, a secret, a hostname or a stack trace.
   ⚠ **INVARIANT: CLAUDE.md §4.8.**
5. **Given** the endpoint is unauthenticated, **When** it is called repeatedly, **Then** results are
   memoised for 5 seconds so it cannot become a database denial-of-service vector.
6. **Given** `railway.json` and every compose healthcheck, **When** they are read, **Then** they point at
   `/health/ready`.

---

### Story 1.15: `xsom init` bootstraps a tenant, an admin and a token with no SQL

**As** a first-time deployer, **I want** one command to produce a usable tenant, **So that** I never
open a SQL console or hunt a UUID in a dashboard.

`Effort: L` · `Files: cli/ (new: main.py, init.py), pyproject.toml, core/signup.py, core/tenant_tokens.py, core/policy_store.py, tests/test_cli_init.py (new)` · `FRs: FR-91, FR-94`

**Acceptance Criteria**
1. **Given** `pyproject.toml`, **When** the package is installed, **Then** `[project.scripts]` registers
   `xsom = "cli.main:main"` and the console entry point runs.
2. **Given** a fresh migrated database, **When** `xsom init --org "Acme Ops" --email a@example.test` runs,
   **Then** it creates the tenant, the admin member and the identity claim atomically by calling the
   existing `core.signup.provision_account`, installs a starter policy, mints one gateway token and
   exits 0.
3. **Given** the command output, **When** it is read, **Then** the gateway token is printed **exactly
   once** and never written to a log, and the exact environment-variable export line the runtime reads
   is printed beside it.
4. **Given** `.env` is written, **When** its mode is checked, **Then** it is `0600` and it is gitignored.
   ⚠ **INVARIANT: CLAUDE.md §4.6/§4.7** — no secret is echoed twice, logged, or committed.
5. **Given** `docs/DEPLOY.md` after this story, **When** it is searched, **Then** it contains **zero**
   SQL statements for bootstrap.
6. **Given** a test against a fresh database, **When** it runs `xsom init` and then authenticates an
   agent with the printed token, **Then** the agent reaches a decision — proving the path end to end.

---

### Story 1.16: The `xsom` CLI covers migrate, bootstrap, token and doctor

**As an** operator, **I want** the routine operations as commands, **So that** I never need database
access to run the product.

`Effort: M` · `Files: cli/main.py, cli/doctor.py (new), core/migrate.py, core/tenant_tokens.py, tests/test_cli.py (new)` · `FRs: FR-94`

**Acceptance Criteria**
1. **Given** the CLI, **When** `xsom migrate [--dry-run] [--target] [--and-compat]` runs, **Then** it
   delegates to `core.migrate` and reports applied versions.
2. **Given** an existing `.env`, **When** `xsom bootstrap` runs, **Then** it performs `init` minus secret
   generation.
3. **Given** `xsom token mint` and `xsom token revoke`, **When** either runs, **Then** it delegates to
   `core.tenant_tokens`, prints the token at most once on mint, and writes a control-plane event
   (wired in Story 4.2; until then the call site exists and the test asserts the hook).
4. **Given** `xsom doctor`, **When** it runs, **Then** it reports configuration presence (never values),
   database connectivity, schema head versus bundled head, capability activation and chain status, and
   prints a concrete remediation line for each failure.
5. **Given** every command, **When** it targets a hosted or a self-hosted deployment, **Then** behaviour
   is identical — no command assumes compose.

---

### Story 1.17: Destructive CLI operations refuse to run in production without an explicit flag

**As an** operator, **I want** state-changing commands to fail closed against production, **So that** a
mistyped command cannot destroy a live deployment.

`Effort: S` · `Files: cli/main.py, tests/test_cli.py` · `FRs: FR-95`

**Acceptance Criteria**
1. **Given** `ENV=prod`, **When** any state-creating or state-destroying command runs without `--force`,
   **Then** it exits non-zero, changes nothing, and prints which flag would authorise it.
2. **Given** `--force` in production, **When** the command runs, **Then** it proceeds and writes a
   control-plane event with `actor_type=system` and the invoking OS user recorded as an object-ref
   metadata field, **never** as personal data.
3. **Given** an ambiguous or unreadable `ENV`, **When** a destructive command runs, **Then** it is treated
   as production and refused. ⚠ **INVARIANT: CLAUDE.md §4.4** — fail-closed by default.

---

### Story 1.18: A scheduled-work runner with advisory-lock leader election

**As an** operator, **I want** recurring work to run, be observable and be multi-replica safe,
**So that** expiry sweeps, purges, checkpoints and egress are not silently absent.

`Effort: M` · `Files: core/jobs.py (new), cli/main.py, supabase/migrations/0019_halts_and_job_runs.sql (new), api/health.py, tests/test_jobs.py (new)` · `FRs: FR-94 (worker), OP-4, OP-9`

**Acceptance Criteria**
1. **Given** `xsom worker`, **When** it starts, **Then** it runs a single-process loop; each job acquires
   a Postgres advisory lock so exactly one replica executes it per interval.
2. **Given** any job, **When** it completes or fails, **Then** a row is written to
   `job_runs(job, tenant_id, started_at, finished_at, status, detail)`.
3. **Given** a job is re-run over the same window, **When** it executes, **Then** the result is identical —
   every job is idempotent.
4. **Given** stale `job_runs`, **When** `/health/ready` is called, **Then** `worker_fresh` reports as a
   **warning**, never a failure.
5. **Given** the migration, **When** it is applied, **Then** it creates `job_runs` **and** the `halts`
   table specified by the architecture (consumed by Epic 6), each with RLS where a tenant dimension
   exists and a two-tenant isolation test.
6. **Given** the decision path, **When** the worker is stopped entirely, **Then** no tool call is allowed
   that would otherwise be denied — no job is on the decision path (risk R-11).

---

### Story 1.19: A policy template library, offered at bootstrap

**As a** new tenant admin, **I want** a working deny-by-default policy without authoring YAML,
**So that** my first policy is safe and useful in one action.

`Effort: M` · `Files: core/policy_templates/ (new: finance.yaml, hr.yaml, devops.yaml, customer_comms.yaml), core/policy_store.py, api/policy.py, cli/init.py, tests/test_policy_templates.py (new)` · `FRs: FR-13`

**Acceptance Criteria**
1. **Given** the template library, **When** every template is parsed by `core.policy.parse_policy`,
   **Then** each parses without error and each declares `unknown_tool: deny`.
2. **Given** `xsom init`, **When** no template is chosen, **Then** the safest template is installed and
   named in the output.
3. **Given** `POST /v1/policy/template/{name}`, **When** an admin installs one, **Then** it becomes the
   tenant's policy through the normal save path and is audited.
4. **Given** any template, **When** a fixture corpus of tool names is evaluated against it, **Then** no
   irreversible tool resolves to `auto`. ⚠ **INVARIANT: CLAUDE.md §4.1** — the irreversible floor.

---

### Story 1.20: Safe defaults everywhere, stated where an operator can read them

**As a** security reviewer, **I want** a zero-configuration deployment to be restrictive, **So that**
"ultra-easy" never means "insecure by default".

`Effort: M` · `Files: core/config.py, core/policy.py, docs/CAPABILITIES.md (new), tests/test_defaults.py (new)` · `FRs: FR-107`

**Acceptance Criteria**
1. **Given** a deployment with no configuration beyond the required keys, **When** defaults are read,
   **Then** `unknown_tool: deny`, irreversible actions require a human, risk bands are off, taint is off,
   auto-halt is off and egress is off.
2. **Given** `docs/CAPABILITIES.md`, **When** it is read, **Then** every opt-in control lists its module,
   its **default state**, what it writes to the audit log, and its known limits.
3. **Given** a test enumerating every enforcement branch, **When** it runs, **Then** each branch is
   confirmed off by default and present in `docs/CAPABILITIES.md`; the test fails if a new branch is
   added without an entry. ⚠ **INVARIANT: NFR-7 / G-S5** — an upgrade must never change a tenant's
   effective decisions without that tenant acting.

---

### Story 1.21: Onboarding proposes a first policy from the discovered tool inventory

**As a** new operator, **I want** to see every discovered tool with its proposed class and the source
of that classification, **So that** I accept or edit a policy instead of authoring one blind.

`Effort: M` · `Files: frontend/app/(app)/onboarding/page.tsx, api/policy.py, core/policy.py, frontend/e2e/smoke.spec.ts` · `FRs: FR-108`

**Acceptance Criteria**
1. **Given** a tenant with configured downstream servers, **When** onboarding runs, **Then** it lists every
   discovered tool with its proposed action class and approval tier.
2. **Given** each row, **When** it renders, **Then** the **source** of the classification is shown
   (explicit rule / tool annotation / name heuristic / unknown) and heuristic-only rows are visibly marked.
3. **Given** the proposal, **When** the operator has not accepted it, **Then** nothing is applied — no
   policy is auto-applied silently.
4. **Given** acceptance, **When** it is submitted, **Then** the policy is saved through the normal path and
   a control-plane event is written.

---

### Story 1.22: A capability activation panel shows what is on, off and unconfigured

**As an** operator, **I want** one place that tells me which controls are active and what each needs,
**So that** I can consent to a control rather than discover it exists later.

`Effort: S` · `Files: frontend/app/(app)/admin/page.tsx, api/health.py, frontend/components/ (new CapabilityPanel.tsx)` · `FRs: FR-109`

**Acceptance Criteria**
1. **Given** the panel, **When** it renders, **Then** each capability appears in exactly one of three
   states: active, available-but-unconfigured, or unavailable in this deployment.
2. **Given** an unconfigured capability, **When** it is expanded, **Then** it names the exact setting that
   would enable it and links to `docs/CAPABILITIES.md` — never showing the setting's value.
3. **Given** the readiness endpoint's `capabilities` map, **When** it changes, **Then** the panel reflects
   it without a code change — the panel is a renderer, not a second source of truth.

---

### Story 1.23: Downstream server configuration is bounded, validated and secret-rejecting

**As a** security reviewer, **I want** server configuration to reject inline credentials and hide
config from non-admins, **So that** the one clear-text credential path in the codebase is closed.

`Effort: M` · `Files: api/servers.py, core/schemas.py, core/servers.py, tests/test_servers_api.py` · `FRs: FR-111`

**Acceptance Criteria**
1. **Given** a `config` object, **When** it is submitted, **Then** it is bounded in total size and nesting
   depth, its keys are validated against an allowlist pattern, and violations return 422 with a bounded
   message.
2. **Given** a value matching a secret-shaped pattern, **When** it is submitted, **Then** it is rejected
   with an instruction to use an environment reference, and the rejected value never appears in the
   error, in a log, or in an audit entry.
3. **Given** a viewer or operator role, **When** they read a server, **Then** they receive name, transport
   and enabled state only; **Given** an admin, **Then** they additionally receive `config`.
   ⚠ **INVARIANT: CLAUDE.md §4.9/§4.10 and §4.6.**

---

### Story 1.24: A deployment smoke workflow makes "ultra-easy to deploy" a gate

**As** the team, **I want** CI to prove the product deploys and blocks an action, **So that**
deployment defects cannot ship the way five of them did.

`Effort: L` · `Files: .github/workflows/deploy-smoke.yml (new), deploy/mock_downstream.py (new), Makefile` · `FRs: FR-105`

**Acceptance Criteria**
1. **Given** the workflow, **When** it runs on a pull request, **Then** it executes in order:
   `docker compose up -d --wait` → assert `/health/ready` 200 → `xsom init` → mint a token →
   `POST /v1/authorize` on an irreversible tool → assert the verdict is a hold **and** the downstream
   mock recorded **zero** invocations → run `tests/test_rls.py` against the compose database →
   `xsom verify-chain` → run the standalone verifier over an export → `docker compose down`.
2. **Given** the irreversible assertion, **When** the action is not approved, **Then** the mock's
   invocation count is exactly zero. ⚠ **INVARIANT: CLAUDE.md §4.1 / G-S2** — this is the executable
   proof that an unapproved irreversible action is not executed.
3. **Given** each of the five known deployment defect classes (unparseable CORS value, `.dockerignore`
   excluding migrations, static health literal, vendor URL in an artifact, mismatched snippet variable),
   **When** each is deliberately reintroduced in a scratch branch, **Then** the workflow fails —
   validating assumption A-12.
4. **Given** the workflow is green, **When** any later story merges, **Then** this workflow is a required
   check.

---

### Story 1.25: The demonstration needs only Docker

**As an** evaluator, **I want** `make demo` to run against the composed stack, **So that** I do not
install PostgreSQL server binaries as root to see the product work.

`Effort: S` · `Files: scripts/demo.py, scripts/pgcluster.py (moved from tests/pgcluster.py), tests/conftest.py, Makefile, README.md` · `FRs: FR-106`

**Acceptance Criteria**
1. **Given** `DATABASE_URL` from a running compose stack, **When** `make demo` runs, **Then** the
   break-then-control scenario completes without installing anything.
2. **Given** no `DATABASE_URL`, **When** `make demo` runs, **Then** it falls back to `scripts/pgcluster.py`.
3. **Given** `scripts/demo.py`, **When** its imports are inspected, **Then** it imports nothing from
   `tests` — the dependency direction is inverted and `tests/conftest.py` imports the shared harness.
4. **Given** `README.md` prerequisites, **When** they are read, **Then** they match what the demo actually
   requires.

---

### Story 1.26: Deployment documentation uses placeholders, never live vendor values

**As a** reader of the deployment guide, **I want** placeholders, **So that** I never paste the
maintainer's own project reference into my deployment.

`Effort: S` · `Files: docs/DEPLOY.md, README.md, .env.example, tests/test_docs_placeholders.py (new)` · `FRs: FR-101`

**Acceptance Criteria**
1. **Given** every deployment document, **When** a test scans them, **Then** no live project reference,
   hostname, identifier or account belonging to the maintainer appears.
2. **Given** the migration count stated in `docs/DEPLOY.md`, **When** it is compared to
   `supabase/migrations/`, **Then** the document does not state a count at all — it points at the ledger
   and `xsom doctor` instead, so it cannot go stale.
3. **Given** the guide after this story, **When** it is followed literally on a clean machine, **Then** it
   succeeds — verified by Story 1.24's workflow following the same sequence.

---

## Epic 2: Self-Explaining Decisions — provenance on every audit entry

**Goal.** Make every audit entry answer *why*, *escalated by what*, *under which policy version*, *at
what risk*, *in which session*, *in which enforcement mode*, and *on which product build* — without
interpretation (SM-2: ≥ 99% of entries, 100% of held and denied entries). The policy engine already
computes a precise reason and discards it; this epic stops discarding it.

**The hard constraint that shapes every story here.** Payload v1 is frozen permanently
(CLAUDE.md §4.2, PRD V-2). `core/audit.py::_payload` and `compute_entry_hash` are **not modified by
any story in this document**. Every new field is an **annex column**, and its tamper-evidence comes
from the signed checkpoints of Epic 3 — a limitation that Story 3.9 publishes rather than hides.

---

### Story 2.1: The provenance annex migration

**As a** maintainer, **I want** every provenance field available as a nullable annex column, **So
that** existing rows keep verifying while new rows carry the full record.

`Effort: M` · `Files: supabase/migrations/0017_audit_provenance_annex.sql (new), tests/test_audit.py, tests/test_rls.py` · `FRs: FR-113 (enabling), FR-123 (truncate block)`

**Acceptance Criteria**
1. **Given** the migration, **When** it is applied, **Then** `audit_log` gains nullable columns
   `actor_type`, `decision_reason`, `escalated_by`, `enforcement_mode`, `policy_version`,
   `product_version`, `correlation_id`, `session_id`, `trace_id`, `risk_score`, `risk_band`,
   `risk_factors`, `lineage`, `outcome_status`, `approval_outcome`, `guards_run`, `ai_system_id`.
2. **Given** rows that existed before the migration, **When** `verify_chain` runs, **Then** it returns
   `ok=True` and the head hash is byte-identical to the pre-migration head.
   ⚠ **INVARIANT: CLAUDE.md §4.2 / NFR-8.**
3. **Given** the new columns, **When** any is added, **Then** **none** carries a foreign key — a cascade
   DELETE or set-null UPDATE would fire the `0005` append-only triggers and break the parent operation
   (AD-18).
4. **Given** the latent `audit_log_gateway_token_id_fkey` from `0006`, **When** the migration runs, **Then**
   the constraint is dropped while the column and its index are kept, and deleting a gateway token
   afterwards succeeds.
5. **Given** `TRUNCATE audit_log`, **When** it is attempted, **Then** a statement-level `before truncate`
   trigger refuses it — closing the gap where truncation left verification reporting "OK, 0 entries".
6. **Given** the four new indexes (correlation, session, actor, reason), **When** the audit explorer
   filters, **Then** each filter uses an index.

---

### Story 2.2: `core/provenance.py` and an annex-writing `log_event`

**As an** auditor, **I want** one frozen provenance record written beside every entry, **So that**
the record is complete and consistent regardless of which code path produced it.

`Effort: L` · `Files: core/provenance.py (new), core/audit.py, core/decision.py, gateway/server.py, api/llm_proxy.py, tests/test_audit.py` · `FRs: FR-113, FR-35, FR-3, FR-57, FR-58, FR-140`

**Acceptance Criteria**
1. **Given** `core/provenance.py`, **When** it is imported, **Then** it exposes a frozen dataclass
   `Provenance` with the enumerated vocabularies for `actor_type` (`human|agent|system`),
   `decision_reason` and `escalated_by`, and `enforcement_mode` (`mandatory|cooperative|evaluate_only`).
2. **Given** `core.audit.log_event(..., provenance=…)`, **When** it writes, **Then** it writes the annex
   columns in the same statement as the payload write, and a test asserts `_payload` and
   `compute_entry_hash` are unchanged from `HEAD` (a source-level assertion, not a behavioural one).
   ⚠ **INVARIANT: CLAUDE.md §4.2.**
3. **Given** the MCP path, **When** an entry is produced, **Then** `enforcement_mode='mandatory'`; **Given**
   the HTTP and LLM-proxy paths, **Then** `enforcement_mode='cooperative'`.
4. **Given** one tool call, **When** it produces a decision entry and any gate entries, **Then** all share
   one `correlation_id` generated once per call.
5. **Given** a caller that supplies a session or trace identifier, **When** the entry is written, **Then**
   `session_id` and `trace_id` are persisted; **Given** none is supplied, **Then** the columns are null and
   the pipeline's fail-closed rule for irreversible actions still applies (Story 5.4).
6. **Given** any entry, **When** it is written, **Then** `product_version` is non-null.
7. **Given** `risk_factors`, **When** it is written, **Then** it contains factor **names and integer
   points only**, and a test asserts no argument-derived string can reach the column.
   ⚠ **INVARIANT: CLAUDE.md §4.10.**

---

### Story 2.3: Every producer supplies a Decision Reason

**As a** security engineer, **I want** no entry without a reason, **So that** SM-2 is a measured fact
rather than an aspiration.

`Effort: M` · `Files: core/decision.py, gateway/server.py, api/llm_proxy.py, core/policy.py, tests/test_audit_reason_completeness.py (new)` · `FRs: FR-113`

**Acceptance Criteria**
1. **Given** the enumerated vocabulary (`policy`, `constraint`, `unknown_tool`, `auto_classify`,
   `annotation`, `judge`, `risk`, `taint`, `integrity`, `rbac`, `budget`, `halt`, `dlp`), **When** any
   producer writes an entry, **Then** `decision_reason` is one of those values.
2. **Given** an exhaustive test that drives every decision branch in `core/policy.py::evaluate` and every
   gate, **When** it runs, **Then** **100%** of produced entries have a non-null `decision_reason`, and
   every held or denied entry additionally has a non-null `escalated_by` or an explicit `null` meaning
   "the base rule decided".
3. **Given** a new producer added later without a reason, **When** the test runs, **Then** it fails.

---

### Story 2.4: Gate events become first-class

**As** Tom the security engineer, **I want** a gate row to carry the same dimensions as a decision
row, **So that** an RBAC denial tells me which agent was denied.

`Effort: M` · `Files: core/audit.py (new log_gate_event), gateway/server.py (_audit_gate), tests/test_audit_gate.py` · `FRs: FR-115, FR-58`

**Acceptance Criteria**
1. **Given** `audit.log_gate_event(...)`, **When** it replaces `gateway/server.py::_audit_gate`, **Then**
   every gate entry carries correlation id, canonical tool name, agent attribution, action class and
   decision reason.
2. **Given** an `rbac_denied` entry, **When** it is read, **Then** it records **which** agent was denied —
   without which a confused-deputy guard's trail defeats its own purpose.
3. **Given** a `tainted_action` entry, **When** it is read, **Then** it shares a `correlation_id` with the
   decision entry it escalated and links to the `taint_marked` entry that caused it.
4. **Given** the audit explorer, **When** a decision row is opened, **Then** its gate rows are retrievable
   by correlation id in one query.

---

### Story 2.5: `error` means error

**As an** auditor, **I want** the column named `error` to contain execution failures only, **So that**
I am not misled by a field carrying policy rationale.

`Effort: M` · `Files: gateway/server.py, api/llm_proxy.py, core/decision.py, docs/AUDIT_FORMAT.md, tests/test_audit.py` · `FRs: FR-114`

**Acceptance Criteria**
1. **Given** the four conventions currently multiplexed through `error` (downstream error, DLP prefix,
   integrity reason, taint reason), **When** this story lands, **Then** each moves to `decision_reason`
   and `error` carries genuine execution failures only.
2. **Given** `docs/AUDIT_FORMAT.md`, **When** it is read, **Then** it publishes the enumerated
   `decision_reason` vocabulary and states that consumers must tolerate unknown values (PRD V-3).
3. **Given** historical rows written under the old convention, **When** they are read, **Then** they are
   unchanged and the per-producer historical mapping is documented rather than rewritten.
   ⚠ **INVARIANT: CLAUDE.md §4.2** — no historical row is edited.
4. **Given** a genuine downstream execution failure, **When** it occurs, **Then** `error` is populated and
   `decision_reason` reflects the authorization cause, and the two are independently asserted.

---

### Story 2.6: The risk score and its factors are persisted

**As an** operator, **I want** the score that drove an escalation stored, **So that** a held action is
explainable after the fact.

`Effort: S` · `Files: core/risk.py, core/decision.py, gateway/server.py, tests/test_risk.py` · `FRs: FR-29`

**Acceptance Criteria**
1. **Given** `core/risk.py::escalate_by_risk`, **When** it returns, **Then** it returns a `RiskVerdict`
   carrying tier, score, factors, discount and band rather than a bare tier.
2. **Given** any decision where the risk guard ran, **When** the entry is written, **Then** `risk_score`,
   `risk_band` and `risk_factors` are non-null.
3. **Given** `risk_factors`, **When** it is inspected, **Then** it contains factor names and integer points
   only; a test feeds arguments containing a distinctive string and asserts that string never appears in
   the column. ⚠ **INVARIANT: CLAUDE.md §4.10.**
4. **Given** the risk guard did not run, **When** the entry is written, **Then** the columns are null and
   `guards_run` omits `risk` — absence is explicit, never implied.

---

### Story 2.7: The risk score and band are returned to the caller

**As an** agent engineer, **I want** the same number the engine used, **So that** my client and the
console agree with the decision.

`Effort: S` · `Files: core/schemas.py, api/authorize.py, api/policy.py, frontend/app/(app)/inspector/page.tsx, tests/test_authorize_api.py` · `FRs: FR-30`

**Acceptance Criteria**
1. **Given** `AuthorizeResponse`, **When** a decision returns, **Then** it carries `risk_score` and
   `risk_band`.
2. **Given** the Inspector's `ToolView`, **When** a tool is rendered, **Then** it carries the same two
   fields.
3. **Given** a decision where risk did not run, **When** the response is read, **Then** both fields are
   explicitly `null` rather than defaulted to zero.

---

### Story 2.8: The reasoning chain is machine-readable

**As a** customer building review tooling, **I want** the explanation as structured data, **So that**
I do not parse prose.

`Effort: S` · `Files: core/schemas.py, api/audit.py, docs/AUDIT_FORMAT.md, tests/test_audit_api.py` · `FRs: FR-117`

**Acceptance Criteria**
1. **Given** an audit entry, **When** it is fetched through the API, **Then** the reasoning chain is a
   structured object (guards run in order, each with its outcome, reason and contribution), not a string.
2. **Given** the structure, **When** it is versioned, **Then** the version is stated in the payload and
   documented in `docs/AUDIT_FORMAT.md` per PRD §15.
3. **Given** a consumer written against version 1, **When** a new reason value appears, **Then** the
   consumer contract requires tolerating it (V-3) and the test fixture proves the shape is stable.

---

### Story 2.9: One product version constant, recorded on every decision

**As an** auditor, **I want** to know which build made a decision, **So that** "which version of the
policy engine decided this?" is answerable.

`Effort: S` · `Files: pyproject.toml, api/main.py, core/provenance.py, tests/test_version.py (new)` · `FRs: FR-140`

**Acceptance Criteria**
1. **Given** the version string, **When** it is read from `pyproject.toml` and from the running app,
   **Then** both come from **one** constant and agree.
2. **Given** the version that has read `0.1.0` since M0, **When** this story lands, **Then** it reflects
   the real release and semantic versioning applies (paired with Story 13.6).
3. **Given** any audit entry written after this story, **When** it is read, **Then** `product_version` is
   non-null and matches the running build.

---

### Story 2.10: The audit explorer shows the truth

**As** Tom the security engineer, **I want** to filter, sort and open a decision, **So that** root
cause takes minutes rather than guesswork.

`Effort: L` · `Files: frontend/app/(app)/audit/page.tsx, api/audit.py, core/audit.py, frontend/lib/i18n.tsx, frontend/e2e/smoke.spec.ts` · `FRs: FR-116`

**Acceptance Criteria**
1. **Given** the explorer, **When** it renders, **Then** the table shows timestamp, decision, decision
   reason, escalation source, agent, policy version and enforcement mode.
2. **Given** the query parameters `api/audit.py` already accepts, **When** filters are used, **Then** each
   filter is bound to an existing parameter — tool, decision, time window, actor type, agent.
3. **Given** a row is clicked, **When** the detail drawer opens, **Then** it shows every field including
   `prev_hash` and `entry_hash`, the risk breakdown, the linked gate rows by correlation id, and the
   linked approval with its deciders.
4. **Given** an entry whose escalation source is `taint`, **When** the drawer opens, **Then** it links to
   the `taint_marked` entry that caused it.
5. **Given** keyboard-only navigation and a screen reader, **When** the explorer is used, **Then** rows,
   filters and the drawer are reachable and labelled (NFR-10).

---

## Epic 3: Independent Verification — proof-carrying exports, verifier, checkpoints, anchors

**Goal.** Convert "immutable audit trail" from a vendor-asserted boolean into something
Anne-Laure the external auditor can check on her own laptop, against a witness we do not control
(SM-3: 100% of evidence packs independently verifiable, UJ-7). Four layers, each stronger than the
last, each with a **published limit**.

---

### Story 3.1: Exports carry the proof

**As an** external auditor, **I want** the export to contain the hashes and the full hashed payload,
**So that** I can recompute the chain instead of trusting a boolean.

`Effort: M` · `Files: core/audit.py (list_events), core/schemas.py (AuditEntry), api/audit.py, tests/test_audit_api.py` · `FRs: FR-119`

**Acceptance Criteria**
1. **Given** any export, **When** it is read, **Then** each entry carries `prev_hash`, `entry_hash`,
   `tenant_id` and every Payload v1 field (`ts`, `tenant_id`, `user_id`, `request_id`, `tool_name`,
   `action_class`, `decision`, `policy_rule_id`, `judge_used`, `args_hash`, `latency_ms`, `error`).
2. **Given** the read runs through `core/db.py::tenant_reader`, **When** `tenant_id` is returned, **Then**
   RLS has already scoped the read to the caller's own tenant and a two-tenant test proves no bleed.
   ⚠ **INVARIANT: CLAUDE.md §4.3.**
3. **Given** an export and the published algorithm, **When** a test recomputes every hash offline,
   **Then** the recomputed head matches the exported head.
4. **Given** the export, **When** it is inspected for content, **Then** it carries `args_hash` and never
   argument values. ⚠ **INVARIANT: CLAUDE.md §4.10.**

---

### Story 3.2: A standalone, stdlib-only verifier with a published algorithm

**As** Anne-Laure, **I want** one file I can read and run with no database, no network and no vendor
code, **So that** my opinion does not rest on the vendor's good faith.

`Effort: M` · `Files: tools/xsom_verify.py (new), docs/AUDIT_FORMAT.md, tests/test_standalone_verifier.py (new)` · `FRs: FR-120`

**Acceptance Criteria**
1. **Given** `tools/xsom_verify.py`, **When** its imports are inspected, **Then** it imports only `json`,
   `hashlib` and `argparse` and imports **nothing** from `core/`.
2. **Given** a real export, **When** the verifier runs on it, **Then** it recomputes the chain from
   `GENESIS`, prints the head hash and the entry count, and exits 0.
3. **Given** `docs/AUDIT_FORMAT.md`, **When** it is read, **Then** the canonicalisation
   (`json.dumps(payload, sort_keys=True, separators=(",", ":"))`), the hash
   (`sha256(prev_hash || payload)`) and the genesis root are fully specified, sufficient for a third
   party to write their own verifier.
4. **Given** no network access, **When** the verifier runs, **Then** it succeeds — it must work air-gapped.

---

### Story 3.3: The two verifiers are proven to agree, and a doctored export fails

**As a** maintainer, **I want** CI to catch divergence between the in-product and standalone verifiers,
**So that** the second implementation cannot silently drift (risk R-9).

`Effort: S` · `Files: tests/test_standalone_verifier.py, .github/workflows/ci.yml` · `FRs: FR-120`

**Acceptance Criteria**
1. **Given** a generated corpus of entries, **When** both `core.audit.verify_chain` and
   `tools/xsom_verify.py` run over it, **Then** they agree on ok/not-ok, entry count and head hash.
2. **Given** an export with one field mutated in one entry, **When** the standalone verifier runs, **Then**
   it exits non-zero and names the first broken entry id.
3. **Given** an export with an entry removed from the middle, **When** the verifier runs, **Then** it
   fails — mid-chain excision is detected.
4. **Given** an export truncated at the tail, **When** the verifier runs, **Then** it reports OK for the
   remaining chain **and** the test asserts this is exactly why checkpoints (Story 3.5) exist — the
   limitation is asserted, not hidden.

---

### Story 3.4: Signed checkpoints cover the annex

**As a** compliance officer, **I want** the annex columns to be tamper-evident too, **So that** the
decision reason and risk on an entry are not the one part nobody can check.

`Effort: L` · `Files: core/checkpoint.py (new), supabase/migrations/0018_checkpoints_and_anchors.sql (new), core/secrets.py, cli/init.py, tests/test_checkpoint.py (new)` · `FRs: FR-121`

**Acceptance Criteria**
1. **Given** a contiguous id range, **When** a checkpoint is built, **Then** it records
   `(tenant_id, first_id, last_id, entry_count, head_hash, payload_digest, annex_digest)` where
   `annex_digest` is a sha256 over the canonical JSON of the annex fields of those entries.
2. **Given** the signature, **When** it is produced, **Then** it is Ed25519 over the documented
   domain-separated string, using `cryptography` (already present transitively via
   `python-jose[cryptography]`) — **no new dependency**.
3. **Given** `CheckpointSigner`, **When** implementations are enumerated, **Then** `LocalKeySigner` (key
   generated by `xsom init`, the self-host default) and a KMS-backed signer reusing `core/secrets.py`
   both satisfy the protocol.
4. **Given** `audit_checkpoints`, **When** the migration is applied, **Then** the table carries RLS with a
   `*_select_own` policy and the same append-only UPDATE/DELETE trigger pattern as `audit_log`;
   `audit_log` itself is **untouched**. ⚠ **INVARIANT: CLAUDE.md §4.2.**
5. **Given** any export and `GET /v1/audit/verify`, **When** read, **Then** they publish `key_id` and the
   public key so a third party can check the signature.
6. **Given** key custody is open (OQ-9), **When** the documentation is read, **Then** it states plainly
   that a vendor-held key weakens the independence a checkpoint exists to establish, and points at
   anchoring as the answer.

---

### Story 3.5: The checkpoint job, and truncation becomes detectable

**As an** auditor, **I want** tail truncation and wholesale rebuild to be detectable, **So that**
"tamper-evident" holds against someone with database write access.

`Effort: M` · `Files: core/jobs.py, core/checkpoint.py, tests/test_checkpoint.py, tests/test_audit.py` · `FRs: FR-121, FR-123`

**Acceptance Criteria**
1. **Given** the worker, **When** the checkpoint job runs on its interval, **Then** it appends a checkpoint
   per tenant covering entries since the last checkpointed `last_id`, and records the run in `job_runs`.
2. **Given** entries deleted after a checkpoint, **When** verification runs, **Then** it reports a
   mismatch because the tenant's current head id is below the checkpointed `last_id` or the head hash
   differs.
3. **Given** `TRUNCATE audit_log`, **When** attempted, **Then** the statement-level trigger from Story 2.1
   refuses it, and a test asserts the refusal.
4. **Given** the design alternative of a per-tenant sequence column, **When** the ADR is read, **Then** it
   is documented as **rejected** — it would have to live inside the frozen payload to be chain-protected.
5. **Given** a checkpoint job failure, **When** it occurs, **Then** an alert fires (wired fully in Story
   12.5) and readiness reports the staleness as a warning.

---

### Story 3.6: External anchors put the head somewhere we do not control

**As** Anne-Laure, **I want** to check a head hash against a witness outside the vendor, **So that**
a full-chain rebuild is detectable.

`Effort: L` · `Files: core/anchor.py (new), supabase/migrations/0018_checkpoints_and_anchors.sql, api/audit.py, core/jobs.py, tests/test_anchor.py (new)` · `FRs: FR-122`

**Acceptance Criteria**
1. **Given** an `AnchorTarget` protocol, **When** implementations are enumerated, **Then** v2.0 ships
   exactly two, both dependency-free: `webhook` (HMAC-signed delivery to the tenant's own endpoint) and
   `file` (write to a mounted path, the air-gapped and object-lock route).
2. **Given** an anchor payload, **When** it is inspected, **Then** it is a digest tuple only — no entries,
   no arguments, no content. ⚠ **INVARIANT: CLAUDE.md §4.10.**
3. **Given** the `audit_anchors` table, **When** it is created, **Then** it is RLS-enabled and, unlike
   checkpoints, is **not** append-only — delivery status must be updatable, which is safe precisely
   because the anchored content is already signed inside the checkpoint.
4. **Given** a delivery failure, **When** the job retries, **Then** it backs off exponentially, increments
   `attempts`, and alerts after the configured threshold.
5. **Given** an offline deployment, **When** no external target is configured, **Then** the system reports
   the **absence** of an external witness rather than implying one (OP-10, G-S6).
6. **Given** an anchor published six weeks ago, **When** the export is re-verified today, **Then** the head
   at that anchor still reproduces from the exported data.

---

### Story 3.7: Verification as an endpoint

**As a** tenant admin, **I want** a structured attestation from the console, **So that** I can check
the chain without a database credential.

`Effort: M` · `Files: api/audit.py, core/audit.py, core/checkpoint.py, frontend/app/(app)/audit/page.tsx, tests/test_audit_api.py` · `FRs: FR-124`

**Acceptance Criteria**
1. **Given** `GET /v1/audit/verify?from=&to=`, **When** it is called, **Then** it returns `ok`, entry count,
   `first_broken_id`, `head_id`, `head_hash`, `tenant_id`, period, `product_version`, checkpoint status
   (`verified`, `last_id`, `key_id`) and anchor status (`last_published_at`, `destination`).
2. **Given** the endpoint, **When** it is called, **Then** it is RLS-scoped through `tenant_reader` and
   rate-limited under the existing export limit.
3. **Given** the console, **When** an operator clicks verify, **Then** the attestation renders and is
   downloadable.
4. **Given** the documentation, **When** it describes this endpoint, **Then** it states explicitly that it
   is a **convenience** and that the standalone verifier (Story 3.2) is the source of truth.
5. **Given** verification today requires the backend's own database credentials, **When** this story lands,
   **Then** it does not (AT-9).

---

### Story 3.8: `xsom verify-chain` and `xsom export`

**As an** operator, **I want** chain verification and evidence export from the command line, **So
that** incident response and audit prep need no console session.

`Effort: S` · `Files: cli/main.py, core/audit.py, core/checkpoint.py, core/compliance.py, core/export.py, tests/test_cli.py` · `FRs: FR-94`

**Acceptance Criteria**
1. **Given** `xsom verify-chain`, **When** it runs, **Then** it verifies the payload chain **and** the
   checkpoints **and** the anchor status, and exits non-zero on any failure.
2. **Given** `xsom export --framework <name> --out <path>`, **When** it runs, **Then** it writes a
   hash-bearing export the standalone verifier accepts.
3. **Given** either command against a hosted or self-hosted deployment, **When** it runs, **Then** behaviour
   is identical.

---

### Story 3.9: The limits of the chain are published, precisely

**As a** buyer's security reviewer, **I want** the product to state what its tamper-evidence does not
detect, **So that** the strong claims are credible.

`Effort: S` · `Files: docs/SECURITY.md, docs/AUDIT_FORMAT.md, README.md` · `FRs: FR-125`

**Acceptance Criteria**
1. **Given** `docs/SECURITY.md`, **When** it is read, **Then** the current claim that tampering any row
   breaks verification is **corrected**: hash chaining detects mutation and mid-chain excision, and does
   **not** by itself detect tail truncation or a wholesale rebuild by someone with database write access.
2. **Given** the same document, **When** it describes annex columns, **Then** it states they are not
   covered by the payload hash and are covered by checkpoints (AT-4).
3. **Given** anchoring, **When** it is described, **Then** the residual window between anchors is stated as
   a residual risk.
4. **Given** a test over the documentation, **When** it runs, **Then** it fails if `docs/SECURITY.md`
   asserts a detection property the test suite does not demonstrate.

---

## Epic 4: Supervising the Supervisors — control-plane events and effective human oversight

**Goal.** Close the single biggest credibility gap: the hash chain covers every agent action and **no
human action on the control plane**. After this epic, a reviewer filtering by actor type sees the
policy relaxation and the restoration that bracket a burst of allows (UJ-8), every human approval is
chained **at the moment it is taken** with a mandatory justification, and a tenant can have a second
member — which is what makes separation of duties and `human_dual` reachable at all.

**Measured by SM-4** (100% of mutating control-plane routes write a chained event) as a **build
gate**, not a report.

---

### Story 4.1: `core/control_events.py` — chained events with mandatory attribution

**As a** compliance officer, **I want** every administrative mutation recorded in the same chain as
agent actions, **So that** the record covers the actor a reviewer most needs to see.

`Effort: M` · `Files: core/control_events.py (new), core/audit.py, core/provenance.py, tests/test_control_events.py (new)` · `FRs: FR-36, FR-38`

**Acceptance Criteria**
1. **Given** `record(conn, *, tenant_id, actor, event, object_ref, before_digest, after_digest, note)`,
   **When** it is called, **Then** it writes a chained entry through `core.audit.log_event` with
   `actor_type='human'` or `'system'` and the acting user in the **existing in-payload `user_id` field**
   — so the actor's identity is chain-protected with **no payload change**.
   ⚠ **INVARIANT: CLAUDE.md §4.2.**
2. **Given** no resolvable actor, **When** `record()` is called, **Then** it raises and the calling route
   returns an error rather than mutating anonymously.
3. **Given** a mutation and its event, **When** they are written, **Then** both occur in the **same
   transaction** — a rollback loses both or neither.
4. **Given** an automated change, **When** it is recorded, **Then** `actor_type='system'` and the
   initiating job identifier is present.
5. **Given** the event payload, **When** it is inspected, **Then** it carries digests, object references
   and enumerated event names only — never a document body, a secret, or a token value.
   ⚠ **INVARIANT: CLAUDE.md §4.10.**

---

### Story 4.2: Every mutating route writes a control-plane event

**As** the reviewer in UJ-8, **I want** policy, token, member, server, DLP, credential, integrity and
retention changes on the chain, **So that** a privileged insider cannot change the rules invisibly.

`Effort: L` · `Files: api/policy.py, api/approvals.py, api/gateway_tokens.py, api/read_tokens.py, api/integrity.py, api/dlp.py, api/credentials.py, api/clients.py, api/servers.py, api/signup.py, cli/main.py` · `FRs: FR-36`

**Acceptance Criteria**
1. **Given** the enumerated event catalogue (policy updated/rolled back/promoted; gateway and read token
   minted/revoked; approval decided; tool re-baselined; DLP configuration changed; provider credential
   connected/revoked; member added/role changed/removed; downstream server created/modified/disabled;
   halt/resume; erasure executed; retention purge executed; budget changed; event sink created/revoked;
   anchor published), **When** each corresponding route is exercised, **Then** exactly one chained event
   is written with the correct enumerated name.
2. **Given** any of those routes, **When** the mutation fails, **Then** no event is written.
3. **Given** a CLI mutation, **When** it runs, **Then** it writes the same event with `actor_type='system'`.
4. **Given** the existing zero `audit.log_event` calls in `api/`, **When** this story lands, **Then** each
   listed router has at least one, verified by Story 4.3's gate.

---

### Story 4.3: The route-enumeration build gate (SM-4)

**As a** maintainer, **I want** a test that fails when a new mutating route forgets its event, **So
that** coverage is enforced by the build rather than by convention.

`Effort: S` · `Files: tests/test_control_plane_coverage.py (new), .github/workflows/ci.yml, docs/CAPABILITIES.md` · `FRs: FR-36`

**Acceptance Criteria**
1. **Given** the FastAPI application, **When** the test enumerates every `POST`, `PUT`, `PATCH` and
   `DELETE` route on `app.routes`, **Then** each either writes a control-plane event or appears in a
   small allowlist **with a written reason**.
2. **Given** a new mutating route added without an event and without an allowlist entry, **When** CI runs,
   **Then** the test fails and names the route.
3. **Given** the allowlist, **When** it grows, **Then** the diff is reviewable — the reason string is
   mandatory and bounded.
4. **Given** SM-4's target, **When** the gate is green, **Then** control-plane coverage is 100% by
   construction.

---

### Story 4.4: The security audit script enforces content discipline on control-plane events

**As a** privacy reviewer, **I want** a static gate against leaking documents or secrets into events,
**So that** the metadata-only discipline extends to the control plane.

`Effort: S` · `Files: scripts/audit_security.py, tests/test_audit_security.py` · `FRs: FR-37`

**Acceptance Criteria**
1. **Given** a control-plane event carrying a policy YAML body, a token value or a secret-shaped string,
   **When** `scripts/audit_security.py` runs, **Then** it reports **CRITICAL** and `make verify` fails.
2. **Given** a token mint event, **When** it is inspected, **Then** it records the token **id** and never
   the token.
3. **Given** a policy update event, **When** it is inspected, **Then** it records the version plus
   `before_digest`/`after_digest` and never the YAML. ⚠ **INVARIANT: CLAUDE.md §4.10.**

---

### Story 4.5: A control-plane review surface

**As** a reviewer, **I want** a chronological view of human and system changes, **So that** I see a
relaxation and a restoration bracketing a burst of allows without writing a query.

`Effort: M` · `Files: frontend/app/(app)/audit/page.tsx (control-plane tab or new frontend/app/(app)/control-plane/page.tsx), api/audit.py, frontend/lib/i18n.tsx` · `FRs: FR-39`

**Acceptance Criteria**
1. **Given** the view, **When** it renders, **Then** it lists control-plane events chronologically,
   filterable by actor and by object, independent of agent traffic.
2. **Given** a policy update event, **When** it is opened, **Then** it links to the version diff (Story 9.3)
   and to the audit entries stamped with that version.
3. **Given** an operator with the `viewer` role, **When** they open the view, **Then** they can read it and
   cannot act from it — RBAC is enforced server-side, not by hiding controls.

---

### Story 4.6: Human decisions are chained at the moment they are taken

**As** Yusuf the approver, **I want** my denial recorded when I make it, **So that** it is evidence
even if the agent never comes back.

`Effort: M` · `Files: api/approvals.py, core/approvals.py, core/decision.py, gateway/server.py, core/compliance.py, tests/test_approvals_api.py, CHANGELOG.md` · `FRs: FR-15`

**Acceptance Criteria**
1. **Given** an approve or deny, **When** it is recorded, **Then** a chained entry is written
   **synchronously in the same transaction** as `core/approvals.py::decide`, with `user_id` = the deciding
   member and `request_id` = the approval id. ⚠ **INVARIANT: CLAUDE.md §4.1/§4.2** — the approver's
   identity is inside the frozen payload, requiring no payload change.
2. **Given** consumption at execution time, **When** it happens, **Then** it emits the **additive** decision
   value `hitl_executed`, producing a three-link `hold → decide → execute` chain (PRD V-3).
3. **Given** an agent that never returns after a denial, **When** the chain is read, **Then** the denial is
   present.
4. **Given** `core/compliance.py::oversight_coverage`, **When** it counts human oversight, **Then** it
   counts `actor_type='human'` entries rather than matching decision strings — immune to future
   vocabulary growth.
5. **Given** this is a behavioural change, **When** it ships, **Then** `CHANGELOG.md` records it per V-7.

---

### Story 4.7: A decision requires a bounded justification

**As a** compliance officer, **I want** every human decision to carry a reason, **So that** oversight
is effective rather than nominal (CM-2).

`Effort: S` · `Files: core/schemas.py (DecisionRequest), api/approvals.py, core/approvals.py, supabase/migrations/0021_membership_and_justification.sql (new), tests/test_approvals_api.py` · `FRs: FR-16`

**Acceptance Criteria**
1. **Given** `DecisionRequest`, **When** a decision is submitted without a `reason`, **Then** the API
   returns 422.
2. **Given** a `reason`, **When** it is validated, **Then** it is length-bounded by Pydantic and rejected
   above the bound (CLAUDE.md §4.9).
3. **Given** the stored justification, **When** the data manifest is generated (Story 11.8), **Then** it is
   classified `free_text` and is excluded from egress payloads by default (G-P4).
4. **Given** the chained entry, **When** it is written, **Then** it references the justification by digest
   rather than embedding it. ⚠ **INVARIANT: CLAUDE.md §4.10.**

---

### Story 4.8: Separation of duties is enforced

**As a** compliance officer, **I want** the requester unable to approve their own action, **So that**
the oversight step is real.

`Effort: M` · `Files: core/approvals.py, api/approvals.py, tests/test_approvals.py` · `FRs: FR-19`

**Acceptance Criteria**
1. **Given** an approval whose `requested_by` equals the deciding member, **When** a decision is
   submitted, **Then** the API returns 409 with an explicit, enumerated reason.
2. **Given** the `human_dual` tier, **When** two decisions are recorded by the **same** member, **Then** the
   approval is not satisfied; **Given** two distinct members, **Then** it is.
3. **Given** a tenant with only one member, **When** `human_dual` would be required, **Then** the action is
   **denied** (fail-closed) and the reason states that the tier is structurally unsatisfiable.
   ⚠ **INVARIANT: CLAUDE.md §4.4.**
4. **Given** the channel callback path (Story 4.14), **When** a decision arrives, **Then** the same checks
   apply identically.

---

### Story 4.9: Expiry is effective in the read path, and a sweeper records it

**As an** operator, **I want** an expired approval never to render as pending, **So that** oversight
statistics are not silently wrong.

`Effort: M` · `Files: core/approvals.py (list_for_tenant, expire_if_needed), api/approvals.py, core/jobs.py, tests/test_approvals.py` · `FRs: FR-18`

**Acceptance Criteria**
1. **Given** an approval past `expires_at`, **When** it is listed through the API or the console, **Then**
   its status is derived as expired in the read path — no agent poll required.
2. **Given** the sweeper job, **When** it runs, **Then** it writes the `expired` audit entry exactly once
   per approval and fires an alert.
3. **Given** an expired approval, **When** an agent later polls it, **Then** the action is **not** executed.
   ⚠ **INVARIANT: CLAUDE.md §4.1 / G-S2** — expiry equals denial.
4. **Given** oversight coverage statistics, **When** they are computed, **Then** expired approvals are
   counted as such and cannot silently inflate the decided rate.

---

### Story 4.10: The membership plane, with RLS write policies

**As a** tenant admin, **I want** to invite, list, re-role and remove members, **So that** my tenant
can have more than one human — the precondition for every oversight guarantee.

`Effort: L` · `Files: api/members.py (new), core/members.py (new), core/signup.py (AuthAdmin), supabase/migrations/0021_membership_and_justification.sql, api/main.py, tests/test_members_api.py (new), tests/test_rls.py` · `FRs: FR-79`

**Acceptance Criteria**
1. **Given** `POST|GET|PATCH|DELETE /v1/members`, **When** an admin calls them, **Then** invite, list,
   role change and removal work through the same `AuthAdmin` protocol `core/signup.py` already defines.
2. **Given** a non-admin, **When** they attempt a member write **through the API**, **Then** they receive
   403; **When** they attempt the same write **through direct SQL under RLS**, **Then** Postgres refuses it.
   ⚠ **INVARIANT: CLAUDE.md §4.3** — application checks alone are insufficient.
3. **Given** the migration, **When** it is applied, **Then** `memberships` gains insert, update and delete
   RLS policies (it has only had `memberships_select_own`), each requiring the caller's tenant and the
   `admin` role from the JWT claim.
4. **Given** any member mutation, **When** it succeeds, **Then** a control-plane event is written.
5. **Given** the last remaining admin, **When** removal or demotion is attempted, **Then** it is refused —
   a tenant can never be left without an admin.

---

### Story 4.11: `human_dual` becomes reachable and is offered honestly

**As a** policy author, **I want** the dual-approval tier offered only when it can be satisfied, **So
that** I never publish a rule that is structurally unsatisfiable.

`Effort: S` · `Files: frontend/app/(app)/admin/page.tsx (policy editor), api/policy.py, core/members.py, frontend/lib/i18n.tsx` · `FRs: FR-80`

**Acceptance Criteria**
1. **Given** a tenant with ≥ 2 members, **When** the policy editor renders tiers, **Then** `human_dual` is
   offered.
2. **Given** a tenant with one member, **When** the editor renders, **Then** `human_dual` is shown as
   unavailable with an explanation and a link to member invitation — not silently hidden.
3. **Given** a policy that already declares `human_dual` in a single-member tenant, **When** a matching
   action arrives, **Then** it is denied (Story 4.8 AC-3) and the console surfaces why.

---

### Story 4.12: Per-tenant notification channels and typed events

**As a** tenant admin, **I want** my own notification targets, **So that** alerts do not go to a
single deployment-wide address.

`Effort: M` · `Files: core/notify.py, supabase/migrations/0025_sinks_and_channels.sql (new), api/sinks.py (new, channels half), core/schemas.py, tests/test_notify_gate.py` · `FRs: FR-149`

**Acceptance Criteria**
1. **Given** `core/notify.py::Notifier`, **When** it is widened, **Then** its surface becomes
   `notify(event: NotificationEvent)` and the approval-only method becomes one event type.
2. **Given** `notification_channels(tenant_id, kind, target, events[], enabled)`, **When** it is created,
   **Then** it carries RLS with a two-tenant test, and the single process-wide recipient setting is
   removed and deprecated per V-6.
3. **Given** a tenant with no channel configured, **When** an event fires, **Then** nothing is sent and the
   absence is reported as an unconfigured capability — never an error that blocks a decision (OP-6).
4. **Given** a channel target, **When** it is stored, **Then** any secret component is envelope-encrypted
   through `core/secrets.py` and never returned by the API.

---

### Story 4.13: Approvals route to the right humans and escalate before expiry

**As** Yusuf, **I want** the request to reach my team and to be chased before it dies, **So that** an
approval is decided rather than silently expiring.

`Effort: M` · `Files: core/notify.py, core/approvals.py, core/jobs.py, api/approvals.py, tests/test_notify_gate.py` · `FRs: FR-20`

**Acceptance Criteria**
1. **Given** a tenant-configured approver group or channel, **When** an approval is created, **Then** the
   notification goes to that target and to no global address.
2. **Given** an approval approaching its deadline, **When** the configured escalation threshold is reached,
   **Then** an escalation fires **before** the deadline, not after.
3. **Given** a notification channel outage, **When** it occurs, **Then** the decision path is unaffected and
   an alert is raised — a channel failure never blocks or allows an action (OP-6, G-S6).
4. **Given** SM-5, **When** approvals are measured, **Then** creation-to-decision time is recorded and
   queryable.

---

### Story 4.14: Decide from a signed interactive channel message

**As** Yusuf, **I want** to approve or deny where I already work, **So that** I decide in under a
minute without opening another console.

`Effort: L` · `Files: api/approvals.py (callback route), core/notify.py, core/members.py, core/secrets.py, tests/test_approvals_api.py, docs/SECURITY.md` · `FRs: FR-21`

**Acceptance Criteria**
1. **Given** an interactive channel message, **When** the approver acts, **Then** the callback hits
   `POST /v1/approvals/{id}/decision/callback` and the **gateway** records and enforces the decision —
   the channel is how the human is asked, never the authority.
   ⚠ **INVARIANT: CLAUDE.md §4.1** — HITL is never delegated.
2. **Given** the callback, **When** it is authenticated, **Then** it requires an HMAC signature **and** a
   single-use per-approval nonce, and resolves to a **member identity**, never a shared bot identity.
3. **Given** a replayed callback, **When** it arrives, **Then** it is rejected.
4. **Given** RBAC and separation of duties, **When** a channel decision arrives, **Then** both are applied
   identically to the console path.
5. **Given** OQ-11 is open, **When** the story is implemented, **Then** the chosen minimum authentication is
   documented in `docs/SECURITY.md` and reviewed by security before merge.

---

### Story 4.15: The approval surface becomes the full Decision Brief

**As** Yusuf, **I want** enough context to make a real decision in under a minute, **So that** I stop
rubber-stamping (CM-2).

`Effort: L` · `Files: frontend/app/(app)/approvals/page.tsx, api/approvals.py, core/approvals.py, frontend/lib/i18n.tsx, frontend/e2e/smoke.spec.ts` · `FRs: FR-17`

**Acceptance Criteria**
1. **Given** a pending approval, **When** it renders, **Then** it shows: action class; requesting agent and
   client; the **deterministic, gateway-computed dry-run**; the risk score with its factor breakdown; the
   escalation source; taint and integrity banners; a live expiry countdown labelled **"expiry = denial"**;
   and the tool's recent decisions.
2. **Given** the dry-run, **When** it is displayed, **Then** it is the value produced by
   `core/approvals.py::build_dry_run` from the tool definition and arguments — **never** authored by the
   agent or an LLM. ⚠ **INVARIANT: CLAUDE.md §4.1 / G-S1.**
3. **Given** a guard that did not run for this decision, **When** its banner would render, **Then** the
   surface states "not evaluated" using `guards_run`, rather than implying a clean result.
4. **Given** a denial, **When** it is submitted, **Then** the interface requires the one-line justification
   from Story 4.7 before the button is enabled.
5. **Given** keyboard-only and screen-reader use, **When** an approver decides, **Then** every element of
   the brief is reachable and labelled (NFR-10), and the brief is comprehensible without product
   training.

---

### Story 4.16: Break-glass is explicit, time-boxed and loudly audited

**As a** security lead, **I want** emergency elevation to be a named operation, **So that** there is
no silent elevation path.

`Effort: M` · `Files: api/members.py, core/members.py, core/control_events.py, core/notify.py, frontend/app/(app)/admin/page.tsx, tests/test_members_api.py` · `FRs: FR-84`

**Acceptance Criteria**
1. **Given** break-glass, **When** it is invoked, **Then** it requires a reason and a bounded duration, and
   expires automatically at the end of that duration.
2. **Given** invocation, **When** it succeeds, **Then** a control-plane event is written and **every admin**
   in the tenant is notified.
3. **Given** the codebase, **When** it is searched for privilege elevation, **Then** this is the only path
   and there is no implicit elevation anywhere. ⚠ **INVARIANT: CLAUDE.md §4.3.**
4. **Given** an active break-glass, **When** the console renders, **Then** it is visibly flagged with who,
   why and when it lapses.

---

## Epic 5: One Guard Pipeline — one sequence, every ingress

**Goal.** Remove the structural defect beneath everything else: two independent guard sequences
(`gateway/server.py::PolicyBackend.call_tool` and `core/decision.py::authorize`) with different guard
sets, so a customer cannot tell which guards protected them. After this epic there is exactly one
ordered pipeline, every ingress path calls it, every response declares which guards ran and in which
enforcement mode, and adding a guard is one change that is automatically live everywhere.

**Sequenced before Emergency Stop** deliberately (risk R-1): the refactor must never be entangled
with a new guard. Story 5.1 is the safety net that makes the refactor provable.

---

### Story 5.1: A golden-decision corpus that proves the refactor changes nothing

**As a** maintainer, **I want** a recorded corpus of current verdicts, **So that** the riskiest
refactor in the release cannot silently change a customer's decisions.

`Effort: M` · `Files: tests/fixtures/golden_decisions.json (new), tests/test_golden_decisions.py (new)` · `FRs: FR-1 (enabling), NFR-7`

**Acceptance Criteria**
1. **Given** the code at `HEAD` before the refactor, **When** the corpus is generated, **Then** it records,
   for a broad matrix of policies × tool names × argument shapes, the resulting decision, action class,
   tier and reason on **both** existing paths.
2. **Given** the corpus, **When** it is replayed against the refactored pipeline, **Then** every verdict is
   identical, and any intentional difference must be added to the corpus with a written justification in
   the PR.
3. **Given** a new guard added later, **When** it is off by default, **Then** the corpus still passes —
   which is the executable form of NFR-7.

---

### Story 5.2: `core/pipeline.py` — extract the single Guard Pipeline

**As an** agent engineer, **I want** the same guards regardless of how my call arrives, **So that** my
integration's strength does not depend on an accident of ingress.

`Effort: L` · `Files: core/pipeline.py (new), gateway/server.py, core/decision.py, api/llm_proxy.py, tests/test_pipeline_equivalence.py (new)` · `FRs: FR-1`

**Acceptance Criteria**
1. **Given** `core/pipeline.py`, **When** it is imported, **Then** it exposes frozen `CallContext` and
   `Verdict` dataclasses and `evaluate_call(conn, policy, ctx) -> Verdict`, and owns the ordered sequence
   `halt → integrity → rbac → budget → policy → judge → risk → taint`.
2. **Given** `gateway/server.py::PolicyBackend.call_tool`, **When** it is refactored, **Then** it calls
   `evaluate_call`, acts on the verdict (relay / deny / hold), marks taint, and audits — and contains **no
   guard ordering of its own**.
3. **Given** `core/decision.py::authorize`, **When** it is refactored, **Then** it calls `evaluate_call`,
   returns the verdict and **never executes** an action.
4. **Given** an identical irreversible call on the MCP gateway and on `/v1/authorize`, **When** both run,
   **Then** decision, decision reason and escalation source are identical.
5. **Given** one tool call, **When** the pipeline runs, **Then** it opens **one** connection and passes it
   to every guard — replacing the separate connections opened today in `_integrity_blocks`,
   `_apply_risk` and `_audit` (NFR-3, CM-3).
6. **Given** the judge, **When** the pipeline runs, **Then** it is consulted **only** for `ambiguous`
   classification and never decides. ⚠ **INVARIANT: CLAUDE.md §4.1 / NFR-1.**
7. **Given** Story 5.1's corpus, **When** it runs against the refactor, **Then** it passes unchanged.

---

### Story 5.3: Every response declares its guards and its enforcement mode

**As a** customer, **I want** the response to tell me how strong my integration is, **So that** I do
not have to read the source to find out.

`Effort: M` · `Files: core/schemas.py, api/authorize.py, api/llm_proxy.py, gateway/server.py, core/provenance.py, docs/AUDIT_FORMAT.md, tests/test_authorize_api.py` · `FRs: FR-2, FR-3`

**Acceptance Criteria**
1. **Given** any decision response, **When** it is read, **Then** `AuthorizeResponse` carries `guards_run`
   and an `X-XSOM-Guards` header lists the executed guards in order.
2. **Given** the MCP path, **When** a decision is returned, **Then** `enforcement_mode=mandatory`; **Given**
   the SDK/HTTP and LLM-proxy paths, **Then** `cooperative`.
3. **Given** every audit entry, **When** it is written, **Then** `enforcement_mode` is persisted and appears
   in every export and evidence pack.
4. **Given** a guard that was skipped because it is disabled, **When** the response renders, **Then** it is
   absent from `guards_run` — the list is what **ran**, never what exists.

---

### Story 5.4: The fail-closed guard-unavailability matrix

**As a** security engineer, **I want** every guard failure to deny irreversible actions, **So that**
no failure mode produces an implicit allow.

`Effort: M` · `Files: core/pipeline.py, core/policy.py, tests/test_pipeline_failclosed.py (new), docs/CAPABILITIES.md` · `FRs: FR-7`

**Acceptance Criteria**
1. **Given** each guard independently made to fail (database unreachable, halt state unresolvable,
   approval service down, session unresolvable, budget unreadable, fingerprint unreadable), **When** an
   `irreversible` or `external_send` action arrives, **Then** the verdict is **deny** and the reason names
   the unavailable guard. ⚠ **INVARIANT: CLAUDE.md §4.4 / NFR-2.**
2. **Given** the same failures on a `read` action, **When** they occur, **Then** behaviour follows the
   configured `on_guard_unavailable` default, which itself defaults to the safe side.
3. **Given** any guard failure, **When** a response is returned, **Then** the degradation is **disclosed**
   in the response and in the audit record, never hidden (G-S6).
4. **Given** the matrix, **When** a new guard is added, **Then** the test requires it to declare a failure
   verdict or the test fails.

---

### Story 5.5: Session-aware HTTP ingress

**As** Sofia the AI engineer, **I want** taint to apply on the HTTP path, **So that** my non-MCP
agent gets the same protection as an MCP one.

`Effort: M` · `Files: core/schemas.py (AuthorizeRequest), api/authorize.py, core/pipeline.py, tests/test_authorize_api.py` · `FRs: FR-4`

**Acceptance Criteria**
1. **Given** `AuthorizeRequest`, **When** it is submitted, **Then** it accepts a bounded `session_id` and an
   agent-declared **digest** of the preceding tool result — a digest, never the result content.
   ⚠ **INVARIANT: CLAUDE.md §4.10.**
2. **Given** a taint-then-send sequence on the HTTP path, **When** it is evaluated, **Then** it is escalated
   identically to the MCP path.
3. **Given** an `irreversible` action with no resolvable session, **When** it is evaluated, **Then** the
   pipeline fails closed per Story 5.4.

---

### Story 5.6: Tool annotations are a safety floor, never a ceiling

**As a** security engineer, **I want** a hostile downstream server unable to lower a tool's class,
**So that** the supply-chain assumption ("downstream servers can lie") is honoured.

`Effort: M` · `Files: core/policy.py (new classify_by_annotation), core/pipeline.py, gateway/server.py, tests/test_policy.py` · `FRs: FR-53`

**Acceptance Criteria**
1. **Given** a tool with `destructiveHint: true`, **When** it is classified, **Then** its class is at least
   `irreversible`; **Given** `openWorldHint: true`, **Then** at least `external_send`.
2. **Given** a tool named `delete_all` declaring `readOnlyHint: true`, **When** it is classified, **Then**
   its class is **not** reduced — a test asserts this specific hostile case.
   ⚠ **INVARIANT: CLAUDE.md §4.4 / G-S4.**
3. **Given** an explicit policy rule, **When** an annotation would relax it, **Then** the rule wins.
4. **Given** the classification order, **When** it runs, **Then** annotations are consulted **before** name
   heuristics and the combination is monotone-upward only.
5. **Given** an entry classified via annotation, **When** it is written, **Then** `decision_reason` is
   `annotation`.

---

### Story 5.7: Annotations enter the fingerprint, with a versioned silent re-baseline

**As a** security engineer, **I want** a flipped `destructiveHint` to register as tool drift, **So
that** the supply-chain shield closes the hole it was built to cover.

`Effort: L` · `Files: core/integrity.py (fingerprint), supabase/migrations/0026_integrity_v2.sql (new), core/control_events.py, tests/test_integrity.py` · `FRs: FR-54`

**Acceptance Criteria**
1. **Given** `core/integrity.py::fingerprint`, **When** it is computed, **Then** it includes the tool's
   annotations and is stamped with `fp_version = 2`.
2. **Given** a downstream server that flips `destructiveHint` from true to false between two listings,
   **When** the tool is screened, **Then** drift is detected and the tool is quarantined fail-closed.
3. **Given** an existing approved tool on upgrade, **When** its recomputed **v1** fingerprint still matches
   the stored v1 (definition provably unchanged), **Then** it is silently re-baselined to v2 and **one
   `system` control-plane event per re-baseline** is written — no operator sees a false drift.
   ⚠ **INVARIANT: NFR-7 / risk R-2** — a mass false-drift event would train operators to click through
   the most important supply-chain signal.
4. **Given** a tool whose definition genuinely changed, **When** upgrade runs, **Then** it still
   quarantines.

---

### Story 5.8: Multilingual and opaque tool classification

**As a** French-market operator, **I want** `supprimer_client` classified as destructive, **So that**
the safe default is safe in my language.

`Effort: M` · `Files: core/policy.py (classify_by_name, PolicyDefaults), tests/test_policy.py, docs/CAPABILITIES.md` · `FRs: FR-6`

**Acceptance Criteria**
1. **Given** `supprimer_client`, `envoyer_courriel`, `virement`, `enviar_correo` and `löschen`-stemmed
   names, **When** classified, **Then** each resolves to the safe (higher-risk) class.
2. **Given** an opaque name such as `t_0042`, **When** classified, **Then** it falls to `unknown_tool` and
   is denied.
3. **Given** a tenant-supplied `defaults.extra_heuristics` list, **When** it is present, **Then** it is
   applied in addition to the built-ins and is bounded and validated.
4. **Given** a golden corpus of existing tool names, **When** the new stems land, **Then** **no** name moves
   to a *less* strict class — misclassification may only tighten. ⚠ **INVARIANT: CLAUDE.md §4.4.**
5. **Given** ordering by decreasing risk, **When** several stems match, **Then** the strictest wins, and a
   test asserts the ordering.

---

### Story 5.9: The irreversible floor holds across every escalation path

**As a** buyer, **I want** proof that nothing can make an irreversible action automatic, **So that**
the product's central guarantee survives every new feature.

`Effort: S` · `Files: core/risk.py (band), core/policy.py (escalate_for_class), core/pipeline.py, tests/test_risk.py` · `FRs: FR-33`

**Acceptance Criteria**
1. **Given** any combination of risk score, trust discount, risk band, tool annotation and earned-trust
   streak, **When** an `irreversible` action is evaluated, **Then** its tier is never `auto`.
2. **Given** the existing floor test, **When** this story lands, **Then** it is retained and **extended** to
   the annotation-derived and trust-derived paths introduced in v2.
3. **Given** a future guard added to the pipeline, **When** the floor test runs, **Then** it exercises the
   new guard automatically because it asserts over the pipeline's output, not over a single function.
   ⚠ **INVARIANT: CLAUDE.md §4.1 / G-S2.**

---

### Story 5.10: Evaluate-only replay

**As** Tom the security engineer, **I want** to re-run a decision and see the full reasoning without
executing anything, **So that** I can reproduce an escalation deterministically.

`Effort: M` · `Files: core/pipeline.py, api/authorize.py (or api/policy.py replay route), frontend/app/(app)/inspector/page.tsx, core/control_events.py, tests/test_replay.py (new)` · `FRs: FR-60`

**Acceptance Criteria**
1. **Given** `enforcement_mode="evaluate_only"`, **When** the pipeline runs, **Then** it returns the full
   reasoning chain and **contacts no downstream server** — a test asserts **zero** downstream invocations.
   ⚠ **INVARIANT: CLAUDE.md §4.1 / G-S2.**
2. **Given** a replay, **When** it completes, **Then** it writes **no decision record**, but the operator
   action that triggered it **is** a control-plane event (AD-20).
3. **Given** the judge, **When** a replay runs, **Then** it is consulted only if explicitly requested — so
   replay neither burns budget nor becomes non-deterministic.
4. **Given** identical inputs and policy version, **When** a replay is run twice, **Then** the result is
   identical (NFR-1).

---

### Story 5.11: The Inspector shows the runtime truth

**As an** operator, **I want** the Inspector to stop showing an optimistic single tier, **So that** I
am not surprised by a hold in production.

`Effort: M` · `Files: frontend/app/(app)/inspector/page.tsx, api/policy.py (ToolView), core/integrity.py, frontend/lib/i18n.tsx` · `FRs: FR-61`

**Acceptance Criteria**
1. **Given** a tool, **When** it renders, **Then** its tier is labelled as a **baseline** tier and, where
   risk bands may escalate it, a tier **range** is shown rather than one green tier.
2. **Given** a quarantined tool, **When** the Inspector renders, **Then** it is never displayed as
   available, and its quarantine reason is shown (Story 7.13).
3. **Given** a tool with constraints, **When** it renders, **Then** the presence of constraints and the
   integrity status are declared.
4. **Given** the classification source, **When** it renders, **Then** the row states whether the class came
   from an explicit rule, an annotation, a name heuristic or `unknown_tool`.

---

## Epic 6: Emergency Stop and Containment

**Goal.** Give Ravi the SRE (UJ-5) a lever that works at 03:00: one control, effective on
already-authenticated sessions, denying at the gateway **before** the downstream server is contacted,
with the halt itself on the chain. Target **SM-6: < 5 s p95** from decision to first denied call.
Depends on Epic 5 so halt lands once, as pipeline guard #1.

---

### Story 6.1: Halt state and scopes

**As an** SRE, **I want** to halt a tenant, an agent or a tool, **So that** containment matches the
blast radius I am facing.

`Effort: M` · `Files: core/control.py (new), api/control.py (new), api/main.py, supabase/migrations/0019_halts_and_job_runs.sql, core/schemas.py, tests/test_control_api.py (new)` · `FRs: FR-23`

**Acceptance Criteria**
1. **Given** `POST /v1/control/halt` with a scope in `{tenant, agent, tool}`, a scope reference and a
   **mandatory bounded reason**, **When** it is called by an admin or operator, **Then** an active halt row
   is created and the state is queryable.
2. **Given** `POST /v1/control/resume`, **When** it is called with a mandatory reason, **Then** the halt is
   marked resumed with the resuming identity and timestamp — halts are never deleted.
3. **Given** each of the three scopes, **When** tested independently, **Then** each is enforced
   independently and a tool-scoped halt does not stop unrelated tools.
4. **Given** the `halts` table, **When** created, **Then** it carries RLS with a two-tenant isolation test.

---

### Story 6.2: Halt is the pipeline's first guard, effective on live sessions

**As** Ravi, **I want** an agent authenticated hours ago to be stopped on its very next call, **So
that** containment does not depend on process lifetime.

`Effort: M` · `Files: core/pipeline.py, core/control.py, gateway/server.py, tests/test_halt_gate.py (new), docs/CAPABILITIES.md` · `FRs: FR-24`

**Acceptance Criteria**
1. **Given** the pipeline, **When** it runs, **Then** `is_halted` is the **first** guard, executed on the
   connection the pipeline already holds — adding no extra round trip (NFR-3).
2. **Given** an MCP session authenticated before the halt, **When** it makes its next tool call, **Then**
   the call is denied **at the gateway before the downstream server is contacted**, and the downstream
   mock records zero invocations.
3. **Given** an active halt, **When** any policy rule, risk band, trust discount, annotation or existing
   approval would allow the action, **Then** the halt still wins.
   ⚠ **INVARIANT: G-S3** — Emergency Stop always wins.
4. **Given** a call already relayed to a downstream server, **When** a halt is set, **Then** the in-flight
   call is **not** cancelled, and this limit is stated in `docs/CAPABILITIES.md` (OQ-5, resolved
   conservatively and published rather than implied).
5. **Given** SM-6, **When** measured, **Then** the time from halt to first denied call is under 5 s at p95.

---

### Story 6.3: Halt fails closed

**As a** security engineer, **I want** an unreadable halt state to deny risky actions, **So that** the
containment primitive cannot be bypassed by breaking it.

`Effort: S` · `Files: core/control.py, core/pipeline.py, tests/test_pipeline_failclosed.py` · `FRs: FR-25`

**Acceptance Criteria**
1. **Given** the halt query fails, **When** an `irreversible` or `external_send` action is evaluated,
   **Then** it is denied with `decision_reason=halt`. ⚠ **INVARIANT: CLAUDE.md §4.4.**
2. **Given** the same failure, **When** the response is returned, **Then** the degraded mode is disclosed
   in the response and the audit record (G-S6).
3. **Given** Story 5.4's matrix, **When** it runs, **Then** the halt guard is one of its enumerated rows.

---

### Story 6.4: Halt and resume are on the chain

**As a** post-mortem author, **I want** the timeline to be the audit chain, **So that** the incident
record is the same record as the evidence.

`Effort: S` · `Files: api/control.py, core/control_events.py, core/audit.py, tests/test_control_api.py` · `FRs: FR-27`

**Acceptance Criteria**
1. **Given** a halt or a resume, **When** it succeeds, **Then** a control-plane event is written with the
   actor identity **inside the hashed payload's `user_id`** and the reason as metadata.
2. **Given** a call denied by an active halt, **When** its entry is written, **Then** `decision` is `halted`
   and `decision_reason` is `halt`.
3. **Given** the audit explorer filtered by agent, **When** an incident is reconstructed, **Then** halt and
   resume appear in place in the timeline.

---

### Story 6.5: Halt is one action from the agent page and from every alert

**As** Ravi at 03:00, **I want** one click from the alert to an effective halt, **So that** I do not
need a ticket, a deploy or database access.

`Effort: M` · `Files: frontend/app/(app)/control/page.tsx (new), frontend/components/AppShell.tsx, frontend/app/(app)/home/page.tsx, core/notify.py, frontend/e2e/smoke.spec.ts` · `FRs: FR-26`

**Acceptance Criteria**
1. **Given** an agent page, **When** it renders, **Then** a single **Halt** control is present, with
   tenant-wide and per-tool scopes beside it, requiring a reason before submission.
2. **Given** an alert notification, **When** it is received, **Then** it links directly to the halt control
   for the affected scope.
3. **Given** a journey test following UJ-5, **When** it measures clicks from alert to effective halt,
   **Then** the count is **one** (plus the mandatory reason entry).
4. **Given** halted state, **When** the console renders, **Then** it shows who halted, when, and why, and
   offers resume to an authorised role.

---

### Story 6.6: `xsom halt` and `xsom resume`

**As an** on-call engineer without console access, **I want** to halt from the command line, **So
that** containment never depends on a browser session.

`Effort: S` · `Files: cli/main.py, core/control.py, tests/test_cli.py` · `FRs: FR-94`

**Acceptance Criteria**
1. **Given** `xsom halt --scope agent --ref <id> --reason "<text>"`, **When** it runs, **Then** the halt is
   effective and a control-plane event is written.
2. **Given** a missing reason, **When** the command runs, **Then** it exits non-zero and changes nothing.
3. **Given** `ENV=prod`, **When** halt runs, **Then** it is **permitted** without `--force` (halting is a
   safety action) while resume requires explicit confirmation — the fail-closed direction is preserved.

---

### Story 6.7: Revocation is effective on the next call, not the next session

**As a** security engineer, **I want** a revoked token to stop the agent immediately, **So that**
credential response is real containment.

`Effort: M` · `Files: core/tenant_tokens.py, core/control.py, core/pipeline.py, gateway/server.py, tests/test_tenant_tokens.py` · `FRs: FR-47`

**Acceptance Criteria**
1. **Given** a gateway token revoked mid-session, **When** the agent makes its next call, **Then** the call
   is denied at the same enforcement point as halt.
2. **Given** the liveness check, **When** it runs, **Then** it is folded into the halt guard's existing
   query — no additional round trip (NFR-3).
3. **Given** a revocation, **When** it succeeds, **Then** a control-plane event is written.
4. **Given** the revocation check fails to execute, **When** an irreversible action arrives, **Then** it is
   denied. ⚠ **INVARIANT: CLAUDE.md §4.4.**

---

### Story 6.8: Credential hygiene is surfaced

**As a** security engineer, **I want** token age, last use and rotation status per agent, **So that** a
never-rotated long-lived credential is visible without a query.

`Effort: S` · `Files: api/gateway_tokens.py, core/tenant_tokens.py, frontend/components/ApiKeys.tsx, tests/test_tenant_tokens.py` · `FRs: FR-46`

**Acceptance Criteria**
1. **Given** the agent view, **When** it renders, **Then** each credential shows creation age, last-use
   timestamp and rotation status.
2. **Given** a long-lived credential, **When** it exceeds the configured rotation reminder age, **Then** it
   is visibly flagged.
3. **Given** the flag, **When** it fires, **Then** **nothing is revoked automatically** — revocation stays a
   deliberate human action (Story 6.7).
4. **Given** the API response, **When** it is inspected, **Then** it contains no token value or hash prefix
   sufficient to reconstruct one. ⚠ **INVARIANT: CLAUDE.md §4.7.**

---

## Epic 7: Agent Plane Coverage — identity, systems, sessions, taint, drift, outcomes

**Goal.** Make the supervised unit real. Today an "agent" is a token row with a name, per-agent
attribution is null on the flagship MCP path, taint lives in process memory and resets on every
reconnect, drift covers tool definitions only, and the outcome of an allowed action is computed and
thrown away. This epic makes each of those durable, attributable and visible — without adding a
single content-bearing field.

---

### Story 7.1: Agent attribution on the MCP path

**As an** operator, **I want** every gateway-relayed entry to name the agent, **So that** per-agent
dashboards, trust and filters stop returning empty.

`Effort: M` · `Files: gateway/server.py (run_stdio, ApprovalContext, _audit, _audit_gate), core/tenant_tokens.py (resolve_principal), tests/test_gateway_session.py` · `FRs: FR-40`

**Acceptance Criteria**
1. **Given** `gateway/server.py::run_stdio`, **When** it authenticates, **Then** it resolves
   `(token_id, tenant_id)` rather than the tenant alone, and threads `token_id` into `ApprovalContext`.
2. **Given** any gateway-relayed call, **When** its entry is written, **Then** `gateway_token_id` is
   non-null — including on **gate** entries.
3. **Given** a regression test, **When** it relays a call, **Then** it asserts non-null agent attribution
   and fails if a future refactor drops it.
4. **Given** the per-agent filter in the console, **When** it is used on gateway traffic, **Then** it
   returns results.

---

### Story 7.2: Earned trust is keyed per agent

**As a** security engineer, **I want** a compromised agent to start with no discount, **So that** one
well-behaved agent cannot lower risk for a fresh one.

`Effort: S` · `Files: core/trust.py (observed, summary), api/trust.py, tests/test_trust.py, CHANGELOG.md` · `FRs: FR-32`

**Acceptance Criteria**
1. **Given** `core/trust.py::observed`, **When** it computes a streak, **Then** it keys on
   `(tenant_id, gateway_token_id, tool)` rather than `(tenant_id, tool)`.
2. **Given** agent B with a long clean streak and agent A with none, **When** agent A calls the same tool,
   **Then** agent A receives **no** discount.
3. **Given** existing streaks, **When** the re-keying lands, **Then** they reset — which moves decisions in
   the **stricter** direction only, satisfying NFR-7, and is recorded in `CHANGELOG.md` per V-7.
4. **Given** an `irreversible` action, **When** any streak exists, **Then** the floor from Story 5.9 still
   holds. ⚠ **INVARIANT: CLAUDE.md §4.1.**

---

### Story 7.3: The AI System registry

**As a** compliance officer, **I want** agents to belong to a registered system with owner and
purpose, **So that** reporting is per system rather than per tenant.

`Effort: L` · `Files: core/systems.py (new), api/systems.py (new), supabase/migrations/0022_ai_systems.sql (new), api/main.py, core/schemas.py, frontend/app/(app)/systems/page.tsx (new), tests/test_systems_api.py (new)` · `FRs: FR-41`

**Acceptance Criteria**
1. **Given** `ai_systems`, **When** it is created, **Then** it carries owner, business purpose, model,
   framework and version, environment, risk tier, data categories, lifecycle state and documentation URL,
   with RLS and a two-tenant isolation test.
2. **Given** `gateway_tokens.ai_system_id`, **When** a token is minted, **Then** it may point at an AI
   System — tokens become credentials *pointing at* a system.
3. **Given** `/v1/systems`, **When** an admin creates, reads, updates or archives a system, **Then** each
   mutation writes a control-plane event.
4. **Given** an audit entry, **When** it is written for an attributed agent, **Then** `ai_system_id` is
   populated in the annex.
5. **Given** every input, **When** validated, **Then** each field is length- and shape-bounded (NFR-5).

---

### Story 7.4: The registry completeness gate

**As a** compliance officer, **I want** an incomplete inventory to block a green readiness, **So that**
compliance cannot look ready while the inventory is empty.

`Effort: M` · `Files: core/systems.py, core/compliance.py, api/compliance.py, frontend/app/(app)/systems/page.tsx` · `FRs: FR-42`

**Acceptance Criteria**
1. **Given** an AI System missing required governance fields, **When** compliance status is computed,
   **Then** the system reports `incomplete` and its missing fields are itemised by name.
2. **Given** any incomplete system, **When** tenant-level compliance readiness is computed, **Then** it
   cannot be green.
3. **Given** the console, **When** a gap is shown, **Then** it links to the field that fixes it.
4. **Given** an agent with no AI System at all, **When** status is computed, **Then** it is reported as an
   unregistered agent rather than silently ignored.

---

### Story 7.5: Delegation lineage is captured

**As an** investigator, **I want** a sub-agent call attributable to its parent and to the originating
human, **So that** an orchestrator spawning ten sub-agents is not one indistinguishable agent.

`Effort: M` · `Files: core/pipeline.py, core/provenance.py, gateway/server.py, api/authorize.py, core/schemas.py, frontend/app/(app)/audit/page.tsx, tests/test_lineage.py (new)` · `FRs: FR-43`

**Acceptance Criteria**
1. **Given** the MCP call context and the `/v1/authorize` payload, **When** a call is made, **Then**
   `parent_request_id`, `delegation_subject`, `originating_principal` and `call_depth` propagate and land
   in the `lineage` annex column.
2. **Given** a nested call chain, **When** the audit explorer renders it, **Then** the delegation tree is
   reconstructable from stored data alone.
3. **Given** lineage fields, **When** they are stored, **Then** they are identifiers and counts only — no
   argument content, no prompt, no free text. ⚠ **INVARIANT: CLAUDE.md §4.10.**
4. **Given** the credential model of FR-44 is deferred, **When** this story lands, **Then** it works without
   it — lineage capture ships independently.

---

### Story 7.6: Durable session identity

**As an** investigator, **I want** a session identity that survives reconnects, **So that** taint and
lineage do not reset every time an orchestrator opens a new connection.

`Effort: M` · `Files: core/sessions.py (new), supabase/migrations/0023_sessions_and_taint.sql (new), core/pipeline.py, gateway/server.py, api/authorize.py, tests/test_sessions.py (new)` · `FRs: FR-56`

**Acceptance Criteria**
1. **Given** any ingress path, **When** a call arrives, **Then** a session id is derived from trace context
   or the standard conversation identifier where available, declared by the caller otherwise, and
   generated as a last resort.
2. **Given** the `sessions` table, **When** it is created, **Then** it records first-seen, last-seen,
   gateway token and trace id, carries RLS, and has a two-tenant isolation test.
3. **Given** a process restart or a reconnect, **When** the same session id is presented, **Then** the
   session row and its state persist.
4. **Given** the MCP protocol session, **When** the implementation is reviewed, **Then** the durable session
   is **explicitly not** it (see Story 7.7).

---

### Story 7.7: No enforcement state depends on the MCP protocol session

**As a** maintainer, **I want** a test that fails if enforcement state binds to the protocol session,
**So that** the coming stateless transport revision cannot silently widen the taint window to zero.

`Effort: S` · `Files: gateway/server.py, gateway/taint.py, core/taint_store.py, tests/test_mcp_stateless_forward_compat.py (new), docs/CAPABILITIES.md` · `FRs: FR-55`

**Acceptance Criteria**
1. **Given** taint, quarantine and trust state, **When** a test inspects where each is keyed, **Then** each
   keys off the durable session or a persisted table, never the protocol session or the initialize
   handshake.
2. **Given** an unresolvable session on an `irreversible` action, **When** it is evaluated, **Then** it is
   treated as **tainted, never clean**. ⚠ **INVARIANT: PRD V-9 / CLAUDE.md §4.4.**
3. **Given** a future SDK bump, **When** it is proposed, **Then** this test is a required gate before the
   bump, and full transport conformance remains out of scope for v2.0 (Story 14.10).

---

### Story 7.8: The session timeline

**As** Tom, **I want** one page stitching model interactions, decisions, approvals and outcomes, **So
that** "which conversation caused this action?" is one query.

`Effort: L` · `Files: core/sessions.py, api/sessions.py (new), api/main.py, frontend/app/(app)/sessions/[id]/page.tsx (new), tests/test_sessions_api.py (new)` · `FRs: FR-59`

**Acceptance Criteria**
1. **Given** `GET /v1/sessions/{id}`, **When** it is called, **Then** it returns one ordered timeline joining
   `audit_log`, `usage_events` and `approvals` for that session, RLS-scoped.
2. **Given** a link that cannot be established, **When** the timeline renders, **Then** it states the link is
   unavailable rather than inferring one.
3. **Given** the console page, **When** it renders, **Then** each timeline item links to its audit detail
   drawer, and the tainted state (Story 7.10) is banner-visible.
4. **Given** a session with thousands of events, **When** it is fetched, **Then** the response is paginated
   and bounded.

---

### Story 7.9: Taint is persisted

**As a** security engineer, **I want** taint to survive reconnection and cross ingress paths, **So
that** the orchestrator pattern of one session per task does not reset it to clean every time.

`Effort: L` · `Files: core/taint_store.py (new), gateway/taint.py, core/pipeline.py, supabase/migrations/0023_sessions_and_taint.sql, tests/test_taint.py, tests/test_taint_gate.py` · `FRs: FR-62`

**Acceptance Criteria**
1. **Given** `session_taint(tenant_id, session_id, marked_at, source_tool, reason, call_count, expires_at)`,
   **When** it is created, **Then** it carries RLS with a two-tenant isolation test.
2. **Given** `gateway/taint.py`, **When** refactored, **Then** its detection functions stay **pure** and its
   stateful dataclass is replaced by `core/taint_store.py`.
3. **Given** a session marked tainted, **When** the agent reconnects mid-session, **Then** taint still
   applies — a test performs exactly this reconnection.
4. **Given** taint marked on the MCP path, **When** the next call arrives on the HTTP path with the same
   session, **Then** taint applies there too.
5. **Given** both a call-count window and a wall-clock window, **When** either expires, **Then** taint
   lapses; **Given** neither has, **Then** a following `irreversible` or `external_send` action is escalated.
6. **Given** a database failure reading taint, **When** an `irreversible` action arrives, **Then** it is
   denied. ⚠ **INVARIANT: CLAUDE.md §4.4.**
7. **Given** taint is computed from tool **results**, **When** reviewed, **Then** no prompt or model input is
   read anywhere — xSOM is not a prompt firewall (PRD §5.1).

---

### Story 7.10: Taint is visible

**As an** operator, **I want** to see which sessions are tainted and why, **So that** I understand an
escalation without reading raw audit rows.

`Effort: M` · `Files: frontend/app/(app)/sessions/[id]/page.tsx, frontend/app/(app)/approvals/page.tsx, api/sessions.py, frontend/lib/i18n.tsx` · `FRs: FR-63`

**Acceptance Criteria**
1. **Given** a tainted session, **When** the console renders it, **Then** a banner names the source tool, the
   time it was marked and the remaining window.
2. **Given** the Decision Brief (Story 4.15), **When** the underlying session is tainted, **Then** the taint
   banner appears on it.
3. **Given** the session timeline, **When** it renders, **Then** the `taint_marked` event appears in place
   and links to the `tainted_action` entries it caused.

---

### Story 7.11: Deterministic behavioural baselines

**As an** operator, **I want** a rolling per-agent-and-tool baseline, **So that** an agent quietly
doing ten times more external sends is visible.

`Effort: M` · `Files: core/baseline.py (new), core/jobs.py, tests/test_baseline.py (new), docs/CAPABILITIES.md` · `FRs: FR-65`

**Acceptance Criteria**
1. **Given** `core/baseline.py`, **When** it computes a baseline, **Then** it derives call rate,
   action-class mix, blast-radius distribution and deny rate **from `audit_log` only** — no new collection.
2. **Given** the same input window, **When** the computation is repeated, **Then** the result is identical —
   deterministic and explainable, with **no machine learning** (PRD §5.7).
3. **Given** the worker, **When** the baseline job runs, **Then** it records a `job_runs` row and is
   idempotent.
4. **Given** the computation, **When** it is reviewed, **Then** it reads metadata columns only and no
   content. ⚠ **INVARIANT: CLAUDE.md §4.10.**

---

### Story 7.12: Behavioural drift raises an event

**As an** operator, **I want** a drift event when an agent's behaviour deviates beyond my threshold,
**So that** I hear about it before it becomes an incident.

`Effort: M` · `Files: core/baseline.py, core/jobs.py, core/audit.py, core/notify.py, api/policy.py (thresholds), tests/test_baseline.py` · `FRs: FR-66`

**Acceptance Criteria**
1. **Given** a deviation beyond the configured threshold, **When** the job runs, **Then** a `behavior_drift`
   audit entry is written and a notification fires.
2. **Given** no configured threshold, **When** the job runs, **Then** nothing fires — drift detection is
   **off by default**, per tenant. ⚠ **INVARIANT: NFR-7.**
3. **Given** a registered AI System whose model version changes, **When** the change is detected, **Then**
   it is itself a drift trigger.
4. **Given** a drift event, **When** it is written, **Then** it carries the deviating metric, the baseline
   value and the observed value as numbers — never sampled content.
5. **Given** OQ-10 is open, **When** defaults are chosen, **Then** the decision is documented in
   `docs/CAPABILITIES.md`, because a misfiring default drives CM-1 directly.

---

### Story 7.13: The poison reason is persisted and shown

**As an** operator, **I want** to see why a tool was quarantined, **So that** a quarantine is not a
dead end I can only inspect by reading audit rows.

`Effort: S` · `Files: core/integrity.py (list_status, record_sighting), supabase/migrations/0026_integrity_v2.sql, api/integrity.py, frontend/app/(app)/integrity/page.tsx (new), tests/test_integrity_api.py` · `FRs: FR-68`

**Acceptance Criteria**
1. **Given** a tool quarantined as poisoned, **When** the fingerprint row is written, **Then**
   `poison_reason` is persisted.
2. **Given** `GET /v1/tools/integrity`, **When** it is called, **Then** the `poison` status and its reason
   are returned — the status stops existing only transiently at listing time.
3. **Given** the reason text, **When** it is stored, **Then** it is an enumerated detector code plus bounded
   metadata, never the raw injected description. ⚠ **INVARIANT: CLAUDE.md §4.10.**
4. **Given** a quarantined tool, **When** an agent lists tools, **Then** the tool is not exposed and calls to
   it are denied until a human re-baselines it (fail-closed, unchanged).

---

### Story 7.14: Capture the outcome of an allowed action

**As an** operator, **I want** the downstream result status recorded, **So that** an agent whose
failure rate jumps is visible.

`Effort: S` · `Files: gateway/server.py, core/provenance.py, core/audit.py, tests/test_downstream_proxy.py` · `FRs: FR-69`

**Acceptance Criteria**
1. **Given** an allowed action relayed downstream, **When** it returns, **Then** `outcome_status` is written
   as one of `ok`, `downstream_error`, `timeout` or `not_executed`.
2. **Given** the downstream result, **When** it is processed, **Then** only status and error **class** are
   recorded — **never** the result body. ⚠ **INVARIANT: CLAUDE.md §4.10.**
3. **Given** a held or denied action, **When** its entry is written, **Then** `outcome_status` is
   `not_executed`.
4. **Given** the `result.isError` flag currently computed and thrown away, **When** this story lands, **Then**
   it is the source of the status.

---

### Story 7.15: Outcome rates per agent and tool

**As an** operator, **I want** success, failure and refusal rates, **So that** a degrading agent is
visible without a query.

`Effort: M` · `Files: core/baseline.py, api/agents.py, frontend/app/(app)/home/page.tsx, core/otlp_genai.py (is_refusal), tests/test_baseline.py` · `FRs: FR-70`

**Acceptance Criteria**
1. **Given** recorded outcomes, **When** rates are derived, **Then** success, failure and refusal rates are
   available per agent and per tool over a selectable window.
2. **Given** refusal detection, **When** it classifies, **Then** it uses the existing documented,
   deterministic classifier over error type — never a judgement of output quality.
3. **Given** a jump in failure rate, **When** the console renders, **Then** it is visible on the agent's
   view.

---

### Story 7.16: The product states what it does not measure

**As an** honest vendor, **I want** the console to name what outcome supervision is not, **So that** a
buyer does not mistake it for model evaluation.

`Effort: S` · `Files: frontend/app/(app)/home/page.tsx, docs/CAPABILITIES.md, frontend/lib/i18n.tsx, tests/test_docs_placeholders.py` · `FRs: FR-73`

**Acceptance Criteria**
1. **Given** the outcome surface, **When** it renders, **Then** it explicitly states that no groundedness
   score, hallucination metric or golden-set evaluation is produced, and recommends an evaluation tool
   for that job.
2. **Given** the codebase, **When** it is searched, **Then** no quality, groundedness or hallucination
   scoring exists (PRD §5.2).
3. **Given** `docs/CAPABILITIES.md`, **When** it is read, **Then** the same limit is stated in the honest
   not-covered rows.

---

## Epic 8: Universal Ingress — SDK and framework adapters

**Goal.** "We govern your agents" must not mean "we govern the subset that uses MCP." Sofia's
LangGraph agent (UJ-2) comes under the same policy with four lines and no rewrite of her tool layer —
and the console tells her plainly that this path is **cooperative**, not mandatory. Target
**SM-10: ≥ 25%** of supervised calls arriving through the SDK or adapters.

**The invariant this epic must not break:** the framework *asks*, xSOM *decides and records*. A
framework never becomes the authority (CLAUDE.md §4.1).

---

### Story 8.1: The Python client SDK

**As** an agent engineer, **I want** one call that asks for a decision, **So that** I add supervision
without writing policy logic.

`Effort: M` · `Files: sdk/python/xsom_guard/ (new), sdk/python/pyproject.toml (new), sdk/python/tests/ (new), docs/CAPABILITIES.md` · `FRs: FR-48`

**Acceptance Criteria**
1. **Given** the client, **When** its surface is inspected, **Then** it is one call —
   `authorize(tool, args, ctx) -> Decision` — over `/v1/authorize`, returning verdict, reason, risk band,
   enforcement mode, guards run and (when held) an approval id.
2. **Given** the client source, **When** it is reviewed, **Then** it contains **no policy logic** — the
   decision is always the server's. ⚠ **INVARIANT: CLAUDE.md §4.1.**
3. **Given** a held decision, **When** the caller inspects it, **Then** the approval id is surfaced so the
   caller's own framework can park the run.
4. **Given** the SDK, **When** it is packaged, **Then** it depends only on an HTTP client already in the
   imposed stack.

---

### Story 8.2: The TypeScript client SDK

**As** a Node/TypeScript agent engineer, **I want** the same one call, **So that** my stack is not a
second-class citizen.

`Effort: M` · `Files: sdk/typescript/ (new: src/index.ts, package.json, tsconfig.json, tests)` · `FRs: FR-48`

**Acceptance Criteria**
1. **Given** the TypeScript client, **When** its surface is compared to the Python one, **Then** the call
   shape, the returned fields and the failure semantics are identical.
2. **Given** strict TypeScript, **When** the package is built, **Then** `tsc` passes with the repository's
   strict settings.
3. **Given** a contract test fixture shared with the Python SDK, **When** both run it, **Then** both produce
   the same decision object from the same server response.

---

### Story 8.3: Client-side fail-closed by default

**As a** security engineer, **I want** the SDK to deny risky actions when it cannot reach xSOM, **So
that** a network partition is not an implicit allow.

`Effort: S` · `Files: sdk/python/xsom_guard/, sdk/typescript/src/index.ts, docs/CAPABILITIES.md` · `FRs: FR-49`

**Acceptance Criteria**
1. **Given** a network failure or an ambiguous response, **When** the action class is `irreversible` or
   `external_send`, **Then** the client denies by default.
   ⚠ **INVARIANT: CLAUDE.md §4.4 / NFR-2.**
2. **Given** an operator who wants a different behaviour, **When** they enable it, **Then** it requires an
   explicit, documented opt-in that the client **logs loudly at startup**.
3. **Given** the opt-in is enabled, **When** a decision is made locally, **Then** the client marks it as
   unsupervised in its return value so the caller cannot mistake it for a verdict.

---

### Story 8.4: The LangGraph / LangChain adapter

**As** Sofia, **I want** four lines to route my graph's human-in-the-loop hook to xSOM, **So that**
eleven previously ungoverned tools become policy-controlled with no change to my tool code.

`Effort: M` · `Files: sdk/python/xsom_guard/adapters/langgraph.py (new), sdk/python/tests/test_langgraph_adapter.py (new), docs/CAPABILITIES.md` · `FRs: FR-50`

**Acceptance Criteria**
1. **Given** the adapter, **When** it is wired into a graph's pre-tool hook, **Then** every tool call asks
   xSOM for a decision before executing.
2. **Given** a held decision, **When** the adapter returns, **Then** it surfaces the approval id so the graph
   parks the run exactly the way its native interrupt does; on approval the run resumes.
3. **Given** the adapter, **When** it is reviewed, **Then** it is **transport only** — it never decides, and
   the resulting audit entries are marked `enforcement_mode=cooperative`.
   ⚠ **INVARIANT: CLAUDE.md §4.1** — the resolution of the framework-owns-HITL collision.
4. **Given** an integration test with a mock server, **When** an irreversible tool is called and denied,
   **Then** the tool implementation is never invoked.

---

### Story 8.5: OpenAI Agents SDK, Claude Agent SDK and CrewAI adapters

**As an** agent engineer on any mainstream framework, **I want** an adapter for my stack, **So that**
coverage is genuinely exhaustive rather than MCP-shaped.

`Effort: L` · `Files: sdk/python/xsom_guard/adapters/{openai_agents,claude_agent,crewai}.py (new), sdk/python/tests/, docs/CAPABILITIES.md` · `FRs: FR-50`

**Acceptance Criteria**
1. **Given** each adapter, **When** it is wired to its framework's approval callback or pre-tool hook,
   **Then** the framework asks xSOM and obeys the returned verdict.
2. **Given** each adapter, **When** tested against a mock decision server, **Then** a denied irreversible
   call never reaches the tool implementation.
3. **Given** all adapters, **When** their entries are audited, **Then** every one is marked
   `enforcement_mode=cooperative`.
4. **Given** each adapter, **When** reviewed, **Then** it shares the single client from Story 8.1 and adds
   no decision logic of its own.

---

### Story 8.6: Honest strength labelling

**As** Sofia, **I want** the product to tell me plainly that this path is weaker, **So that** I can
choose the mandatory path for production rather than discover the difference later.

`Effort: S` · `Files: docs/CAPABILITIES.md, README.md, frontend/app/(app)/onboarding/page.tsx, frontend/lib/i18n.tsx, frontend/e2e/smoke.spec.ts` · `FRs: FR-51`

**Acceptance Criteria**
1. **Given** the documentation and the console, **When** either describes the SDK path, **Then** both state
   plainly that SDK-mediated enforcement is **cooperative** and that the MCP gateway is **mandatory**.
2. **Given** an irreversible-heavy workload, **When** the onboarding wizard recommends a path, **Then** it
   recommends MCP.
3. **Given** an evidence pack, **When** cooperative decisions appear, **Then** they are labelled and are
   **never** presented as equivalent to mandatory oversight (C-7, pending OQ-3).
4. **Given** a response on a cooperative path, **When** it is returned, **Then** the header states the mode
   — a customer can determine their integration's strength from the response alone.

---

## Epic 9: Policy Lifecycle — versions, diff, rollback, simulation

**Goal.** A policy document is currently one row, overwritten in place: the prior text is destroyed,
decisions cannot be joined to the policy that produced them, and there is no rollback, diff or
simulation. This epic makes policy an append-only, versioned, testable artifact — which is also what
makes `policy_version` on an audit entry resolve to something immutable. Target **SM-11: < 10 min**
mean time to revert a bad policy.

---

### Story 9.1: Immutable policy versions

**As a** tenant admin, **I want** every accepted policy change retained, **So that** the document in
force at any past moment is recoverable.

`Effort: M` · `Files: core/policy_versions.py (new), core/policy_store.py, supabase/migrations/0020_policy_versions.sql (new), api/policy.py, tests/test_policy_api.py` · `FRs: FR-8`

**Acceptance Criteria**
1. **Given** `policy_versions(tenant_id, version, yaml, author, note, scope, created_at)`, **When** it is
   created, **Then** it carries RLS, a unique `(tenant_id, version)` constraint, and the same
   UPDATE/DELETE blocking trigger pattern as `audit_log` — a published version can never be edited.
   ⚠ **INVARIANT: CLAUDE.md §4.2 (append-only discipline extended).**
2. **Given** `core/policy_store.py::save_yaml`, **When** a policy is saved, **Then** it **appends** a version
   and updates `tool_policies.active_version`; nothing is destroyed.
3. **Given** the existing single-row hot path, **When** `load_policy` runs, **Then** it remains a single-row
   read — versioning must not add latency to the decision path (NFR-3).
4. **Given** `GET /v1/policy/versions`, **When** it is called, **Then** it lists history with author, note
   and timestamp, and version numbers are monotonic per tenant.
5. **Given** the migration, **When** it is applied, **Then** the current policy row is backfilled as version
   N with `active_version = N`.

---

### Story 9.2: The policy version in force is stamped on every decision

**As** Tom, **I want** to know which rules were live when something happened, **So that** the question
is answerable by a join rather than by memory.

`Effort: S` · `Files: core/pipeline.py, core/provenance.py, core/policy_store.py, tests/test_audit.py` · `FRs: FR-9`

**Acceptance Criteria**
1. **Given** any decision, **When** its entry is written, **Then** `policy_version` is populated from the
   version actually loaded for that evaluation.
2. **Given** the frozen payload, **When** this story lands, **Then** `policy_version` is an **annex column**
   — adding it to the hashed payload would break `verify_chain` on existing rows.
   ⚠ **INVARIANT: CLAUDE.md §4.2**; tamper-evidence comes from checkpoints (Story 3.4), and AT-4 states
   this limit explicitly.
3. **Given** the audit explorer, **When** a row is opened, **Then** the policy version links to the version
   document and to its diff against the current one.

---

### Story 9.3: Structured diff and append-only rollback

**As** a tenant admin who published a bad policy, **I want** to see exactly what changed and to revert
in one action, **So that** recovery takes minutes.

`Effort: M` · `Files: core/policy_diff.py (new), api/policy.py, core/control_events.py, frontend/app/(app)/admin/page.tsx, tests/test_policy_diff.py (new)` · `FRs: FR-10`

**Acceptance Criteria**
1. **Given** `GET /v1/policy/diff?from=&to=`, **When** it is called, **Then** it returns a **rule-level**
   structured diff (rules added, removed, tier changed, constraints changed, defaults changed) — not a
   text diff.
2. **Given** `POST /v1/policy/rollback/{version}`, **When** it is called, **Then** it **appends** a new
   version copying the prior document; history is never rewritten.
3. **Given** either operation, **When** it succeeds, **Then** a control-plane event is written with the
   version numbers and a diff digest, never the YAML body.
4. **Given** SM-11, **When** measured, **Then** publish-to-rollback elapsed time is derivable from the
   control-plane events alone.

---

### Story 9.4: Policy simulation that is honest about what it cannot know

**As** Tom, **I want** to see which historical decisions a candidate policy would change, **So that**
I tighten a rule with evidence instead of hope.

`Effort: L` · `Files: core/policy_sim.py (new), api/policy.py, frontend/app/(app)/admin/page.tsx, tests/test_policy_sim.py (new)` · `FRs: FR-11`

**Acceptance Criteria**
1. **Given** `POST /v1/policy/simulate` with a candidate document, **When** it runs, **Then** it evaluates
   the candidate against the last N audit entries and returns a per-tool delta of
   unchanged / relaxed / tightened.
2. **Given** simulation, **When** it runs, **Then** it is **read-only** and executes no action, contacts no
   downstream server, and writes no decision record. ⚠ **INVARIANT: G-S2.**
3. **Given** argument-dependent guards (constraints, risk, DLP) and the fact that arguments are not
   stored, **When** simulation encounters them, **Then** the affected rows are marked **`indeterminate`**
   rather than guessed.
4. **Given** the response, **When** it renders, **Then** it states plainly that `indeterminate` rows would
   require the (deferred, opt-in) argument vault to resolve — the limit is disclosed, not implied.
5. **Given** the endpoint, **When** it is called, **Then** it is rate-limited and bounded in N.

---

### Story 9.5: Policy history and version surface in the console

**As a** tenant admin, **I want** version history, diff and rollback in the console, **So that** the
lifecycle is operable without curl.

`Effort: M` · `Files: frontend/app/(app)/admin/page.tsx, frontend/components/ (new PolicyVersions.tsx), api/policy.py, frontend/lib/i18n.tsx, frontend/e2e/smoke.spec.ts` · `FRs: FR-8, FR-10`

**Acceptance Criteria**
1. **Given** the policy page, **When** it renders, **Then** it lists versions with author, note, timestamp
   and active marker.
2. **Given** two selected versions, **When** diff is requested, **Then** the rule-level diff renders with
   tightened and relaxed changes visually distinguished.
3. **Given** a prior version, **When** rollback is clicked, **Then** it requires a confirmation and a note,
   and the result appears as a **new** version at the top of the list.
4. **Given** a `viewer` role, **When** the page renders, **Then** history is readable and rollback is
   refused server-side, not merely hidden.

---

## Epic 10: Budgets, Limits and Cost Correctness

**Goal.** Cost is measured with precision and enforced not at all; the only throttle is keyed by
client IP with no shared storage, so it is per-process, punishes tenants behind one egress IP, and is
bypassed entirely by a tenant with many. This epic makes consumption a control: tenant-keyed limits,
enforced budgets that fail closed, audited budget changes, and a cost number finance can trust.

---

### Story 10.1: Rate limiting keys on the principal, with optional shared storage

**As a** platform operator, **I want** limits keyed on the tenant or agent and correct across
replicas, **So that** the limiter protects the system rather than punishing the wrong customer.

`Effort: M` · `Files: api/ratelimit.py, api/security.py, api/main.py, core/config.py, docs/CAPABILITIES.md, tests/test_ratelimit.py` · `FRs: FR-74`

**Acceptance Criteria**
1. **Given** an authenticated surface, **When** a request arrives, **Then** the limiter's `key_func` reads
   the resolved principal (tenant or agent) that the auth dependency places on `request.state`.
2. **Given** an unauthenticated surface, **When** a request arrives, **Then** the remote address remains
   the key.
3. **Given** `RATE_LIMIT_STORAGE_URI`, **When** it is set, **Then** it is passed through to slowapi's
   existing `storage_uri` parameter and two API replicas share one bucket — proven by a test with two
   app instances against one store.
4. **Given** single-node compose with no storage URI, **When** the system runs, **Then** it degrades to
   in-process limiting and the degradation is **documented, not silent** (A-7, G-S6, G-C4).
   ⚠ **INVARIANT: CLAUDE.md §3** — no new required service.
5. **Given** every rate-limited route, **When** the API specification is generated, **Then** its limit and
   keying dimension are published (API-6).

---

### Story 10.2: Budgets are defined and enforced

**As a** finance-accountable operator, **I want** a spend or volume ceiling that actually stops
things, **So that** measuring cost precisely while enforcing nothing ends.

`Effort: L` · `Files: core/budgets.py (new), api/budgets.py (new), supabase/migrations/0024_budgets.sql (new), core/pipeline.py, api/llm_proxy.py, api/main.py, tests/test_budgets.py (new)` · `FRs: FR-75`

**Acceptance Criteria**
1. **Given** `budgets(tenant_id, scope, scope_ref, period, cap_usd, warn_pct, action)`, **When** it is
   created, **Then** it carries RLS with a two-tenant test and bounded, validated fields.
2. **Given** consumption, **When** it is computed, **Then** it is derived from `usage_events` — **no second
   ledger**.
3. **Given** a budget breached with `action=deny`, **When** a model call or a costly action is attempted,
   **Then** it is denied before the call is forwarded, with `decision_reason=budget`.
   ⚠ **INVARIANT: CLAUDE.md §4.4 / G-C3.**
4. **Given** the warn threshold, **When** it is crossed, **Then** an alert fires and nothing is blocked.
5. **Given** the budget guard runs inside the pipeline, **When** it executes, **Then** it uses the
   connection the pipeline already holds (NFR-3).
6. **Given** the budget state cannot be read, **When** an `irreversible` or `external_send` action arrives,
   **Then** it is denied (Story 5.4's matrix).

---

### Story 10.3: Budget changes are audited and budget denials explain themselves

**As an** agent owner, **I want** "why did my agent stop?" answerable without a support ticket, **So
that** enforcement is legible.

`Effort: S` · `Files: api/budgets.py, core/control_events.py, core/provenance.py, frontend/app/(app)/audit/page.tsx, tests/test_budgets.py` · `FRs: FR-76`

**Acceptance Criteria**
1. **Given** any budget create, update or delete, **When** it succeeds, **Then** a control-plane event is
   written with the scope and the before/after digest.
2. **Given** a budget-caused denial, **When** its entry is written, **Then** `decision_reason=budget` and
   the audit explorer renders it as such.
3. **Given** the agent-facing response, **When** a budget denial is returned, **Then** it names the budget
   scope and the period — never another tenant's data and never a spend figure the caller may not see.

---

### Story 10.4: Cost correctness — cache and reasoning tokens priced distinctly

**As a** finance stakeholder, **I want** cached and reasoning tokens priced correctly, **So that** the
number I am shown is not systematically wrong.

`Effort: M` · `Files: core/pricing.py, core/usage.py, core/otlp_genai.py, supabase/migrations/0027_usage_v2.sql (new), frontend/app/(app)/costs/page.tsx, tests/test_pricing.py` · `FRs: FR-77`

**Acceptance Criteria**
1. **Given** `usage_events`, **When** the migration is applied, **Then** it gains cache-read,
   cache-creation and reasoning token columns, each defaulting to zero so historical rows are unchanged.
2. **Given** cache-heavy traffic, **When** cost is computed, **Then** cache-read tokens are priced
   separately and the total no longer systematically overstates spend.
3. **Given** the costs page, **When** it renders, **Then** **estimated** and **provider-billed** figures are
   displayed side by side and labelled (G-C6).
4. **Given** a provider whose pricing is unknown, **When** cost is computed, **Then** the figure is marked
   as unavailable rather than silently defaulted to zero.

---

### Story 10.5: The budgets console page

**As an** operator, **I want** to see and set budgets in the console, **So that** the control is
usable by the person accountable for it.

`Effort: M` · `Files: frontend/app/(app)/budgets/page.tsx (new), frontend/components/AppShell.tsx, api/budgets.py, frontend/lib/i18n.tsx` · `FRs: FR-75, FR-110`

**Acceptance Criteria**
1. **Given** the page, **When** it renders, **Then** it lists budgets by scope with period, cap, current
   consumption, warn threshold and breach action.
2. **Given** an admin, **When** they create or edit a budget, **Then** the form validates bounds client-side
   and the server re-validates (never trusting the client).
3. **Given** a breached budget, **When** the page renders, **Then** it is visibly flagged and links to the
   denied entries in the audit explorer.
4. **Given** a non-admin, **When** they open the page, **Then** they can read and cannot write, enforced
   server-side.

---

## Epic 11: Evidence Packs and Data Governance

**Goal.** The compliance plane assembles genuine evidence and renders almost none of it: the exported
PDF drops the entire articles block, retention is reported compliant from a configuration constant
while never being enforced, and oversight coverage is computed with no tenant predicate. This epic
ships the evidence, declares every column the product stores, and makes the erasure and purge
primitives — which today have zero callers outside their own tests — operable and audited.

---

### Story 11.1: Compliance computation takes an explicit tenant predicate

**As a** compliance officer, **I want** every compliance query scoped to my tenant in the query
itself, **So that** correctness does not rest on a caller convention.

`Effort: S` · `Files: core/compliance.py (oversight_coverage, oldest_entry_age_days), api/compliance.py, tests/test_compliance.py` · `FRs: FR-129`

**Acceptance Criteria**
1. **Given** `oversight_coverage`, **When** it is called, **Then** it takes an explicit `tenant_id`
   parameter and applies a `where` predicate — the current unscoped query is gone.
2. **Given** two tenants with different oversight histories, **When** each requests status, **Then** counts
   do not bleed, proven by a two-tenant test.
3. **Given** the RLS boundary, **When** this story lands, **Then** the predicate is documented as **defence
   in depth**, not a replacement for RLS. ⚠ **INVARIANT: CLAUDE.md §4.3.**
4. **Given** every other compliance query, **When** enumerated, **Then** each takes the same explicit
   predicate, so the current asymmetry with `chain_integrity` is removed.

---

### Story 11.2: Human oversight evidence is sourced from the chain

**As** Anne-Laure, **I want** the oversight table built from hash-chained entries, **So that** the one
part of the pack with no tamper-evidence gains it.

`Effort: M` · `Files: core/compliance.py, core/export.py, tests/test_compliance.py` · `FRs: FR-128`

**Acceptance Criteria**
1. **Given** the evidence pack's oversight section, **When** it is assembled, **Then** every row is sourced
   from `audit_log` entries with `actor_type='human'` — not from the mutable approvals table.
2. **Given** the approvals table, **When** it is used, **Then** it is a **convenience index** only, and the
   distinction is stated in the pack.
3. **Given** an approval decided before Story 4.6 landed, **When** the pack is generated, **Then** the row
   is included with an explicit note that it predates chained decision-time recording — honest, not
   silently backfilled. ⚠ **INVARIANT: CLAUDE.md §4.2** — no historical entry is created or edited.

---

### Story 11.3: Retention is reported from observation, and the purge actually runs

**As a** regulator-facing officer, **I want** retention status derived from data, **So that** I never
present a configuration constant as an operational fact.

`Effort: M` · `Files: core/compliance.py (enforce_retention_purge, status), core/jobs.py, supabase/migrations/0028_retention_and_holds.sql (new), api/compliance.py, tests/test_compliance.py` · `FRs: FR-130`

**Acceptance Criteria**
1. **Given** the worker, **When** the retention job runs, **Then** it calls the existing
   `enforce_retention_purge` (which has zero callers today) and records the run in `retention_runs`.
2. **Given** compliance status, **When** it reports retention, **Then** the value derives from the **oldest
   observed entry** and the **last executed purge**, never from the configured retention setting.
3. **Given** a purge that would go below the 183-day floor, **When** it is attempted, **Then** it is refused
   (fail-closed) and the refusal is recorded. ⚠ **INVARIANT: CLAUDE.md §4.4 / DG-3.**
4. **Given** no purge has ever run, **When** status is computed, **Then** it reports amber with the reason
   "no purge executed", never green.
5. **Given** a legal hold in scope, **When** the purge runs, **Then** the held rows are skipped and the skip
   is recorded.

---

### Story 11.4: Evidence packs contain the evidence

**As** Claire the compliance officer, **I want** the export to contain the assembled sections and the
hash-bearing appendix, **So that** a regulator receives evidence rather than a cover page.

`Effort: L` · `Files: core/export.py (render_pdf, build_report), core/compliance.py, api/compliance.py, tests/test_compliance_api.py` · `FRs: FR-127`

**Acceptance Criteria**
1. **Given** the renderer, **When** it runs, **Then** it walks the assembled pack rather than five top-level
   keys, and the `articles`, `human_supervision` and `compliant` blocks it currently drops are rendered.
2. **Given** a rendered pack, **When** it is inspected, **Then** it contains: a chain-integrity section with
   status, entry count, **head hash**, period and retention; a human-oversight section with a
   per-approval table naming approvers, decision times and outcomes; a deployer section; and an appendix
   of hash-bearing entries.
3. **Given** the FRIA or any scaffolded assessment, **When** it renders, **Then** it carries an **"unsigned
   draft"** banner on its face.
4. **Given** an AI System, **When** a pack is exported, **Then** it renders **per system**, with a
   tenant-level aggregate available but not the unit of governance (C-8).
5. **Given** a test over the rendered bytes, **When** it runs, **Then** it asserts the presence of the
   section headings, the head hash and the per-approval table — the current silent drop cannot recur.

---

### Story 11.5: No generated prose stands as or beside a control verdict

**As an** auditor, **I want** every control verdict computed deterministically, **So that** an LLM
never appears to be making a compliance assertion.

`Effort: S` · `Files: core/export.py, core/compliance.py, core/judge.py, tests/test_compliance.py` · `FRs: FR-118`

**Acceptance Criteria**
1. **Given** any control verdict in a pack, **When** it is produced, **Then** it is computed from data by
   deterministic code with no LLM involvement. ⚠ **INVARIANT: CLAUDE.md §4.1 / NFR-1.**
2. **Given** a narrative section, **When** it is rendered, **Then** it is visibly labelled as generated and
   is separated from every verdict.
3. **Given** a test, **When** the LLM judge is made unavailable, **Then** every control verdict in the pack
   is still produced and identical.

---

### Story 11.6: Multi-framework mapping from one evidence base

**As** Claire, **I want** the same evidence rendered against the framework my auditor uses, **So that**
I do not run five collection programmes.

`Effort: L` · `Files: core/frameworks.py (new), core/export.py, api/compliance.py, tests/test_frameworks.py (new)` · `FRs: FR-131`

**Acceptance Criteria**
1. **Given** `core/frameworks.py`, **When** it is read, **Then** it is a **declarative** table mapping
   evidence artifact → control id for EU AI Act, GDPR, ISO/IEC 42001, NIST AI RMF and SOC 2.
2. **Given** `GET /v1/compliance/export?framework=…`, **When** each framework is requested, **Then** the
   same underlying evidence renders against that catalogue with a per-control **pass/gap** table.
3. **Given** a control with insufficient evidence, **When** it renders, **Then** it renders as a **gap**, and
   no verdict is asserted beyond what the data supports.
4. **Given** the mapping, **When** this story lands, **Then** it introduces **no new collection and no new
   tables** — mapping and rendering only.

---

### Story 11.7: The compliance console page, per AI System

**As** Claire, **I want** compliance in the console and not only in an API, **So that** I can see gaps
and fix them without engineering help.

`Effort: M` · `Files: frontend/app/(app)/compliance/page.tsx (new), frontend/components/AppShell.tsx, api/compliance.py, frontend/lib/i18n.tsx` · `FRs: FR-127, FR-110`

**Acceptance Criteria**
1. **Given** the page, **When** it renders, **Then** it shows, per registered AI System: chain integrity with
   head hash and period, observed retention status, oversight coverage and the deployer summary.
2. **Given** an amber item, **When** it renders, **Then** it states what is missing and links to the fix.
3. **Given** a framework selector, **When** a framework is chosen and export is clicked, **Then** the pack
   downloads and the data manifest is downloadable beside it.
4. **Given** the tenant aggregate, **When** it renders, **Then** it is clearly labelled as an aggregate, not
   the unit of governance.

---

### Story 11.8: The Data Manifest — every table and column declared

**As a** DPO, **I want** a column-by-column statement of what is stored and why, **So that** I hand
over a manifest instead of a paragraph of marketing.

`Effort: M` · `Files: core/data_manifest.py (new), api/data.py (new), docs/DATA_MANIFEST.md (new), api/main.py, tests/test_data_manifest.py (new)` · `FRs: FR-133`

**Acceptance Criteria**
1. **Given** a freshly migrated database, **When** the inventory is built, **Then** it is **generated** from
   `information_schema.columns`, never hand-maintained.
2. **Given** each column, **When** the manifest renders, **Then** it carries a declared classification from
   `identifier | metadata | hash | derived | free_text | encrypted`, a retention, a lawful basis, and
   whether it can contain customer text (DG-2).
3. **Given** `GET /v1/data/manifest` and `docs/DATA_MANIFEST.md`, **When** both are read, **Then** they are
   generated from the same source and agree.
4. **Given** `free_text` columns, **When** enumerated, **Then** only the intentional ones (human
   justifications and operator notes) appear, and every other free-text-capable field is bounded and
   scanned or reclassified.

---

### Story 11.9: The manifest is enforced in CI

**As a** privacy reviewer, **I want** the build to fail on an undeclared column, **So that** "we never
store content" is an enforced invariant rather than prose.

`Effort: S` · `Files: tests/test_data_manifest.py, scripts/audit_security.py, .github/workflows/ci.yml` · `FRs: FR-134`

**Acceptance Criteria**
1. **Given** the live schema after migration, **When** the test runs, **Then** it fails if **any** column
   lacks a declaration, naming the table and column.
2. **Given** a new migration adding a column, **When** CI runs without a manifest entry, **Then** the build
   fails. ⚠ **INVARIANT: CLAUDE.md §4.10 / NFR-6.**
3. **Given** a column declared `metadata` that in fact receives free text, **When** the security audit
   script runs its pattern checks, **Then** it reports CRITICAL.

---

### Story 11.10: Erasure is operable, hold-aware and self-auditing

**As a** DPO handling an erasure request, **I want** an admin-only operation that honours legal hold
and records itself, **So that** the primitive stops being a function with no callers.

`Effort: M` · `Files: api/data.py, core/usage.py (erase_session), core/compliance.py, supabase/migrations/0028_retention_and_holds.sql, docs/DATA_MANIFEST.md, tests/test_data_api.py (new)` · `FRs: FR-135`

**Acceptance Criteria**
1. **Given** `POST /v1/data/erasure`, **When** an admin calls it, **Then** it invokes the existing erasure
   primitives over **operational tables** and returns a removed-row count.
2. **Given** `audit_log`, **When** erasure runs, **Then** it is **never** touched.
   ⚠ **INVARIANT: CLAUDE.md §4.2 — collision with the right to erasure, resolved in favour of the
   invariant.** `docs/DATA_MANIFEST.md` states the reconciliation as a product position: pseudonymised
   metadata retained under a legal-obligation basis is not erasable personal data (C-4).
3. **Given** an active legal hold covering the scope, **When** erasure is requested, **Then** it is refused
   and the refusal is recorded.
4. **Given** any erasure, **When** it executes, **Then** a control-plane event is written with the scope and
   the removed-row count — never the erased values.
5. **Given** the endpoint, **When** it is called by a non-admin, **Then** it returns 403 and RLS prevents the
   equivalent direct write.

---

### Story 11.11: Ingested telemetry is content-free by rule

**As a** customer whose instrumentation has content capture enabled, **I want** xSOM to drop content
by name, **So that** the metadata-only property is true by rule rather than by accident of
enumeration.

`Effort: M` · `Files: core/otlp_genai.py, core/dlp.py, api/ai.py, scripts/audit_security.py, tests/test_otlp_genai.py` · `FRs: FR-137`

**Acceptance Criteria**
1. **Given** an explicit denylist constant (input messages, output messages, system instructions, tool call
   arguments, tool call results, prompt, completion), **When** a span carries any of them, **Then** they are
   dropped **by name** at ingestion.
2. **Given** free-text-capable fields that are kept (error type, route), **When** they are ingested, **Then**
   they are DLP-scanned and length-bounded.
3. **Given** a test that posts a payload full of prompt content, **When** it runs, **Then** it asserts
   **nothing** content-bearing is persisted in any column.
   ⚠ **INVARIANT: CLAUDE.md §4.10 / NFR-6.**
4. **Given** `scripts/audit_security.py`, **When** it runs, **Then** it fails if any denied key name appears
   in a persisted column or an emitted payload.

---

## Epic 12: Event Egress and Alerting — SIEM, OTLP, webhooks

**Goal.** Nothing streams out today: export is pull-based and rendered for a human, alerting is one
global address for an entire deployment, and the product ingests telemetry while emitting none. This
epic makes xSOM an enrichment of the customer's existing stack rather than a fifteenth pane of glass
(JTBD-8), and fixes the silent telemetry data loss that makes a supervision product show "no AI
activity" instead of an error. Target **SM-8: ≥ 50%** of multi-agent tenants with at least one sink.

---

### Story 12.1: Event sinks, cursors and their management API

**As a** platform lead, **I want** to register a destination for the decision stream, **So that** agent
decisions reach the systems I already run.

`Effort: M` · `Files: api/sinks.py (new), core/schemas.py, supabase/migrations/0025_sinks_and_channels.sql, core/secrets.py, api/main.py, tests/test_sinks_api.py (new)` · `FRs: FR-146`

**Acceptance Criteria**
1. **Given** `event_sinks(tenant_id, kind, endpoint, secret_ref, format, filter, enabled)` and
   `sink_cursors(sink_id, last_audit_id, updated_at, failures)`, **When** created, **Then** both carry RLS
   with two-tenant isolation tests.
2. **Given** a sink secret, **When** it is stored, **Then** it is envelope-encrypted through
   `core/secrets.py` and never returned by any read endpoint.
   ⚠ **INVARIANT: CLAUDE.md §4.7.**
3. **Given** sink creation, revocation or modification, **When** it succeeds, **Then** a control-plane event
   is written.
4. **Given** every field, **When** validated, **Then** endpoint, filter and format are bounded and
   enumerated (NFR-5).
5. **Given** no sink configured, **When** the system runs, **Then** egress is **off** — the default.

---

### Story 12.2: A cursor-based, signed webhook dispatcher

**As a** platform lead, **I want** an outage to backfill rather than lose events, **So that** the feed
I depend on is complete.

`Effort: L` · `Files: core/egress.py (new), core/jobs.py, tests/test_egress.py (new), docs/AUDIT_FORMAT.md` · `FRs: FR-146`

**Acceptance Criteria**
1. **Given** the dispatcher, **When** it runs, **Then** it reads `audit_log` by **id watermark** from
   `sink_cursors` and advances the cursor only on successful delivery.
2. **Given** a sink outage, **When** the sink returns, **Then** delivery backfills from the watermark rather
   than losing events (G-C5).
3. **Given** each delivery, **When** it is signed, **Then** it uses stdlib HMAC-SHA256 with a timestamp and a
   nonce, and the signature format is published in `docs/AUDIT_FORMAT.md` — **no new dependency**.
4. **Given** delivery failures, **When** they occur, **Then** retries use exponential backoff, `failures` is
   incremented, and an alert fires past a threshold.
5. **Given** the payload, **When** it is inspected, **Then** it includes denials, holds **and gate events** —
   a feed that omits denied requests is not complete — and carries `args_hash` only, never argument
   content. ⚠ **INVARIANT: CLAUDE.md §4.10 / G-P3.**
6. **Given** the payload shape, **When** it changes, **Then** it is versioned independently of the HTTP API
   (API-7).

---

### Story 12.3: A SIEM-shaped normalised format

**As a** SecOps lead, **I want** decisions in a format my SIEM already parses, **So that** onboarding
this stream is configuration rather than a project.

`Effort: M` · `Files: core/ocsf.py (new), core/egress.py, api/audit.py, tests/test_ocsf.py (new)` · `FRs: FR-147`

**Acceptance Criteria**
1. **Given** `core/ocsf.py`, **When** it is reviewed, **Then** it is a **pure mapper** (audit row → normalised
   security event), fully unit-testable, with **no new dependency**.
2. **Given** the mapped event, **When** it is inspected, **Then** its fields are discrete and parseable:
   agent identity, tool, action class, decision, decision reason, risk band, policy version, enforcement
   mode.
3. **Given** the mapper's field list, **When** it is reviewed, **Then** it is **closed** — a test asserts no
   argument-derived string can appear in any output field, making "our stream is safe to forward because
   it contains no content by construction" a tested claim (risk R-8).
   ⚠ **INVARIANT: CLAUDE.md §4.10.**
4. **Given** both pull and push, **When** either is used, **Then** the same mapper produces the payload.

---

### Story 12.4: Trace export — one span per decision

**As a** platform lead, **I want** decisions in the trace backend I already run, **So that** xSOM
enriches my stack instead of competing with it.

`Effort: M` · `Files: core/otel_export.py (new), core/pipeline.py, core/config.py, docs/CAPABILITIES.md, tests/test_otel_export.py (new)` · `FRs: FR-148`

**Acceptance Criteria**
1. **Given** a configured trace endpoint, **When** a decision is made, **Then** one span is emitted,
   propagating the caller's trace context so the decision nests under the agent's existing trace.
2. **Given** no configured endpoint, **When** the system runs, **Then** export is **off** — the default
   (NFR-7).
3. **Given** span attributes, **When** they are set, **Then** they carry decision, action class, risk score,
   policy rule and approval id — and **never** arguments, which is also the telemetry standard's own
   default. ⚠ **INVARIANT: CLAUDE.md §4.10.**
4. **Given** the implementation, **When** it is reviewed, **Then** it emits OTLP/HTTP with a JSON content
   type over the already-present HTTP client — **no new dependency** — and the PR carries the written
   dependency justification NFR-11 requires for this capability.
5. **Given** the exporter fails or the endpoint is unreachable, **When** a decision is made, **Then** the
   decision is unaffected — export is never on the decision's critical path.

---

### Story 12.5: Alert on what matters

**As an** on-call engineer, **I want** alerts on the events I need to wake up for, **So that** the
supervision product participates in incident response.

`Effort: M` · `Files: core/notify.py, core/jobs.py, core/audit.py, core/checkpoint.py, core/baseline.py, api/sinks.py, tests/test_notify_gate.py` · `FRs: FR-150`

**Acceptance Criteria**
1. **Given** the alert catalogue, **When** each event occurs, **Then** an alert fires for: approval created;
   approval approaching expiry; tool drift or poison quarantine; tainted action; behavioural drift; chain
   verification failure; checkpoint or anchor failure; budget threshold and breach; deny-rate anomaly;
   halt and resume.
2. **Given** each alert type, **When** tested, **Then** it is **individually** testable and **individually**
   mutable per tenant.
3. **Given** an alert channel outage, **When** it occurs, **Then** decisions are unaffected and the failure
   is itself surfaced (OP-6).
4. **Given** an alert payload, **When** it is inspected, **Then** it carries metadata and links only — never
   argument content or a justification body (G-P4).

---

### Story 12.6: Telemetry ingestion tracks the current standard

**As a** customer with modern instrumentation, **I want** my spans ingested, **So that** the product
does not show "no AI activity" while silently dropping everything.

`Effort: M` · `Files: core/otlp_genai.py, supabase/migrations/0027_usage_v2.sql, tests/test_otlp_genai.py` · `FRs: FR-151`

**Acceptance Criteria**
1. **Given** a span carrying only the **current** provider attribute name, **When** it is ingested, **Then**
   it is recognised as an AI call — a regression test posts exactly this payload.
2. **Given** the deprecated attribute names, **When** they are present, **Then** they are still read
   (dual-read), in documented precedence order.
3. **Given** a span that is genuinely not an AI call, **When** it is ingested, **Then** it is **counted as
   rejected** rather than silently dropped — the current failure mode where data disappears without even
   being counted is closed.
4. **Given** detection, **When** it runs, **Then** it recognises the current operation-name attribute in
   addition to the model attributes.

---

### Story 12.7: Standard correlation keys are preferred

**As an** operator, **I want** model spend attributed to the agent whose actions are policed, **So
that** the model plane and the action plane are one story.

`Effort: S` · `Files: core/otlp_genai.py, core/usage.py, core/sessions.py, tests/test_otlp_genai.py` · `FRs: FR-152`

**Acceptance Criteria**
1. **Given** a span carrying the standard conversation identifier, **When** it is ingested, **Then** that
   identifier is preferred over the proprietary trace-state mechanism, which remains a documented
   fallback.
2. **Given** a span carrying the standard agent identifier, **When** it is ingested, **Then** usage
   attributes to that agent and joins to the same agent's decisions.
3. **Given** finish-reason and refusal signals, **When** present, **Then** they are stored and feed the
   outcome reporting of Story 7.15.
4. **Given** a session id derived from the standard key, **When** a decision is made in the same session,
   **Then** the session timeline (Story 7.8) joins the model call and the decision.

---

### Story 12.8: The sinks console page

**As a** platform lead, **I want** to manage sinks in the console, **So that** the egress capability is
operable without curl.

`Effort: S` · `Files: frontend/app/(app)/sinks/page.tsx (new), frontend/components/AppShell.tsx, api/sinks.py, frontend/lib/i18n.tsx` · `FRs: FR-146, FR-110`

**Acceptance Criteria**
1. **Given** the page, **When** it renders, **Then** it lists sinks with kind, format, enabled state, cursor
   position and recent failure count.
2. **Given** a sink secret, **When** the page renders, **Then** the secret is never displayed and can only be
   replaced, never read.
3. **Given** a failing sink, **When** it renders, **Then** it is flagged with its last error class and the
   time of the last successful delivery.
4. **Given** a non-admin, **When** they open the page, **Then** writes are refused server-side.

---

## Epic 13: Operator and Public Surface

**Goal.** Enforce the definition-of-done rule that makes the rest of the release real —
**a backend capability without a console surface has not shipped (FR-110)** — and publish the
artifacts a reviewer, an integrator and a security engineer need: an API specification, an SBOM, a
licence, a changelog, accurate documentation and an honest coverage map with not-covered rows.

---

### Story 13.1: Risk-score histogram and band preview

**As an** operator, **I want** to set risk bands from my own traffic, **So that** the flagship
graduated-autonomy feature can be tuned instead of staying off.

`Effort: M` · `Files: frontend/app/(app)/trust/page.tsx (new), api/trust.py, core/risk.py, core/baseline.py, frontend/lib/i18n.tsx` · `FRs: FR-31`

**Acceptance Criteria**
1. **Given** persisted risk scores (Story 2.6), **When** the page renders, **Then** it shows a histogram of
   observed scores per tenant and per agent over a selectable window.
2. **Given** a candidate band configuration, **When** it is previewed, **Then** the console reports **how
   many past decisions** that band would have changed, and in which direction.
3. **Given** the preview, **When** it runs, **Then** it is read-only and changes nothing until explicitly
   applied.
4. **Given** an applied band change, **When** it is saved, **Then** a control-plane event is written and the
   change is off-by-default for tenants who never opt in (NFR-7, mitigating CM-1).

---

### Story 13.2: Every shipped control has an operator surface

**As an** operator, **I want** every capability reachable from the console, **So that** a quarantined
tool is not a dead end reachable only by curl.

`Effort: M` · `Files: frontend/components/AppShell.tsx, frontend/app/(app)/{compliance,integrity,trust,sessions,control,budgets,members,sinks,systems}/page.tsx, docs/CAPABILITIES.md, tests/test_capability_surface.py (new)` · `FRs: FR-110`

**Acceptance Criteria**
1. **Given** the capability catalogue in `docs/CAPABILITIES.md`, **When** the gate test runs, **Then** every
   entry names a console route that exists, and the test fails if a capability has none.
2. **Given** the quarantine queue, **When** it renders, **Then** an operator can see the description diff and
   re-baseline a tool — the action that today requires a direct API call.
3. **Given** navigation, **When** it renders, **Then** each surface is reachable within one click of the
   shell for the roles permitted to use it.
4. **Given** a role without permission, **When** a surface renders, **Then** actions are refused
   **server-side**, never merely hidden.

---

### Story 13.3: Console language parity, English and French

**As a** French-market operator, **I want** approval and audit surfaces in French, **So that** the
launch market is served without translation gaps in the surfaces that matter.

`Effort: M` · `Files: frontend/lib/i18n.tsx, frontend/app/(app)/approvals/page.tsx, frontend/app/(app)/audit/page.tsx, frontend/e2e/smoke.spec.ts, tests (parity test)` · `FRs: FR-112`

**Acceptance Criteria**
1. **Given** the i18n catalogue, **When** a parity test runs, **Then** every key used by the approvals and
   audit surfaces exists in both English and French, and the test fails on a missing key.
2. **Given** the French locale, **When** the Decision Brief renders, **Then** every field label, including
   the "expiry = denial" wording, is translated and correct.
3. **Given** enumerated values (decision, reason, escalation source), **When** they render, **Then** they are
   displayed translated while the **stored** value remains the canonical English enum.
4. **Given** accessibility, **When** either locale renders, **Then** labels and roles are present in that
   locale (NFR-10).

---

### Story 13.4: A published API specification with a drift gate

**As an** integrator, **I want** a committed OpenAPI document, **So that** I have a machine-readable
contract even though interactive docs are correctly disabled in production.

`Effort: S` · `Files: scripts/dump_openapi.py (new), docs/openapi.json (new), .github/workflows/ci.yml, api/main.py` · `FRs: FR-139`

**Acceptance Criteria**
1. **Given** the script, **When** it runs, **Then** it writes `docs/openapi.json` from the live application.
2. **Given** CI, **When** the committed specification differs from the application's, **Then** the build
   fails — which also catches undocumented route additions.
3. **Given** `ENV=prod`, **When** the app runs, **Then** `/docs` and `/redoc` remain disabled.
   ⚠ **INVARIANT: CLAUDE.md §4.8.**
4. **Given** the specification, **When** it is read, **Then** every route is under `/v1` (or `/health*`) per
   API-1, and rate-limited routes document their limit and keying dimension.

---

### Story 13.5: SBOM, provenance and signed images

**As a** security reviewer, **I want** to enumerate dependencies without cloning, **So that** the
supply-chain story is checkable.

`Effort: M` · `Files: scripts/sbom.py (new), .github/workflows/release.yml (new), docs/` · `FRs: FR-141`

**Acceptance Criteria**
1. **Given** `scripts/sbom.py`, **When** it runs, **Then** it reads `uv.lock` with stdlib `tomllib` and
   `frontend/package-lock.json` with stdlib `json` and emits a CycloneDX JSON document — **zero new
   dependencies** for an artifact whose purpose is enumerating dependencies.
   ⚠ **INVARIANT: CLAUDE.md §3.**
2. **Given** the same inputs, **When** the script is run twice, **Then** the output is byte-identical
   (deterministic and diffable).
3. **Given** a release, **When** the workflow runs, **Then** it publishes the SBOM, a build-provenance
   attestation and signed images, all as CI actions rather than runtime dependencies.

---

### Story 13.6: Licence, changelog and semantic versioning

**As an** evaluator, **I want** to know the licence and what changed, **So that** I can take the
product to a security review at all.

`Effort: S` · `Files: LICENSE (new), CHANGELOG.md (new), pyproject.toml, docs/` · `FRs: FR-142`

**Acceptance Criteria**
1. **Given** OQ-1's resolution, **When** it is made, **Then** a `LICENSE` file exists at the repository root
   and is referenced from `README.md`.
2. **Given** `CHANGELOG.md`, **When** it is read, **Then** it records every behavioural change flagged in
   this document (chained human decisions, per-agent trust re-keying, fingerprint v2), each with its
   version.
3. **Given** the version string that has read `0.1.0` since the first milestone, **When** this story lands,
   **Then** it reflects the real release, matches Story 2.9's constant, and follows semantic versioning
   (V-1).

---

### Story 13.7: Documentation matches the shipped product

**As an** evaluator, **I want** the README and capability documentation to describe what actually
ships, **So that** undisclosed enforcement behaviour stops being a transparency defect.

`Effort: M` · `Files: README.md, docs/CAPABILITIES.md, docs/SPEC.md, docs/DEPLOY.md, tests/test_docs_placeholders.py` · `FRs: FR-143`

**Acceptance Criteria**
1. **Given** `README.md`, **When** it is read, **Then** it describes the **four**-tier policy
   (`auto`, `notify`, `human_in_the_loop`/`human_dual`, `deny`) and the current milestone range — the
   three-tier, four-milestones-stale description is corrected.
2. **Given** `docs/CAPABILITIES.md`, **When** it is read, **Then** each control maps to its module, its
   default state, what it writes to the audit log, and its published limits.
3. **Given** a control that can hold a call (risk band, taint, budget, integrity, halt), **When** the
   documentation is read, **Then** the behaviour is disclosed — an operator who was never told a control
   exists cannot consent to it.
4. **Given** the positioning, **When** it is stated, **Then** it is the intersection claim (enforced human
   approval + verifiable evidence + tool supply-chain integrity, any cloud, any framework,
   self-hostable), not the now-commoditised "we control what the agent does" alone (§12).

---

### Story 13.8: A published coverage map with honest not-covered rows

**As a** security reviewer, **I want** a map from recognised agentic-risk categories to the exact
module and test, **So that** gaps are stated rather than implied.

`Effort: S` · `Files: docs/COVERAGE.md (new), tests/test_coverage_map.py (new)` · `FRs: FR-144`

**Acceptance Criteria**
1. **Given** `docs/COVERAGE.md`, **When** it is read, **Then** each recognised agentic-risk category maps to
   the exact module **and the exact test** that covers it.
2. **Given** a category the product does not cover, **When** it appears, **Then** it is present as an honest
   **not-covered** row with the reason — including the explicit non-goals (prompt firewall, model
   evaluation, APM, DLP as a product, identity provider, ML anomaly detection).
3. **Given** the named module or test, **When** the gate test runs, **Then** it fails if a referenced module
   or test no longer exists.

---

## Epic 14: Post-v2.0 Backlog (deferred by PRD §6.2)

**Goal.** Record every deferred requirement as a real story so that nothing is silently dropped and
the FR coverage map is complete. **None of these ships in v2.0.** Each carries the PRD's stated
deferral reason; several are gated on an open question that must close first.

---

### Story 14.1: Streamed tool-call inspection

**As a** customer using streamed completions, **I want** tool calls reassembled from stream deltas,
**So that** streamed calls are at minimum classified and audited.

`Effort: M` · `Files: api/llm_proxy.py, core/pipeline.py` · `FRs: FR-5` · *Deferred: depends on the v2.0 pipeline landing first.*

**Acceptance Criteria**
1. **Given** a streamed completion containing a tool call, **When** it is proxied, **Then** the fragments are
   reassembled and an audit entry is produced.
2. **Given** a stream that cannot be paused, **When** a hold would be required, **Then** the response header
   declares `hitl=unavailable` and the entry records `enforcement_mode=cooperative` — never a silent
   degradation of hold to strip. ⚠ **INVARIANT: G-S6.**

---

### Story 14.2: Staged policy rollout

**As a** tenant admin, **I want** to canary a policy version on one agent set, **So that** I promote
tenant-wide only after evidence.

`Effort: M` · `Files: core/policy_versions.py, core/policy_store.py, api/policy.py` · `FRs: FR-12` · *Deferred: depends on policy versions (Story 9.1).*

**Acceptance Criteria**
1. **Given** a version scoped to a client or a named agent set, **When** those agents call, **Then** they
   evaluate against version N+1 while the rest of the tenant stays on N.
2. **Given** any decision, **When** it is written, **Then** the entry records which version applied to that
   agent.

---

### Story 14.3: Deterministic policy export for external review

**As an** external reviewer, **I want** the policy in a standard authorization representation, **So
that** I can review it without learning our dialect.

`Effort: L` · `Files: core/policy_export.py (new), api/policy.py` · `FRs: FR-14` · *Deferred: gated on OQ-7 (authoring language) and assumption A-1.*

**Acceptance Criteria**
1. **Given** a policy document, **When** it is exported, **Then** the representation is **generated**, never
   hand-maintained.
2. **Given** a fixture corpus, **When** the exported form is evaluated, **Then** it round-trips to the same
   decisions — and if it cannot, the export is not shipped (A-1).

---

### Story 14.4: Native protocol elicitation for approvals

**As** an MCP host user, **I want** approval requests rendered natively, **So that** the experience is
not a tool error string.

`Effort: M` · `Files: gateway/server.py` · `FRs: FR-22` · *Deferred: blocked on SDK support; assumption A-2.*

**Acceptance Criteria**
1. **Given** a conforming host, **When** an approval is required, **Then** the native input-required
   mechanism is used and the error-string form remains as a compatibility fallback.
2. **Given** either mechanism, **When** a decision is made, **Then** the verdict remains the gateway's —
   elicitation is a presentation channel only. ⚠ **INVARIANT: CLAUDE.md §4.1.**

---

### Story 14.5: Automatic containment

**As an** operator, **I want** an opt-in rule that auto-halts an agent on a defined trigger, **So
that** containment does not always wait for a human.

`Effort: M` · `Files: core/control.py, core/baseline.py, core/jobs.py` · `FRs: FR-28` · *Deferred: manual Emergency Stop must be proven in production first.*

**Acceptance Criteria**
1. **Given** a configured trigger (behavioural drift beyond threshold, budget breach, repeated poison
   quarantine), **When** it fires, **Then** the agent is halted, a control-plane event with
   `actor_type=system` is written, and notifications are sent.
2. **Given** any auto-halt, **When** it occurs, **Then** the agent is **never** auto-resumed, and the feature
   is off by default. ⚠ **INVARIANT: NFR-7 / G-S3.**

---

### Story 14.6: Tenant-scoped judge budget

**As an** operator, **I want** the judge's call cap enforced over a persistent tenant-scoped window,
**So that** the documented cost guardrail is not inert.

`Effort: M` · `Files: core/judge.py, core/pipeline.py` · `FRs: FR-34` · *Deferred: cost, not safety, consequence; sequenced right after v2.0.*

**Acceptance Criteria**
1. **Given** the HTTP paths, **When** consecutive requests are made, **Then** the cap is not reset per
   request — the counter persists in a tenant-scoped window.
2. **Given** an exhausted cap, **When** an ambiguous tool is evaluated, **Then** it over-classifies to
   `irreversible` (fail-closed, unchanged). ⚠ **INVARIANT: CLAUDE.md §4.4 / G-C1.**

---

### Story 14.7: Scoped child credentials

**As an** orchestrator author, **I want** to mint a short-lived child credential with a strict subset
of my authority, **So that** delegation is bounded by construction.

`Effort: L` · `Files: core/tenant_tokens.py, core/pipeline.py, api/gateway_tokens.py` · `FRs: FR-44` · *Deferred: requires its own ADR; lineage capture (Story 7.5) delivers the audit value.*

**Acceptance Criteria**
1. **Given** a child credential, **When** it requests an action, **Then** it can never exceed its parent's
   approval tier for any action class; an attempt is denied and audited.
2. **Given** a policy `call_depth` cap, **When** it is exceeded, **Then** the call fails closed.
   ⚠ **INVARIANT: CLAUDE.md §4.4.**

---

### Story 14.8: Federated agent identity

**As a** platform engineer, **I want** agents to authenticate with short-lived workload identities,
**So that** per-tool RBAC binds to a verified identity rather than a static token row.

`Effort: L` · `Files: api/security.py, core/tenant_tokens.py, core/pipeline.py` · `FRs: FR-45` · *Deferred: assumption A-4 unvalidated.*

**Acceptance Criteria**
1. **Given** an IdP-issued workload identity, **When** an agent authenticates, **Then** RBAC binds to the
   verified identity.
2. **Given** static tokens, **When** they remain in use, **Then** they are supported and marked in the
   console as long-lived credentials with a rotation reminder (Story 6.8).

---

### Story 14.9: Standards-shaped decision façade

**As an** integrator, **I want** a standardised pre-tool-call request and verdict shape, **So that** I
can adopt xSOM without a bespoke contract.

`Effort: M` · `Files: api/interop.py (new)` · `FRs: FR-52` · *Deferred: target specifications are working drafts (A-5, OQ-8).*

**Acceptance Criteria**
1. **Given** the façade, **When** it maps tiers, **Then** the mapping is deterministic and documented
   (`notify` → warn; `human_in_the_loop`/`human_dual` → escalate).
2. **Given** the façade, **When** it is reviewed, **Then** it adds **no new decision logic** — the bespoke
   API remains the primary contract.

---

### Story 14.10: Full stateless-transport conformance

**As a** maintainer, **I want** conformance to the stateless protocol revision, **So that** the
gateway keeps working as the ecosystem moves.

`Effort: L` · `Files: gateway/server.py, pyproject.toml (SDK pin)` · `FRs: FR-55` · *Deferred: blocked on SDK support; v2.0 ships the forward-compatibility discipline (Story 7.7) instead.*

**Acceptance Criteria**
1. **Given** an SDK bump, **When** it is proposed, **Then** the conformance test is written **before** the
   bump and Story 7.7's test is a required gate (V-9).
2. **Given** the new transport, **When** a session is unresolvable, **Then** it is treated as tainted, never
   as clean. ⚠ **INVARIANT: CLAUDE.md §4.4.**

---

### Story 14.11: DLP participates in post-taint decisions

**As a** security engineer, **I want** an exfiltration-shaped target after taint to raise the verdict,
**So that** the taint guard and the egress guard reinforce each other.

`Effort: M` · `Files: core/dlp.py, core/pipeline.py` · `FRs: FR-64` · *Deferred: additive refinement once persisted taint exists.*

**Acceptance Criteria**
1. **Given** a post-taint `external_send` whose recipient is outside the allowlist, **When** it is
   evaluated, **Then** the verdict is escalated with `decision_reason=dlp`.
2. **Given** detection, **When** it runs, **Then** it is metadata-only and matched values are never stored.
   ⚠ **INVARIANT: CLAUDE.md §4.10.**

---

### Story 14.12: Behavioural drift feeds the risk score

**As an** operator, **I want** drift to contribute a graduated factor rather than a binary novelty
bit, **So that** the score reflects observed behaviour.

`Effort: M` · `Files: core/risk.py, core/baseline.py` · `FRs: FR-67` · *Deferred: additive once baselines exist.*

**Acceptance Criteria**
1. **Given** measured drift, **When** the score is computed, **Then** the contribution is deterministic and
   bounded, and the novelty factor remains for genuinely first-seen pairs.
2. **Given** drift alone, **When** no band is configured, **Then** it cannot push an action to `deny`
   (NFR-7).

---

### Story 14.13: Operator incident labelling

**As an** operator, **I want** to label a decision or session as an incident, **So that** review has a
handle on the record.

`Effort: M` · `Files: api/audit.py, core/control_events.py, frontend/app/(app)/audit/page.tsx` · `FRs: FR-71` · *Deferred: needs UX definition.*

**Acceptance Criteria**
1. **Given** a label with a bounded category and note, **When** it is applied, **Then** a control-plane event
   is written.
2. **Given** the labelled record, **When** it is read, **Then** the label **annotates** and never alters the
   decision record. ⚠ **INVARIANT: CLAUDE.md §4.2.**

---

### Story 14.14: Post-incident linkage

**As an** incident reviewer, **I want** labelled incidents linked to policy version, agent, session and
approval, **So that** the review is one saved query.

`Effort: S` · `Files: api/sessions.py, api/audit.py, frontend` · `FRs: FR-72` · *Deferred: follows Story 14.13.*

**Acceptance Criteria**
1. **Given** a labelled incident, **When** the incident view renders, **Then** it is a saved query over
   existing lineage — **no new data plane**.
2. **Given** any link, **When** it cannot be established, **Then** the view states so rather than inferring.

---

### Story 14.15: Connection pooling

**As a** platform operator, **I want** a process-wide connection pool, **So that** the control API
stops opening a connection per operation.

`Effort: M` · `Files: core/db.py, pyproject.toml` · `FRs: FR-78` · *Deferred: performance, not a v2.0 promise; needs a dependency justification (A-8).*

**Acceptance Criteria**
1. **Given** the pool, **When** it is introduced, **Then** call sites are unchanged and the PR carries the
   written dependency justification NFR-11 requires.
2. **Given** a **recycled** pooled connection, **When** it is used by a different tenant's request, **Then**
   it cannot read the first tenant's rows — a test written **before** the pool is introduced.
   ⚠ **INVARIANT: CLAUDE.md §4.3** — the most severe possible regression.

---

### Story 14.16: Scoped operators

**As a** tenant admin, **I want** operator approval authority scoped to clients or AI systems, **So
that** a tenant-wide operator is not the only option.

`Effort: M` · `Files: core/members.py, api/approvals.py` · `FRs: FR-81` · *Deferred: membership (Story 4.10) is the gate.*

**Acceptance Criteria**
1. **Given** a scoped operator, **When** they attempt a decision outside their scope, **Then** it is refused
   **server-side**, not by hiding UI.
2. **Given** separation of duties, **When** scoping is applied, **Then** it composes with it rather than
   replacing it.

---

### Story 14.17: Identity federation for the console

**As an** enterprise customer, **I want** console login through my own OIDC provider with group-to-role
mapping, **So that** identity is not a vendor dependency.

`Effort: L` · `Files: api/security.py, frontend/middleware.ts, frontend/lib/supabaseServer.ts` · `FRs: FR-82` · *Deferred: SAML and SCIM explicitly out; builds on Story 1.10.*

**Acceptance Criteria**
1. **Given** a configured OIDC issuer, **When** a user logs in, **Then** authentication resolves through the
   generic JWKS interface and IdP groups map to roles.
2. **Given** the token, **When** it is stored, **Then** it remains in an `httpOnly`, `Secure`, `SameSite`
   cookie. ⚠ **INVARIANT: CLAUDE.md §4.5.**

---

### Story 14.18: Step-up authentication for high-risk approvals

**As a** security lead, **I want** re-authentication before deciding a high-risk approval, **So that**
a hijacked session cannot approve a large action.

`Effort: M` · `Files: api/approvals.py, api/security.py` · `FRs: FR-83` · *Deferred: follows federation.*

**Acceptance Criteria**
1. **Given** a risk score above the configured threshold, **When** a decision is attempted, **Then**
   re-authentication is required; the feature is off by default (NFR-7).
2. **Given** a step-up failure, **When** it occurs, **Then** the **approval action** is denied and the
   underlying agent action is **never** implicitly allowed. ⚠ **INVARIANT: CLAUDE.md §4.4.**

---

### Story 14.19: Helm chart for cluster deployment

**As a** platform engineer, **I want** a chart, **So that** cluster deployment is as easy as compose.

`Effort: L` · `Files: deploy/helm/ (new)` · `FRs: FR-90` · *Deferred: compose is the ten-minute promise (A-9).*

**Acceptance Criteria**
1. **Given** the chart, **When** it is installed, **Then** containers run non-root, secrets are externalised
   and ingress is configurable.
2. **Given** the chart, **When** it is tested in CI, **Then** the deployment smoke assertions of Story 1.24
   pass against it.

---

### Story 14.20: A published threat model

**As a** security reviewer, **I want** assets, adversaries, trust boundaries and a residual-risk
register, **So that** I can evaluate the product rather than a control checklist.

`Effort: M` · `Files: docs/THREAT_MODEL.md (new), docs/SECURITY.md` · `FRs: FR-126` · *Deferred: valuable, not load-bearing for the four v2.0 demands.*

**Acceptance Criteria**
1. **Given** the document, **When** it is read, **Then** it names the adversaries currently absent: a
   malicious tenant admin with database access, a compromised downstream server, a vendor insider, and
   **the vendor itself as the party attesting its own logs**.
2. **Given** each adversary, **When** it is described, **Then** the residual risk and the mitigating control
   (or its absence) are stated.

---

### Story 14.21: A signed impact assessment

**As a** compliance officer, **I want** an assessment with reviewer identity and sign-off, **So that**
the scaffold becomes a completed record.

`Effort: M` · `Files: core/compliance.py, api/compliance.py, core/control_events.py` · `FRs: FR-132` · *Deferred: extends the v2.0 scaffold.*

**Acceptance Criteria**
1. **Given** a sign-off, **When** it is recorded, **Then** it is a control-plane event carrying the reviewer
   identity and timestamp.
2. **Given** an unsigned assessment, **When** status is computed, **Then** it can **never** report as
   complete, and the "unsigned draft" banner of Story 11.4 remains.

---

### Story 14.22: The opt-in Argument Vault

**As an** operator who needs full replay, **I want** an opt-in encrypted argument store, **So that**
simulation stops returning `indeterminate` rows.

`Effort: L` · `Files: core/vault.py (new), core/secrets.py, core/policy_sim.py` · `FRs: FR-136` · *Deferred: needs a privacy review; gated on OQ-4.*

**Acceptance Criteria**
1. **Given** the vault, **When** it is implemented, **Then** it is a **separate** store, **off by default**,
   envelope-encrypted per tenant, with its own short retention and its own access audit.
2. **Given** `audit_log`, **When** the vault is in use, **Then** **nothing** from the vault is ever written to
   it and the hash chain is unchanged.
   ⚠ **INVARIANT: CLAUDE.md §4.10 — collision resolved in favour of the invariant.**
3. **Given** a tenant that leaves it off, **When** they operate, **Then** they keep today's guarantee exactly,
   and the console states which mode is active.

---

### Story 14.23: Per-tenant retention, residency posture and legal hold configuration

**As a** tenant with a jurisdictional requirement, **I want** retention configurable above the floor
with a legal-hold flag, **So that** one process-wide value does not govern every tenant.

`Effort: M` · `Files: core/compliance.py, api/compliance.py, supabase/migrations (legal_holds), docs/DATA_MANIFEST.md` · `FRs: FR-138` · *Deferred: gated on OQ-6.*

**Acceptance Criteria**
1. **Given** a per-tenant retention above the floor, **When** it is set, **Then** it governs that tenant's
   purge; **Given** a value below the floor, **Then** it is refused (fail-closed).
   ⚠ **INVARIANT: CLAUDE.md §4.4 / DG-3.**
2. **Given** a legal hold, **When** it is set or lifted, **Then** each is a control-plane event and purge and
   erasure are suspended for its scope.
3. **Given** residency, **When** it is documented, **Then** self-host is stated plainly as the current answer
   — no per-tenant residency claim is made (DG-8).

---

### Story 14.24: Supply-chain scanning breadth

**As a** security reviewer, **I want** frontend dependency and licence scanning plus static analysis,
**So that** the existing backend-only gates cover the whole product.

`Effort: S` · `Files: .github/workflows/ci.yml` · `FRs: FR-145` · *Deferred: cheap but not load-bearing for v2.0.*

**Acceptance Criteria**
1. **Given** CI, **When** it runs, **Then** frontend dependency audit and licence scanning run alongside the
   existing backend dependency audit and secret scanning.
2. **Given** a critical finding, **When** it is reported, **Then** the build fails, matching the existing
   gate's severity policy.

---

## Validation

- **FR coverage:** 152 / 152. Every functional requirement in `docs/product/PRD.md` §4 maps to at
  least one story in the FR Coverage Map above. **Uncovered: none.**
- **Story count:** 163 across 14 epics (26 · 10 · 9 · 16 · 11 · 8 · 16 · 6 · 5 · 5 · 11 · 8 · 8 · 24).
- **v2.0 scope:** Epics 1–13 (139 stories). Epic 14 (24 stories) is the deferred backlog per PRD §6.2
  and ships nothing in v2.0.
- **Epic 1 is the deployment epic**, as required, and it establishes the CI gate every later epic
  must keep green.
- **Invariant discipline:** every story that touches a CLAUDE.md §4 non-negotiable is marked
  ⚠ **INVARIANT** with the specific clause named. Where the PRD implies an invariant violation
  (erasure vs. append-only in Story 11.10, framework-owned HITL in Stories 8.4/8.5, argument storage
  in Story 14.22, channel-based approval in Story 4.14), the story is written to **enforce** the
  invariant and to disclose the resolution — never to relax it.
- **No new required runtime dependency** is introduced by any v2.0 story; the two capabilities that
  would conventionally require one (trace export, SBOM) are explicitly implemented without one, and
  the single deferred exception (connection pooling, Story 14.15) carries its justification and its
  RLS-under-pooling test as acceptance criteria.


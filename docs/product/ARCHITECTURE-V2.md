---
title: "xSOM AI Guard v2 — Technical Architecture"
product: xSOM AI Guard
release: v2.0
status: draft
owner: Architecture (BMAD Architect)
created: 2026-07-27
implements: docs/product/PRD.md (FR-1 … FR-152)
supersedes: architecture implied by docs/SPEC.md and docs/ADR-0001-ai-observability.md
authority: CLAUDE.md §4 (non-negotiable invariants) > docs/product/PRD.md > this document
---

# xSOM AI Guard v2 — Technical Architecture

## 0. How to read this

This document makes the v2 PRD **buildable on the existing codebase**. It is not a
greenfield design: every target component names the real file it extends, and every
decision names the invariant it must not break.

Three rules govern every choice here:

1. **Boring beats clever.** Where two designs work, the one with fewer moving parts,
   fewer dependencies and a cheaper test wins. A supervision product that is hard to
   verify is a contradiction.
2. **Payload v1 is frozen, permanently** (CLAUDE.md §4.2, PRD V-2). Every new audit
   field is an **annex column**. Tamper-evidence for annex data comes from signed
   **checkpoints**, never from changing `core/audit.py::_payload`.
3. **Absence of a decision is never an allow** (CLAUDE.md §4.4, PRD NFR-2). Every new
   path in §3.9 states its failure verdict.

Sections: §1 as-is architecture and its seams · §2 target architecture (deployment,
transparency, coverage planes) · §3 decision register · §4 data model and migrations ·
§5 module map · §6 dependency policy · §7 risks, mitigations and non-goals ·
appendices (guard pipeline, audit record contract, sequencing).

---

## 1. Architecture as-is (read from the code, 2026-07-27)

### 1.1 Component map

```
                    ┌──────────────────────────────────────────┐
   agent (MCP)  ───►│ gateway/server.py  PolicyBackend         │  MANDATORY
                    │  list_tools → integrity screen           │  enforcement
                    │  call_tool  → integrity, rbac, policy,   │  (in the path)
                    │               judge, risk, taint, HITL   │
                    │  → gateway/downstream.py DownstreamProxy │
                    └───────────────┬──────────────────────────┘
                                    │
   agent (HTTP) ───► api/authorize.py ──► core/decision.py::authorize   COOPERATIVE
                                    │        (policy, judge, risk, HITL)
   agent (LLM)  ───► api/llm_proxy.py ─────► post-hoc tool-call strip   COOPERATIVE
                                    │        + core/dlp.py egress guard
                                    ▼
                    core/policy.py · core/judge.py · core/risk.py · core/trust.py
                    core/approvals.py · core/integrity.py · gateway/taint.py
                                    ▼
                    core/audit.py  ──►  audit_log (append-only, hash-chained)
                                    ▼
   console (JWT) ──► api/*.py (18 routers) ──► core/db.py tenant_reader (RLS)
                                    ▼
                    Supabase Postgres  ·  Supabase Auth (JWKS)  ·  Vercel frontend
```

### 1.2 What is genuinely solid (do not disturb)

| Asset | Where | Why it is load-bearing |
|---|---|---|
| Hash chain | `core/audit.py:38-71` (`_payload`, `compute_entry_hash`), `:74-141` (`log_event` with `pg_advisory_xact_lock` per tenant) | Correct serialisation, correct canonicalisation, no races. |
| Append-only enforcement | `supabase/migrations/0005_audit_log.sql:41-45` (row triggers on UPDATE/DELETE) | Enforced by the database, not by convention. |
| Annex-column precedent | `supabase/migrations/0006_agent_usage.sql` adds `audit_log.gateway_token_id` **outside** `_payload`, with the reasoning in the migration header | v2 follows this pattern verbatim. |
| Real RLS | every table's `*_select_own` policy reading `auth.jwt() -> 'app_metadata' ->> 'tenant_id'`; `core/db.py::tenant_reader` sets `set local role authenticated` + `request.jwt.claims` transaction-locally | Proven against plain Postgres by `tests/test_rls.py`. |
| Deterministic dry-run | `core/approvals.py:60-75` (`build_dry_run`) — computed by the gateway from tool + args, never authored by the agent or an LLM | The specific defence against a misleading approval summary. Never trade it. |
| Deterministic risk | `core/risk.py:87-146` — four factors, irreversible floor in `band()`, bounded trust discount | Sound; only its *plumbing* is broken (score discarded). |
| Supply-chain shield | `core/integrity.py`, `gateway/server.py:205-236` (`_screen_tools`), `:254-268` (`_integrity_blocks`) | Fail-closed quarantine, genuinely differentiated. |
| Self-serve provisioning | `core/signup.py:90-113` (`provision_account`) — user + tenant + membership + `app_metadata`, atomic with rollback | Already ~70% of a zero-SQL bootstrap. It is only unreachable, not missing. |
| Hermetic PG harness | `tests/pgcluster.py`, `tests/conftest.py:139-166` | Real Postgres, real RLS, no Docker. Keep it; only move it out of `tests/`. |

### 1.3 The seams we extend

These are the exact insertion points. Everything in §2 attaches to one of them.

| # | Seam | File:symbol | What attaches |
|---|---|---|---|
| S1 | Audit write | `core/audit.py::log_event` (the only writer) | Annex provenance, actor dimension, control-plane events |
| S2 | Audit read | `core/audit.py::list_events` (13 columns, no hashes) | Hash-bearing exports, filters, detail drawer |
| S3 | Chain verify | `core/audit.py::verify_chain` + `scripts/verify_chain.py` | `GET /v1/audit/verify`, checkpoints, standalone verifier |
| S4 | MCP decision loop | `gateway/server.py::PolicyBackend.call_tool:127-203` | Replaced by a call into the shared pipeline |
| S5 | HTTP decision loop | `core/decision.py::authorize:77-219` | Replaced by a call into the shared pipeline |
| S6 | Policy evaluation | `core/policy.py::evaluate:282-302`, `classify_by_name:85-91` | Annotations floor, multilingual stems, reason vocabulary |
| S7 | Policy persistence | `core/policy_store.py::save_yaml:40-52` (destructive upsert) | Versions, diff, rollback, simulation |
| S8 | Approval decision | `api/approvals.py::decide_approval:39-68` + `core/approvals.py::decide:176-208` | Chained human decision, justification, separation of duties |
| S9 | Session auth | `gateway/server.py::run_stdio:524-543` (`resolve_client_id` already called) | Agent attribution, halt re-check, session id |
| S10 | Approval context | `gateway/server.py::ApprovalContext:79-90` | `gateway_token_id`, `session_id`, `ai_system_id` |
| S11 | Taint state | `gateway/taint.py::TaintState` held at `gateway/server.py:115` | Detection functions stay pure; state moves to Postgres |
| S12 | Fingerprint | `core/integrity.py::fingerprint:67-75` | Annotations in the hash (v2 algorithm) |
| S13 | Notifier protocol | `core/notify.py:19-20` (`notify_approval` only) | Typed events, per-tenant channels, webhooks |
| S14 | Settings | `core/config.py::Settings` | Pluggable issuer, sinks, worker, anchors |
| S15 | Migration application | `tests/conftest.py:147` + `scripts/demo.py:74` (duplicated, test-owned) | Inverted: shared runner, imported by tests |
| S16 | App factory | `api/main.py::create_app:58-135` | Readiness, new routers, principal-keyed limiter |
| S17 | Rate limiting | `api/ratelimit.py:10` (`key_func=get_remote_address`) | Principal keying, optional shared storage |
| S18 | Telemetry ingest | `core/otlp_genai.py` (`gen_ai.system` only) | Dual-read current attributes, content denylist |

### 1.4 The structural defects the architecture must remove

Stated once, precisely, because §2 is organised around removing them:

- **D1** Two independent guard sequences (`gateway/server.py:127-203` vs `core/decision.py:77-219`) with different guard sets. `core/decision.py:21` imports `approvals, audit, db, risk, trust` — no `integrity`, no `taint`, no `allowed_clients` check.
- **D2** The chain covers agents and not supervisors. `grep audit.log_event` → only `api/llm_proxy.py:231,286`, `core/decision.py:54`, `gateway/server.py:319,345`. Zero calls in `api/policy.py`, `api/approvals.py`, `api/gateway_tokens.py`, `api/integrity.py`, `api/dlp.py`, `api/credentials.py`, `api/clients.py`, `api/servers.py`.
- **D3** `PolicyOutcome.reason` (`core/policy.py:289-302`) and the risk score (`core/risk.py:143`) are computed and discarded; neither `_audit` helper accepts them.
- **D4** `gateway/server.py:345-358` omits `gateway_token_id`; `ApprovalContext` never carries it; `core/trust.py:32-36` keys on `(tenant, tool)` only.
- **D5** `core/policy_store.py:42-48` destroys the previous document (`unique (tenant_id)` in `0003`).
- **D6** No halt primitive anywhere; `gateway/server.py:537` authenticates once per process.
- **D7** `core/audit.py:226-231` selects no `prev_hash`/`entry_hash`/`tenant_id` — exports are unverifiable.
- **D8** `core/export.py::render_pdf:84-116` ignores `report["articles"]`, `["compliant"]` and `["human_supervision"]` while `core/compliance.py:155` claims otherwise.
- **D9** No compose file, no frontend image, no migration runner; `.dockerignore` excludes `supabase` and `scripts` so the image cannot migrate itself.
- **D10** `core/config.py:36` (`cors_allow_origins: list[str]`) is JSON-decoded at the settings-source layer before `_split_origins` runs — **reproduced**: `Settings(_env_file=…)` on the shipped `.env.example` raises `SettingsError`. `tests/test_config.py:29` passes the field as an init kwarg and is structurally blind to it.
- **D11** `core/compliance.py::oversight_coverage:68-86` queries `audit_log` with no tenant predicate while its caller has `tenant_id` in scope.
- **D12** `frontend/app/(app)/onboarding/page.tsx:11` hardcodes a vendor Railway URL used to build the LLM proxy `base_url`; the MCP snippet exports `XSOM_GATEWAY_TOKEN` while `gateway/server.py:38` reads `XSOM_TENANT_TOKEN`.

---

## 2. Target architecture

### 2.0 Shape of the target system

```
 ┌── one command: docker compose up ──────────────────────────────────────┐
 │  db (postgres:16)   auth (GoTrue)   migrate (one-shot)                 │
 │  api (control API + decision API)   worker (scheduled jobs)   web      │
 └────────────────────────────────────────────────────────────────────────┘

 agent ─MCP──► gateway/server.py ──┐
 agent ─HTTP─► api/authorize.py ───┼──► core/pipeline.py  ← THE single Guard Pipeline
 agent ─SDK──► sdk/* ─► /v1/authorize                     halt→integrity→rbac→budget
 agent ─LLM──► api/llm_proxy.py ───┘                      →policy→judge→risk→taint
                                          │
                                          ▼
                       core/provenance.py  (one Verdict, fully explained)
                                          │
                    ┌─────────────────────┼──────────────────────┐
                    ▼                     ▼                      ▼
            core/audit.py          core/approvals.py       api responses
            (payload v1 +          (dry-run, HITL,         (+X-XSOM-Guards,
             annex provenance)      justification)          enforcement_mode)
                    │
        ┌───────────┼─────────────┬───────────────┬──────────────┐
        ▼           ▼             ▼               ▼              ▼
  audit_log   core/checkpoint  core/egress   core/compliance  tools/xsom_verify.py
  (immutable) (signed digests) (webhook/     (evidence packs)  (standalone, stdlib)
                    │           OCSF/OTLP)
                    ▼
             core/anchor.py → destination OUTSIDE xSOM's control
```

---

### 2.A Deployment plane — "ultra facile de déploiement"

Delivers PRD Group C (FR-85 … FR-112) and SM-1 (0 SQL, 0 SaaS accounts). *`SM-1`'s ≤ 10 min median is recalibrated to a credibility metric — `AR-3` / `QO-6`, see `DECOUPAGE.md` §7 bis.*

#### 2.A.1 Compose topology

`/docker-compose.yml` (new), all services bound to `127.0.0.1` by default:

| Service | Image / build | Role | Health |
|---|---|---|---|
| `db` | `postgres:16-alpine` | Postgres. Volume `xsom-db`. | `pg_isready` |
| `auth` | pinned `supabase/auth` (GoTrue) | Identity: users, password login, JWKS. Owns `auth.users`. | `/health` |
| `migrate` | `build: .` (API image), `command: xsom migrate --and-compat` | One-shot. Applies `deploy/auth_compat.sql` then `supabase/migrations/*` through the ledger. Exits 0. | n/a (`restart: "no"`) |
| `api` | `build: .` | Control API + Decision API. | `GET /health/ready` |
| `worker` | `build: .`, `command: xsom worker` | Scheduled jobs (§2.C.9). | `job_runs` freshness |
| `web` | `build: ./frontend` (new `frontend/Dockerfile`) | Console. | `GET /api/health` |

`depends_on` with `condition: service_healthy` for `db`→`auth`→`migrate`→`api`/`worker`→`web`.
`api` and `worker` additionally `depends_on: migrate: {condition: service_completed_successfully}`,
so the stack cannot report healthy on an unmigrated database.

**Embedded vs external Postgres.** The compose `db` service is a *convenience default*, not an
embedded engine. `DATABASE_URL` overrides it to point at any managed Postgres (Supabase, RDS,
Cloud SQL). There is no second storage engine and no SQLite path: RLS policies, the append-only
triggers and `pg_advisory_xact_lock` are load-bearing and are not portable. One engine, one
dialect, one test matrix.

#### 2.A.2 Authentication without a SaaS dependency (FR-87)

The blocking fact: `frontend/lib/supabaseServer.ts`, `frontend/middleware.ts` and
`frontend/app/api/auth/*` speak the Supabase Auth wire protocol, and every RLS policy reads
`auth.jwt() -> 'app_metadata' ->> 'tenant_id'`. GoTrue *is* that protocol, self-hostable and
offline-capable, so running it locally keeps the console, the RLS contract and
`core/signup.provision_account` working **unchanged**.

- `api/security.py::build_verifier` is generalised to a **pluggable JWKS issuer**: `AUTH_ISSUER_URL`
  + `AUTH_JWKS_URL` (the existing `SUPABASE_*` keys remain accepted, deprecated per V-6). Supabase
  becomes one issuer among several; Keycloak/Entra/Okta work by configuration alone.
- `deploy/auth_compat.sql` (new) is `tests/fixtures/supabase_auth_shim.sql` promoted to a supported,
  reviewed artifact: creates `auth.jwt()`, `auth.uid()`, `auth.role()`, and the `anon`,
  `authenticated`, `service_role` roles — **`service_role` with `BYPASSRLS`, exactly as the hosted
  provider does**. `auth.users` is created only `if not exists`, so GoTrue's own migration wins.
- Asymmetric signing is required (RS256/ES256 as today). `xsom init` generates an RSA keypair,
  configures GoTrue with the private JWK set and the compose stack with the public JWKS URL.
  *Named degraded mode:* if the pinned GoTrue build cannot sign asymmetrically, a shared-secret
  mode exists behind `AUTH_ISSUER_MODE=selfhost_shared_secret`, which is **refused when
  `ENV=prod`** and reported by `/health/ready` as a degraded capability. Fail-closed default.

**Invariant guarded (§4.3):** `tests/test_rls.py` must pass **unmodified** against the compose
database. It is added to the deploy-smoke workflow, so RLS isolation on a single node is proven
by the same test that proves it on Supabase — not asserted.

**Invariant guarded (§4.6):** the service-role DSN and the GoTrue service key live only in the
`api`, `worker` and `migrate` services. `web` receives `NEXT_PUBLIC_*` values and `CONTROL_API_URL`
only. `xsom init` writes `.env` with mode `0600` and never echoes a secret except the gateway
token and (if generated) the admin password, each printed exactly once.

#### 2.A.3 Migration runner and ledger (FR-97 … FR-101)

- `core/migrate.py` (new, production code): discover `supabase/migrations/*.sql`, sha256 each,
  compare to the ledger, apply pending files in filename order inside a single transaction each,
  under `pg_advisory_lock` so two replicas cannot race.
- `schema_migrations(version text primary key, checksum text not null, applied_at timestamptz, applied_by text)`.
  The runner creates it idempotently before doing anything (chicken-and-egg), and
  `0016_schema_migrations.sql` declares the same DDL so the data manifest sees it.
- **Baseline adoption** for existing deployments: on a database that already has `audit_log` but no
  ledger, the runner records `0001 … 0015` as applied *without re-running them*, detected by probing
  for a sentinel object per file group. This is the upgrade path for the hosted instance and is
  covered by FR-100's previous-release-to-head CI job.
- **Dependency direction inverted (FR-98):** `tests/conftest.py:147` and `scripts/demo.py:74` stop
  owning migration logic and import `core.migrate`. `tests/pgcluster.py` moves to
  `scripts/pgcluster.py` (a dev tool) so `scripts/demo.py` no longer imports the test package.
- **CI integrity (FR-99):** a test asserts filenames are unique and monotonically increasing, that
  no *new* gap appears after 0015 (the existing 0012 gap is recorded in `docs/AUDIT_FORMAT.md` and
  grandfathered — renumbering a released migration would violate V-4), and that no already-applied
  migration's checksum changed.
- `.dockerignore` keeps `supabase/migrations`, `core/migrate.py`, `scripts/migrate.py` and the CLI
  in the build context; `tests`, `frontend` and `docs` stay excluded (FR-88).

#### 2.A.4 The `xsom` CLI and zero-SQL bootstrap (FR-91 … FR-96)

New package `cli/` registered as `[project.scripts] xsom = "cli.main:main"` in `pyproject.toml`
(which today has no `[project.scripts]` and `package = false` — the latter changes to allow the
entry point; `uv sync --frozen --no-dev` in the Dockerfile still installs only locked deps).

| Command | Implementation | Notes |
|---|---|---|
| `xsom init` | `cli/init.py` → `core.migrate` + `core.signup.provision_account` + `core.tenant_tokens.mint` + `core.policy_store` template | Generates secrets, writes `.env`, prints the gateway token once. |
| `xsom migrate` | `core.migrate` | `--dry-run`, `--target`, `--and-compat`. |
| `xsom bootstrap` | same as `init` minus secret generation | For an existing `.env`. |
| `xsom token mint/revoke` | `core.tenant_tokens` | Writes a control-plane event. |
| `xsom halt/resume` | `core.control` | Scope + mandatory reason. |
| `xsom verify-chain` | `core.audit.verify_chain` + `core.checkpoint` | Also verifies checkpoints and anchors. |
| `xsom export` | `core.compliance` + `core.export` | Framework selectable. |
| `xsom doctor` | `cli/doctor.py` | Config, connectivity, schema head, capability activation, chain status, remediation per failure. |
| `xsom worker` | `core.jobs` | The scheduler process. |

**Fail-closed CLI (FR-95):** every state-creating or state-destroying command refuses to run when
`ENV=prod` without `--force`; every mutation writes a control-plane event with
`actor_type=system` plus the invoking OS user as `object_ref` metadata (never as PII).

**Signup un-blocked (FR-92, FR-93):** `SUPABASE_SERVICE_ROLE_KEY` (renamed `AUTH_SERVICE_KEY`,
old name accepted per V-6), `SIGNUP_RATE_LIMIT` and `AUTHORIZE_RATE_LIMIT` are added to
`.env.example` with a §4.6 backend-only warning. `api/signup.py`'s 503 becomes
`{"code": "signup_disabled", "detail": "signup disabled: set AUTH_SERVICE_KEY on the backend"}` —
names the setting, never its value, no stack trace (§4.8).

#### 2.A.5 Readiness, liveness and the boot gate (FR-102 … FR-106)

- `GET /health` — unchanged: static, unauthenticated, liveness only.
- `GET /health/ready` (new, `api/health.py`) — 503 unless: DB connects; `schema_migrations` head
  equals the bundled head; the JWKS issuer resolves. Returns **booleans and counts only**
  (§4.8), plus a `capabilities` map (`signup`, `judge`, `dlp`, `egress`, `anchors`, `worker_fresh`)
  as *warnings*, not failures (FR-103). Memoised for 5 s so an unauthenticated endpoint cannot
  become a database DoS. `railway.json` and every compose healthcheck point here.
- **The `.env.example` boot fix (D10, FR-104):** `cors_allow_origins` becomes
  `Annotated[list[str], NoDecode]` so the existing `_split_origins` validator owns parsing
  (`pydantic-settings>=2.14.2` is already pinned; `NoDecode` landed in 2.7 — **no new dependency**).
  The wildcard rejection is untouched. New `tests/test_env_example.py` copies `.env.example` to a
  temp dir, instantiates `Settings(_env_file=…)` and boots `create_app()`. That single test is the
  regression gate for the whole class.
- **Deploy smoke workflow** `.github/workflows/deploy-smoke.yml` (new, FR-105):
  `docker compose up -d --wait` → assert `/health/ready` 200 → `xsom init` → mint token →
  `POST /v1/authorize` on an irreversible tool → assert verdict `hold` **and** the downstream mock
  recorded zero invocations → `tests/test_rls.py` against the compose DB → `xsom verify-chain` →
  standalone verifier on the export → `docker compose down`. Validated by deliberately
  reintroducing each of D9–D12 and confirming the gate fails (A-12).
- **Demo needs only Docker (FR-106):** `scripts/demo.py` prefers `DATABASE_URL` from compose and
  falls back to `scripts/pgcluster.py`.

#### 2.A.6 No vendor URL in any artifact (FR-89 — a security requirement)

`frontend/lib/config.ts` gains `xsomApiUrl: process.env.NEXT_PUBLIC_XSOM_API_URL ?? <origin>`;
`frontend/app/(app)/onboarding/page.tsx:11` deletes the Railway constant and reads it. A new
`frontend/.env.example` documents `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`CONTROL_API_URL`, `NEXT_PUBLIC_XSOM_API_URL`. A Playwright assertion fails if any rendered
onboarding artifact contains a vendor hostname. The MCP snippet emits `XSOM_TENANT_TOKEN`
(matching `gateway/server.py:38`) and a complete `mcpServers` block (FR-96).

---

### 2.B Transparency plane — "transparent" and independently checkable

Delivers PRD Group D (FR-113 … FR-152) and SM-2, SM-3.

#### 2.B.1 The decision provenance record

One frozen dataclass, `core/provenance.py::Provenance`, produced by the pipeline and consumed by
the audit writer. Its fields land in **annex columns only**:

```
actor_type          human | agent | system            (FR-35)
decision_reason     policy | constraint | unknown_tool | auto_classify | annotation |
                    judge | risk | taint | integrity | rbac | budget | halt | dlp   (FR-113)
escalated_by        judge | risk | taint | integrity | rbac | budget | annotation | null
enforcement_mode    mandatory | cooperative | evaluate_only                        (FR-3)
policy_version      int                                                            (FR-9)
product_version     text                                                           (FR-140)
correlation_id      one per tool call, shared with every gate entry                (FR-58)
session_id, trace_id                                                               (FR-57)
risk_score int, risk_band text, risk_factors jsonb (names + points only)           (FR-29)
lineage jsonb       parent_request_id, delegation_subject, originating_principal, call_depth (FR-43)
outcome_status      ok | downstream_error | timeout | not_executed                 (FR-69)
guards_run          text[]                                                         (FR-2)
ai_system_id        uuid                                                           (FR-41)
```

`core/audit.py::log_event` gains one keyword, `provenance: Provenance`, and writes those columns
alongside the untouched payload write. `_payload` and `compute_entry_hash` are **not modified** —
this is the whole point. `_audit_gate` (`gateway/server.py:312-327`) is replaced by
`audit.log_gate_event(...)`, which takes the same `Provenance`, so a `tainted_action` row shares a
`correlation_id` with the `hitl_pending` row it caused and an `rbac_denied` row records the agent
it denied (FR-115).

**`error` means error (FR-114).** The four conventions currently multiplexed through `error`
(`downstream_error` at `gateway/server.py:192`, `dlp:` at `api/llm_proxy.py:295`, integrity and
taint reasons at `gateway/server.py:324`) move to `decision_reason`. `error` is left for genuine
execution failures. The vocabulary is published in `docs/AUDIT_FORMAT.md` and consumers are
required to tolerate unknown values (V-3).

**Referential-integrity rule for `audit_log`.** New annex columns that reference other tables are
stored as bare `uuid`/`text` with **no foreign key**. Reason: any `on delete cascade` would attempt
a DELETE and any `on delete set null` would attempt an UPDATE on `audit_log` — both are rejected by
the `0005` triggers, which would make the *parent* delete fail. This also means the existing
`audit_log.gateway_token_id uuid references gateway_tokens (id)` (added in `0006` with default
`NO ACTION`) is a latent hazard: deleting a gateway token would error. Migration `0017` drops that
constraint while keeping the column and its index — dropping a constraint is DDL, not a row
mutation, so the append-only triggers do not fire.

#### 2.B.2 Independent verification: exports, verifier, checkpoints, anchors

Four layers, each stronger than the last, each with a stated limit.

**Layer 1 — the export carries the proof (FR-119).** `core/audit.py::list_events` and
`core.schemas.AuditEntry` gain `prev_hash`, `entry_hash`, `tenant_id` and every payload field.
`tenant_id` is safe to return: the read runs through `db.tenant_reader`, so RLS has already scoped
it to the caller's own tenant.

**Layer 2 — the standalone verifier (FR-120).** `tools/xsom_verify.py`: one file, **stdlib only**
(`json`, `hashlib`, `argparse`), importing nothing from `core/`. It rebuilds the canonical payload
per `docs/AUDIT_FORMAT.md` and recomputes the chain from `GENESIS`. Because a second implementation
can silently diverge, CI runs three tests: it agrees with `core.audit.verify_chain` on a generated
corpus; it returns OK on a real export; it returns FAIL on a doctored export.

**Layer 3 — signed checkpoints (FR-121, FR-123).** A checkpoint digests a contiguous id range of
entries **and their annex columns**:

```
annex_digest   = sha256( canonical_json([annex(e) for e in entries first_id..last_id]) )
payload_digest = sha256( canonical_json([payload(e) for e in ...]) )
signature      = Ed25519( "xsom-ckpt-v1|" || tenant_id || first_id || last_id ||
                          count || head_hash || payload_digest || annex_digest )
```

Ed25519 comes from `cryptography`, already present transitively via
`python-jose[cryptography]` — **no new dependency**. `core/checkpoint.py` defines a
`CheckpointSigner` protocol with two implementations: `LocalKeySigner` (key generated by
`xsom init`; the self-host default) and `KmsSigner` reusing the envelope-encryption machinery in
`core/secrets.py`. The public key and `key_id` are published in every export and by
`GET /v1/audit/verify`. **Key custody is OQ-9 and is disclosed, not decided here**: a vendor-held
key weakens exactly the independence the checkpoint exists to establish, which is why Layer 4 is
not optional for a customer who cares.

Truncation: a checkpoint recording `(last_id, head_hash, count)` *is* the anti-truncation witness —
if the tenant's current head id is below a checkpointed `last_id`, or its hash differs, the tail was
removed. A per-tenant `seq` column was considered and **rejected**: it would have to live inside the
payload to be chain-protected, which V-2 forbids, and outside the payload it adds nothing the
checkpoint does not already give. Additionally, migration `0017` adds the statement-level
`before truncate` trigger that `0005` lacks (row triggers do not fire on `TRUNCATE`, which is why
`TRUNCATE audit_log` currently leaves verification reporting "OK, 0 entries").

**Layer 4 — external anchors (FR-122).** `core/anchor.py` publishes a checkpoint to a destination
**outside xSOM's control**, via an `AnchorTarget` protocol. v2.0 ships two targets, both
dependency-free: `webhook` (signed HMAC delivery to the tenant's own endpoint or compliance
mailbox, reusing §2.C.8's sink machinery) and `file` (write to a mounted path — the practical route
to a customer's object-locked bucket via a CSI mount, and the only one that works air-gapped).
Timestamp authorities and public transparency logs are deferred (OQ-2). Verification gains a second
assertion: *the head at anchor k still reproduces from the exported data*.

**Layer 5 — the endpoint (FR-124).** `GET /v1/audit/verify?from=&to=` returns
`{ok, entries, first_broken_id, head_id, head_hash, tenant_id, period, product_version,
checkpoints:{verified, last_id, key_id}, anchors:{last_published_at, destination}}`.
RLS-scoped, rate-limited under the existing export limit, downloadable from the console. It is a
*convenience*; Layer 2 remains the source of truth, and the documentation says so.

**Honest limits (FR-125, AT-4)**, published in `docs/SECURITY.md` and `docs/AUDIT_FORMAT.md`:
hash chaining detects mutation and mid-chain excision; it does **not** by itself detect tail
truncation or a wholesale rebuild by someone with database write access. Annex columns are not
covered by the payload hash — they are covered by checkpoints. The window between anchors is a
residual risk. `docs/SECURITY.md:30`'s current claim ("tampering any row … breaks verify_chain") is
corrected.

#### 2.B.3 Control-plane supervision (FR-35 … FR-39) — supervising the supervisors

`core/control_events.py` provides `record(conn, *, tenant_id, actor, event, object_ref,
before_digest, after_digest, note)` which calls `audit.log_event` with `actor_type='human'|'system'`
and the acting user in the **existing in-payload `user_id` field** — so the actor's identity is
chain-protected without touching Payload v1.

Three designs were considered for *guaranteeing* coverage: middleware inference, a route decorator,
and an explicit call plus a build gate. **Explicit call plus build gate wins**: the event needs
semantic fields (which object, which version, which digest) that middleware cannot invent, and a
decorator hides the transaction boundary — the event must be written in the *same* transaction as
the mutation it records. Coverage is then enforced by `tests/test_control_plane_coverage.py`, which
enumerates every `POST|PUT|PATCH|DELETE` route on `app.routes` and fails unless each either writes
an event or appears in a small allowlist with a written reason. **That test is SM-4**; it is a build
gate, not a report.

**Content discipline (FR-37):** a token-mint event records the token id, never the token; a policy
update records version + `before_digest`/`after_digest`, never the YAML. `scripts/audit_security.py`
is extended to fail if a control-plane payload carries a document body or a secret-shaped value.

**Attribution is mandatory (FR-38):** `record()` raises if no resolvable actor is supplied; the route
returns 500 rather than mutating anonymously. Automated changes carry `actor_type='system'` plus the
job identifier.

#### 2.B.4 Human oversight as evidence (FR-15 … FR-21)

`api/approvals.py::decide_approval` writes the chained entry **synchronously, inside the same
transaction as `core/approvals.py::decide`**, with `user_id` = the deciding member and
`request_id` = the approval id. Because `user_id` is already a Payload v1 field, the approver is
chain-protected with **no payload change**.

This moves *where* `hitl_approved`/`hitl_denied` are emitted, from consumption time
(`core/decision.py:261-271`, `gateway/server.py:406-421`) to decision time. Consumption emits a new
additive value `hitl_executed`, giving the three-link `hold → decide → execute` chain of FR-15.
`core/compliance.py::oversight_coverage` stops counting human events by decision string and counts
them by `actor_type='human'`, which is both more correct and immune to future vocabulary additions.
This is a behavioural change and gets a changelog entry per V-7.

`DecisionRequest` (`core/schemas.py:141-147`) gains a **mandatory bounded `reason`** (FR-16); a
decision without one is 422. The justification text is stored on the mutable approval row and
referenced from the chained entry by digest — it is classified `free_text` in the data manifest
(§2.B.5) and excluded from egress payloads by default (G-P4).

Separation of duties (FR-19): `requested_by` may not equal `decided_by` (409 with an explicit
reason); `human_dual` requires distinct member ids, which `core/approvals.py:197-205` already
computes but which is unreachable until §2.C.7 makes a second member possible.

Effective expiry (FR-18): `core/approvals.py::list_for_tenant` derives status from `expires_at` in
the read path, so a stale approval never renders as pending; the worker additionally writes the
`expired` entry and fires an alert so `oversight_coverage` cannot silently under-count.

#### 2.B.5 Data manifest and content-free proof (FR-133 … FR-137)

`core/data_manifest.py` holds a **declared** classification per column
(`identifier | metadata | hash | derived | free_text | encrypted`, plus retention and lawful basis).
The *inventory* is **generated** from `information_schema.columns` against a freshly migrated
database. `tests/test_data_manifest.py` fails if any generated column lacks a declaration — so the
"we never store content" claim becomes an enforced invariant rather than prose. The reconciliation
with FR-133's "generated, not hand-maintained": the inventory is generated, the *classification*
is declared, and the test binds them. Published as `docs/DATA_MANIFEST.md` and `GET /v1/data/manifest`.

Erasure (FR-135) becomes operable: `POST /v1/data/erasure` (admin, rate-limited, Legal-Hold aware)
calls the existing `core/usage.py::erase_session` and writes a control-plane event with a
removed-row count. **Invariant collision resolved in favour of §4.2:** `audit_log` is never erased;
erasure covers operational tables. `docs/DATA_MANIFEST.md` states the reconciliation as a product
position — pseudonymised metadata retained under a legal-obligation basis is not erasable personal
data — rather than leaving it in a docstring.

Retention (FR-130, FR-134): the worker runs `core/compliance.py::enforce_retention_purge` (which
currently has zero callers), records `last_purge_at` in `retention_runs`, and
`core/compliance.py::status` reports `retention_ok` from the **observed** oldest row and the last
executed purge — not from `settings.audit_retention_days`. The fail-closed floor guard stays.

Ingestion (FR-137): `core/otlp_genai.py` gains an explicit denylist constant
(`gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`,
`gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`, `gen_ai.prompt`, `gen_ai.completion`)
dropped **by name**, and `error_type`/`route` are DLP-scanned and length-bounded. A test posts a
payload full of prompt content and asserts nothing content-bearing is persisted.

#### 2.B.6 Evidence packs that contain the evidence (FR-127 … FR-131)

`core/export.py::render_pdf` is rewritten to walk the pack rather than five top-level keys (D8):
an Article 12 section (chain status, entry count, head hash, period, retention), an Article 14
section (per-approval table with approvers, decision times and outcomes **sourced from the chain**,
FR-128), an Article 26 section with the FRIA scaffold carrying an "unsigned draft" banner on its
face, and an appendix of hash-bearing entries. A test asserts the rendered bytes contain the
headings and the head hash.

`core/frameworks.py` (new) is a **declarative control-mapping table** — evidence artifact → control
id — for EU AI Act, GDPR, ISO/IEC 42001, NIST AI RMF and SOC 2 (FR-131). No new collection, no new
tables; `GET /v1/compliance/export?framework=…` renders the same evidence against a different
catalogue with a per-control pass/gap table. Control verdicts are computed deterministically; only
narrative prose may be generated and it is labelled (FR-118).

`oversight_coverage` gains an explicit `tenant_id` parameter and a `where` predicate (D11, FR-129),
with a two-tenant test asserting counts do not bleed. Defence in depth, not a replacement for RLS —
but the current asymmetry, where `chain_integrity` is tenant-scoped and `oversight_coverage` is not,
is exactly how a plausible-looking, unverifiable compliance artifact is produced.

#### 2.B.7 Public surface (FR-139 … FR-145)

- `scripts/dump_openapi.py` writes `docs/openapi.json`; CI fails on drift. `/docs` stays disabled
  in production (§4.8) — the artifact is what an integrator or auditor actually needs.
- `scripts/sbom.py` (new, ~80 lines) reads `uv.lock` with stdlib `tomllib` and
  `frontend/package-lock.json` with stdlib `json`, and emits CycloneDX 1.5 JSON. **Zero new
  dependencies**, deterministic, diffable. Provenance attestation and image signing are CI actions,
  not runtime dependencies.
- `LICENSE` and `CHANGELOG.md` (OQ-1 gates the licence choice), semantic versioning, and
  `product_version` on every entry (FR-140) — sourced from one constant read by both
  `pyproject.toml` and `api/main.py:66`, which have both read `0.1.0` since M0.
- `docs/CAPABILITIES.md` maps each control to its module, its **default state** and what it writes
  to the audit log; `docs/COVERAGE.md` maps recognised agentic-risk categories to the exact module
  and test, with honest not-covered rows (FR-144).

---

### 2.C Coverage plane — "exhaustif"

#### 2.C.1 One Guard Pipeline (FR-1 … FR-7) — the central refactor

`core/pipeline.py` (new) owns the ordered sequence, and both entry points call it:

```python
# core/pipeline.py
@dataclass(frozen=True)
class CallContext:
    tenant_id: str; tool: str; arguments: dict[str, Any]
    agent_id: str | None; client_id: str | None; ai_system_id: str | None
    session_id: str | None; trace_id: str | None; correlation_id: str
    enforcement_mode: Literal["mandatory", "cooperative", "evaluate_only"]
    requested_by: str | None; lineage: Lineage

@dataclass(frozen=True)
class Verdict:
    approval: Approval; action_class: ActionClass | None
    provenance: Provenance          # reason, escalated_by, risk, guards_run, ...
    approval_id: str | None = None
    dry_run: dict[str, Any] | None = None

GUARDS = (halt, integrity, rbac, budget, policy, judge, risk, taint)

def evaluate_call(conn, policy, ctx) -> Verdict: ...
```

`gateway/server.py::PolicyBackend.call_tool` becomes: `evaluate_call(...)` → act on the verdict
(relay / deny / HITL) → `_mark_taint` → audit. `core/decision.py::authorize` becomes:
`evaluate_call(...)` → return the verdict (never execute). The LLM proxy calls it in
`enforcement_mode="cooperative"` per reassembled tool call.

- **One connection.** The pipeline opens a single connection and passes it to every guard, so halt,
  integrity, trust and budget cost no extra round trips (NFR-3, CM-3). Today
  `gateway/server.py` opens separate connections in `_integrity_blocks`, `_apply_risk` and `_audit`.
- **Declared coverage (FR-2).** `Verdict.provenance.guards_run` is returned in `AuthorizeResponse`
  and in an `X-XSOM-Guards` header; `enforcement_mode` is returned and persisted (FR-3), so a
  customer can determine the strength of their integration from the response alone.
- **Equivalence is tested, not assumed.** `tests/test_pipeline_equivalence.py` asserts that the same
  call through the MCP gateway and through `/v1/authorize` yields identical decision, decision
  reason and escalation source. A golden-decision corpus test asserts the refactor changes **no**
  verdict for existing policies (NFR-7).
- **Session-aware HTTP ingress (FR-4).** `AuthorizeRequest` accepts `session_id` and an
  agent-declared digest of the preceding tool result, so taint applies on that path too.

#### 2.C.2 Emergency Stop (FR-23 … FR-27)

`halts(tenant_id, scope ∈ {tenant, agent, tool}, scope_ref, halted_at, halted_by, reason,
resumed_at, resumed_by, resume_reason)`; `core/control.py::is_halted(conn, tenant, agent, tool)` is
the pipeline's **first** guard, on the connection it already holds. `POST /v1/control/halt|resume`
with a mandatory reason, both control-plane events. One console control on the agent page and on
every alert (FR-26).

Effective on live sessions (FR-24): because the check is per call, not per session, a session
authenticated hours ago is stopped on its next call — which also delivers FR-47 (revocation
effective immediately) by folding a token-liveness check into the same query.

**OQ-5 resolved conservatively and documented:** halt blocks calls **not yet relayed**. A call
already in flight to a downstream server is not cancelled, because cancellation is unreliable and
can leave partial effects. The limit is stated in `docs/CAPABILITIES.md` rather than implied.

Fail-closed (FR-25): if halt state cannot be read, `irreversible` and `external_send` are denied.

#### 2.C.3 Policy lifecycle (FR-8 … FR-13)

- `policy_versions(tenant_id, version, yaml, author, note, created_at, scope)` — append-only, with
  the same UPDATE/DELETE trigger pattern as `audit_log`. `tool_policies` is kept and gains
  `active_version`, so `core/policy_store.py::load_policy` stays a single-row read on the hot path.
- `save_yaml` stops destroying (`0003`'s `unique (tenant_id)` stays; the *document* moves to the
  versions table). Rollback appends a new version copying an old one — history is never rewritten.
- `core/policy_diff.py` (rule-level structured diff) and `core/policy_sim.py` (replay the last N
  audit entries against a candidate document). Simulation is read-only and never executes; because
  arguments are not stored, argument-dependent guards (constraints, risk, DLP) return
  **`indeterminate`** rather than guessing (FR-11) — honest, and it is exactly the gap the optional
  Argument Vault would close if OQ-4 ever permits it.
- Policy templates (FR-13) ship in `core/policy_templates/` (finance, HR, DevOps, customer
  communication), every one with `unknown_tool: deny`, offered at bootstrap.

#### 2.C.4 Agent identity, AI System registry, lineage (FR-40 … FR-47)

- **Attribution (FR-40).** `gateway/server.py::run_stdio` already calls `resolve_client_id`;
  it switches to `tenant_tokens.resolve_principal`, which returns `(token_id, tenant_id)`, and
  threads `token_id` into `ApprovalContext` and every audit call. Regression test: a gateway-relayed
  call produces an entry with non-null `gateway_token_id`.
- **Per-agent trust (FR-32).** `core/trust.py::observed` re-keys on `(tenant, gateway_token_id, tool)`.
  This *resets* existing streaks, which moves decisions in the **stricter** direction only, so it
  does not violate NFR-7 (which forbids silently *relaxing*). Risk bands are off by default, so the
  blast radius is near zero; it is still a changelog entry.
- **AI System registry (FR-41, FR-42).** `ai_systems(id, tenant_id, name, owner, purpose, model,
  framework, framework_version, environment, risk_tier, data_categories, lifecycle_state,
  documentation_url, created_at, archived_at)`; `gateway_tokens.ai_system_id` makes tokens
  *credentials pointing at a system*. Compliance status and evidence packs render per system, with
  a completeness gate itemising missing governance fields.
- **Lineage (FR-43).** `parent_request_id`, `delegation_subject`, `originating_principal`,
  `call_depth` travel in the MCP call context and the `/v1/authorize` payload and land in the
  `lineage` annex column. This ships **independently of** the credential model (FR-44, deferred):
  capturing lineage is cheap and is what makes the audit defensible.
- **Credential hygiene (FR-46).** Token age, last use and rotation status per agent, surfaced — no
  automatic revocation, which is deliberately a human action (§2.C.2).

#### 2.C.5 Universal ingress: SDK, adapters, annotations (FR-48 … FR-54)

- `sdk/python/xsom_guard/` and `sdk/typescript/` — a single call
  (`authorize(tool, args, ctx) -> Decision`) over `/v1/authorize`. **No policy logic in the client**;
  the decision is always the server's (FR-48).
- **Client-side fail-closed (FR-49):** network failure or ambiguous response denies `irreversible`
  and `external_send`; relaxing requires an explicit opt-in the client logs loudly at startup.
- **Adapters (FR-50):** LangGraph/LangChain HITL middleware, OpenAI Agents SDK approval callback,
  Claude Agent SDK pre-tool hook, CrewAI. **Invariant collision (§4.1) resolved:** the framework
  *asks*, xSOM *decides and records*; the framework never becomes the authority. Entries are marked
  `enforcement_mode=cooperative` so the weaker trust boundary is disclosed, never hidden (FR-51).
- **Annotations as a floor (FR-53).** `core/policy.py` gains `classify_by_annotation()`, consulted
  **before** name heuristics: `destructiveHint: true` ⇒ at least `irreversible`;
  `openWorldHint: true` ⇒ at least `external_send`; `readOnlyHint: true` may *hint* `read` but never
  relaxes an explicit rule or a higher name match. Downstream servers are untrusted by definition
  (G-S4), so this is monotone-upward only, with a test asserting a hostile `readOnlyHint: true` on a
  tool named `delete_all` cannot reduce its class.
- **Annotations in the fingerprint (FR-54).** `core/integrity.py::fingerprint` includes
  `annotations` — which **changes every existing fingerprint**, so every approved tool would show
  `drift` on upgrade. Mitigation: a `fp_version` column; on upgrade, a tool whose stored v1
  fingerprint still matches the recomputed v1 is silently re-baselined to v2 (same definition, new
  algorithm) and the migration records one `system` control-plane event per re-baseline. A genuine
  definition change still surfaces as drift.
- **Multilingual classification (FR-6).** French, Spanish and German stems (`supprim`, `effac`,
  `envoy`, `virement`, `paiement`, `cré`, `modif`, `recherch`, `enviar`, `borrar`, `löschen`,
  `senden`, …) plus tenant-supplied `defaults.extra_heuristics`. Ordering by decreasing risk is
  preserved and a golden corpus test asserts no existing tool name moves to a *less* strict class.

#### 2.C.6 Durable session, taint, drift, outcomes (FR-56 … FR-73)

- **Session (FR-56).** A durable `Session` is created at ingress: derived from trace context /
  `gen_ai.conversation.id` where available, declared otherwise, generated as a last resort.
  **It is explicitly not the MCP protocol session** — which is exactly what makes v2 forward-
  compatible with the 2026-07-28 stateless revision (FR-55, A-6). No enforcement state may depend on
  the protocol session or the initialize handshake; a design-review checklist item enforces this.
- **Persisted taint (FR-62).** `session_taint(tenant_id, session_id, marked_at, source_tool, reason,
  call_count, expires_at)` with RLS. `gateway/taint.py` keeps its pure detection functions
  (`taints_result`) and loses its stateful dataclass; state moves to `core/taint_store.py`. Both a
  call-count **and** a wall-clock window, per the original M12 deliverable. **An unresolvable session
  on an `irreversible` action is treated as tainted, never as clean** (V-9).
- **Behavioural baseline (FR-65, FR-66).** `core/baseline.py` computes rolling per-`(agent, tool)`
  statistics from `audit_log` only — call rate, action-class mix, blast-radius distribution, deny
  rate. Deterministic and explainable; **no machine learning** (§5.7). Deviation writes a
  `behavior_drift` entry and notifies. Off by default; thresholds per tenant (OQ-10).
- **Poison reason persisted (FR-68).** `tool_fingerprints.poison_reason`, returned by
  `GET /v1/tools/integrity`, so the `poison` status stops existing only transiently at listing time.
- **Outcome capture (FR-69, FR-70, FR-73).** The downstream `result.isError` already available at
  `gateway/server.py:192` stops being thrown away and lands in `outcome_status`. Success, failure
  and refusal **rates** are derived per agent and tool. Status and error class only — never the
  result body (§4.10). The console names what it does **not** measure and recommends an evaluation
  tool for that job.

#### 2.C.7 Membership, budgets, limits (FR-74 … FR-80, FR-84)

- **Membership plane (FR-79).** `POST|GET|PATCH|DELETE /v1/members`, admin-only, audited, invites
  through the same `AuthAdmin` protocol `core/signup.py` already defines. Migration `0021` adds the
  **RLS write policies** `memberships` has never had (today only `memberships_select_own` exists),
  so an admin's ability to add a member is enforced in Postgres, not only in the API (§4.3). Test:
  a non-admin cannot add a member through the API **or** through direct SQL under RLS.
- **`human_dual` becomes reachable (FR-80).** The policy editor offers the tier only when the tenant
  has ≥ 2 members and explains why when it does not.
- **Rate limiting (FR-74).** `api/ratelimit.py`'s `key_func` reads the resolved principal
  (tenant/agent) that the auth dependency places on `request.state`, falling back to the remote
  address only on unauthenticated surfaces. `RATE_LIMIT_STORAGE_URI` is passed through to slowapi's
  existing `storage_uri`. **A-7 honoured:** single-node compose degrades to in-process limiting,
  documented explicitly, so the ten-minute promise does not acquire a second required service.
- **Budgets (FR-75, FR-76).** `budgets(tenant_id, scope, scope_ref, period, cap_usd, warn_pct,
  action)`; consumption is derived from `usage_events` (no second ledger). Checked in the pipeline's
  budget guard and before `api/llm_proxy.py` forwards. Breach fails closed to deny with
  `decision_reason=budget`; warn fires an alert. Budget changes are control-plane events.
- **Cost correctness (FR-77).** `usage_events` gains cache-read, cache-creation and reasoning token
  columns; `core/pricing.py` prices cache-read tokens separately. Estimated and provider-billed are
  displayed side by side.
- **Break-glass (FR-84).** Named, time-boxed, writes a control-plane event and notifies all admins.
  There is no silent elevation path.

#### 2.C.8 Event egress and alerting (FR-146 … FR-152)

- `event_sinks(tenant_id, kind ∈ {webhook, siem, otlp}, endpoint, secret_ref, format ∈
  {xsom_v1, ocsf, cef}, filter, enabled)` + `sink_cursors(sink_id, last_audit_id, updated_at)`.
  `core/egress.py` reads `audit_log` by **id watermark**, so a sink outage backfills from the cursor
  instead of losing events (G-C5). HMAC-SHA256 signing with stdlib `hmac`; delivery with `httpx`
  (already a dependency); at-least-once with exponential backoff. Denials, holds and gate events are
  included — a feed that omits denied requests is not complete.
- `core/ocsf.py` is a **pure mapper** (audit row → OCSF API-Activity JSON), ~80 lines, fully
  unit-testable, no dependency. Egress carries metadata + `args_hash` only, never argument content
  (G-P3), and that property is tested — which is what makes "our stream is safe to forward because
  it contains no content by construction" a claim rather than a hope.
- **Trace export (FR-148).** `core/otel_export.py` emits one span per decision to any
  `OTEL_EXPORTER_OTLP_ENDPOINT`, propagating the caller's trace context, **off by default**. See
  §6 for why this is hand-rolled OTLP/HTTP+JSON over `httpx` rather than a new SDK dependency.
- **Notifications (FR-149, FR-150).** The `Notifier` protocol widens from `notify_approval` to
  `notify(event: NotificationEvent)`. `notification_channels(tenant_id, kind, target, events[],
  enabled)` replaces the single process-wide `APPROVAL_NOTIFY_TO` address. Alerts fire on: approval
  created, approval approaching expiry, tool drift/poison quarantine, tainted action, behavioural
  drift, chain verification failure, checkpoint/anchor failure, budget threshold and breach,
  deny-rate anomaly, halt and resume.
- **Decide where the human works (FR-21).** A signed interactive channel message carries an
  Approve/Deny callback to `POST /v1/approvals/{id}/decision/callback`, authenticated by HMAC **and**
  a single-use per-approval nonce, resolved to a **Member identity** — never a shared bot identity —
  so RBAC and separation of duties apply identically to the console path. **Invariant guarded
  (§4.1):** the channel is how the human is *asked*; the gateway still decides and records.
  OQ-11 gates the minimum acceptable authentication.
- **Telemetry ingest (FR-151, FR-152).** `core/otlp_genai.py` dual-reads
  `gen_ai.provider.name` → `gen_ai.system` → `mip.ai.provider`, and `is_gen_ai` recognises
  `gen_ai.provider.name` and `gen_ai.operation.name`. Prefers `gen_ai.conversation.id` over the
  proprietary `mip=s:` tracestate (kept as fallback), and reads `gen_ai.agent.id`,
  `gen_ai.response.finish_reasons`. This is **silent data loss today** — modern instrumentation is
  dropped without even being counted as rejected — so it ships first (§ Appendix C).

#### 2.C.9 Scheduled work (OP-4, OP-9)

There is no scheduler in the product today. v2 adds `core/jobs.py` + `xsom worker`: a single-process
loop, each job wrapped in a Postgres **advisory lock** for leader election (multi-replica safe), each
run recorded in `job_runs(job, started_at, finished_at, status, detail)` for console visibility and
alerting on failure. Jobs: approval expiry sweep, retention purge, checkpointing, anchoring, egress
dispatch, behavioural baselines, budget rollups. Every job is idempotent. See §6 for why this is not
Celery or APScheduler.

#### 2.C.10 Console surfaces (FR-107 … FR-112)

**Definition-of-done rule: a backend capability without a console surface does not ship (FR-110).**
New pages under `frontend/app/(app)/`: `compliance/`, `integrity/` (quarantine queue with a
description diff and re-baseline — today a quarantine is a dead end reachable only by `curl`),
`trust/` (risk-band editor with an observed-score histogram and a "how many past decisions would
this band have changed" preview), `sessions/[id]/` (the lineage timeline), `control/` (halt/resume
and break-glass), `budgets/`, `members/`, `sinks/`, `systems/` (AI System registry). Existing pages
are rebuilt where they lie: the approvals card becomes the full Decision Brief (FR-17), and the audit
explorer gains a timestamp column, filters bound to the query parameters `api/audit.py:37-42` already
accepts, and a row-detail drawer showing hashes, reason, risk breakdown, linked gate rows by
correlation id and the linked approval with its deciders (FR-116). English/French parity is tested
for the approval and audit surfaces (FR-112).

`api/servers.py` config handling is bounded and key-validated, rejects inline secrets with an
instruction to use an environment reference, and restricts `config` to admins — closing the one
place in the codebase where a credential can be stored in clear text and read by a viewer (FR-111).

---

## 3. Decision register

Each entry: options considered → choice → why → the invariant it must not break.

**AD-1 · Where new audit fields live.**
*Options:* (a) extend `_payload` and re-chain historical rows; (b) a parallel v2 chain; (c) annex
columns + signed checkpoints. **Choice: (c).** (a) invalidates every historical verification and
destroys the product's central claim; (b) doubles the write path and the verifier for a benefit
checkpoints already deliver. **Invariant: §4.2 / V-2.** `core/audit.py::_payload` and
`compute_entry_hash` are not modified by any v2 work; `verify_chain` stays green on every existing
row; the annex is covered by `annex_digest` inside a signed checkpoint, and AT-4 states plainly that
the payload hash does not cover it.

**AD-2 · Guaranteeing control-plane coverage.**
*Options:* (a) middleware that infers events from method+path; (b) a route decorator; (c) an explicit
call inside the mutation's transaction plus a route-enumeration build gate. **Choice: (c).** The
event needs semantic fields middleware cannot invent, and it must be written in the *same*
transaction as the mutation. **Invariant: §4.2 (append-only) and §4.10 (content).** The event stores
digests and object refs, never documents or secrets; `scripts/audit_security.py` enforces it, and
the enumeration test is SM-4, a build gate rather than a report.

**AD-3 · When a human decision is chained.**
*Options:* (a) keep chaining at consumption; (b) chain at decision time and drop the consumption
entry; (c) chain at decision time **and** add an additive `hitl_executed` at consumption.
**Choice: (c).** (a) loses the denial entirely when the agent never returns — precisely the denials
that matter most. (b) loses the execution link. **Invariant: §4.1 and V-3.** The approver's identity
uses the **existing in-payload `user_id`** field, so it is chain-protected with no payload change;
new decision values are additive; `oversight_coverage` moves to counting `actor_type='human'` so it
is immune to future vocabulary growth.

**AD-4 · One pipeline vs. per-path guards.**
*Options:* (a) copy the missing guards into `core/decision.py`; (b) extract `core/pipeline.py` that
both paths call. **Choice: (b).** (a) reproduces the defect the next time a guard is added — the
root cause is duplication, not omission. **Invariant: §4.1 and §4.4.** HITL stays a gateway
decision; the pipeline never delegates to a model; every guard states its failure verdict (§3.9),
and a cross-path equivalence test plus a golden-decision corpus prevent the refactor from changing
any existing verdict (NFR-7).

**AD-5 · Self-host identity.**
*Options:* (a) run GoTrue in compose; (b) write a local issuer inside the control API; (c) require
Supabase forever. **Choice: (a).** (b) means writing password auth, session and reset flows — new
attack surface — *and* rewriting the console away from `@supabase/ssr`. (c) fails FR-85, OP-10 and
the sovereign buyer outright. **Invariants: §4.3, §4.5, §4.6.** `deploy/auth_compat.sql` creates
`service_role` with `BYPASSRLS` exactly as the hosted provider does, so RLS is genuinely enforced
and `tests/test_rls.py` passes unmodified; tokens remain in `httpOnly`/`Secure`/`SameSite` cookies;
the service key never reaches the `web` container. PRD §5.5 ("not an identity provider") is
preserved: we run a standard issuer and federate to the customer's when configured — we do not
build one.

**AD-6 · Embedded vs external Postgres.**
*Options:* (a) bundle Postgres as the only option; (b) an embedded engine for the demo path;
(c) a compose default that is fully overridable. **Choice: (c).** (b) would need a second dialect,
and RLS, the append-only triggers and advisory locks are not portable. **Invariant: §4.3.** Tenant
isolation is Postgres RLS on a single node exactly as on Supabase, proven by the same test.

**AD-7 · Migration runner ownership.**
*Options:* (a) keep applying migrations from `tests/`; (b) a third-party migration tool
(alembic/sqitch/atlas); (c) a small forward-only runner in `core/`. **Choice: (c).** (a) makes the
image unable to migrate itself and inverts the dependency direction; (b) adds a dependency and a
second source of truth for a 15-file, forward-only, plain-SQL history. **Invariant: V-4 and §4.2.**
Applied migrations are immutable, checksummed, and never edited; the runner takes an advisory lock
so two replicas cannot race; FR-100's previous-release-to-head job asserts `verify_chain` stays
green across the upgrade.

**AD-8 · Checkpoint signature algorithm and key custody.**
*Options:* (a) per-row signing; (b) periodic checkpoint signing; (c) hash-only, no signature.
**Choice: (b), Ed25519 via the already-present `cryptography`.** (a) costs a signature on the hot
path and would tempt a payload change; (c) leaves the vendor attesting its own database.
**Invariant: §4.2 and §4.7.** `audit_log` is untouched — checkpoints live in their own table; the
signing key is generated locally by `xsom init` and never committed; custody is **OQ-9, disclosed
not decided**, and §2.B.2 states that a vendor-held key weakens the independence the checkpoint
exists to establish, which is why anchoring (AD-9) exists.

**AD-9 · Anchor destinations.**
*Options:* (a) RFC 3161 timestamp authority; (b) public transparency log; (c) customer object-lock
bucket; (d) signed webhook to the tenant. **Choice: ship (d) + a `file` target that covers (c) via a
mount; defer (a) and (b).** (a) and (b) require network egress that the air-gapped buyer self-host
is meant to unlock cannot have, and both add dependencies. **Invariant: §4.10 and OP-10.** The
anchor payload is a digest tuple only — no events, no content. Offline deployments degrade to
`file` and report the absence of an external witness rather than pretending to have one. OQ-2 picks
the default.

**AD-10 · Taint state location.**
*Options:* (a) keep in-process; (b) Redis; (c) Postgres table keyed on the durable session.
**Choice: (c).** (a) resets on every reconnect — the common orchestrator pattern — and cannot cross
ingress paths; (b) adds a required service to the ten-minute promise. **Invariants: §4.3 and §4.4.**
`session_taint` carries RLS from its creating migration; an unresolvable session on an
`irreversible` action is treated as **tainted, never clean** (V-9); a database failure reading taint
denies `irreversible`/`external_send`.

**AD-11 · Fingerprint algorithm change.**
*Options:* (a) include annotations and accept a mass drift event; (b) never include annotations;
(c) versioned fingerprints with a one-time silent re-baseline of provably-unchanged tools.
**Choice: (c).** (a) floods every customer's quarantine queue on upgrade and trains operators to
click through drift — the worst possible outcome for a supply-chain control. (b) leaves the hole
FR-54 exists to close. **Invariants: §4.4 and NFR-7.** Re-baselining fires only when the recomputed
**v1** fingerprint still matches the stored v1 (i.e. the definition is provably unchanged); every
re-baseline writes a `system` control-plane event; a genuine change still quarantines.

**AD-12 · Rate-limit storage.**
*Options:* (a) require Redis; (b) in-process only; (c) principal-keyed with an optional shared
storage URI. **Choice: (c).** (a) breaks G-C4 and A-7; (b) is incorrect across replicas.
**Invariant: §4.9 and OP-9.** Limits key on the resolved tenant/agent on authenticated surfaces and
on the address only where there is no principal; the single-node degradation is documented, not
silent (G-S6).

**AD-13 · Scheduler.**
*Options:* (a) Celery; (b) APScheduler; (c) external cron; (d) a loop with Postgres advisory locks.
**Choice: (d).** (a) and (b) are dependencies plus, for Celery, a broker — a second required service.
(c) is not available in every target environment and is invisible to the console.
**Invariant: OP-9 and §4.4.** Advisory locks make it multi-replica correct; every job is idempotent
and records `job_runs`; a job that cannot run alerts rather than silently skipping — and no job is
on the decision path, so a stalled worker never allows an action.

**AD-14 · Trace export implementation.**
*Options:* (a) `opentelemetry-sdk` + OTLP exporter; (b) hand-rolled OTLP/HTTP+JSON over `httpx`.
**Choice: (b)** — see §6. **Invariant: §3 (dependency discipline) and §4.10.** Attributes carry
decision, action class, risk score, policy rule and approval id — never arguments, which is also the
telemetry standard's own default, so the standard and the invariant agree.

**AD-15 · Erasure vs. the immutable chain.**
*Options:* (a) allow chain erasure for data-subject requests; (b) refuse erasure entirely;
(c) erase operational tables, never the chain, and publish the reconciliation.
**Choice: (c).** **Invariant: §4.2, explicitly resolved in favour of the invariant** (PRD FR-135,
C-4). `audit_log` is never erased; `docs/DATA_MANIFEST.md` asserts, as a product position, that
pseudonymised metadata retained under a legal-obligation basis is not erasable personal data. That
argument *is* the product and it is stated, not implied.

**AD-16 · Where the decision reason lives.**
*Options:* (a) keep multiplexing through `error`; (b) a `reason` field inside the payload;
(c) a dedicated `decision_reason` annex column with an enumerated vocabulary. **Choice: (c).**
(a) misleads every auditor who reads a column named `error`; (b) is a payload change.
**Invariant: §4.2 and AT-7.** Gate reasons become enumerated codes rather than free text, and the
vocabulary is published in `docs/AUDIT_FORMAT.md` with a tolerate-unknown-values rule (V-3).

**AD-17 · Correlation identity.**
*Options:* (a) redefine `request_id`; (b) add `correlation_id` as an annex column.
**Choice: (b).** `request_id` is inside Payload v1 and means three different things across the three
producers; it cannot be retro-fixed. **Invariant: V-2.** `correlation_id` is generated once per tool
call and shared by the decision entry and every gate entry (FR-58, AT-6); the historical mapping is
documented rather than rewritten.

**AD-18 · Foreign keys on `audit_log`.**
*Options:* (a) FK new annex references with cascade/set-null; (b) no FK, bare ids.
**Choice: (b).** A cascade DELETE or a set-null UPDATE on `audit_log` is rejected by the `0005`
triggers, which would make the *parent* delete fail. **Invariant: §4.2.** Migration `0017` also
drops the latent `0006` FK to `gateway_tokens` while keeping the column and index.

**AD-19 · SBOM generation.**
*Options:* (a) `cyclonedx-py` + `cyclonedx-npm`; (b) a small script over `uv.lock` and
`package-lock.json`. **Choice: (b)** — stdlib `tomllib` + `json`, deterministic, ~80 lines.
**Invariant: §3.** Zero new dependencies for an artifact whose whole purpose is enumerating
dependencies.

**AD-20 · Evaluate-only replay.**
*Options:* (a) replay writes a normal audit entry; (b) replay writes nothing; (c) replay writes
nothing to the decision record but the *request* is a control-plane event.
**Choice: (c).** **Invariants: §4.1, §4.4, G-S2.** Replay contacts no downstream server (a test
asserts zero invocations), consults the judge only when explicitly requested (so it neither burns
budget nor becomes non-deterministic), and cannot execute anything — while the operator action that
triggered it is still on the record.

---

## 4. Data model changes

Numbering continues from `supabase/migrations/0015_tool_fingerprints_last_fp.sql`. The `0012` gap is
grandfathered and documented (V-4 forbids renumbering a released migration).

**Rules applied to every new table** (NFR-4, §4.3): RLS enabled in its creating migration; a
`*_select_own` policy reading `auth.jwt() -> 'app_metadata' ->> 'tenant_id'`; `grant select … to
authenticated`; writes by the backend `service_role` (which bypasses RLS) unless a console user must
write directly, in which case an explicit write policy is added; a two-tenant isolation test.

### 0016 — `schema_migrations` (ledger)
```sql
create table if not exists schema_migrations (
    version    text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now(),
    applied_by text
);
```
No RLS (operational metadata, no tenant dimension; readable only by the backend role). Also created
idempotently by `core/migrate.py` itself to resolve the chicken-and-egg.

### 0017 — audit provenance annex + truncation block
```sql
alter table audit_log
    add column if not exists actor_type       text,      -- human | agent | system
    add column if not exists decision_reason  text,
    add column if not exists escalated_by     text,
    add column if not exists enforcement_mode text,
    add column if not exists policy_version   int,
    add column if not exists product_version  text,
    add column if not exists correlation_id   text,
    add column if not exists session_id       text,
    add column if not exists trace_id         text,
    add column if not exists risk_score       int,
    add column if not exists risk_band        text,
    add column if not exists risk_factors     jsonb,
    add column if not exists lineage          jsonb,
    add column if not exists outcome_status   text,
    add column if not exists approval_outcome text,
    add column if not exists guards_run       text[],
    add column if not exists ai_system_id     uuid;      -- NO foreign key (AD-18)

create index if not exists idx_audit_correlation on audit_log (tenant_id, correlation_id);
create index if not exists idx_audit_session     on audit_log (tenant_id, session_id);
create index if not exists idx_audit_actor       on audit_log (tenant_id, actor_type, id desc);
create index if not exists idx_audit_reason      on audit_log (tenant_id, decision_reason);

-- AD-18: a cascade/set-null on an append-only table would fire the 0005 triggers.
alter table audit_log drop constraint if exists audit_log_gateway_token_id_fkey;

-- FR-123: row triggers do not fire on TRUNCATE.
create trigger audit_log_no_truncate before truncate on audit_log
    for each statement execute function audit_log_block_mutation();
```
All columns nullable → existing rows unchanged → `verify_chain` unaffected. No new RLS needed
(`audit_select_own` already covers the table).

### 0018 — checkpoints and anchors
```sql
create table if not exists audit_checkpoints (
    id             bigint generated always as identity primary key,
    tenant_id      text not null,
    first_id       bigint not null,
    last_id        bigint not null,
    entry_count    int not null,
    head_hash      text not null,
    payload_digest text not null,
    annex_digest   text not null,
    algo           text not null default 'ed25519',
    key_id         text not null,
    public_key     text not null,
    signature      text not null,
    created_at     timestamptz not null default now()
);
create index if not exists idx_ckpt_tenant on audit_checkpoints (tenant_id, last_id desc);

create table if not exists audit_anchors (
    id            bigint generated always as identity primary key,
    tenant_id     text not null,
    checkpoint_id bigint not null references audit_checkpoints (id),
    destination   text not null,           -- webhook | file
    external_ref  text,
    status        text not null default 'pending',  -- pending | published | failed
    attempts      int not null default 0,
    published_at  timestamptz,
    created_at    timestamptz not null default now()
);
```
Both RLS-enabled with `*_select_own` on `tenant_id`. Checkpoints get the same append-only trigger
pattern as `audit_log` (they are evidence about evidence). Anchors are *not* append-only — delivery
status must be updatable — which is exactly why the anchor's *content* is a digest tuple already
signed inside the checkpoint.

### 0019 — halts and job runs
```sql
create table if not exists halts (
    id            bigint generated always as identity primary key,
    tenant_id     uuid not null references tenants (id) on delete cascade,
    scope         text not null check (scope in ('tenant','agent','tool')),
    scope_ref     text,                    -- null for tenant scope
    reason        text not null,
    halted_by     text not null,
    halted_at     timestamptz not null default now(),
    resumed_by    text,
    resume_reason text,
    resumed_at    timestamptz
);
create index if not exists idx_halts_active
    on halts (tenant_id, scope, scope_ref) where resumed_at is null;

create table if not exists job_runs (
    id          bigint generated always as identity primary key,
    job         text not null,
    tenant_id   uuid,
    started_at  timestamptz not null default now(),
    finished_at timestamptz,
    status      text not null default 'running',
    detail      jsonb
);
create index if not exists idx_job_runs_recent on job_runs (job, started_at desc);
```

### 0020 — policy versions
```sql
create table if not exists policy_versions (
    id         bigint generated always as identity primary key,
    tenant_id  uuid not null references tenants (id) on delete cascade,
    version    int not null,
    yaml       text not null,
    author     text not null,
    note       text,
    scope      jsonb,                      -- null = tenant-wide (FR-12, deferred)
    created_at timestamptz not null default now(),
    unique (tenant_id, version)
);
alter table tool_policies add column if not exists active_version int;
-- Backfill: the current row becomes version N in policy_versions and active_version = N.
```
Append-only trigger (UPDATE/DELETE blocked) so a published policy version can never be edited — the
same reasoning as `audit_log`, because `policy_version` on an audit entry must resolve to an
immutable document.

### 0021 — membership writes and separation of duties
```sql
create policy memberships_admin_insert on memberships for insert to authenticated
    with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
                and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
-- plus matching update/delete policies, and grants.
alter table approvals add column if not exists decision_reason_text text;  -- FR-16 justification
```

### 0022 — AI System registry
```sql
create table if not exists ai_systems (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants (id) on delete cascade,
    name text not null, owner text, purpose text,
    model text, framework text, framework_version text,
    environment text check (environment in ('dev','staging','prod')),
    risk_tier text, data_categories text[], lifecycle_state text not null default 'draft',
    documentation_url text,
    created_at timestamptz not null default now(), archived_at timestamptz
);
alter table gateway_tokens add column if not exists ai_system_id uuid references ai_systems (id);
```

### 0023 — sessions and durable taint
```sql
create table if not exists sessions (
    tenant_id uuid not null references tenants (id) on delete cascade,
    session_id text not null,
    first_seen timestamptz not null default now(),
    last_seen  timestamptz not null default now(),
    gateway_token_id uuid,
    trace_id text,
    primary key (tenant_id, session_id)
);

create table if not exists session_taint (
    tenant_id   uuid not null references tenants (id) on delete cascade,
    session_id  text not null,
    marked_at   timestamptz not null default now(),
    source_tool text not null,
    reason      text not null,
    call_count  int not null default 0,
    expires_at  timestamptz not null,
    primary key (tenant_id, session_id)
);
```

### 0024 — budgets
```sql
create table if not exists budgets (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants (id) on delete cascade,
    scope text not null check (scope in ('tenant','agent')),
    scope_ref text,
    period text not null check (period in ('day','week','month')),
    cap_usd numeric(12,4) not null check (cap_usd > 0),
    warn_pct int not null default 80 check (warn_pct between 1 and 100),
    action text not null default 'deny' check (action in ('deny','notify')),
    created_at timestamptz not null default now(), updated_at timestamptz
);
```

### 0025 — event sinks, cursors, notification channels
```sql
create table if not exists event_sinks (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants (id) on delete cascade,
    kind text not null check (kind in ('webhook','siem','otlp')),
    endpoint text not null,
    secret_ref text,                       -- envelope-encrypted via core/secrets.py
    format text not null default 'xsom_v1' check (format in ('xsom_v1','ocsf','cef')),
    filter jsonb, enabled boolean not null default true,
    created_at timestamptz not null default now(), revoked_at timestamptz
);
create table if not exists sink_cursors (
    sink_id uuid primary key references event_sinks (id) on delete cascade,
    last_audit_id bigint not null default 0,
    updated_at timestamptz not null default now(),
    failures int not null default 0
);
create table if not exists notification_channels (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants (id) on delete cascade,
    kind text not null check (kind in ('email','webhook')),
    target text not null,
    events text[] not null default '{}',
    enabled boolean not null default true
);
```

### 0026 — integrity v2
```sql
alter table tool_fingerprints
    add column if not exists fp_version    int not null default 1,
    add column if not exists poison_reason text,
    add column if not exists annotations_hash text;
```

### 0027 — gen_ai usage v2
```sql
alter table usage_events
    add column if not exists cache_read_tokens     int not null default 0,
    add column if not exists cache_creation_tokens int not null default 0,
    add column if not exists reasoning_tokens      int not null default 0,
    add column if not exists conversation_id       text,
    add column if not exists agent_id              text,
    add column if not exists finish_reason         text;
```

### 0028 — retention, legal hold, erasure log
```sql
create table if not exists retention_runs (
    id bigint generated always as identity primary key,
    tenant_id uuid, ran_at timestamptz not null default now(),
    rows_removed int not null default 0, floor_days int not null, ok boolean not null
);
create table if not exists legal_holds (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants (id) on delete cascade,
    scope text not null, scope_ref text, reason text not null,
    set_by text not null, set_at timestamptz not null default now(), lifted_at timestamptz
);
```

**Total: migrations 0016 → 0028.** Every one is forward-only, checksummed by the ledger, and never
edited after release (V-4). Each new table gets its RLS policy in the same file and a two-tenant
isolation test in `tests/test_rls.py`.

---

## 5. Module map

### 5.1 New modules

| Path | Purpose | Extends / replaces |
|---|---|---|
| `core/pipeline.py` | The single Guard Pipeline (`CallContext`, `Verdict`, `evaluate_call`) | Extracts `gateway/server.py:127-203` + `core/decision.py:77-219` |
| `core/provenance.py` | `Provenance` dataclass, enumerated reason/escalation vocabularies | New; consumed by `core/audit.py` |
| `core/control.py` | Halt/resume state and `is_halted` | New; first guard in the pipeline |
| `core/control_events.py` | `record()` for control-plane events | Wraps `core/audit.py::log_event` |
| `core/checkpoint.py` | Checkpoint build, sign, verify; `CheckpointSigner` protocol | Uses `core/audit.py`, `core/secrets.py` |
| `core/anchor.py` | `AnchorTarget` protocol; webhook + file targets | Uses `core/checkpoint.py`, `core/egress.py` |
| `core/egress.py` | Cursor-based outbound dispatcher, HMAC signing, retries | New; reads `audit_log` |
| `core/ocsf.py` | Pure audit-row → OCSF mapper | New; no dependency |
| `core/otel_export.py` | One span per decision, OTLP/HTTP+JSON over `httpx` | New; off by default |
| `core/policy_versions.py` | Append-only version store | Replaces the destructive path in `core/policy_store.py:40-52` |
| `core/policy_diff.py` | Structured rule-level diff | New |
| `core/policy_sim.py` | Candidate policy vs. historical decisions | New; reads `audit_log` |
| `core/policy_templates/` | Starter policy documents | New; used by `xsom init` |
| `core/taint_store.py` | Durable taint persistence | Takes state out of `gateway/taint.py::TaintState` |
| `core/baseline.py` | Deterministic behavioural statistics | New; reads `audit_log` |
| `core/sessions.py` | Durable session identity and timeline stitching | Joins `audit_log` + `usage_events` + `approvals` |
| `core/systems.py` | AI System registry | New; `gateway_tokens` become credentials |
| `core/members.py` | Membership plane | Uses `core/signup.py::AuthAdmin` |
| `core/budgets.py` | Budget definition and evaluation | Reads `core/usage.py` |
| `core/frameworks.py` | Declarative control mappings (AI Act, GDPR, ISO 42001, NIST, SOC 2) | Feeds `core/export.py` |
| `core/data_manifest.py` | Declared column classification | New; enforced in CI |
| `core/jobs.py` | Scheduled jobs with advisory-lock leader election | New; run by `xsom worker` |
| `core/migrate.py` | Forward-only runner + ledger | Replaces `tests/conftest.py:147` / `scripts/demo.py:74` |
| `api/health.py` | `/health/ready` | Splits `api/main.py:102-105` |
| `api/control.py` | `POST /v1/control/halt|resume` | New |
| `api/members.py` | `/v1/members` | New |
| `api/systems.py` | `/v1/systems` | New |
| `api/sessions.py` | `GET /v1/sessions/{id}` | New |
| `api/budgets.py` | `/v1/budgets` | New |
| `api/sinks.py` | `/v1/sinks` | New |
| `api/data.py` | `/v1/data/manifest`, `/v1/data/erasure` | Calls `core/usage.py::erase_session` (zero callers today) |
| `cli/` (`main.py`, `init.py`, `doctor.py`, …) | The `xsom` CLI | New; `[project.scripts]` entry point |
| `tools/xsom_verify.py` | Standalone stdlib-only chain verifier | New; imports nothing from `core/` |
| `scripts/migrate.py` | Thin CLI wrapper | Wraps `core/migrate.py` |
| `scripts/pgcluster.py` | Ephemeral PG harness | Moved from `tests/pgcluster.py` |
| `scripts/sbom.py` | CycloneDX from `uv.lock` + `package-lock.json` | New |
| `scripts/dump_openapi.py` | `docs/openapi.json` | New |
| `docker-compose.yml`, `frontend/Dockerfile`, `deploy/auth_compat.sql` | Self-host stack | New; the shim is promoted out of `tests/fixtures/` |
| `.github/workflows/deploy-smoke.yml`, `release.yml` | Deployability gate; SBOM/provenance/signing | New |

### 5.2 Changed modules

| Path | Change |
|---|---|
| `core/audit.py` | `log_event(..., provenance)` writes annex columns; new `log_gate_event`; `list_events` returns `prev_hash`, `entry_hash`, `tenant_id` + all payload fields. **`_payload` and `compute_entry_hash` untouched.** |
| `core/config.py` | `cors_allow_origins: Annotated[list[str], NoDecode]` (D10 fix); pluggable issuer keys; sink/worker/anchor/rate-limit keys; `SUPABASE_*` accepted and deprecated per V-6 |
| `core/policy.py` | `classify_by_annotation()` as a floor before `classify_by_name`; multilingual stems; tenant `extra_heuristics`; enumerated reasons on `PolicyOutcome` |
| `core/policy_store.py` | `save_yaml` appends a version and updates `active_version` instead of overwriting |
| `core/decision.py` | Body replaced by a `core/pipeline.evaluate_call` call; keeps its HTTP-shaped response mapping |
| `core/risk.py` | `escalate_by_risk` returns a `RiskVerdict(tier, score, factors, discount, band)` instead of a bare tier |
| `core/trust.py` | `observed()` re-keyed on `(tenant, gateway_token_id, tool)` |
| `core/integrity.py` | `fingerprint()` includes annotations, versioned (`fp_version`); `list_status` surfaces persisted `poison_reason` |
| `core/approvals.py` | `decide()` takes a justification; read-path expiry; separation-of-duties check |
| `core/compliance.py` | `oversight_coverage(conn, tenant_id)`; oversight sourced from `actor_type='human'` entries; retention from observation |
| `core/export.py` | `render_pdf` walks `articles`, `human_supervision`, `compliant` and appends hash-bearing entries; framework list from `core/frameworks.py` |
| `core/notify.py` | `Notifier.notify(event)`; per-tenant channels; webhook implementation |
| `core/otlp_genai.py` | Dual-read provider attributes; content denylist; new usage fields |
| `core/usage.py` / `core/pricing.py` | Cache and reasoning tokens priced distinctly |
| `gateway/server.py` | `call_tool` delegates to the pipeline; `ApprovalContext` carries `gateway_token_id`, `session_id`, `ai_system_id`; `_audit`/`_audit_gate` pass `Provenance`; `run_stdio` uses `resolve_principal` |
| `gateway/taint.py` | Keeps `taints_result`; `TaintState` replaced by `core/taint_store.py` |
| `api/main.py` | Registers new routers; principal-keyed limiter; version constant |
| `api/security.py` | Pluggable JWKS issuer; principal on `request.state` for limiting |
| `api/approvals.py` | Chained decision at decision time; mandatory reason; SoD; callback route |
| `api/policy.py` | Version/diff/rollback/simulate routes; `ToolView` gains integrity, constraints and risk-range fields |
| `api/audit.py` | `GET /v1/audit/verify`; hash-bearing exports |
| `api/authorize.py` | Session id, lineage, guard header, enforcement mode |
| `api/servers.py` / `core/schemas.py` | Bounded, key-validated, secret-rejecting server config; admin-only `config` |
| `api/ratelimit.py` | Principal `key_func`; optional `storage_uri` |
| `tests/conftest.py` | Imports `core.migrate` and `scripts.pgcluster` (dependency direction inverted) |
| `scripts/demo.py` | Prefers compose Postgres; no longer imports `tests.*` |
| `scripts/audit_security.py` | Fails on control-plane content leakage and on denied telemetry keys in persisted columns |
| `.dockerignore`, `Dockerfile`, `Makefile`, `railway.json` | Keep migrations/CLI in context; `make migrate`, `make compose-up`; healthcheck → `/health/ready` |
| `frontend/lib/config.ts`, `frontend/app/(app)/onboarding/page.tsx`, `frontend/components/AppShell.tsx` | No vendor URL; correct env var names; nav for the nine new pages |

---

## 6. Dependency policy

CLAUDE.md §3 forbids a dependency outside the imposed stack without written justification.
**v2.0 adds zero required runtime Python dependencies.** Every capability that would conventionally
pull one is listed here with how it is avoided.

| Capability | Conventional dependency | Decision | Why |
|---|---|---|---|
| Ed25519 checkpoint signing | `pynacl` / `cryptography` | **Avoided.** `cryptography` is already installed transitively via the pinned `python-jose[cryptography]` and is already imported by the test suite. | Uses what is present; a direct dependency declaration is added to `pyproject.toml` for honesty, not as a new package. |
| Trace export | `opentelemetry-sdk` + `opentelemetry-exporter-otlp-proto-http` | **Avoided (AD-14).** `core/otel_export.py` emits OTLP/HTTP with `Content-Type: application/json` using `httpx`, which is already a dependency. | One fixed span shape and a closed attribute set — roughly 120 lines, fully unit-testable against a recorded payload. The SDK is the documented fallback if the JSON encoding proves insufficient; taking it would then require the PR justification NFR-11 mandates. |
| SBOM | `cyclonedx-python-lib`, `cyclonedx-npm` | **Avoided (AD-19).** `scripts/sbom.py` reads `uv.lock` with stdlib `tomllib` and `package-lock.json` with stdlib `json`. | Adding dependencies to enumerate dependencies is the wrong trade. |
| Scheduler | `celery` (+ a broker), `apscheduler` | **Avoided (AD-13).** `core/jobs.py` loop + Postgres advisory locks. | A broker would be a second required service and would break G-C4's "no mandatory paid or extra dependency" for self-host. |
| Shared rate-limit storage | `redis` / `limits[redis]` | **Avoided as a requirement (AD-12).** `RATE_LIMIT_STORAGE_URI` is passed through to slowapi's existing parameter; operators who want it install the extra in their own image. | Preserves A-7 and the ten-minute promise. |
| Webhook signing | `standardwebhooks` | **Avoided.** stdlib `hmac` + `hashlib`, timestamped and nonce-bound. | Thirty lines, and the format is documented in `docs/AUDIT_FORMAT.md` (API-7). |
| Self-host identity | writing our own | **Avoided (AD-5).** GoTrue is a *container image*, not a Python dependency; the API's only change is a pluggable JWKS URL. | Zero code-level dependency; PRD §5.5 preserved. |
| Migration runner | `alembic`, `sqitch`, `atlas` | **Avoided (AD-7).** `core/migrate.py`, ~150 lines. | A 15-file forward-only plain-SQL history does not need a framework, and a framework would become a second source of truth for schema state. |
| Connection pooling (FR-78, deferred) | `psycopg_pool` | **Deferred to post-v2.0.** When taken, it is a first-party companion to the already-approved `psycopg` and carries a written PR justification plus the A-8 test (a recycled pooled connection cannot read another tenant's rows) **written before** the pool is introduced. | Performance, not a v2.0 promise. |

**Frontend:** no new runtime dependency. New pages use the existing Next.js 14 + Tailwind +
`@supabase/*` stack. `npm audit` and a licence scan are added to CI (FR-145, deferred but cheap).

**CI-only tooling** (not runtime dependencies, no §3 implication): `actions/attest-build-provenance`,
`cosign`, `trufflehog` (already present), `pip-audit` (already present).

---

## 7. Risks, mitigations, and what we deliberately do not build

### 7.1 Risk register

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R-1 | **The pipeline refactor silently changes a customer's verdicts.** Two guard sequences merge into one; a subtle ordering difference alters a decision. | Med · High | A golden-decision corpus captured from the current code and replayed against the new pipeline; the cross-path equivalence test (FR-1); every new guard off by default (NFR-7). Ship the refactor **before** any new guard so the two changes are never entangled. |
| R-2 | **Annotation-aware fingerprints flood quarantine queues on upgrade**, training operators to click through drift. | Med · High | AD-11's versioned fingerprint with a one-time silent re-baseline of provably-unchanged tools, each recorded as a `system` control-plane event. |
| R-3 | **Checkpoint key custody makes the vendor its own witness** — the exact criticism the feature answers. | High · High | OQ-9 is open and disclosed; the default is a locally-generated key the *operator* holds; anchoring (AD-9) is the real answer and §2.B.2 says so plainly rather than over-claiming. |
| R-4 | **New guards add latency** and become the reason a customer removes xSOM (CM-3, CM-5). | Med · Med | One connection per call shared by every guard (today `gateway/server.py` opens three); halt and budget folded into existing queries; a p95 overhead budget with a CI benchmark. |
| R-5 | **Supervision becomes annoying → tenants widen the auto tier** (CM-1, the single most important counter-metric). | Med · Very High | Risk-score histogram and band preview so bands are set from data (FR-31); trust discount retained; alerting on approaching expiry so holds resolve fast (SM-5); the false-hold rate is tracked (CM-7). |
| R-6 | **GoTrue's asymmetric-signing support at the pinned version does not match expectations**, blocking self-host login. | Med · High | Named degraded mode in §2.A.2, refused when `ENV=prod` and reported by `/health/ready`; verified in the deploy-smoke workflow, which is the gate — a failure here fails CI, not a customer. |
| R-7 | **Migration baseline adoption mis-detects an existing database** and re-runs a non-idempotent migration (`0015` does `set not null` after a backfill). | Low · High | Sentinel-object probing per file group; `--dry-run` prints the adoption plan; the FR-100 previous-release-to-head job runs the real path against a seeded database and asserts `verify_chain` stays green. |
| R-8 | **Egress leaks content** despite the metadata-only claim, which is a marketed property. | Low · Very High | `core/ocsf.py` and the webhook payload are built from a **closed field list**; a test asserts no argument-derived string appears; `scripts/audit_security.py` fails on a denied key in any persisted or emitted column (FR-137). |
| R-9 | **The two chain verifiers diverge** (`core/audit.py` vs `tools/xsom_verify.py`). | Med · High | CI runs both against a generated corpus and asserts agreement, plus a doctored-export negative test. The published algorithm in `docs/AUDIT_FORMAT.md` is the contract both implement. |
| R-10 | **Scope.** v2.0 is 13 migrations, ~25 new modules and 9 console pages. | High · High | Sequencing in Appendix C puts the correctness-debt fixes and the deployability gate first, so value lands even if later groups slip; FR-110's "no surface, no ship" rule prevents backend-only accumulation. |
| R-11 | **The worker becomes a hidden single point of failure** — checkpoints or egress silently stop. | Med · Med | `job_runs` freshness is a `/health/ready` warning and an alert (FR-150); no job is on the decision path, so a stalled worker never allows an action. |
| R-12 | **RLS regression on the self-host path** — the compatibility layer creates a weaker `service_role`. | Low · Very High | `deploy/auth_compat.sql` creates `service_role` with `BYPASSRLS` exactly as the hosted provider does; `tests/test_rls.py` runs **unmodified** against the compose database inside the deploy-smoke workflow. |
| R-13 | **Cooperative enforcement is mistaken for mandatory** in an evidence pack (OQ-3). | Med · High | `enforcement_mode` is persisted (FR-3), returned (FR-2), labelled in the console and in documentation (FR-51), and the conservative treatment applies until legal confirms — disclose, qualify, never claim equivalence (C-7). |
| R-14 | **`request_id` ambiguity is baked into Payload v1** and cannot be fixed retroactively. | Certain · Low | `correlation_id` as an annex column (AD-17); the historical per-producer mapping is documented in `docs/AUDIT_FORMAT.md` rather than rewritten. |

### 7.2 What we deliberately do NOT build

Beyond PRD §5's product non-goals, these are the **architectural** exclusions for v2.0. Each is a
choice, not an omission.

1. **No Payload v2, ever.** No new field enters the hashed payload. If a future need genuinely
   requires one, it is a *new chain* with a documented, verifiable transition — never an in-place
   change (V-2).
2. **No second storage engine.** No SQLite, no embedded database, no document store. RLS, the
   append-only triggers and advisory locks are load-bearing and Postgres-specific.
3. **No message broker, no Redis requirement, no Kubernetes requirement.** Compose is the
   ten-minute promise; Helm follows real cluster demand (FR-90, deferred, A-9).
4. **No ORM and no migration framework.** Plain SQL, plain `psycopg`, a 150-line runner.
5. **No custom identity provider.** We run a standard issuer for self-host and federate to the
   customer's; SAML and SCIM are explicitly out of v2.0.
6. **No agent-argument storage in `audit_log`.** The Argument Vault (FR-136) is deferred pending
   OQ-4 and, if it ever ships, is a *separate*, opt-in, envelope-encrypted store with its own
   retention and its own access audit — never `audit_log`.
7. **No machine learning.** Behavioural baselines are deterministic, explainable statistics. An
   unexplainable escalation is worse than none for this product.
8. **No LLM anywhere near a verdict.** The judge classifies `ambiguous` tools and writes narrative
   prose. It never decides, never approves, never authors a dry-run (§4.1, NFR-1, G-S1).
9. **No in-flight call cancellation on halt.** Halt blocks calls not yet relayed; the limit is
   published (OQ-5, §2.C.2).
10. **No conformance to working-draft interop specifications.** The standards façade (FR-52) waits
    for stabilisation; premature conformance is a maintenance liability (A-5, OQ-8).
11. **No expansion of the observability plane.** It is frozen at "enough to decide and to explain a
    decision". We emit into the customer's stack (FR-148); we do not compete with it (§5.3).
12. **No streaming enforcement in v2.0.** FR-5 reassembles and audits streamed tool calls in a later
    release; until then the LLM proxy declares `hitl=unavailable` on streams rather than silently
    degrading `hold` to `strip` (G-S6).
13. **No automatic containment.** Manual Emergency Stop must be proven in production before any
    trigger is trusted to halt a customer's agent (FR-28, deferred).
14. **No connection pooling in v2.0.** FR-78 waits for its dependency justification and its
    RLS-under-pooling test (A-8).

---

## Appendix A — The Guard Pipeline, in order

Every ingress path executes exactly this sequence, in `core/pipeline.py`. Each row states the guard,
its data source, its failure verdict, and its default state.

| # | Guard | Source | Failure verdict | Default |
|---|---|---|---|---|
| 1 | **halt** | `halts` (same connection) | deny `irreversible`/`external_send`; `defaults.on_guard_unavailable` otherwise | always on |
| 2 | **integrity** | `tool_fingerprints` | deny (quarantine is fail-closed) | off (`integrity_enabled`) |
| 3 | **rbac** | `rule.constraints.allowed_clients` vs resolved client | deny | on when constrained |
| 4 | **budget** | `budgets` + `usage_events` | deny on breach; `deny` if unreadable and class is risky | off (no budget rows) |
| 5 | **policy** | `core/policy.py` — annotations floor → explicit rule → name heuristics → `unknown_tool` | `unknown_tool` (`deny`) | always on |
| 6 | **judge** | `core/judge.py`, only for `classify: ambiguous` | over-classify to `irreversible` | on when configured |
| 7 | **risk** | `core/risk.py` + `core/trust.py` | keep the policy tier (risk may only tighten) | off (`risk_bands`) |
| 8 | **taint** | `session_taint` | unresolvable session ⇒ **treated as tainted** | off (`taint_policy`) |

Invariants that hold across the whole sequence:

- Guards may only move the tier **up** the severity order (`auto < notify < human_in_the_loop <
  human_dual < deny`). No guard, score, annotation or trust streak can place an `irreversible`
  action in `auto` (FR-33, G-S3 for halt specifically).
- `Provenance.guards_run` records exactly which guards executed, and it is returned to the caller and
  persisted (FR-2, FR-3).
- Every guard receives the **same open connection**; no guard opens its own (NFR-3).
- `enforcement_mode="evaluate_only"` short-circuits execution entirely and contacts no downstream
  server (FR-60).

## Appendix B — The audit record contract

```
PAYLOAD v1  (hashed — FROZEN, core/audit.py::_payload, never modified)
  ts · tenant_id · user_id · request_id · tool_name · action_class · decision ·
  policy_rule_id · judge_used · args_hash · latency_ms · error
  entry_hash = sha256(prev_hash || json(payload, sort_keys, separators=(",",":")))
  prev_hash rooted at "GENESIS", per tenant, serialised by pg_advisory_xact_lock

ANNEX  (not hashed by the payload — covered by signed checkpoints)
  gateway_token_id (0006) · actor_type · decision_reason · escalated_by ·
  enforcement_mode · policy_version · product_version · correlation_id ·
  session_id · trace_id · risk_score · risk_band · risk_factors · lineage ·
  outcome_status · approval_outcome · guards_run · ai_system_id

CHECKPOINT  (audit_checkpoints)
  (tenant_id, first_id, last_id, count, head_hash, payload_digest, annex_digest)
  signed Ed25519, key_id + public_key published in every export

ANCHOR  (audit_anchors)
  a checkpoint published to a destination outside xSOM's control
```

Published in `docs/AUDIT_FORMAT.md` together with the enumerated `decision_reason` vocabulary, the
per-producer `request_id` history, the webhook signature format, and the standalone verifier
algorithm. **This is the most stable contract in the product** (API-8) — and AT-4's honest limits
are published with it, not discovered by an adversarial auditor.

## Appendix C — Suggested build order (hand-off to `docs/BUILD_PLAN_V2.md`)

Ordered so that correctness debt and the deployability gate land first, value is demonstrable at
every step, and the two riskiest changes (R-1 pipeline, R-2 fingerprint) are never entangled.

1. **Correctness debt, hours not days.** D10 CORS boot fix + `tests/test_env_example.py`; `.env.example`
   missing keys; `XSOM_TENANT_TOKEN` snippet; vendor URL removal; OTLP dual-read; `oversight_coverage`
   tenant predicate; truncate trigger. Each is a one-file change with a regression test.
2. **The deployability gate.** `core/migrate.py` + ledger, compose, frontend image, `auth_compat.sql`,
   `/health/ready`, `xsom` CLI, `deploy-smoke.yml`. **Nothing after this ships without passing it.**
3. **Provenance and the chain.** Migrations 0016–0018; `core/provenance.py`; `log_event` annex;
   hash-bearing exports; `tools/xsom_verify.py`; checkpoints; `GET /v1/audit/verify`.
4. **Supervising the supervisors.** `core/control_events.py`, the route-enumeration build gate,
   chained human decisions with justification, halt/resume.
5. **The pipeline refactor**, alone, behind the golden-decision corpus.
6. **Coverage.** Policy versions, agent attribution, durable sessions and taint, AI System registry,
   membership, budgets, outcomes, baselines.
7. **Egress and surfaces.** Sinks, OCSF, OTLP export, per-tenant channels, alerting, and the nine
   console pages — remembering FR-110: a backend capability without an operator surface has not shipped.

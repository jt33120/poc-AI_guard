# xSOM AI Guard

An **action-control gateway** for AI agents. The agent reaches its tools *through*
xSOM, which on every tool-call:

- applies a deterministic **authorization policy** (auto / notify / human-in-the-loop / deny),
- keeps a **human in the loop** for irreversible actions (dry-run + approval + timeout),
- writes an **immutable, hash-chained audit log** exportable for EU AI Act / GDPR.

The differentiator: we control what the agent **does**, not just what it is told.

```
 Agent ──MCP──▶  xSOM AI Guard  ──MCP──▶  downstream tool servers (mail, CRM, fs…)
                 policy → HITL → audit
                       │
        ┌──────────────┼─────────────────┐
        ▼              ▼                  ▼
   Postgres        LLM judge          Control API (FastAPI)
   (RLS +          (Mistral, thin)    ◀── Next.js console
    append-only audit)                (inspector, approvals, audit, policy)
```

Three ways in, same verdict vocabulary: the **MCP gateway** (stdio, beside the
agent — enforcement is mandatory), `POST /v1/authorize` (any language, one HTTP
call before you execute a tool), and the **LLM provider proxy** (point an SDK's
`base_url` at xSOM for zero-code monitoring).

## What it does

| Area | Shipped |
|---|---|
| **Policy** | YAML rules + auto-classification (read / write / external_send / irreversible / unknown), per-class approval levels, deny-by-default on unknown tools, natural-language policy drafting. |
| **Human oversight** | Dry-run preview, approval queue, expiry = denial, email notification, per-tool RBAC scoped to a client. |
| **Audit** | Append-only hash-chained entries, `verify_chain`, tenant-scoped exports, AI Act evidence packs (art. 12 / 14 / 26) and a retention floor. |
| **Risk & trust** | Deterministic per-action risk score with bands, earned per-tool trust, graduated escalation instead of a binary gate. |
| **Tool integrity** | MCP tool fingerprinting, drift/poison detection, quarantine at the proxy, operable approve / re-baseline. |
| **Taint** | Indirect prompt-injection taint tracked across a session and enforced at the action boundary. |
| **Egress DLP** | Outbound prompt scanning: block fixed-form secrets, flag structured PII — value never logged (kind + hash only). |
| **AI observability** | Per-agent usage, cost and latency, OTLP `gen_ai` ingestion, cost-anomaly detection. |
| **Tenancy** | Multi-tenant by Postgres RLS, self-serve signup, gateway tokens (hash-stored), client/project scoping. |

## xSOM Signal console

The console and corporate site share the versioned `frontend/design-system/`
package: warm charcoal / copper tokens, self-hosted fonts and mark, verdict
colors, interactive diagrams and accessible display preferences. The source
tokens are `frontend/design-system/design/tokens.json`, vendored from the
corporate repository. Edit that canonical package, regenerate with
`node design-system/build.mjs`, then synchronize both repos as documented in
`frontend/design-system/README.md`. Do not change generated token CSS by hand.
See `frontend/design-system/VOICE.md` for copy rules.

Start only the frontend with `cd frontend && npm ci && npm run dev`; use the
existing `.env.example` configuration for Supabase and `CONTROL_API_URL`.
`npm run typecheck`, `npm run lint`, `npm run build` and `npm run test:e2e`
validate the frontend. E2E fixtures are hermetic and are never live customer data.

The operational routes are `/home`, `/inspector`, `/approvals`, `/audit`, `/risk`,
`/costs`, `/executive`, `/policy`, `/onboarding`, `/admin` and `/settings`.
Policy editing remains available in `/admin` for existing workflows. Display
preferences persist locally; auth tokens still use the existing server cookies.

The inspector reads effective rules and recorded metadata; it does not execute
tools. Approval countdowns disable expired actions locally, while the server
remains authoritative for every decision. Audit exports cover the tenant and
selected date range. The event sequence does not claim cryptographic verification:
the current audit API does not return chain hashes. Risk screens show actual trust
and integrity rows; absent per-call scores stay unknown. Interactive examples and
videos are explicitly illustrative.

## Prerequisites

- **Python 3.12** and [uv](https://docs.astral.sh/uv/)
- **Node 20+** (console)
- **PostgreSQL 16** server binaries — an *ephemeral* cluster is spun up for the
  hermetic RLS/HITL/audit tests and `make demo` (no live database required).
  On Debian/Ubuntu: `apt-get install -y postgresql-16`.

## Quickstart (local)

```bash
cp .env.example .env          # boots as-is; every key is optional, empty = feature off
make install                  # backend (uv) + console (npm) + Playwright browser
make verify                   # ruff + mypy + pytest + audit + eslint + tsc + Playwright
make demo                     # the break-then-control story, end to end
make dev                      # control API on :8000  (+ console on :3000)
```

`make demo` runs entirely offline: it spins a throwaway Postgres and shows an
agent that (1) is **held** when it tries an irreversible action, (2) is **denied**
when it mails outside the allowlist, (3) is **allowed** to read — then verifies
the audit chain is intact.

## Quickstart (self-hosted, Docker)

```bash
cp .env.example .env          # unedited
make up                       # db + migrations + control API, all on 127.0.0.1
curl localhost:8000/health/ready
```

`api` waits for the one-shot `migrate` service to *complete*, so the stack cannot
report healthy on an unmigrated database. There is no identity provider in this
stack and therefore no console login — gateway-token paths (MCP, `/v1/authorize`,
audit) all work. Human login needs an issuer whose tokens carry the claims this
product reads (`app_metadata.tenant_id`, `app_metadata.role` — GoTrue's shape):
point `SUPABASE_URL` at a Supabase project, or bring your own with
`SUPABASE_JWKS_URL` **and** `ISSUER_CLAIMS=supabase_gotrue`. Not every OIDC
provider qualifies, and readiness says so rather than going green on a
deployment that cannot authorise anything (`FR-195`). The reasoning is written
out at the top of `docker-compose.yml`.

Operate it without ever opening a SQL console. From a checkout:

```bash
uv run python -m cli migrate --dry-run   # what would change
uv run python -m cli bootstrap --org …   # tenant + admin + first gateway token
uv run python -m cli doctor              # config, schema, ports, capabilities — each gap with its fix
```

From the Docker stack, where there is no Python on the host and `DATABASE_URL`
resolves to a container, run the same commands inside it:

```bash
make cli ARGS="doctor"
make backup                              # dump the evidence plane
make restore FILE=backup/xsom-….sql.gz   # put it back, then re-verify the chain
```

To point it at a real database and a real agent, see
[`docs/DEPLOY.md`](docs/DEPLOY.md).

## Configuration

All settings load from the environment / `.env` (gitignored). Nothing is required
to boot; features light up as you configure them, and anything touching data or
money fails **closed** when its key is missing.

[`.env.example`](.env.example) documents every key the runtime reads — a test
keeps it in sync with `core/config.py`, so it cannot go stale. The ones you will
set first:

| Variable | Purpose |
|---|---|
| `ENV` | `dev` / `staging` / `prod` (prod disables `/docs`). |
| `DATABASE_URL` | Postgres DSN for the backend. |
| `CORS_ALLOW_ORIGINS` | Explicit comma-separated allowlist (no `*`). |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | JWT verification (JWKS) and self-serve signup. Service role is **backend-only**. |
| `MISTRAL_API_KEY` | LLM judge (ambiguous tools + compliance narratives). Absent ⇒ judge off, ambiguous escalates to a human. |
| `XSOM_TENANT_TOKEN` | Read by the **agent's** process to authenticate its gateway session. |

Console (`frontend/.env.local`): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CONTROL_API_URL`, `NEXT_PUBLIC_XSOM_API_URL`.

## Make targets

| Target | What it does |
|---|---|
| `make install` | Install backend + console deps + Playwright browser. |
| `make dev` | Run the control API (+ console); the gateway runs over stdio. |
| `make test` | pytest + Playwright smoke. |
| `make verify` | ruff + mypy + tests + security audit + sovereignty gate + coverage gate + eslint + tsc. |
| `make sovereignty-gate` | `SM-15`: fails if any module on the decision path *can* reach the network (`AD-25`). |
| `make demo` | End-to-end break-then-control demo. |
| `make up` / `make down` | Bring the self-hosted compose stack up / down (the volume survives `down`). |
| `make down-hard` | `down --volumes` — **destroys the database, and with it the audit chain**. |
| `make logs` / `make ps` | Follow the stack's logs / list its services. |
| `make cli ARGS="…"` | Run the CLI **inside** the stack — no Python needed on the host. |
| `make backup` / `make restore` | Dump the evidence plane, and put it back; restore re-verifies the hash chain. |

## Layout

```
gateway/   MCP gateway: server (to the agent) + downstream client; policy→HITL→audit, integrity, taint
core/      config, db (RLS), migrate, policy, judge, approvals, audit, risk, trust, dlp, compliance,
           observability, usage/billing, credentials, export, notify, schemas
api/       hardened FastAPI control API (auth, authorize, policy, approvals, audit, compliance,
           integrity, trust, DLP, LLM proxy, usage, signup)
supabase/  SQL migrations (RLS, append-only audit) + the schema_migrations ledger
frontend/  Next.js 14 console (onboarding, inspector, approvals, audit, admin)
scripts/   audit_security, audit_sovereignty, gen_coverage, verify_chain, demo, seed_demo
tests/     pytest suite (ephemeral Postgres harness) + Playwright e2e
docs/      SPEC, BUILD_PLAN, SECURITY, DEPLOY, product/ (PRD, architecture, epics)
```

## Security

See [`docs/SECURITY.md`](docs/SECURITY.md) for the threat model and pentest
checklist. Highlights: HITL enforced at the gateway (never by the prompt),
fail-closed defaults, tenant isolation by Postgres RLS, append-only hash-chained
audit, httpOnly auth cookies, no secrets in git (trufflehog in CI).

## Status

MVP milestones **M0–M8** plus **M9–M12** (AI Act compliance plane, tool integrity
and RBAC, risk/trust-graduated escalation, taint) are complete, alongside egress
DLP, AI observability and the LLM proxy. See `docs/BUILD_PLAN.md` for the MVP and
`docs/product/` (PRD, `ARCHITECTURE-V2.md`, `EPICS.md`, `PLAN-REVIEW.md`) for what
v2 adds next — starting with one-command deployment.

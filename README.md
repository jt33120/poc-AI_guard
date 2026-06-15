# xSOM AI Guard

An **MCP action-control gateway** for AI agents. The agent calls its tools
*through* the gateway, which on every tool-call:

- applies a deterministic **authorization policy** (auto / human-in-the-loop / deny),
- keeps a **human in the loop** for irreversible actions (dry-run + approval),
- writes an **immutable, hash-chained audit log** exportable for AI Act / GDPR.

The differentiator: we control what the agent **does**, not just its prompts.

```
 Agent ──MCP──▶  xSOM AI Guard  ──MCP──▶  downstream tool servers (mail, CRM, fs…)
                 policy → HITL → audit
                       │
        ┌──────────────┼─────────────────┐
        ▼              ▼                  ▼
   Supabase       LLM judge          Control API (FastAPI)
   (Postgres+RLS, (Mistral, thin)    ◀── Next.js frontend
    append-only audit)               (inspector, approvals, audit, policy)
```

## Prerequisites

- **Python 3.12** and [uv](https://docs.astral.sh/uv/)
- **Node 20+** (frontend, M7)
- **PostgreSQL 16** server binaries — used to spin an *ephemeral* cluster for the
  hermetic RLS/HITL/audit tests and `make demo` (no live Supabase required).
  On Debian/Ubuntu: `apt-get install -y postgresql-16`.

## Quickstart (local, < 10 min)

```bash
cp .env.example .env          # nothing is required to boot; fill in to enable features
make install                  # backend (uv) + frontend (npm) + Playwright browser
make verify                   # ruff + mypy + pytest + audit + eslint + tsc + Playwright
make demo                     # the break-then-control story, end to end
make dev                      # control API on :8000  (+ frontend on :3000)
```

`make demo` runs entirely offline: it spins a throwaway Postgres, and shows an
agent that (1) is **held** when it tries an irreversible action, (2) is **denied**
when it mails outside the allowlist, (3) is **allowed** to read — then verifies the
audit chain is intact.

## Configuration

All settings load from the environment / `.env` (gitignored). Everything is
optional to boot; features light up as you configure them.

| Variable | Purpose |
|---|---|
| `ENV` | `dev` / `staging` / `prod` (prod disables `/docs`). |
| `CORS_ALLOW_ORIGINS` | Explicit comma-separated allowlist (no `*`). |
| `DATABASE_URL` | Postgres DSN for the backend (service-role connection). |
| `SUPABASE_URL` / `SUPABASE_JWKS_URL` | JWT verification (JWKS). |
| `SUPABASE_JWT_AUDIENCE` / `SUPABASE_JWT_ISSUER` | JWT claims. |
| `SMTP_HOST` / `SMTP_FROM` / `APPROVAL_NOTIFY_TO` … | HITL email notifications. |
| `MISTRAL_API_KEY` / `MISTRAL_MODEL` | LLM judge (ambiguous tools + narratives). |
| `JUDGE_MAX_CALLS` / `EXPORT_RATE_LIMIT` | Cost cap + rate limiting. |
| `SENTRY_DSN` | Optional error reporting. |

Frontend (`frontend/.env.local`): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CONTROL_API_URL`.

## Make targets

| Target | What it does |
|---|---|
| `make install` | Install backend + frontend deps + Playwright browser. |
| `make dev` | Run the control API (+ frontend); the gateway runs over stdio. |
| `make test` | pytest + Playwright smoke. |
| `make verify` | ruff + mypy + tests + security audit + eslint + tsc. |
| `make demo` | End-to-end break-then-control demo. |

## Layout

```
gateway/   MCP gateway: server (to the agent) + client (downstream); policy→HITL→audit
core/      config, db (RLS), policy, judge, approvals, audit, export, notify, schemas
api/       hardened FastAPI control API (auth, servers, policy, approvals, audit)
supabase/  SQL migrations (RLS, append-only audit)
frontend/  Next.js 14 app (inspector, approvals, audit, admin)
scripts/   audit_security, verify_chain, demo
tests/     pytest suite (ephemeral Postgres harness) + Playwright e2e
```

## Security

See [`docs/SECURITY.md`](docs/SECURITY.md) for the threat model and pentest
checklist. Highlights: HITL enforced at the gateway (never by the prompt),
fail-closed defaults, tenant isolation by Postgres RLS, append-only hash-chained
audit, httpOnly auth cookies, no secrets in git (trufflehog in CI).

## Status

MVP milestones **M0–M8 complete**. See `docs/BUILD_PLAN.md` and `docs/SPEC.md`.

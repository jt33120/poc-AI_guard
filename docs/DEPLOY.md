# Deployment — xSOM AI Guard

How to run xSOM AI Guard on your own infrastructure. Every value below is a
placeholder: `<your-project-ref>`, `<your-backend-host>`, `<your-console-host>`.
Nothing here points at a host operated by anyone but you — your database, your
agents' tokens and your provider API keys must never transit a vendor's server.

| Piece | What it is | Deploys to |
|---|---|---|
| **Database + identity** | Postgres 16 with RLS, plus a JWT issuer | Supabase, or your own Postgres + issuer |
| **Control API** | Hardened FastAPI (`api.main:app`) — policy, approvals, audit, exports | Any container host (Railway, Render, Fly, Kubernetes) |
| **Console** | Next.js 14 dashboard (root dir `frontend/`) | Vercel, or any Node host |

> The **MCP gateway** (`gateway/server.py`) is not a hosted web service. It runs
> over stdio next to the agent, reads `XSOM_TENANT_TOKEN` and `DATABASE_URL` from
> that process's environment, and refuses to start without a valid token
> (fail-closed, CLAUDE.md §4.4). There is nothing to deploy for it.

All secrets live in each platform's environment variables — **never in git**
(CLAUDE.md §4.7). `SUPABASE_SERVICE_ROLE_KEY` is backend-only: it bypasses RLS,
so it never appears in the console's environment nor in any `NEXT_PUBLIC_*`
variable (CLAUDE.md §4.6). Every key the runtime reads is documented in
[`.env.example`](../.env.example), and a test keeps that file and
`core/config.py` in sync — it is the authoritative list, this page is a subset.

---

## Path A — managed (Supabase + a container host + Vercel)

The path with the fewest moving parts.

### 1. Database and identity

Create a Supabase project; note its **project ref** (`<your-project-ref>`) and
region. Auth signs tokens with an **ES256 asymmetric key**, so the backend
verifies against the project's public JWKS —
`https://<your-project-ref>.supabase.co/auth/v1/.well-known/jwks.json` — and
fails closed if it is unreachable. No key material is copied anywhere.

### 2. Apply the schema

Migrations are forward-only and recorded in a ledger,
`schema_migrations(filename, checksum, applied_at)`. Do not count the files or
paste them into a SQL editor: the runner records what ran, refuses to start on a
checksum mismatch, serialises concurrent replicas with an advisory lock, and is
safely re-runnable. Ask the ledger — not this document — what is applied.

From a checkout, against the DSN from step 3:

```bash
DATABASE_URL="<your dsn>" uv run python -m cli migrate --dry-run   # plan only, writes nothing
DATABASE_URL="<your dsn>" uv run python -m cli migrate
```

It prints the files it applied; re-running prints `schema already up to date`
and changes nothing.

> Filenames are a sequence, not a count, and the sequence has one hole: `0012`
> was never used. It stays a hole because renumbering a released migration would
> change its checksum and invalidate every ledger already written. A missing
> `0012` is expected, not damage — `python -m cli doctor` is the authority on
> whether a schema is at head.

If the database predates the ledger (it already has `audit_log` but no
`schema_migrations`), adopt its history **once** first:

```bash
DATABASE_URL="<your dsn>" uv run python -m cli migrate --adopt-baseline
```

It probes one sentinel object per historical file and records only the history it
can prove ran, refusing to guess if it finds a gap. Adoption is deliberately
never automatic — it cannot happen as a side effect of a container start.

### 3. Control API

Build the repository `Dockerfile` (`railway.json` configures Railway; any
container host works). Healthcheck: `GET /health`.

| Var | Value | Notes |
|---|---|---|
| `ENV` | `prod` | Disables `/docs`, `/redoc`, `/openapi.json` (CLAUDE.md §4.8). |
| `DATABASE_URL` | `postgresql://postgres.<your-project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require` | Use the **session pooler** (IPv4, port 5432); the direct `db.*` host is IPv6-only. |
| `SUPABASE_URL` | `https://<your-project-ref>.supabase.co` | The JWKS URL is derived from it. |
| `SUPABASE_SERVICE_ROLE_KEY` | _(project API settings → `service_role`)_ | Backend only. Enables `POST /v1/signup`; absent ⇒ signup answers 503 forever. |
| `SUPABASE_JWT_AUDIENCE` | `authenticated` | Matches the Supabase user token's `aud`. |
| `SUPABASE_JWT_ISSUER` | `https://<your-project-ref>.supabase.co/auth/v1` | Optional; must match `iss` exactly. Empty skips the issuer check. |
| `CORS_ALLOW_ORIGINS` | `https://<your-console-host>` | Explicit allowlist, comma-separated. `*` is refused at boot. Set once the console URL is known. |
| `MISTRAL_API_KEY` | _(optional)_ | LLM judge + compliance narratives. Absent ⇒ judge off and ambiguous tools escalate to a human (fail-closed). |
| `SMTP_*` / `APPROVAL_NOTIFY_TO` | _(optional)_ | HITL approval emails. Absent ⇒ reviewers watch the queue in the console. |
| `SENTRY_DSN` | _(optional)_ | Error reporting. |

Everything else has a working default; `.env.example` documents each one and what
leaving it empty turns off.

`PORT` is injected by the platform — do not set it.

Verify: `curl https://<your-backend-host>/health` ⇒ `{"status":"ok"}`.

### 4. Console

Next.js, auto-detected. **Root directory must be `frontend`.**

| Var | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | _(the project's anon key)_ |
| `CONTROL_API_URL` | `https://<your-backend-host>` — server-side only; the browser never sees the bearer token. |
| `NEXT_PUBLIC_XSOM_API_URL` | `https://<your-backend-host>` — the base URL the onboarding wizard writes into generated snippets. Defaults to the console's own origin, which is only correct when API and console share one. |

Then set `CORS_ALLOW_ORIGINS` on the backend to that exact origin and redeploy it.

### 5. First tenant and admin — no SQL

`POST /v1/signup` provisions in one call: the auth user, the tenant, the admin
membership, and the user's `app_metadata` (`tenant_id` + `role`) that both the
API and Postgres RLS read. It is unauthenticated, rate-limited
(`SIGNUP_RATE_LIMIT`, default `10/hour`), and rolls the partial account back on
failure.

```bash
curl -X POST https://<your-backend-host>/v1/signup \
  -H 'content-type: application/json' \
  -d '{"org":"Acme Ops","email":"admin@example.test","password":"<a strong password>"}'
```

`503` means `SUPABASE_SERVICE_ROLE_KEY` is not set on the backend; `409` means
that email already has an account. On success, sign in to the console with those
credentials — the first login mints a JWT carrying the new claims.

> From a checkout you can do the same without the HTTP round trip:
> `XSOM_ADMIN_PASSWORD=… uv run python -m cli bootstrap --org "Acme Ops" --email admin@example.test`
> provisions the tenant, the admin and a first gateway token in one command. The
> password is read from that variable (or prompted on the TTY) and never passed as
> a flag, because argv is world-readable via `ps` and is kept in shell history.
> Without `SUPABASE_SERVICE_ROLE_KEY` the command still creates the tenant and the
> token, and tells you which half it could not create and why.

### 6. Give an agent a token

In the console: **Onboarding**, or **Settings → Gateway tokens**. Only the
SHA-256 hash of the token is stored; the raw value is shown once. The onboarding
wizard then prints an integration snippet for your stack, using this deployment's
own base URL and the variable names the runtime actually reads — for the MCP
gateway, `XSOM_TENANT_TOKEN`.

---

## Path B — self-hosted, no cloud account

```bash
cp .env.example .env      # works unedited; every key is a safe default or empty
make up                   # docker compose up -d --build --wait
```

`docker-compose.yml` brings up three services, every published port bound to
`127.0.0.1`:

| Service | What it does |
|---|---|
| `db` | PostgreSQL 16 on a named volume. `deploy/auth_compat.sql` is applied on first boot. |
| `migrate` | One-shot `python -m cli migrate`, then exits 0. |
| `api` | The control API. Waits on `migrate` *completing*, so the stack cannot report healthy on an unmigrated database. |

Readiness is `GET /health/ready`, which answers four booleans and nothing else —
`ok`, `database`, `schema_current`, `issuer`. It is unauthenticated, so it
deliberately exposes no hostnames, DSNs or capability map: an anonymous
capability list is a target-selection oracle.

Set `XSOM_API_PORT` / `XSOM_DB_PORT` in `.env` if 8000 or 5432 are taken — a port
collision is the most common first-run failure. To use a database of your own
instead of the bundled one, set `DATABASE_URL` and apply `deploy/auth_compat.sql`
to it once, as its owner, before the first migration.

**There is no identity provider in this stack, so there is no console login.**
Everything that authenticates with a *gateway token* works — the MCP gateway,
`POST /v1/authorize`, the audit chain, migrations, health. Everything that
authenticates a *human* with a JWT needs an external issuer — and not just any
one. We federate issuers presenting **compatible claims**: `api/security.py` and
every RLS policy read `app_metadata.tenant_id` and `app_metadata.role`, which is
GoTrue's shape. Point `SUPABASE_URL` at a Supabase project and readiness reports
`issuer: true`. To bring your own issuer, set `SUPABASE_JWKS_URL` **and**
`ISSUER_CLAIMS=supabase_gotrue` — the second is you affirming it mints those
claims. Leave it undeclared and readiness stays red deliberately: an issuer that
merely serves a key set resolves fine and authorises nothing, so its tokens 403
and its queries return zero rows. A green probe on that deployment would be a
lie, which is the defect `FR-195` closed. The reasoning behind the gap itself is
written out in full at the top of `docker-compose.yml`.

Routine operation needs no database access:
`python -m cli migrate | bootstrap | token | doctor`. `doctor` reports
configuration *presence*, never values, and exits non-zero only on a real
failure — an unconfigured optional capability is a warning, because "off" is not
"broken" (the judge being off means ambiguous tools escalate to a human, which is
fail-closed). The same gap in `ENV=prod` is a failure.

**`deploy/auth_compat.sql`** is the supported production counterpart of
`tests/fixtures/supabase_auth_shim.sql`: it creates the `auth` schema, the
`auth.jwt()` / `auth.uid()` / `auth.role()` functions the RLS policies call, and
the `anon` / `authenticated` / `service_role` roles. It is **not** an identity
provider — it exposes claims an already-trusted backend set, and verifies
nothing. That the RLS suite passes on a plain cluster with it applied is the
evidence self-hosting is not a downgrade of the isolation boundary.

> **Status.** The SQL, the migration runner, the CLI and the `/health` endpoints
> are covered by tests that run against a real PostgreSQL 16 cluster, and the
> compose boot order was reproduced against one outside a container. The compose
> file *itself* has not yet been executed in CI — see Story 1.24.

---

## Post-deploy security checklist

- [ ] `ENV=prod` on the backend ⇒ `GET /docs` returns 404.
- [ ] `CORS_ALLOW_ORIGINS` is the exact console origin, no `*`.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set on the backend **only** — absent from the
      console project and from every `NEXT_PUBLIC_*` variable.
- [ ] Secrets only in platform environment variables;
      `git ls-files | grep -i env` shows no `.env`.
- [ ] **Rotate** anything pasted in plaintext during setup, once provisioning is done.
- [ ] Auth cookies are `httpOnly` + `Secure` + `SameSite` (enforced in
      `frontend/lib/supabaseServer.ts`).
- [ ] `DATABASE_URL=<your dsn> uv run python scripts/verify_chain.py` reports an
      intact audit chain.
- [ ] `ENV=prod DATABASE_URL=<your dsn> uv run python -m cli doctor` exits 0. It
      re-checks most of the boxes above from the deployment's own environment,
      and every non-OK line carries the fix.

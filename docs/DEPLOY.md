# Deployment — xSOM AI Guard

How the MVP is deployed to a live environment. Three pieces go online:

| Piece | Host | What it is |
|---|---|---|
| **Supabase** | `ahndrprqongfqohkhwfu` (eu-west-1) | Postgres + Auth + RLS. Already provisioned (migrations applied). |
| **Control API** | Railway (Docker) | Hardened FastAPI (`api.main:app`). |
| **Frontend** | Vercel | Next.js 14 dashboard (root dir `frontend/`). |

> The **MCP gateway** (`gateway/server.py`) is **not** a hosted web service — it
> runs over stdio next to an agent, pointed at the control plane. Nothing to deploy.

All secrets live in each platform's environment variables — **never in git**
(CLAUDE.md §4.7). The `service_role` key is backend-only and, in fact, unused by
our code (we talk to Postgres via `DATABASE_URL` and verify JWTs via JWKS).

---

## 0. Supabase (done)

The 5 migrations (tenancy → RLS → append-only hash-chained audit) are applied to
project `ahndrprqongfqohkhwfu`. Auth uses an **ES256 asymmetric signing key**, so
the public JWKS at `https://ahndrprqongfqohkhwfu.supabase.co/auth/v1/.well-known/jwks.json`
is what the backend verifies against — no code change, fail-closed if unreachable.

To re-apply migrations to a fresh project, run each file in `supabase/migrations/`
in order (SQL editor, `psql`, or the Management API `database/query` endpoint).

---

## 1. Backend → Railway (Docker)

Railway builds the repo's `Dockerfile` (config in `railway.json`). Healthcheck:
`GET /health`.

### Environment variables

| Var | Value | Notes |
|---|---|---|
| `ENV` | `prod` | Disables `/docs`, `/redoc`, `/openapi.json` (CLAUDE.md §4.8). |
| `DATABASE_URL` | `postgresql://postgres.ahndrprqongfqohkhwfu:<DB_PASSWORD>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require` | **Session pooler** (IPv4, port 5432). The direct `db.*` host is IPv6-only. |
| `SUPABASE_URL` | `https://ahndrprqongfqohkhwfu.supabase.co` | JWKS URL is derived from this. |
| `SUPABASE_JWT_AUDIENCE` | `authenticated` | Matches Supabase user-token `aud`. |
| `SUPABASE_JWT_ISSUER` | `https://ahndrprqongfqohkhwfu.supabase.co/auth/v1` | Optional; must match token `iss` exactly. Leave empty to skip issuer check. |
| `CORS_ALLOW_ORIGINS` | `https://<your-frontend>.vercel.app` | Explicit allowlist, comma-separated. No `*`. Set after the frontend URL is known. |
| `MISTRAL_API_KEY` | _(optional)_ | Enables the LLM judge for ambiguous tools + compliance narratives. Absent ⇒ judge disabled (fail-closed). |
| `MISTRAL_MODEL` | `mistral/mistral-small-latest` | Default; override only if needed. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` / `APPROVAL_NOTIFY_TO` | _(optional)_ | HITL approval email notifications. |
| `SENTRY_DSN` | _(optional)_ | Error reporting. |

`PORT` is injected by Railway — do not set it.

### Steps
1. New Railway project → **Deploy from GitHub repo** → `jt33120/xsom-ai-guard`.
2. Railway detects `Dockerfile` + `railway.json`. Set the variables above.
3. Deploy. Note the public URL, e.g. `https://xsom-ai-guard-production.up.railway.app`.
4. `curl https://<backend>/health` ⇒ `{"status":"ok"}`.

---

## 2. Frontend → Vercel

Next.js, auto-detected. **Root Directory must be `frontend`.**

### Environment variables

| Var | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ahndrprqongfqohkhwfu.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | _(the project's anon key)_ |
| `CONTROL_API_URL` | `https://<backend>.up.railway.app` (server-side only; the browser never sees the bearer token) |

### Steps
1. New Vercel project (team **xSOM Org**) → import `jt33120/xsom-ai-guard`.
2. **Root Directory** = `frontend`. Framework preset = Next.js (auto). Build = `next build`.
3. Set the variables above. Deploy. Note the URL, e.g. `https://xsom-ai-guard.vercel.app`.
4. Go back to Railway and set `CORS_ALLOW_ORIGINS` to that exact origin; redeploy the backend.

---

## 3. Bootstrap a tenant + admin (required to use the app)

RLS and RBAC read `tenant_id` and `role` from the user's `app_metadata` — the same
claim the JWT carries. A brand-new sign-up has neither, so it can see nothing until
you attach it to a tenant.

```sql
-- 1) Create a tenant (note the returned id).
insert into tenants (name) values ('Acme') returning id;

-- 2) After the user signs up (email/password in the app), link membership.
insert into memberships (user_id, tenant_id, role)
values ('<auth-user-uuid>', '<tenant-id>', 'admin');
```

Then stamp the user's `app_metadata` (admin privilege required — Management API SQL,
or the Auth Admin API with the `service_role` key):

```sql
update auth.users
set raw_app_meta_data =
    coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('tenant_id', '<tenant-id>', 'role', 'admin')
where id = '<auth-user-uuid>';
```

The user must sign out/in to mint a fresh JWT carrying the new claims.

**Gateway token** (so an agent's MCP session authenticates to a tenant): insert a
row in `gateway_tokens` storing only the SHA-256 hash of the raw token (the raw
value is shown to the operator once and never stored).

---

## 4. Security checklist (post-deploy)

- [ ] `ENV=prod` on the backend ⇒ `GET /docs` returns 404.
- [ ] `CORS_ALLOW_ORIGINS` is the exact frontend origin, no `*`.
- [ ] Secrets only in platform env vars; `git ls-files | grep -i env` shows no `.env`.
- [ ] **Rotate** any secret pasted in plaintext during setup (Supabase `service_role`,
      the Management API PAT) once provisioning is complete.
- [ ] `service_role` is not set anywhere in the frontend project.
- [ ] Auth cookies are `httpOnly` + `Secure` + `SameSite` (enforced in `lib/supabaseServer.ts`).

# Security — threat model & pentest checklist

Maps the non-negotiable rules (`CLAUDE.md §4`) to where they are enforced and
tested. `scripts/audit_security.py` checks the static subset in CI.

## Core guarantees

| # | Rule | Enforced by | Tested by |
|---|---|---|---|
| 1 | HITL at the **gateway**, never the prompt; unapproved irreversible action is never executed | `gateway/server.py` (`PolicyBackend`) | `tests/test_hitl_gate.py`, `make demo` |
| 2 | `audit_log` strictly **append-only**, immutable via hash-chaining | migration `0005` (RLS + triggers), `core/audit.py` | `tests/test_audit.py` |
| 3 | Tenant isolation by **Postgres RLS**, not just app code | migrations + `core/db.py` (`tenant_reader`) | `tests/test_rls.py`, `*_api.py` |
| 4 | **Fail-closed**: unknown tool / policy absent / approval service down → deny | `core/policy.py`, `gateway/server.py` | `tests/test_policy.py`, `tests/test_hitl_gate.py` |
| 5 | Tokens in **httpOnly+Secure+SameSite** cookies, never `localStorage` | `frontend/lib/supabaseServer.ts`, `middleware.ts` | — (frontend) |
| 6 | `service_role` is **backend-only**, never in the frontend or git | architecture; `scripts/audit_security.py` | static audit |
| 7 | **No secrets in git**; `.env` gitignored | `.gitignore`, trufflehog (CI), static audit | CI |
| 8 | `/docs` & `/redoc` **off in prod**; `debug=False`; no stack traces to client | `api/main.py`, `api/errors.py` | `tests/test_config.py` |
| 9 | Strict Pydantic validation; **rate limit** on the costly export endpoint | `core/schemas.py`, `api/ratelimit.py` | `tests/test_ratelimit.py` |
| 10 | Never log argument **content** / PII — metadata + `args_hash` only | `core/audit.py`, `core/approvals.py` (redaction) | `tests/test_audit.py` |

## Quick pentest checklist

- **CORS**: explicit allowlist; wildcard rejected at config load (`core/config.py`).
- **Docs**: `/docs`, `/redoc`, `/openapi.json` return 404 when `ENV=prod`.
- **RLS**: cross-tenant reads return nothing; verified via real Postgres in tests.
- **Auth**: protected routes 401 without a valid JWT; RBAC 403 for insufficient role.
- **Gateway auth**: MCP session refused without a valid (hashed) tenant token.
- **Secrets**: trufflehog (CI) + `scripts/audit_security.py` (no quoted secret literals, no
  `service_role` in the frontend, `.env` ignored/untracked).
- **Audit**: tampering any row (even bypassing triggers) breaks `scripts/verify_chain.py`.
- **Dependencies**: `pip-audit` (Python) in CI; Next.js pinned to a patched release.

## Out of MVP scope (extension points)

Prompt-injection guard, PII stripping, RAG mediation, fleet/GitOps, sovereign
hosting, ML anomaly detection.

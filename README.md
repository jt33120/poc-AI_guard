# xSOM AI Guard

An **MCP action-control gateway** for AI agents. The agent calls its tools
*through* the gateway, which authorizes each tool-call (auto / human-in-the-loop /
deny), keeps a human in the loop for irreversible actions, and writes an
**immutable, hash-chained audit log** — without touching the agent's code.

> This README grows with the build. Right now we are at **M0 (bootstrap)**.
> See `CLAUDE.md` (authority), `docs/SPEC.md` (detail), `docs/BUILD_PLAN.md` (milestones).

## Stack

Python 3.12 · MCP Python SDK · FastAPI + Pydantic v2 · Supabase (Postgres + Auth + RLS)
· LiteLLM→Mistral (thin judge) · Next.js 14 (M7). Tooling: **uv**, ruff, mypy, pytest.

## Quickstart (local)

Prerequisites: Python 3.12 and [uv](https://docs.astral.sh/uv/).

```bash
cp .env.example .env        # then edit if needed (no secrets are required to boot)
make install                # create venv + install deps
make verify                 # ruff + mypy + tests + security audit  ← must be green
make dev                    # control API on http://localhost:8000  (GET /health)
```

## Make targets

| Target | What it does |
|---|---|
| `make install` | Create the venv and install dependencies (uv). |
| `make dev` | Run the control API (gateway MCP runs over stdio; front in M7). |
| `make test` | Run the test suite. |
| `make verify` | ruff + mypy + tests + `scripts/audit_security.py` (+ eslint/tsc from M7). |
| `make demo` | End-to-end "break-then-control" demo (M8). |

## Layout

```
api/         Control API (FastAPI, hardened) — consumed by the frontend
gateway/     MCP gateway: MCP server (to the agent) + MCP client (to downstream tools)
core/        Config, logging, observability; policy/judge/audit/approvals land later
scripts/     Operational scripts (security audit, chain verification, ...)
supabase/    SQL migrations (RLS) — from M1
frontend/    Next.js app — from M7
tests/       pytest suite (+ fixtures)
```

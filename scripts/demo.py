#!/usr/bin/env python3
"""make demo — the break-then-control story, end to end (SPEC §13, M8).

Self-contained (spins an ephemeral PostgreSQL, no live Supabase required):
  1. the agent tries an irreversible action  -> held for human approval, NOT executed
  2. the agent tries mail to a foreign domain -> denied by policy, NOT executed
  3. the agent reads (auto)                    -> allowed and executed
  4. the audit chain is verified intact

Exits non-zero if any control invariant fails.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from uuid import uuid4

_REPO = Path(__file__).resolve().parent.parent

_POLICY_YAML = """
tools:
  - {name: mock.echo, class: read, approval: auto}
  - name: mock.delete_contact
    class: irreversible
    approval: human_dual
    constraints: { dry_run: true }
  - name: mock.mail_send
    class: external_send
    approval: human_in_the_loop
    constraints: { allowed_domains: ["@client.fr"] }
defaults:
  unknown_tool: deny
"""


def _text(result: object) -> str:
    return str(result.content[0].text)  # type: ignore[attr-defined]


def _mark(passed: bool) -> str:
    return "OK" if passed else "FAIL"


async def run() -> int:
    sys.path.insert(0, str(_REPO))
    import psycopg
    from psycopg import sql

    from core import audit, db
    from core.policy import parse_policy
    from gateway.downstream import DownstreamProxy, ServerSpec
    from gateway.server import ApprovalContext, PolicyBackend
    from tests.pgcluster import EphemeralPostgres, binaries_available  # reuse test PG infra

    if not binaries_available():
        print("demo: PostgreSQL binaries are unavailable", file=sys.stderr)
        return 2

    mock = _REPO / "tests" / "fixtures" / "mock_mcp_server.py"
    shim = _REPO / "tests" / "fixtures" / "supabase_auth_shim.sql"
    migrations = sorted((_REPO / "supabase" / "migrations").glob("*.sql"))
    policy = parse_policy(_POLICY_YAML)

    pg = EphemeralPostgres()
    pg.start()
    try:
        admin = psycopg.connect(pg.base_url(), autocommit=True)
        admin.execute(sql.SQL("create database {}").format(sql.Identifier("demo")))
        admin.close()
        url = pg.url_for("demo")
        pg.psql_apply(url, shim)
        for migration in migrations:
            pg.psql_apply(url, migration)

        tenant_id = str(uuid4())
        with db.connection(url) as conn:
            conn.execute("insert into tenants (id, name) values (%s, 'demo')", (tenant_id,))
            conn.commit()

        ctx = ApprovalContext(database_url=url, tenant_id=tenant_id, timeout_seconds=3600)
        backend = PolicyBackend(
            policy,
            DownstreamProxy(
                [
                    ServerSpec(
                        name="mock",
                        transport="stdio",
                        config={"command": sys.executable, "args": [str(mock)]},
                    )
                ]
            ),
            ctx,
        )

        ok = True
        print("== xSOM AI Guard — demo: the agent cannot act without control ==\n")

        # 1. Irreversible action -> held for human approval, never executed.
        held = await backend.call_tool("delete_contact", {"contact_id": "VIP-42"})
        passed = (
            held.isError and "requires_approval" in _text(held) and "deleted" not in _text(held)
        )
        print("[1] agent -> delete_contact (irreversible, human_dual)")
        print(f"    => held for human approval; downstream NOT called  [{_mark(passed)}]")
        ok = ok and passed

        # 2. External send outside the allowlist -> denied, never executed.
        denied = await backend.call_tool("mail_send", {"to": "attacker@evil.com", "subject": "hi"})
        passed = denied.isError and "deny" in _text(denied) and "sent" not in _text(denied)
        print("[2] agent -> mail_send to attacker@evil.com (outside allowlist)")
        print(f"    => denied by policy; not executed  [{_mark(passed)}]")
        ok = ok and passed

        # 3. Read (auto) -> allowed and executed.
        allowed = await backend.call_tool("echo", {"text": "status"})
        passed = (not allowed.isError) and "status" in _text(allowed)
        print("[3] agent -> echo (read, auto)")
        print(f"    => allowed and executed  [{_mark(passed)}]")
        ok = ok and passed

        # 4. Audit chain intact.
        with db.connection(url) as conn:
            chain = audit.verify_chain(conn, tenant_id)
            decisions = [
                row[0]
                for row in conn.execute(
                    "select decision from audit_log where tenant_id = %s order by id", (tenant_id,)
                ).fetchall()
            ]
        print(f"\n[4] audit trail: {decisions}")
        print(f"    => verify_chain: {'INTACT' if chain.ok else 'BROKEN'}  [{_mark(chain.ok)}]")
        ok = ok and chain.ok

        print(f"\n== DEMO {'PASSED' if ok else 'FAILED'} ==")
        return 0 if ok else 1
    finally:
        pg.stop()


def main() -> int:
    return asyncio.run(run())


if __name__ == "__main__":
    sys.exit(main())

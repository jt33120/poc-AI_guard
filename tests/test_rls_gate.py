"""FR-162 / INV-1 — RLS is a property of the migration set, not a habit.

Every migration that creates a table enables row level security on that table
**in the same file**. All eighteen do today; this test is what keeps the
nineteenth honest, because a table that ships one release without RLS is a
tenant-isolation hole that no application code can close (CLAUDE.md §4.3).

Two checks, kept separate because they fail differently and neither subsumes
the other:

* the **static** one reads the DDL and names the migration at fault. That is
  the shape of the requirement — "dans la migration qui la crée" — and it is
  the only check that can tell "never enabled" from "enabled three releases
  later", which is three releases of exposure;
* the **integration** one asks the live cluster what is actually true after
  the whole set has run. It catches an end state the parser cannot see: an
  ``alter table ... disable row level security`` in a later file, a table
  created by a form the parser does not recognise, a name it mis-read.

The third assertion is what makes the pair worth more than either half: the
two inventories must agree. A table the cluster has and the parser does not
is a table that entered the schema by a route this gate does not police.
"""

from __future__ import annotations

import re
from pathlib import Path

from tests.conftest import DBHandle

_MIGRATIONS = Path(__file__).resolve().parents[1] / "supabase" / "migrations"

# `create table [if not exists] [schema.]name` — the identifier, unquoted or quoted.
_CREATE = re.compile(
    r"""create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?""",
    re.IGNORECASE,
)
_ENABLE = re.compile(
    r"""alter\s+table\s+(?:if\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?"""
    r"""\s+enable\s+row\s+level\s+security""",
    re.IGNORECASE,
)

# A table that legitimately carries no RLS must be listed here **with its reason**,
# in the same commit that creates it. The dict is empty on purpose: today there is
# no such table, and `schema_migrations` — the one with no tenant dimension — is not
# an exception but the demonstration, since it enables RLS with zero policies rather
# than skipping it (see 0016). An entry here is a decision someone has to defend in
# review; its absence must never be the silent kind.
_NO_RLS_EXPECTED: dict[str, str] = {}


def _strip_comments(sql: str) -> str:
    """Drop `--` line comments and `/* */` blocks so prose cannot trip the parser.

    Function bodies (`$$ ... $$`) are deliberately **not** stripped: a `create
    table` inside one would be a table this gate cannot reason about, and the
    right answer to that is a failing test, not a blind spot.
    """
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    return re.sub(r"--[^\n]*", " ", sql)


def _tables_by_migration() -> dict[str, tuple[set[str], set[str]]]:
    """{migration filename: (tables created, tables given RLS)} for the whole set."""
    out: dict[str, tuple[set[str], set[str]]] = {}
    for path in sorted(_MIGRATIONS.glob("*.sql")):
        sql = _strip_comments(path.read_text(encoding="utf-8"))
        out[path.name] = (set(_CREATE.findall(sql)), set(_ENABLE.findall(sql)))
    return out


def test_every_created_table_enables_rls_in_its_own_migration() -> None:
    per_file = _tables_by_migration()
    assert per_file, "no migrations found — the gate would pass vacuously"

    offenders = {
        name: sorted(created - enabled - set(_NO_RLS_EXPECTED))
        for name, (created, enabled) in per_file.items()
        if created - enabled - set(_NO_RLS_EXPECTED)
    }
    assert not offenders, (
        "these migrations create a table without enabling RLS on it in the same "
        f"file: {offenders}. Add `alter table <t> enable row level security` to the "
        "migration that creates the table — or, if the table genuinely has no tenant "
        "dimension, enable RLS with no policy (deny-by-default, see 0016) rather than "
        "leaving it open."
    )


def test_every_public_table_has_rls_enabled(db: DBHandle) -> None:
    rows = db.conn.execute(
        "select c.relname, c.relrowsecurity from pg_class c "
        "join pg_namespace n on n.oid = c.relnamespace "
        "where n.nspname = 'public' and c.relkind = 'r' order by c.relname"
    ).fetchall()
    assert rows, "no tables in `public` — the migrations did not run"

    open_tables = sorted(name for name, rls in rows if not rls and name not in _NO_RLS_EXPECTED)
    assert not open_tables, (
        f"RLS is off on {open_tables} after the full migration set. Whatever enabled it "
        "was undone, or never ran: every row of these tables is readable by any role "
        "holding the table grant, across every tenant."
    )


def test_the_parser_sees_every_table_the_cluster_has(db: DBHandle) -> None:
    """The two inventories must agree, or the static gate is policing a subset."""
    live = {
        row[0]
        for row in db.conn.execute(
            "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace "
            "where n.nspname = 'public' and c.relkind = 'r'"
        ).fetchall()
    }
    parsed: set[str] = set()
    for created, _ in _tables_by_migration().values():
        parsed |= created

    assert not live - parsed, (
        f"the cluster has tables the migration parser never saw: {sorted(live - parsed)}. "
        "They entered `public` by a route this gate does not read, so nothing checks "
        "their RLS at review time."
    )


_PRIVILEGE_FOR = {
    "SELECT": "select",
    "INSERT": "insert",
    "UPDATE": "update",
    "DELETE": "delete",
    "ALL": "select",
}


def test_every_rls_policy_can_actually_be_exercised(db: DBHandle) -> None:
    """A policy without the matching grant is an authorisation nobody can use.

    In Postgres, RLS filters rows **after** the privilege check. So
    `create policy ... for select to authenticated` with no `grant select` does not
    fail, does not warn, and reads in review exactly like a working authorisation —
    while the role it names can never exercise it. It is the RLS shape of a policy
    key that parses with no effect, and it is how `monitor_windows` and
    `session_taint` shipped in 0017 and 0018.

    Thirteen tables had it right at the time this test was written. It exists so the
    fourteenth cannot get it wrong quietly: the two halves are written together or
    the build says which one is missing.
    """
    rows = db.conn.execute(
        "select p.tablename, p.policyname, p.cmd, r.rolname "
        "from pg_policies p cross join lateral unnest(p.roles) as r(rolname) "
        "where p.schemaname = 'public' and r.rolname <> 'public' "
        "order by p.tablename, p.policyname"
    ).fetchall()
    assert rows, "no RLS policies found — the gate would pass vacuously"

    orphans = [
        f"{table}.{policy} ({cmd} to {role})"
        for table, policy, cmd, role in rows
        if not db.conn.execute(
            "select has_table_privilege(%s, %s, %s)",
            (role, table, _PRIVILEGE_FOR.get(cmd, "select")),
        ).fetchone()[0]  # type: ignore[index]
    ]
    assert not orphans, (
        f"these RLS policies name a role that lacks the privilege to use them: {orphans}. "
        "Either add the matching `grant`, or drop the policy — a policy nobody can "
        "exercise is not a permission, it is a claim about one."
    )

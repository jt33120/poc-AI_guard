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

import contextlib
import re
from pathlib import Path
from uuid import uuid4

import psycopg

from tests.conftest import DBHandle
from tests.test_rls import _act_as

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


# ---------------------------------------------------------------------------
# `FR-165` — une ligne d'appartenance ne peut pas changer de tenant
# ---------------------------------------------------------------------------
# La revue annonçait des policies d'écriture trop laxistes sur `memberships`. Il n'en
# existe aucune : le schéma n'accorde que `select` à `authenticated`, donc `FR-165`
# est vrai **par absence**, et rien ne garde cette propriété. Les deux tests ci-dessous
# sont ce qui la tiendra quand la première policy d'écriture arrivera.
#
# Deux pièges, mesurés plutôt que supposés :
#
# 1. **Ne pas exiger un `with check` littéral.** Postgres recopie `USING` en
#    `WITH CHECK` quand ce dernier est absent, donc `for update using (tenant_id = jwt)`
#    refuse déjà le déplacement. Appliquer la *lettre* de `FR-165` rejetterait cette
#    policy sûre et exigerait une clause redondante : le garde encoderait l'erreur de
#    spécification du FR au lieu de tenir sa propriété.
# 2. **Ne pas sélectionner les tables par le nom de colonne `tenant_id`.** `tenants`
#    porte son rattachement sous `id` (0001) : un critère « la table a une colonne
#    `tenant_id` » a exactement le même mode d'échec qu'une liste blanche, par une
#    autre route — il périme dès qu'une table nomme sa clé autrement. La colonne de
#    rattachement se **lit dans la policy existante**, elle ne se devine pas.

_JWT_TENANT = "app_metadata"

# `pg_policies` rend le prédicat normalisé, p. ex.
# `(tenant_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid)`.
_TENANCY_COLUMN = re.compile(
    r"""\(?\s*([a-z_][a-z0-9_]*)\s*=\s*\(*\s*\(*\s*auth\.jwt\(\)""", re.IGNORECASE
)


def _tenancy_columns(db: DBHandle) -> dict[str, str]:
    """`{table: colonne de rattachement}`, lu dans les policies de lecture existantes.

    Une table est « à tenant » si l'une de ses policies compare une de ses colonnes à
    la revendication de tenant du JWT. C'est la définition que le schéma porte
    lui-même, donc elle ne périme pas quand une table nomme sa clé autrement.
    """
    rows = db.conn.execute(
        "select tablename, qual from pg_policies where schemaname = 'public' and qual is not null"
    ).fetchall()
    columns: dict[str, str] = {}
    for table, qual in rows:
        if _JWT_TENANT not in qual:
            continue
        match = _TENANCY_COLUMN.search(qual)
        assert match is not None, (
            f"{table}: a policy references the JWT tenant claim in a shape this gate "
            f"cannot read ({qual!r}). Fail-closed: teach the gate the shape rather "
            "than let a tenancy predicate go unchecked."
        )
        columns[table] = match.group(1)
    return columns


def test_write_policies_pin_the_tenant(db: DBHandle) -> None:
    """Toute policy d'écriture sur une table à tenant fixe le tenant, dans les deux sens.

    Postgres évalue `USING` sur la ligne **avant** et `WITH CHECK` sur la ligne
    **après**. Un `update` dont seul le `using` porte le prédicat de tenant ne peut
    donc pas déplacer une ligne — le check effectif est alors la copie du `using`.
    Ce qui est refusé ici, c'est un check effectif qui **ne mentionne pas** le
    rattachement : `with check (true)` (la ligne part chez le voisin) et
    `using (true)` (la ligne du voisin est atteinte).
    """
    tenancy = _tenancy_columns(db)
    assert tenancy, "no tenancy policy found — the gate would pass vacuously"

    rows = db.conn.execute(
        "select tablename, policyname, cmd, qual, with_check from pg_policies "
        "where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') "
        "order by tablename, policyname"
    ).fetchall()

    unpinned = [
        f"{table}.{policy} ({cmd})"
        for table, policy, cmd, qual, with_check in rows
        if table in tenancy
        and not _pins(with_check if with_check is not None else qual, tenancy[table])
    ]
    assert not unpinned, (
        f"these write policies do not pin the tenant: {unpinned}. A row can be written "
        "into — or out of — a foreign tenant through them, which is cross-tenant "
        "escalation by the very policy added to enforce isolation (CLAUDE.md §4.3)."
    )


def _pins(check: str | None, column: str) -> bool:
    """Le check effectif contraint-il la colonne de rattachement à la revendication ?"""
    if check is None:
        return False  # fail-closed: pas de check = rien ne contraint l'écriture
    return column in check and _JWT_TENANT in check


def test_a_row_cannot_be_moved_to_another_tenant(db: DBHandle) -> None:
    """La propriété elle-même, mesurée : `update ... set tenant_id = <victime>`.

    Sans clause `where`, délibérément — c'est la seule forme qui échappe au check
    dérivé de la policy de lecture, donc la seule qui teste vraiment l'écriture.
    Vert aujourd'hui par absence de grant ; il le restera par présence d'un check.
    """
    conn = db.conn
    tenant_a, tenant_b, user_a = uuid4(), uuid4(), uuid4()
    conn.execute("insert into tenants (id, name) values (%s, 'A'), (%s, 'B')", (tenant_a, tenant_b))
    conn.execute("insert into auth.users (id) values (%s)", (user_a,))
    conn.execute(
        "insert into memberships (user_id, tenant_id, role) values (%s, %s, 'admin')",
        (user_a, tenant_a),
    )
    conn.commit()

    for table in ("memberships", "gateway_tokens", "tenants"):
        conn.execute("begin")
        _act_as(conn, user_a, tenant_a)
        column = "id" if table == "tenants" else "tenant_id"
        # Aucun grant d'écriture aujourd'hui : le refus arrive avant même la policy.
        with contextlib.suppress(psycopg.errors.InsufficientPrivilege):
            conn.execute(f"update {table} set {column} = %s", (tenant_b,))  # noqa: S608
        conn.rollback()

    moved = conn.execute(
        "select count(*) from memberships where tenant_id = %s", (tenant_b,)
    ).fetchone()
    assert moved is not None and moved[0] == 0


def test_the_write_policy_gate_is_not_vacuous(db: DBHandle) -> None:
    """Le contrôle négatif, sans lequel le garde passerait vide — et pour toujours.

    Aucune policy d'écriture n'existe aujourd'hui, donc `test_write_policies_pin_the_tenant`
    itère sur zéro ligne. On installe donc la forme exploitable dans une transaction
    **annulée**, et on exige deux choses : que le détecteur la signale, et que la
    relocalisation réussisse réellement — c'est cette seconde moitié qui prouve que
    l'assertion comportementale ci-dessus est capable de rougir, plutôt que de
    constater un simple `permission denied`.
    """
    conn = db.conn
    tenant_a, tenant_b, user_a = uuid4(), uuid4(), uuid4()
    conn.execute("insert into tenants (id, name) values (%s, 'A'), (%s, 'B')", (tenant_a, tenant_b))
    conn.execute("insert into auth.users (id) values (%s)", (user_a,))
    conn.execute(
        "insert into memberships (user_id, tenant_id, role) values (%s, %s, 'admin')",
        (user_a, tenant_a),
    )
    conn.commit()

    conn.execute("begin")
    conn.execute("grant update on memberships to authenticated")
    conn.execute(
        "create policy memberships_neg on memberships for update to authenticated "
        "using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) "
        "with check (true)"
    )

    # 1. Le détecteur statique la voit.
    flagged = conn.execute(
        "select policyname, with_check from pg_policies "
        "where schemaname = 'public' and tablename = 'memberships' and cmd = 'UPDATE'"
    ).fetchall()
    assert flagged and not _pins(flagged[0][1], "tenant_id")

    # 2. Et elle déplace vraiment la ligne : l'assertion comportementale sait rougir.
    _act_as(conn, user_a, tenant_a)
    conn.execute("update memberships set tenant_id = %s", (tenant_b,))
    conn.execute("reset role")
    moved = conn.execute(
        "select count(*) from memberships where tenant_id = %s", (tenant_b,)
    ).fetchone()
    assert moved is not None and moved[0] == 1

    conn.rollback()  # rien de tout ceci ne survit au test

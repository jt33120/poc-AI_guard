"""Forward-only schema migrations: a ledger + a runner owned by production code.

Until now ``supabase/migrations/*.sql`` was pasted by hand into a SQL editor, in
order: nothing recorded which files had run, and a released file could be edited
afterwards without anyone noticing. This module owns that job.

Each file is applied inside ONE transaction together with its ledger row, under a
Postgres advisory lock, so two replicas booting at once cannot double-apply and a
failed file leaves no partial state. Re-running is a no-op. There is no down
migration and there never will be: rolling a schema back on an append-only audit
store is not a recovery, it is a second incident.

Adopting an existing (pre-ledger) database is deliberately NOT automatic —
``apply_all`` never calls ``adopt_baseline``, so adoption cannot happen as a side
effect of a container start. Adoption probes one sentinel object *per file*
(never per group, PLAN-REVIEW INV-10): it records history only for the contiguous
prefix whose sentinels are all present, and refuses outright on a mixed result
rather than stamp a migration for which there is no evidence that it ran.
"""

from __future__ import annotations

import hashlib
import itertools
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import psycopg

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "supabase" / "migrations"

#: The migration that creates the ledger itself, run as a bootstrap before any
#: row can be written (and then applied/recorded like any other file).
LEDGER_MIGRATION = "0016_schema_migrations.sql"

#: Advisory-lock name serialising every runner against every other runner.
_LOCK_KEY = "xsom_schema_migrations"


class MigrationError(RuntimeError):
    """A migration problem. Always fatal — never downgraded to a warning."""


class ChecksumDrift(MigrationError):
    """A migration already applied no longer matches its file on disk."""

    def __init__(self, filenames: Sequence[str]) -> None:
        self.filenames = list(filenames)
        super().__init__(
            "applied migrations changed on disk (a released migration must never "
            f"be edited): {', '.join(self.filenames)}"
        )


class MixedBaseline(MigrationError):
    """Baseline probes are inconsistent: the database is partially migrated."""

    def __init__(self, present: Sequence[str], missing: Sequence[str]) -> None:
        self.present = list(present)
        self.missing = list(missing)
        super().__init__(
            "refusing to adopt a baseline: the database is partially migrated. "
            f"look applied: {', '.join(self.present) or 'none'}; "
            f"look NOT applied: {', '.join(self.missing) or 'none'}"
        )


@dataclass(frozen=True)
class Sentinel:
    """One object a pre-ledger migration creates, used as evidence that it ran.

    Chosen late in each file so a partially pasted migration does not look
    complete, and never shared with another file so the probe stays per-file.
    """

    filename: str
    kind: Literal["policy", "column", "trigger"]
    parent: str  # table the object belongs to
    name: str  # policy / column / trigger name


#: The 14 files shipped before the ledger existed (0012 is a grandfathered gap),
#: in application order. Adoption walks this list and stops at the first absent
#: sentinel; anything present after that gap is a state we refuse to explain.
_BASELINE: tuple[Sentinel, ...] = (
    Sentinel("0001_init_tenancy.sql", "policy", "gateway_tokens", "gateway_tokens_select_own"),
    Sentinel(
        "0002_downstream_servers.sql",
        "policy",
        "downstream_servers",
        "downstream_servers_select_own",
    ),
    Sentinel("0003_tool_policies.sql", "policy", "tool_policies", "tool_policies_select_own"),
    Sentinel("0004_approvals.sql", "policy", "approvals", "approvals_select_own"),
    Sentinel("0005_audit_log.sql", "trigger", "audit_log", "audit_log_no_delete"),
    Sentinel("0006_agent_usage.sql", "policy", "usage_events", "usage_select_own"),
    Sentinel("0007_provider_credentials.sql", "policy", "billed_cost", "billed_cost_select_own"),
    Sentinel("0008_vault_credentials.sql", "column", "provider_credentials", "vault_secret_id"),
    Sentinel("0009_clients.sql", "column", "gateway_tokens", "client_id"),
    Sentinel("0010_dlp_config.sql", "policy", "dlp_config", "dlp_config_select_own"),
    Sentinel("0011_ai_observability.sql", "column", "usage_events", "user_hash"),
    Sentinel("0013_ai_app_and_read_tokens.sql", "policy", "read_tokens", "read_tokens_select_own"),
    Sentinel(
        "0014_tool_fingerprints.sql",
        "policy",
        "tool_fingerprints",
        "tool_fingerprints_select_own",
    ),
    Sentinel(
        "0015_tool_fingerprints_last_fp.sql", "column", "tool_fingerprints", "last_fingerprint"
    ),
)


def checksum(path: Path) -> str:
    """sha256 (hex) of a migration file's bytes — the content that ran."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _migration_files(directory: Path) -> list[Path]:
    return sorted(directory.glob("*.sql"))


def _ledger_exists(conn: psycopg.Connection) -> bool:
    row = conn.execute("select to_regclass('public.schema_migrations') is not null").fetchone()
    return bool(row and row[0])


@contextmanager
def _runner_lock(conn: psycopg.Connection) -> Iterator[None]:
    """Serialise whole runs across replicas, with a SESSION-level advisory lock.

    Session-scoped rather than transaction-scoped on purpose: every migration
    commits on its own, and a transaction-scoped lock would be released by the
    first of those commits. A second runner could then interleave — and would
    deadlock, because it waits for the lock while its own open read transaction
    holds AccessShare on the ledger, which the first runner needs AccessExclusive
    on to (re)apply ``0016``. Acquiring is the runner's first statement, so a
    waiting runner holds no table lock at all. Postgres reference-counts these
    per session, so nesting is safe; a crashed runner releases on disconnect.
    """
    conn.execute("select pg_advisory_lock(hashtext(%s))", (_LOCK_KEY,))
    conn.commit()  # take a fresh snapshot: the peer we waited for has just written
    try:
        yield
    finally:
        conn.rollback()  # discard any read transaction; applied work is committed
        conn.execute("select pg_advisory_unlock(hashtext(%s))", (_LOCK_KEY,))
        conn.commit()


def _ensure_ledger(conn: psycopg.Connection) -> None:
    """Create the ledger table (idempotent bootstrap). Call under ``_runner_lock``.

    Executes the shipped ``0016`` file rather than a Python copy of its DDL, so the
    table has exactly one definition; 0016 is then applied and recorded by
    ``apply_all`` like every other migration.
    """
    ddl = (MIGRATIONS_DIR / LEDGER_MIGRATION).read_text(encoding="utf-8")
    with conn.transaction():
        conn.execute(ddl)
    conn.commit()


def applied(conn: psycopg.Connection) -> list[str]:
    """Migration filenames recorded in the ledger, in application order."""
    if not _ledger_exists(conn):
        return []
    rows = conn.execute("select filename from schema_migrations order by filename").fetchall()
    return [r[0] for r in rows]


def pending(conn: psycopg.Connection, directory: Path = MIGRATIONS_DIR) -> list[Path]:
    """Migration files on disk that the ledger does not record, in filename order."""
    done = set(applied(conn))
    return [p for p in _migration_files(directory) if p.name not in done]


def verify_integrity(conn: psycopg.Connection, directory: Path = MIGRATIONS_DIR) -> list[str]:
    """Filenames whose on-disk content no longer matches what was applied.

    A released migration must never be edited or renumbered (PRD V-4). The ledger
    holds the sha256 of the bytes that ran, so an edit shows up here — as does a
    deletion, which is an edit down to nothing. Callers treat a non-empty result
    as an error: this is the CI gate.
    """
    if not _ledger_exists(conn):
        return []
    rows = conn.execute("select filename, checksum from schema_migrations").fetchall()
    drifted = [
        filename
        for filename, recorded in rows
        if not (directory / filename).exists() or checksum(directory / filename) != recorded
    ]
    return sorted(drifted)


def _apply_one(conn: psycopg.Connection, path: Path) -> None:
    """Apply one file and its ledger row in a single transaction."""
    statements = path.read_text(encoding="utf-8")
    # Close the read transaction the pending() scan left open: `transaction()`
    # nests as a savepoint inside an open one, and this file must be top-level.
    conn.commit()
    with conn.transaction():
        conn.execute(statements)
        conn.execute(
            "insert into schema_migrations (filename, checksum) values (%s, %s)",
            (path.name, checksum(path)),
        )
    conn.commit()


def apply_all(
    conn: psycopg.Connection, directory: Path = MIGRATIONS_DIR, *, dry_run: bool = False
) -> list[str]:
    """Apply every pending migration in filename order; return the files applied.

    Raises ``ChecksumDrift`` before applying anything if a recorded migration was
    edited. ``dry_run`` returns the same plan while touching nothing at all — not
    even the ledger table — so it can be printed against a virgin database.
    """
    if dry_run:
        return [p.name for p in pending(conn, directory)]
    with _runner_lock(conn):
        _ensure_ledger(conn)
        drifted = verify_integrity(conn, directory)
        if drifted:
            raise ChecksumDrift(drifted)
        # Read the plan under the lock: a peer we waited for may have applied it all.
        plan = pending(conn, directory)
        for path in plan:
            _apply_one(conn, path)
        return [path.name for path in plan]


def _object_exists(conn: psycopg.Connection, sentinel: Sentinel) -> bool:
    """True if the sentinel object is present — evidence its migration ran."""
    if sentinel.kind == "policy":
        query = (
            "select exists (select 1 from pg_policies "
            "where schemaname = 'public' and tablename = %s and policyname = %s)"
        )
    elif sentinel.kind == "column":
        query = (
            "select exists (select 1 from information_schema.columns "
            "where table_schema = 'public' and table_name = %s and column_name = %s)"
        )
    else:  # trigger
        query = (
            "select exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid "
            "where c.relname = %s and t.tgname = %s)"
        )
    row = conn.execute(query, (sentinel.parent, sentinel.name)).fetchone()
    return bool(row and row[0])


def adopt_baseline(conn: psycopg.Connection, directory: Path = MIGRATIONS_DIR) -> list[str]:
    """Record pre-ledger history as applied, on per-file evidence only.

    Probes one sentinel object per baseline file and records the longest
    *contiguous* prefix whose sentinels are all present — those files are not
    re-executed; everything after the prefix stays pending and is applied
    normally by ``apply_all``. A sentinel missing while a later one is present is
    a database this runner cannot explain, so it raises ``MixedBaseline`` naming
    both lists rather than guess (PLAN-REVIEW INV-10). A virgin database has no
    prefix and adopts nothing.
    """
    adopted: list[str] = []
    with _runner_lock(conn):
        _ensure_ledger(conn)
        probed = [
            (s, _object_exists(conn, s)) for s in _BASELINE if (directory / s.filename).exists()
        ]
        prefix = list(itertools.takewhile(lambda pair: pair[1], probed))
        if any(found for _, found in probed[len(prefix) :]):
            raise MixedBaseline(
                [s.filename for s, found in probed if found],
                [s.filename for s, found in probed if not found],
            )

        conn.commit()
        with conn.transaction():
            for sentinel, _ in prefix:
                row = conn.execute(
                    "insert into schema_migrations (filename, checksum) values (%s, %s) "
                    "on conflict (filename) do nothing returning filename",
                    (sentinel.filename, checksum(directory / sentinel.filename)),
                ).fetchone()
                if row is not None:
                    adopted.append(sentinel.filename)
        conn.commit()
    return adopted

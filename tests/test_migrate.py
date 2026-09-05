"""Forward-only migration ledger + runner (core/migrate.py) against real Postgres."""

from __future__ import annotations

import hashlib
import shutil
import threading
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql

from core import migrate
from tests import pgcluster
from tests.conftest import DBHandle

_REPO = Path(__file__).resolve().parent.parent
_SHIM_SQL = _REPO / "tests" / "fixtures" / "supabase_auth_shim.sql"
_ALL_FILES = [p.name for p in sorted(migrate.MIGRATIONS_DIR.glob("*.sql"))]
_BASELINE_FILES = [s.filename for s in migrate._BASELINE]
#: Everything the pre-ledger baseline does not cover — the ledger migration and
#: whatever shipped after it. Derived, so a new migration does not falsify a test
#: about adoption, which is a statement about the baseline and nothing else.
_POST_BASELINE = [f for f in _ALL_FILES if f not in _BASELINE_FILES]


@pytest.fixture
def bare_db(pg_cluster: pgcluster.EphemeralPostgres) -> Iterator[DBHandle]:
    """A database with only the Supabase auth shim — no product migration applied.

    The shared ``db`` fixture already migrates to head, which is exactly what a
    runner test must not assume.
    """
    dbname = f"m_{uuid4().hex[:12]}"
    admin = psycopg.connect(pg_cluster.base_url(), autocommit=True)
    admin.execute(sql.SQL("create database {}").format(sql.Identifier(dbname)))
    url = pg_cluster.url_for(dbname)
    pg_cluster.psql_apply(url, _SHIM_SQL)
    conn = psycopg.connect(url)
    try:
        yield DBHandle(url=url, conn=conn)
    finally:
        conn.close()
        admin.execute(sql.SQL("drop database {} with (force)").format(sql.Identifier(dbname)))
        admin.close()


def _apply_files(conn: psycopg.Connection, filenames: list[str]) -> None:
    """Apply migrations the way an operator used to: by hand, without a ledger."""
    for name in filenames:
        conn.execute((migrate.MIGRATIONS_DIR / name).read_text(encoding="utf-8"))
    conn.commit()


def _write_migrations(directory: Path, files: dict[str, str]) -> None:
    for name, body in files.items():
        (directory / name).write_text(body, encoding="utf-8")


# ---------------------------------------------------------------------------
# apply_all
# ---------------------------------------------------------------------------
def test_apply_all_from_empty_applies_every_file_in_order(bare_db: DBHandle) -> None:
    conn = bare_db.conn
    assert migrate.apply_all(conn) == _ALL_FILES
    assert migrate.applied(conn) == _ALL_FILES
    assert migrate.pending(conn) == []
    # The schema really is there, not merely recorded.
    assert conn.execute("select to_regclass('public.audit_log')").fetchone() == ("audit_log",)
    assert migrate.verify_integrity(conn) == []


def test_second_run_applies_nothing(bare_db: DBHandle) -> None:
    conn = bare_db.conn
    migrate.apply_all(conn)
    assert migrate.apply_all(conn) == []
    assert migrate.applied(conn) == _ALL_FILES


def test_dry_run_reports_the_plan_and_touches_nothing(bare_db: DBHandle) -> None:
    conn = bare_db.conn
    assert migrate.apply_all(conn, dry_run=True) == _ALL_FILES
    # Not even the ledger table is created by a dry run.
    assert conn.execute("select to_regclass('public.schema_migrations')").fetchone() == (None,)
    assert conn.execute("select to_regclass('public.audit_log')").fetchone() == (None,)
    assert migrate.applied(conn) == []


# ---------------------------------------------------------------------------
# Integrity
# ---------------------------------------------------------------------------
def test_checksum_drift_is_detected_and_blocks_the_next_run(
    bare_db: DBHandle, tmp_path: Path
) -> None:
    conn = bare_db.conn
    _write_migrations(
        tmp_path,
        {"0001_a.sql": "create table a (i int);\n", "0002_b.sql": "create table b (i int);\n"},
    )
    assert migrate.apply_all(conn, tmp_path) == ["0001_a.sql", "0002_b.sql"]
    assert migrate.verify_integrity(conn, tmp_path) == []

    (tmp_path / "0001_a.sql").write_text("create table a (i int, j int);\n", encoding="utf-8")
    assert migrate.verify_integrity(conn, tmp_path) == ["0001_a.sql"]
    with pytest.raises(migrate.ChecksumDrift) as excinfo:
        migrate.apply_all(conn, tmp_path)
    assert excinfo.value.filenames == ["0001_a.sql"]


def test_integrity_of_a_database_without_a_ledger_is_vacuously_clean(bare_db: DBHandle) -> None:
    # Nothing was recorded, so nothing can have drifted — and probing must not
    # create the ledger as a side effect.
    assert migrate.verify_integrity(bare_db.conn) == []
    assert bare_db.conn.execute("select to_regclass('public.schema_migrations')").fetchone() == (
        None,
    )


def test_a_deleted_applied_migration_is_drift(bare_db: DBHandle, tmp_path: Path) -> None:
    conn = bare_db.conn
    _write_migrations(tmp_path, {"0001_a.sql": "create table a (i int);\n"})
    migrate.apply_all(conn, tmp_path)
    (tmp_path / "0001_a.sql").unlink()
    assert migrate.verify_integrity(conn, tmp_path) == ["0001_a.sql"]


def test_checksum_is_the_sha256_of_the_file_bytes(tmp_path: Path) -> None:
    path = tmp_path / "0001_a.sql"
    path.write_bytes(b"select 1;\n")
    assert migrate.checksum(path) == hashlib.sha256(b"select 1;\n").hexdigest()


# ---------------------------------------------------------------------------
# Baseline adoption (PLAN-REVIEW INV-10)
# ---------------------------------------------------------------------------
def test_adopt_baseline_on_a_fully_migrated_database(db: DBHandle) -> None:
    # The `db` fixture applies every file by hand, exactly like a pre-ledger deployment.
    conn = db.conn
    assert migrate.adopt_baseline(conn) == _BASELINE_FILES
    assert migrate.applied(conn) == _BASELINE_FILES
    # Everything the baseline does not cover stays pending -- derived rather than
    # spelled out, so adding a migration does not falsify this test.
    assert [p.name for p in migrate.pending(conn)] == _POST_BASELINE
    assert migrate.adopt_baseline(conn) == []


def test_adopt_baseline_stops_at_the_first_gap(bare_db: DBHandle) -> None:
    conn = bare_db.conn
    prefix = _BASELINE_FILES[:9]  # a deployment that stopped after 0009
    _apply_files(conn, prefix)

    assert migrate.adopt_baseline(conn) == prefix
    # The rest was never executed, so it stays pending and is applied for real.
    remaining = [*_BASELINE_FILES[9:], *_POST_BASELINE]
    assert [p.name for p in migrate.pending(conn)] == remaining
    assert migrate.apply_all(conn) == remaining
    assert conn.execute("select to_regclass('public.dlp_config')").fetchone() == ("dlp_config",)


def test_adopt_baseline_refuses_a_mixed_database(db: DBHandle) -> None:
    conn = db.conn
    # 0010 applied then partially undone: its sentinel is gone while 0011+ remain.
    conn.execute("drop policy dlp_config_select_own on dlp_config")
    conn.commit()

    with pytest.raises(migrate.MixedBaseline) as excinfo:
        migrate.adopt_baseline(conn)
    assert excinfo.value.missing == ["0010_dlp_config.sql"]
    assert "0011_ai_observability.sql" in excinfo.value.present
    assert "0010_dlp_config.sql" in str(excinfo.value)
    # Refusing means recording nothing at all.
    assert migrate.applied(conn) == []


def test_adopt_baseline_on_a_virgin_database_adopts_nothing(bare_db: DBHandle) -> None:
    assert migrate.adopt_baseline(bare_db.conn) == []
    assert migrate.applied(bare_db.conn) == []


def test_every_baseline_sentinel_is_absent_before_and_present_after(bare_db: DBHandle) -> None:
    """The probes discriminate: none fire on an empty database, all fire at head."""
    conn = bare_db.conn
    assert [s.filename for s in migrate._BASELINE if migrate._object_exists(conn, s)] == []
    migrate.apply_all(conn)
    assert [s.filename for s in migrate._BASELINE if migrate._object_exists(conn, s)] == (
        _BASELINE_FILES
    )


# ---------------------------------------------------------------------------
# Concurrency
# ---------------------------------------------------------------------------
def test_concurrent_runners_do_not_double_apply(bare_db: DBHandle) -> None:
    results: dict[int, list[str]] = {}
    errors: list[BaseException] = []
    barrier = threading.Barrier(2)

    def run(index: int) -> None:
        try:
            with psycopg.connect(bare_db.url) as conn:
                barrier.wait(timeout=30)
                results[index] = migrate.apply_all(conn)
        except BaseException as exc:  # surfaced in the assertions below
            errors.append(exc)

    threads = [threading.Thread(target=run, args=(i,)) for i in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=120)

    # No error at all: the runner used to deadlock here (a waiting runner held
    # AccessShare on the ledger while the other needed AccessExclusive on it).
    assert errors == []
    assert sorted(results[0] + results[1]) == _ALL_FILES  # no file applied twice
    assert min(len(results[0]), len(results[1])) == 0  # the loser applies nothing
    assert migrate.applied(bare_db.conn) == _ALL_FILES


def test_runner_works_on_an_autocommit_connection(bare_db: DBHandle) -> None:
    """A CLI/bootstrap caller may hand us an autocommit connection (scripts/demo.py)."""
    with psycopg.connect(bare_db.url, autocommit=True) as conn:
        assert migrate.apply_all(conn) == _ALL_FILES
        assert migrate.apply_all(conn) == []


# ---------------------------------------------------------------------------
# The ledger is not tenant data (CLAUDE.md §4.3 — denial, not scoping)
# ---------------------------------------------------------------------------
def test_ledger_is_denied_to_tenant_facing_roles(bare_db: DBHandle) -> None:
    conn = bare_db.conn
    migrate.apply_all(conn)

    rls_on = conn.execute(
        "select relrowsecurity from pg_class where relname = 'schema_migrations'"
    ).fetchone()
    policies = conn.execute(
        "select count(*) from pg_policies where tablename = 'schema_migrations'"
    ).fetchone()
    assert rls_on == (True,)
    assert policies == (0,)  # RLS with no policy = deny by default

    for role in ("anon", "authenticated"):
        granted = conn.execute(
            "select has_table_privilege(%s, 'schema_migrations', 'select')", (role,)
        ).fetchone()
        assert granted == (False,), role

    conn.execute("set local role authenticated")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        conn.execute("select * from schema_migrations")
    conn.rollback()


# ---------------------------------------------------------------------------
# `FR-167` — une histoire incomplète ne peut pas se déclarer courante
# ---------------------------------------------------------------------------
def _shipped(tmp_path: Path, *, drop: str | None = None) -> Path:
    """Une copie du répertoire de migrations, éventuellement amputée d'un fichier.

    C'est la forme exacte d'une image mal construite : le code est là, le manifeste
    est là, un `.sql` manque.
    """
    directory = tmp_path / "migrations"
    shutil.copytree(migrate.MIGRATIONS_DIR, directory)
    if drop is not None:
        (directory / drop).unlink()
    return directory


def test_the_manifest_lists_every_shipped_migration() -> None:
    """Le manifeste est à jour — sinon il ne garde rien.

    Un manifeste périmé est pire qu'aucun : il nomme moins de fichiers que l'image
    n'en porte, donc la vérification passe en ignorant précisément les migrations
    récentes. C'est la même fraîcheur que `coverage/map.json` (`AD-30`), et le
    correctif est la même commande : `make migrations-manifest`.
    """
    assert migrate.MANIFEST.read_text(encoding="utf-8") == migrate.render_manifest()
    assert sorted(migrate.read_manifest()) == _ALL_FILES


def test_apply_all_refuses_a_truncated_migrations_directory(
    bare_db: DBHandle, tmp_path: Path
) -> None:
    """Le chemin de démarrage par défaut : `python -m cli migrate` sur une base vierge.

    Sans ce refus — mesuré — le runner applique les 21 fichiers restants, `pending()`
    revient vide parce qu'il compare le registre au **disque**, `/health/ready`
    répond `schema_current: true`, et ni `public.dlp_config` ni sa policy RLS
    n'existent. Le gate de démarrage est vert et l'isolation manque.
    """
    directory = _shipped(tmp_path, drop="0010_dlp_config.sql")
    conn = bare_db.conn

    with pytest.raises(migrate.IncompleteMigrations) as excinfo:
        migrate.apply_all(conn, directory)
    assert excinfo.value.missing == ["0010_dlp_config.sql"]
    assert migrate.applied(conn) == []  # refuser, c'est ne rien appliquer du tout


def test_apply_all_refuses_a_modified_migration_on_a_virgin_database(
    bare_db: DBHandle, tmp_path: Path
) -> None:
    """L'autre moitié : le fichier est là, ses octets ne sont plus ceux du manifeste.

    Sur une base déjà migrée, `verify_integrity` attrape la dérive contre le
    registre. Sur une base **vierge** il n'y a pas de registre, donc rien ne la
    voyait — et la migration réécrite s'appliquait puis s'enregistrait comme si
    elle avait toujours été ainsi.
    """
    directory = _shipped(tmp_path)
    target = directory / "0010_dlp_config.sql"
    target.write_text(target.read_text(encoding="utf-8") + "\n-- edited\n", encoding="utf-8")

    with pytest.raises(migrate.IncompleteMigrations) as excinfo:
        migrate.apply_all(bare_db.conn, directory)
    assert excinfo.value.drifted == ["0010_dlp_config.sql"]


def test_a_complete_directory_still_applies(bare_db: DBHandle, tmp_path: Path) -> None:
    """Le contrôle qui empêche les deux refus ci-dessus d'être une panne générale."""
    directory = _shipped(tmp_path)
    assert migrate.apply_all(bare_db.conn, directory) == _ALL_FILES


def test_adopt_baseline_refuses_when_a_baseline_file_is_missing_from_disk(
    bare_db: DBHandle, tmp_path: Path
) -> None:
    """Un fichier baseline absent était retiré du contrôle de contiguïté, en silence.

    Conséquence mesurée : une base réellement mixte (tout le baseline sauf 0010) vue
    par une image sans `0010_dlp_config.sql` n'était plus mixte — 13 fichiers
    adoptés, tête atteinte, `schema_current: true`, `public.dlp_config` absente.
    """
    directory = _shipped(tmp_path, drop="0010_dlp_config.sql")
    with pytest.raises(migrate.MigrationError) as excinfo:
        migrate.adopt_baseline(bare_db.conn, directory)
    assert "0010_dlp_config.sql" in str(excinfo.value)
    assert migrate.applied(bare_db.conn) == []


def test_the_trigger_sentinel_ignores_a_same_named_trigger_in_another_schema(
    bare_db: DBHandle,
) -> None:
    """La sonde `trigger` ne filtrait pas le schéma, contrairement aux deux autres.

    Un `audit_log` d'archive portant le même trigger suffisait à faire adopter
    `0005_audit_log.sql` — donc à déclarer appliqués la table d'audit append-only et
    ses triggers anti-mutation (`CLAUDE.md` §4.2) sur une base où `public.audit_log`
    n'existe pas.
    """
    conn = bare_db.conn
    _apply_files(conn, _BASELINE_FILES[:4])
    conn.execute("create schema archive")
    conn.execute("create table archive.audit_log (id int)")
    conn.execute(
        "create function archive.noop() returns trigger language plpgsql as "
        "$$ begin return null; end $$"
    )
    conn.execute(
        "create trigger audit_log_no_delete before delete on archive.audit_log "
        "for each row execute function archive.noop()"
    )
    conn.commit()

    sentinel = next(s for s in migrate._BASELINE if s.filename == "0005_audit_log.sql")
    assert migrate._object_exists(conn, sentinel) is False
    assert migrate.adopt_baseline(conn) == _BASELINE_FILES[:4]
    assert conn.execute("select to_regclass('public.audit_log')").fetchone() == (None,)

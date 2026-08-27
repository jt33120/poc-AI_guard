"""Operator CLI (`python -m cli`) against a real ephemeral PostgreSQL.

The `db` fixture is a database migrated *by hand* — exactly a pre-ledger
deployment — so these tests also cover the upgrade path an existing operator hits.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any
from uuid import uuid4

import psycopg
import pytest

from cli.main import ADMIN_PASSWORD_ENV, main
from core import migrate, signup, tenant_tokens
from core.config import Settings
from tests import pgcluster
from tests.conftest import DBHandle

_REPO = Path(__file__).resolve().parent.parent
#: Raw gateway tokens are the only secret the CLI may print; find them to assert on.
_TOKEN_RE = re.compile(r"xsg_[A-Za-z0-9_-]{20,}")


def _settings(db: DBHandle, **overrides: Any) -> Settings:
    """Deterministic settings, isolated from any local .env file."""
    base: dict[str, Any] = {
        "env": "dev",
        "database_url": db.url,
        "cors_allow_origins": ["http://localhost:3000"],
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)


def _run(
    argv: list[str], settings: Settings, capsys: pytest.CaptureFixture[str]
) -> tuple[int, str]:
    """Run one command; return its exit code and everything it printed."""
    code = main(argv, settings=settings)
    captured = capsys.readouterr()
    return code, captured.out + captured.err


def _migrated(db: DBHandle, capsys: pytest.CaptureFixture[str]) -> Settings:
    """Bring the hand-migrated fixture database under the ledger, at head."""
    settings = _settings(db)
    assert _run(["migrate", "--adopt-baseline"], settings, capsys)[0] == 0
    assert _run(["migrate"], settings, capsys)[0] == 0
    return settings


class FakeAuthAdmin:
    """Stand-in for Supabase Auth Admin: writes the auth.users row the FK needs."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn
        self.metadata: dict[str, Any] = {}
        self.deleted: list[str] = []

    def create_user(self, email: str, password: str) -> str:
        assert password  # provisioning must not pass an empty password through
        user_id = str(uuid4())
        self._conn.execute("insert into auth.users (id, email) values (%s, %s)", (user_id, email))
        self._conn.commit()
        return user_id

    def set_app_metadata(self, user_id: str, metadata: dict[str, Any]) -> None:
        self.metadata = {"user_id": user_id, **metadata}

    def delete_user(self, user_id: str) -> None:  # pragma: no cover - no failure path exercised
        self.deleted.append(user_id)


# ---------------------------------------------------------------------------
# migrate
# ---------------------------------------------------------------------------
def test_migrate_dry_run_reports_the_plan_and_changes_nothing(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    code, out = _run(["migrate", "--dry-run"], _settings(db), capsys)
    assert code == 0
    assert "would be applied" in out
    assert "0001_init_tenancy.sql" in out
    # A dry run records nothing: the ledger is still empty afterwards.
    assert db.conn.execute("select count(*) from schema_migrations").fetchone() == (0,)


def test_migrate_on_a_pre_ledger_database_names_adopt_baseline_as_the_fix(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    # Re-applying 0001 over an already-migrated database fails on a duplicate
    # policy: the operator must get the fix, not a psycopg traceback.
    code, out = _run(["migrate"], _settings(db), capsys)
    assert code == 1
    assert "Traceback" not in out
    assert "--adopt-baseline" in out


def test_adopt_baseline_then_migrate_brings_a_pre_ledger_database_to_head(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = _settings(db)
    code, out = _run(["migrate", "--adopt-baseline"], settings, capsys)
    assert code == 0
    assert "0001_init_tenancy.sql" in out

    code, out = _run(["migrate"], settings, capsys)
    assert code == 0
    assert migrate.LEDGER_MIGRATION in out
    assert _run(["migrate"], settings, capsys) == (0, "migrate: schema already up to date\n")


def test_migrate_refuses_when_the_migration_files_are_missing(
    db: DBHandle, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # An image built without supabase/migrations would otherwise report an empty
    # plan and call itself up to date (the .dockerignore trap).
    monkeypatch.setattr(migrate, "MIGRATIONS_DIR", Path("/nonexistent/migrations"))
    code, out = _run(["migrate"], _settings(db), capsys)
    assert code == 1
    assert "no migration files" in out
    assert ".dockerignore" in out

    code, out = _run(["doctor"], _settings(db), capsys)
    assert code == 1
    assert "[FAIL] schema.source" in out


def test_migrate_reports_an_unreachable_database_without_a_traceback(
    capsys: pytest.CaptureFixture[str],
) -> None:
    settings = Settings(_env_file=None, database_url="postgresql://nobody@127.0.0.1:1/none")
    code, out = _run(["migrate"], settings, capsys)
    assert code == 1
    assert "database unreachable" in out
    assert "DATABASE_URL" in out
    assert "Traceback" not in out


# ---------------------------------------------------------------------------
# bootstrap
# ---------------------------------------------------------------------------
def test_bootstrap_creates_a_tenant_and_prints_a_working_token_once(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    code, out = _run(["bootstrap", "--org", "ACME"], _settings(db), capsys)
    assert code == 0

    tokens = _TOKEN_RE.findall(out)
    assert len(tokens) == 1, "the raw token must be printed exactly once"
    raw = tokens[0]
    assert "ONCE" in out and "cannot be recovered" in out

    # The tenant exists and the printed token really authenticates against it.
    tenant_id = tenant_tokens.resolve_tenant(db.conn, raw)
    assert tenant_id is not None
    assert db.conn.execute("select name from tenants where id = %s", (tenant_id,)).fetchone() == (
        "ACME",
    )
    # Only the hash is stored — the raw secret is nowhere in the database.
    stored = db.conn.execute("select token_hash from gateway_tokens").fetchall()
    assert stored == [(tenant_tokens.hash_token(raw),)]


def test_bootstrap_without_a_service_role_key_says_what_it_could_not_do(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    code, out = _run(["bootstrap", "--org", "ACME"], _settings(db), capsys)
    assert code == 0
    assert "SUPABASE_SERVICE_ROLE_KEY is unset" in out
    assert db.conn.execute("select count(*) from memberships").fetchone() == (0,)


def test_bootstrap_with_email_but_no_service_role_key_refuses_actionably(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    code, out = _run(["bootstrap", "--org", "ACME", "--email", "a@acme.fr"], _settings(db), capsys)
    assert code == 1
    assert "SUPABASE_SERVICE_ROLE_KEY" in out
    assert "Traceback" not in out
    # Fail-closed: nothing was half-created.
    assert db.conn.execute("select count(*) from tenants").fetchone() == (0,)
    assert db.conn.execute("select count(*) from gateway_tokens").fetchone() == (0,)


def test_bootstrap_with_supabase_configured_creates_the_admin_membership(
    db: DBHandle, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    admin = FakeAuthAdmin(db.conn)
    monkeypatch.setattr(signup, "build_auth_admin", lambda _settings: admin)
    monkeypatch.setenv(ADMIN_PASSWORD_ENV, "correct-horse-battery")
    settings = _settings(
        db, supabase_url="https://example.supabase.co", supabase_service_role_key="service-role"
    )

    code, out = _run(["bootstrap", "--org", "ACME", "--email", "Admin@ACME.fr"], settings, capsys)
    assert code == 0
    # The password is never echoed, only the freshly minted token is.
    assert "correct-horse-battery" not in out
    assert len(_TOKEN_RE.findall(out)) == 1

    row = db.conn.execute(
        "select m.role, t.name from memberships m join tenants t on t.id = m.tenant_id"
    ).fetchone()
    assert row == ("admin", "ACME")
    assert admin.metadata["role"] == "admin"
    # Tenant, membership and token all describe the same tenant.
    raw = _TOKEN_RE.findall(out)[0]
    assert tenant_tokens.resolve_tenant(db.conn, raw) == admin.metadata["tenant_id"]


def test_bootstrap_rejects_an_out_of_bounds_org(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    code, out = _run(["bootstrap", "--org", "x" * 81], _settings(db), capsys)
    assert code == 1
    assert "--org must be between 1 and 80 characters" in out


def test_bootstrap_before_migrating_says_to_migrate_first(
    pg_cluster: pgcluster.EphemeralPostgres, capsys: pytest.CaptureFixture[str]
) -> None:
    # The commonest first-run mistake: provisioning against a database that has
    # no schema yet. It must read as a fix, not as SQLSTATE 42P01.
    settings = Settings(_env_file=None, database_url=pg_cluster.base_url())
    code, out = _run(["bootstrap", "--org", "ACME"], settings, capsys)
    assert code == 1
    assert "the schema is not installed" in out
    assert "`python -m cli migrate`" in out
    assert "Traceback" not in out


# ---------------------------------------------------------------------------
# token
# ---------------------------------------------------------------------------
def _seed_tenant(conn: psycopg.Connection) -> str:
    row = conn.execute("insert into tenants (name) values ('ACME') returning id").fetchone()
    conn.commit()
    assert row is not None
    return str(row[0])


def test_token_mint_list_revoke_round_trip(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = _settings(db)
    tenant = _seed_tenant(db.conn)

    mint = ["token", "mint", "--tenant", tenant, "--name", "prod-agent"]
    code, out = _run(mint, settings, capsys)
    assert code == 0
    raw = _TOKEN_RE.findall(out)[0]
    token_id = tenant_tokens.list_tokens(db.conn, tenant)[0]["id"]

    code, out = _run(["token", "list", "--tenant", tenant], settings, capsys)
    assert code == 0
    assert token_id in out and "prod-agent" in out and "active" in out
    assert _TOKEN_RE.search(out) is None, "listing must never reveal a raw token"

    code, out = _run(["token", "revoke", "--tenant", tenant, "--id", token_id], settings, capsys)
    assert code == 0
    assert tenant_tokens.resolve_tenant(db.conn, raw) is None

    code, out = _run(["token", "list", "--tenant", tenant], settings, capsys)
    assert "revoked" in out


def test_token_revoke_of_an_unknown_id_exits_non_zero(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    tenant = _seed_tenant(db.conn)
    code, out = _run(
        ["token", "revoke", "--tenant", tenant, "--id", str(uuid4())], _settings(db), capsys
    )
    assert code == 1
    assert "no active token" in out


def test_token_revoke_refuses_in_prod_without_the_flag(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = _settings(db, env="prod")
    tenant = _seed_tenant(db.conn)
    raw, view = tenant_tokens.mint(db.conn, tenant_id=tenant, name="prod-agent")

    code, out = _run(["token", "revoke", "--tenant", tenant, "--id", view["id"]], settings, capsys)
    assert code == 1
    assert "ENV=prod" in out and "--yes-i-know" in out
    assert tenant_tokens.resolve_tenant(db.conn, raw) == tenant  # still usable

    code, _ = _run(
        ["token", "revoke", "--tenant", tenant, "--id", view["id"], "--yes-i-know"],
        settings,
        capsys,
    )
    assert code == 0
    assert tenant_tokens.resolve_tenant(db.conn, raw) is None


def test_token_mint_for_an_unknown_tenant_is_actionable(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    code, out = _run(["token", "mint", "--tenant", str(uuid4())], _settings(db), capsys)
    assert code == 1
    assert "that tenant does not exist" in out
    assert "Traceback" not in out
    assert db.conn.execute("select count(*) from gateway_tokens").fetchone() == (0,)


def test_token_rejects_a_non_uuid_tenant(db: DBHandle, capsys: pytest.CaptureFixture[str]) -> None:
    code, out = _run(["token", "list", "--tenant", "not-a-uuid"], _settings(db), capsys)
    assert code == 1
    assert "--tenant must be a UUID" in out


# ---------------------------------------------------------------------------
# doctor
# ---------------------------------------------------------------------------
def test_doctor_is_healthy_on_a_migrated_deployment(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = _migrated(db, capsys)
    code, out = _run(["doctor"], settings, capsys)
    assert code == 0
    assert "doctor: healthy" in out
    assert "[OK  ] db.reachable" in out
    assert "[OK  ] schema.pending: at head" in out
    # Optional capabilities are warnings, not failures: off is not broken.
    assert "[WARN] cap.judge" in out
    assert "0 failure(s)" in out


def test_doctor_fails_on_a_pre_ledger_database_and_names_the_fix(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    code, out = _run(["doctor"], _settings(db), capsys)
    assert code == 1
    assert "[FAIL] schema.pending" in out
    assert "--adopt-baseline" in out
    assert "doctor: BROKEN" in out


def test_doctor_fails_on_pending_migrations_after_adoption(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = _settings(db)
    _run(["migrate", "--adopt-baseline"], settings, capsys)
    code, out = _run(["doctor"], settings, capsys)
    assert code == 1
    # Derived, not spelled out: the subject is that doctor fails and *names* what is
    # missing, not that exactly one file happens to sit after the baseline today.
    baseline = {sentinel.filename for sentinel in migrate._BASELINE}
    pending = [
        p.name for p in sorted(migrate.MIGRATIONS_DIR.glob("*.sql")) if p.name not in baseline
    ]
    assert f"{len(pending)} migration(s) pending" in out
    for name in pending:
        assert name in out
    assert "`python -m cli migrate`" in out


def test_doctor_fails_on_checksum_drift(db: DBHandle, capsys: pytest.CaptureFixture[str]) -> None:
    settings = _migrated(db, capsys)
    # What the ledger sees when a released migration is edited after the fact
    # (PRD V-4): the recorded checksum no longer matches the file on disk.
    db.conn.execute(
        "update schema_migrations set checksum = repeat('0', 64) where filename = %s",
        (migrate.LEDGER_MIGRATION,),
    )
    db.conn.commit()

    code, out = _run(["doctor"], settings, capsys)
    assert code == 1
    assert "[FAIL] schema.integrity" in out
    assert "never edited" in out


def test_doctor_fails_when_the_database_is_unreachable(capsys: pytest.CaptureFixture[str]) -> None:
    settings = Settings(_env_file=None, database_url="postgresql://nobody@127.0.0.1:1/none")
    code, out = _run(["doctor"], settings, capsys)
    assert code == 1
    assert "[FAIL] db.reachable" in out
    assert "check DATABASE_URL" in out
    assert "Traceback" not in out


def test_doctor_fails_when_database_url_is_unset(capsys: pytest.CaptureFixture[str]) -> None:
    code, out = _run(["doctor"], Settings(_env_file=None), capsys)
    assert code == 1
    assert "[FAIL] db.url" in out


def test_doctor_flags_production_hardening_gaps(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    _migrated(db, capsys)
    prod = _settings(
        db,
        env="prod",
        cors_allow_origins=[],
        secrets_kms_provider="local",
        secrets_local_kek="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    )

    code, out = _run(["doctor"], prod, capsys)
    assert code == 1
    assert "[FAIL] prod.cors" in out  # no browser origin may call the API
    assert "[FAIL] cap.auth" in out  # authenticated endpoints reject everyone
    assert "[FAIL] cap.secrets" in out  # the local KMS provider is forbidden in prod
    assert "[OK  ] prod.docs: /docs, /redoc and /openapi.json are disabled" in out


def test_doctor_reports_configured_capabilities_as_ok(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    _migrated(db, capsys)
    configured = _settings(
        db,
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="service-role",
        mistral_api_key="key",
        dlp_enabled=True,
        smtp_host="smtp.example.com",
        smtp_from="guard@example.com",
        approval_notify_to="ops@example.com",
    )

    code, out = _run(["doctor"], configured, capsys)
    assert code == 0
    for line in ("cap.auth", "cap.signup", "cap.judge", "cap.dlp", "cap.notify"):
        assert f"[OK  ] {line}" in out
    # Secrets never leak into a diagnostic.
    assert "service-role" not in out


# ---------------------------------------------------------------------------
# The `python -m cli` entry point itself (settings really come from the env)
# ---------------------------------------------------------------------------
def _spawn(args: list[str], **env_overrides: str) -> subprocess.CompletedProcess[str]:
    env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(_REPO),
        "ENV": "dev",
        # Comma-separated, the documented form: this used to crash at import.
        "CORS_ALLOW_ORIGINS": "http://localhost:3000",
        **env_overrides,
    }
    return subprocess.run(
        [sys.executable, "-m", "cli", *args],
        cwd=_REPO,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_python_dash_m_cli_runs_and_reads_the_environment(db: DBHandle) -> None:
    result = _spawn(["doctor"], DATABASE_URL=db.url)
    assert "Traceback" not in result.stderr
    assert result.returncode == 1  # the fixture database has no ledger yet
    assert "[FAIL] schema.pending" in result.stdout
    assert "[OK  ] prod.cors: explicit CORS allowlist (1 origin(s))" in result.stdout


def test_a_bad_env_file_value_is_reported_not_raised(db: DBHandle) -> None:
    # Configuration is validated before any command runs: the operator gets the
    # offending key, not a pydantic traceback.
    result = _spawn(["doctor"], DATABASE_URL=db.url, AUDIT_RETENTION_DAYS="0")
    assert result.returncode == 1
    assert "Traceback" not in result.stderr
    assert "invalid configuration" in result.stderr
    assert "audit_retention_days" in result.stderr

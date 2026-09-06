"""Acceptance: liveness stays static, readiness tells the truth and stays quiet.

The readiness cases run against the real ephemeral cluster: "the schema is at the
bundled head" is only worth asserting if a real ledger says so.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from pydantic import ValidationError

from api import health
from api.main import create_app
from core import migrate
from core.config import Settings
from tests import pgcluster

_COMPAT_SQL = Path(__file__).resolve().parent.parent / "deploy" / "auth_compat.sql"


def _client(**overrides: Any) -> TestClient:
    defaults: dict[str, Any] = {"env": "dev", "cors_allow_origins": ["http://localhost:3000"]}
    settings = Settings(_env_file=None, **{**defaults, **overrides})
    return TestClient(create_app(settings))


@pytest.fixture
def migrated_url(pg_cluster: pgcluster.EphemeralPostgres) -> Iterator[str]:
    """A database migrated by the runner, so the ledger really is at head."""
    dbname = f"h_{uuid4().hex[:12]}"
    admin = psycopg.connect(pg_cluster.base_url(), autocommit=True)
    admin.execute(sql.SQL("create database {}").format(sql.Identifier(dbname)))
    url = pg_cluster.url_for(dbname)
    pg_cluster.psql_apply(url, _COMPAT_SQL)
    with psycopg.connect(url) as conn:
        migrate.apply_all(conn)
    try:
        yield url
    finally:
        admin.execute(sql.SQL("drop database {} with (force)").format(sql.Identifier(dbname)))
        admin.close()


# ---------------------------------------------------------------------------
# Liveness (unchanged behaviour)
# ---------------------------------------------------------------------------
def test_health_ok(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_sets_security_headers(client: TestClient) -> None:
    response = client.get("/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"


# ---------------------------------------------------------------------------
# Readiness
# ---------------------------------------------------------------------------
def test_ready_is_503_without_a_database(client: TestClient) -> None:
    response = client.get("/health/ready")
    assert response.status_code == 503
    assert response.json() == {
        "ok": False,
        "database": False,
        "schema_current": False,
        "issuer": False,
    }


def test_ready_discloses_only_booleans(client: TestClient) -> None:
    """No DSN, no hostname, no capability map — readiness is unauthenticated."""
    payload = client.get("/health/ready").json()
    assert set(payload) == {"ok", "database", "schema_current", "issuer"}
    assert all(isinstance(value, bool) for value in payload.values())


def test_ready_is_200_on_a_migrated_database(migrated_url: str) -> None:
    response = _client(database_url=migrated_url).get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "database": True,
        "schema_current": True,
        "issuer": False,
    }


def test_ready_is_503_when_the_schema_is_behind(migrated_url: str) -> None:
    """A ledger short of the bundled head means the image is newer than the schema."""
    with psycopg.connect(migrated_url) as conn:
        conn.execute(
            "delete from schema_migrations where filename = "
            "(select max(filename) from schema_migrations)"
        )
        conn.commit()
    payload = _client(database_url=migrated_url).get("/health/ready").json()
    assert payload == {"ok": False, "database": True, "schema_current": False, "issuer": False}


def test_ready_is_503_when_a_configured_issuer_does_not_resolve(migrated_url: str) -> None:
    """Configured but unreachable is fatal: no token can be verified."""
    client = _client(
        database_url=migrated_url,
        supabase_jwks_url="http://127.0.0.1:1/.well-known/jwks.json",
    )
    response = client.get("/health/ready")
    assert response.status_code == 503
    assert response.json()["issuer"] is False
    assert response.json()["database"] is True


def test_ready_requires_an_issuer_in_prod(migrated_url: str) -> None:
    """An unconfigured issuer is tolerable for a control-plane-only stack, not in prod."""
    payload = _client(env="prod", database_url=migrated_url).get("/health/ready").json()
    assert payload["ok"] is False
    assert payload["schema_current"] is True


def test_ready_is_memoised(monkeypatch: pytest.MonkeyPatch) -> None:
    """An anonymous caller must not be able to amplify probes into the database."""
    calls = 0

    def counting(settings: Settings) -> health.Readiness:
        nonlocal calls
        calls += 1
        return health.Readiness(ok=True, database=True, schema_current=True, issuer=True)

    monkeypatch.setattr(health, "evaluate", counting)
    client = _client()
    for _ in range(3):
        assert client.get("/health/ready").status_code == 200
    assert calls == 1


# --- `FR-195` — un émetteur qui résout n'est pas un émetteur qu'on sait lire ------


class _KeySet:
    """Une réponse JWKS parfaitement valide. Tout le piège est là : elle existe."""

    status_code = 200

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return {"keys": [{"kid": "k1", "kty": "RSA"}]}


def test_a_foreign_issuer_that_resolves_is_not_declared_ready(
    migrated_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Le défaut que `FR-195` ferme : un feu vert sur ce qui ne peut pas marcher.

    `docker-compose.yml` et `docs/DEPLOY.md` disaient de pointer `SUPABASE_JWKS_URL`
    sur « n'importe quel fournisseur OIDC », et la sonde annonçait `issuer: true`
    parce que le point de terminaison servait un jeu de clés. Mais `api/security.py`
    lit `app_metadata.tenant_id` et `app_metadata.role`, et toute policy RLS lit la
    même chose : les jetons d'un tel émetteur tombent en 403 et ses requêtes rendent
    zéro ligne. L'opérateur avait un déploiement vert et mort.
    """
    monkeypatch.setattr(health.httpx, "get", lambda *a, **k: _KeySet())
    response = _client(
        database_url=migrated_url,
        supabase_jwks_url="https://idp.example.test/.well-known/jwks.json",
    ).get("/health/ready")
    assert response.status_code == 503
    assert response.json()["issuer"] is False
    assert response.json()["database"] is True  # la base va bien : c'est bien l'émetteur


def test_a_declared_compatible_issuer_is_ready(
    migrated_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """La moitié passante. Une garde qui refuse tout ne discrimine rien.

    L'opérateur qui déclare la forme de ses revendications retrouve son feu vert :
    la garde exige une déclaration, elle n'interdit pas d'apporter son émetteur.
    """
    monkeypatch.setattr(health.httpx, "get", lambda *a, **k: _KeySet())
    payload = (
        _client(
            database_url=migrated_url,
            supabase_jwks_url="https://idp.example.test/.well-known/jwks.json",
            issuer_claims="supabase_gotrue",
        )
        .get("/health/ready")
        .json()
    )
    assert payload["issuer"] is True
    assert payload["ok"] is True


def test_the_derived_supabase_issuer_needs_no_declaration(
    migrated_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Un JWKS dérivé de `SUPABASE_URL` est GoTrue par construction.

    Rien à déclarer : demander à l'opérateur d'affirmer ce que le code vient de
    construire lui-même serait une case à cocher, pas une garde.
    """
    monkeypatch.setattr(health.httpx, "get", lambda *a, **k: _KeySet())
    payload = (
        _client(database_url=migrated_url, supabase_url="https://projet.supabase.co")
        .get("/health/ready")
        .json()
    )
    assert payload["issuer"] is True


def test_an_unknown_claims_shape_stops_the_boot() -> None:
    """Le vocabulaire est fermé : « compatible » ne se déclare pas en champ libre.

    Un champ libre laisserait écrire `keycloak` et repartir avec un feu vert. Le
    refus au démarrage force l'opérateur à voir que la forme n'est pas servie —
    même raisonnement que le vocabulaire de `FR-178`.
    """
    with pytest.raises(ValidationError):
        Settings(_env_file=None, issuer_claims="keycloak")

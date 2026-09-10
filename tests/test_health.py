"""Acceptance: liveness stays static, readiness tells the truth and stays quiet.

The readiness cases run against the real ephemeral cluster: "the schema is at the
bundled head" is only worth asserting if a real ledger says so.
"""

from __future__ import annotations

import time
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

    def counting(settings: Settings, plane: str = "all") -> health.Readiness:
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


@pytest.mark.parametrize(
    ("plane", "pret"),
    [("decision", True), ("llm", True), ("console", False), ("all", False)],
)
def test_readiness_only_requires_an_issuer_on_the_planes_that_verify_a_token(
    migrated_url: str, plane: str, pret: bool
) -> None:
    """La cascade que le découpage en plans existe pour empêcher, réintroduite par la sonde.

    `health_router` est dans le socle, donc les trois services rendaient le même
    verdict. Or le plan `décision` ne vérifie **aucun** JWT : `api/authorize.py`
    authentifie par `X-Gateway-Token`. Une panne JWKS — ou un projet Supabase en
    pause, cas mesuré dans `docs/DEPLOY.md` — sortait `/v1/authorize` de la rotation
    pour une dépendance qu'il n'appelle jamais. Et un agent coopératif privé de
    verdict refuse tout : une panne d'authentification console arrêtait la flotte.

    **La base doit être saine ici, et c'est tout le contrôle.** Une première version
    de ce test utilisait un DSN mort : `database` était faux, donc `ok` l'était pour
    les quatre plans, et l'assertion passait aussi bien avec le correctif que sans.
    Éprouvé par mutation — elle ne mordait pas. Avec une base migrée, `issuer` est le
    **seul** verrou qui reste, et les quatre cas se séparent.
    """
    reglages = Settings(
        _env_file=None,
        env="prod",
        cors_allow_origins=["https://exemple.fr"],
        database_url=migrated_url,
    )
    verdict = health.evaluate(reglages, plane)

    assert verdict.database is True and verdict.schema_current is True
    # L'émetteur est absent dans les quatre cas, et le booléen reste publié partout :
    # il est informatif, seul le rollup change.
    assert verdict.issuer is False
    assert verdict.ok is pret, (
        f"plan {plane} : ok={verdict.ok}, attendu {pret}\n"
        "  un plan qui ne lit aucun JWT ne doit pas sortir de la rotation sur une "
        "panne d'émetteur ;\n  la console, si — sans émetteur elle n'autorise rien."
    )


def test_the_planes_that_verify_a_token_are_the_planes_that_exist() -> None:
    """L'ensemble est écrit en dur ici : ce contrôle l'empêche de dériver.

    Il ne peut pas être déduit d'`api.main` sans import circulaire — `api/main.py`
    importe déjà `api/health.py`. Une liste écrite à la main sans confrontation est
    ce que cette session a déjà vu échouer deux fois ; celle-ci est confrontée.
    """
    from api.main import Plane

    connus = {p.value for p in Plane}
    assert connus >= health._PLANS_QUI_VERIFIENT_UN_JETON, (
        f"plans inconnus : {health._PLANS_QUI_VERIFIENT_UN_JETON - connus}"
    )
    assert "console" in health._PLANS_QUI_VERIFIENT_UN_JETON, "la console lit bien des JWT"
    assert "all" in health._PLANS_QUI_VERIFIENT_UN_JETON, "le monolithe sert la console"


def test_the_probe_evaluates_once_under_concurrent_load(migrated_url: str) -> None:
    """La mémoïsation que le docstring du module promet, et que le code ne tenait pas.

    « The verdict is memoised for a few seconds so the probe cannot be used as an
    anonymous database or JWKS amplifier » — mais la lecture et l'écriture de
    `state.readiness` n'étaient protégées par rien, dans une fonction **synchrone**,
    donc exécutée dans le pool de threads de Starlette. Vingt requêtes simultanées
    sur une route anonyme et non limitée ouvraient vingt connexions sur le DSN
    qu'utilise aussi le chemin de décision.

    Une relecture croit le commentaire. Ce contrôle compte les évaluations réelles.
    """
    import threading
    from concurrent.futures import ThreadPoolExecutor

    client = _client(database_url=migrated_url)
    evaluations = 0
    verrou = threading.Lock()
    vrai_evaluate = health.evaluate

    def compter(*a: Any, **k: Any) -> Any:
        nonlocal evaluations
        with verrou:
            evaluations += 1
        time.sleep(0.05)  # une évaluation réelle touche la base : elle dure
        return vrai_evaluate(*a, **k)

    health.evaluate = compter  # type: ignore[assignment]
    try:
        with ThreadPoolExecutor(max_workers=20) as pool:
            reponses = [f.result() for f in [pool.submit(_appel, client) for _ in range(20)]]
    finally:
        health.evaluate = vrai_evaluate  # type: ignore[assignment]

    assert all(code == 200 for code in reponses), reponses
    assert evaluations == 1, (
        f"{evaluations} évaluations pour 20 requêtes simultanées — la sonde est un "
        "amplificateur : chaque évaluation ouvre une connexion sur le DSN du chemin "
        "de décision, depuis une route anonyme et non limitée."
    )


def _appel(client: TestClient) -> int:
    return client.get("/health/ready").status_code

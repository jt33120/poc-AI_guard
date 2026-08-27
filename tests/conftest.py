"""Shared pytest fixtures (HTTP client, auth/JWT, ephemeral Postgres)."""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jose import jwk, jwt
from psycopg import sql

from api.main import create_app
from api.security import TokenVerifier
from core.config import Settings
from tests import pgcluster

_REPO = Path(__file__).resolve().parent.parent
_SHIM_SQL = _REPO / "tests" / "fixtures" / "supabase_auth_shim.sql"
_MIGRATIONS_DIR = _REPO / "supabase" / "migrations"
_TEST_KID = "test-key"


# ---------------------------------------------------------------------------
# Settings / HTTP client
# ---------------------------------------------------------------------------
@pytest.fixture
def dev_settings() -> Settings:
    """Deterministic dev settings, isolated from any local .env file."""
    return Settings(_env_file=None, env="dev", cors_allow_origins=["http://localhost:3000"])


@pytest.fixture
def client(dev_settings: Settings) -> TestClient:
    return TestClient(create_app(dev_settings))


# ---------------------------------------------------------------------------
# Auth: RSA keypair, JWKS, token factory, verifier, authenticated client
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def rsa_keys() -> tuple[str, dict[str, Any]]:
    """A signing private key (PEM) and the matching public JWK for the JWKS."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = (
        key.public_key()
        .public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode()
    )
    public_jwk = jwk.construct(public_pem, "RS256").to_dict()
    public_jwk = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in public_jwk.items()}
    public_jwk.update({"kid": _TEST_KID, "use": "sig", "alg": "RS256"})
    return private_pem, public_jwk


@pytest.fixture
def make_token(rsa_keys: tuple[str, dict[str, Any]]) -> Callable[..., str]:
    """Factory minting signed RS256 JWTs that the test verifier accepts."""
    private_pem, _ = rsa_keys

    def _make(
        *,
        sub: str | None = None,
        tenant_id: str | None = None,
        role: str | None = None,
        aud: str = "authenticated",
        exp_delta: int = 3600,
        **extra: Any,
    ) -> str:
        now = int(time.time())
        app_metadata: dict[str, Any] = {}
        if tenant_id is not None:
            app_metadata["tenant_id"] = tenant_id
        if role is not None:
            app_metadata["role"] = role
        claims: dict[str, Any] = {
            "sub": sub or str(uuid4()),
            "aud": aud,
            "iat": now,
            "exp": now + exp_delta,
            "app_metadata": app_metadata,
        }
        claims.update(extra)
        return jwt.encode(claims, private_pem, algorithm="RS256", headers={"kid": _TEST_KID})

    return _make


@pytest.fixture
def test_verifier(rsa_keys: tuple[str, dict[str, Any]]) -> TokenVerifier:
    _, public_jwk = rsa_keys
    return TokenVerifier(jwks_source=lambda: {"keys": [public_jwk]}, audience="authenticated")


@pytest.fixture
def auth_client(dev_settings: Settings, test_verifier: TokenVerifier) -> TestClient:
    """Client whose app verifies tokens with the local test keypair."""
    app = create_app(dev_settings)
    app.state.verifier = test_verifier
    return TestClient(app)


# ---------------------------------------------------------------------------
# Ephemeral PostgreSQL (real RLS testing)
# ---------------------------------------------------------------------------
@dataclass
class DBHandle:
    url: str
    conn: psycopg.Connection


@pytest.fixture(scope="session")
def pg_cluster() -> Iterator[pgcluster.EphemeralPostgres]:
    if not pgcluster.binaries_available():
        pytest.skip("PostgreSQL server binaries unavailable")
    cluster = pgcluster.EphemeralPostgres()
    cluster.start()
    try:
        yield cluster
    finally:
        cluster.stop()


@pytest.fixture
def db(pg_cluster: pgcluster.EphemeralPostgres) -> Iterator[DBHandle]:
    """A fresh database with the auth shim + product migrations applied."""
    dbname = f"t_{uuid4().hex[:12]}"
    admin = psycopg.connect(pg_cluster.base_url(), autocommit=True)
    admin.execute(sql.SQL("create database {}").format(sql.Identifier(dbname)))
    url = pg_cluster.url_for(dbname)
    pg_cluster.psql_apply(url, _SHIM_SQL)
    for migration in sorted(_MIGRATIONS_DIR.glob("*.sql")):
        pg_cluster.psql_apply(url, migration)
    conn = psycopg.connect(url)
    try:
        yield DBHandle(url=url, conn=conn)
    finally:
        conn.close()
        admin.execute(sql.SQL("drop database {} with (force)").format(sql.Identifier(dbname)))
        admin.close()


# --- Coverage scenarios (AD-26, AD-30) ---------------------------------------
# A gate test may declare the coverage facet it proves:
#
#     @pytest.mark.covers("M-06", "chaine", ingress="mcp", sens="bloque")
#
# `sens` says which half of the claim the test carries: `bloque` (the action was
# refused) or `laisse_passer` (a legitimate action still went through). A `Bloqué`
# facet needs both, because a guard that refuses everything is not a control, it is
# an outage -- and the blocking test stays green on a gateway that blocks blindly.
# A test asserting both halves carries both markers.
#
# The run records every marked test's outcome to `coverage/.scenarios.json`, and
# `scripts/gen_coverage.py` folds that into the published map. A test that did not
# run, or did not pass, proves nothing -- there is no third state.

_SCENARIOS_OUT = _REPO / "coverage" / ".scenarios.json"
_scenarios_key = pytest.StashKey[list[dict[str, Any]]]()


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "covers(row, facet, ingress=..., sens=...): coverage facet this test proves (AD-26)",
    )
    config.stash[_scenarios_key] = []


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo[None]) -> Any:
    outcome = yield
    report = outcome.get_result()
    if report.when != "call":
        return
    for mark in item.iter_markers(name="covers"):
        if len(mark.args) != 2:
            raise ValueError(f"{item.nodeid}: @covers takes (row, facet)")
        row, facet = mark.args
        sens = mark.kwargs.get("sens")
        if sens not in ("bloque", "laisse_passer"):
            raise ValueError(f"{item.nodeid}: @covers needs sens='bloque'|'laisse_passer'")
        item.config.stash[_scenarios_key].append(
            {
                "row": row,
                "facet": facet,
                "ingress": mark.kwargs.get("ingress"),
                "sens": sens,
                "test": item.nodeid,
                "outcome": report.outcome,
            }
        )


def pytest_sessionfinish(session: pytest.Session) -> None:
    scenarios = session.config.stash.get(_scenarios_key, None)
    if not scenarios:
        return
    _SCENARIOS_OUT.parent.mkdir(parents=True, exist_ok=True)
    _SCENARIOS_OUT.write_text(json.dumps(scenarios, indent=2, sort_keys=True), encoding="utf-8")

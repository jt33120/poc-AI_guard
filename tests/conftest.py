"""Shared pytest fixtures (HTTP client, auth/JWT, ephemeral Postgres)."""

from __future__ import annotations

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

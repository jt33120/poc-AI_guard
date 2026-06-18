"""Provider credentials API: admin-only, secret never returned, encrypted at rest."""

from __future__ import annotations

import base64
import os
from collections.abc import Callable
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import credentials, secrets
from core.config import Settings
from tests.conftest import DBHandle

KEK = base64.b64encode(os.urandom(32)).decode()


def _settings(db_url: str, *, with_kms: bool = True) -> Settings:
    extra = {"secrets_kms_provider": "local", "secrets_local_kek": KEK} if with_kms else {}
    return Settings(_env_file=None, env="dev", database_url=db_url, **extra)


def _client(settings: Settings, verifier: TokenVerifier) -> TestClient:
    app = create_app(settings)
    app.state.verifier = verifier
    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _tenant(db: DBHandle) -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'C')", (tid,))
    db.conn.commit()
    return tid


def test_connect_list_revoke_never_exposes_secret(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(_settings(db.url), test_verifier)
    admin = make_token(tenant_id=tid, role="admin")

    created = client.post(
        "/v1/credentials",
        headers=_auth(admin),
        json={"provider": "openrouter", "label": "Prod key", "secret": "sk-or-LIVE-123"},
    )
    assert created.status_code == 201
    body = created.json()
    assert body["provider"] == "openrouter" and body["label"] == "Prod key"
    assert "secret" not in body and "sk-or" not in created.text

    listed = client.get("/v1/credentials", headers=_auth(admin)).json()
    assert len(listed) == 1 and listed[0]["revoked"] is False
    assert "secret" not in listed[0]

    # Stored ciphertext must not contain the plaintext, yet must decrypt back.
    row = db.conn.execute(
        "select ciphertext from provider_credentials where tenant_id = %s", (tid,)
    ).fetchone()
    assert row is not None and "sk-or-LIVE-123" not in row[0]
    kp = secrets.build_key_provider(_settings(db.url))
    assert credentials.reveal_secret(db.conn, kp, tid, "openrouter") == "sk-or-LIVE-123"

    cred_id = body["id"]
    assert client.delete(f"/v1/credentials/{cred_id}", headers=_auth(admin)).status_code == 204
    after = client.get("/v1/credentials", headers=_auth(admin)).json()
    assert after[0]["revoked"] is True


def test_non_admin_cannot_manage_credentials(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(_settings(db.url), test_verifier)
    viewer = make_token(tenant_id=tid, role="viewer")
    assert client.get("/v1/credentials", headers=_auth(viewer)).status_code == 403
    assert (
        client.post(
            "/v1/credentials",
            headers=_auth(viewer),
            json={"provider": "openai", "label": "x", "secret": "y"},
        ).status_code
        == 403
    )


def test_credentials_are_tenant_isolated(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    a, b = _tenant(db), _tenant(db)
    client = _client(_settings(db.url), test_verifier)
    client.post(
        "/v1/credentials",
        headers=_auth(make_token(tenant_id=a, role="admin")),
        json={"provider": "openai", "label": "A key", "secret": "sk-a"},
    )
    other = client.get(
        "/v1/credentials", headers=_auth(make_token(tenant_id=b, role="admin"))
    ).json()
    assert other == []


def test_connect_fails_closed_without_secret_backend(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(_settings(db.url, with_kms=False), test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    resp = client.post(
        "/v1/credentials",
        headers=_auth(admin),
        json={"provider": "openai", "label": "x", "secret": "y"},
    )
    assert resp.status_code == 503

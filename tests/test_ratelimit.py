"""Costly endpoints are rate-limited via slowapi (SPEC §3/§6, M6)."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core.config import Settings, get_settings
from tests.conftest import DBHandle


@pytest.fixture
def _low_export_limit(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("EXPORT_RATE_LIMIT", "2/minute")
    get_settings.cache_clear()
    try:
        yield
    finally:
        get_settings.cache_clear()


def test_export_is_rate_limited(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    _low_export_limit: None,
) -> None:
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    app = create_app(Settings(_env_file=None, env="dev", database_url=db.url))
    app.state.verifier = test_verifier
    client = TestClient(app)
    headers = {
        "Authorization": f"Bearer {make_token(tenant_id=str(tenant), role='admin')}",
        # Unique client key so this test's bucket is isolated from others.
        "X-Forwarded-For": "203.0.113.7",
    }

    assert client.get("/v1/audit/export?format=ai_act", headers=headers).status_code == 200
    assert client.get("/v1/audit/export?format=ai_act", headers=headers).status_code == 200
    assert client.get("/v1/audit/export?format=ai_act", headers=headers).status_code == 429

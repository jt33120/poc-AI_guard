"""Settings: safe defaults, env overrides, and fail-closed CORS (CLAUDE.md §4.8)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from api.main import create_app
from core.config import Settings


def test_defaults_are_safe() -> None:
    settings = Settings(_env_file=None)
    assert settings.env == "dev"
    assert settings.is_prod is False
    assert settings.docs_enabled is True
    assert settings.cors_allow_origins == []
    assert settings.sentry_dsn is None


def test_prod_disables_docs() -> None:
    settings = Settings(_env_file=None, env="prod")
    assert settings.is_prod is True
    assert settings.docs_enabled is False


def test_cors_origins_split_from_comma_string() -> None:
    settings = Settings(_env_file=None, cors_allow_origins="http://a.com, http://b.com")
    assert settings.cors_allow_origins == ["http://a.com", "http://b.com"]


def test_cors_wildcard_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, cors_allow_origins="*")


def test_prod_app_hides_docs_but_serves_health() -> None:
    app = create_app(Settings(_env_file=None, env="prod"))
    assert app.docs_url is None
    assert app.openapi_url is None
    client = TestClient(app)
    assert client.get("/health").status_code == 200
    assert client.get("/docs").status_code == 404

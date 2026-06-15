"""Shared pytest fixtures."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from core.config import Settings


@pytest.fixture
def dev_settings() -> Settings:
    """Deterministic dev settings, isolated from any local .env file."""
    return Settings(_env_file=None, env="dev", cors_allow_origins=["http://localhost:3000"])


@pytest.fixture
def client(dev_settings: Settings) -> TestClient:
    return TestClient(create_app(dev_settings))

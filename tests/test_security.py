"""Auth & RBAC: protected route + JWKS verification + require_role (CLAUDE.md §4)."""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose.exceptions import JWTError

from api.security import build_verifier, require_role
from core.config import Settings
from core.schemas import CurrentUser, Role


def test_protected_route_requires_token(auth_client: TestClient) -> None:
    assert auth_client.get("/v1/me").status_code == 401


def test_protected_route_rejects_garbage_token(auth_client: TestClient) -> None:
    response = auth_client.get("/v1/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401


def test_protected_route_accepts_valid_token(
    auth_client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id, tenant_id = str(uuid4()), str(uuid4())
    token = make_token(sub=user_id, tenant_id=tenant_id, role="admin")
    response = auth_client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json() == {"user_id": user_id, "tenant_id": tenant_id, "role": "admin"}


def test_expired_token_rejected(auth_client: TestClient, make_token: Callable[..., str]) -> None:
    token = make_token(role="admin", exp_delta=-30)
    response = auth_client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_wrong_audience_rejected(auth_client: TestClient, make_token: Callable[..., str]) -> None:
    token = make_token(role="admin", aud="some-other-service")
    response = auth_client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_unknown_role_resolves_to_none(
    auth_client: TestClient, make_token: Callable[..., str]
) -> None:
    token = make_token(role="superhacker")
    response = auth_client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["role"] is None


def test_require_role_allows_member() -> None:
    dependency = require_role(Role.admin, Role.operator)
    user = CurrentUser(user_id="u", tenant_id="t", role=Role.operator)
    assert dependency(user=user) is user


def test_require_role_denies_insufficient_role() -> None:
    dependency = require_role(Role.admin)
    with pytest.raises(HTTPException) as exc:
        dependency(user=CurrentUser(user_id="u", role=Role.viewer))
    assert exc.value.status_code == 403


def test_require_role_denies_missing_role() -> None:
    dependency = require_role(Role.admin)
    with pytest.raises(HTTPException) as exc:
        dependency(user=CurrentUser(user_id="u", role=None))
    assert exc.value.status_code == 403


def test_unconfigured_verifier_is_fail_closed(make_token: Callable[..., str]) -> None:
    verifier = build_verifier(Settings(_env_file=None))  # no JWKS configured
    with pytest.raises(JWTError):
        verifier.verify(make_token(role="admin"))

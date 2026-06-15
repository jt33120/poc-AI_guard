"""Authentication and RBAC for the control API (CLAUDE.md §4.3, SPEC §8).

Supabase JWTs are verified against the project's JWKS (asymmetric keys). The
verified principal carries the tenant id and role from ``app_metadata`` — the
same claim RLS reads. Everything is fail-closed: no/invalid token, unconfigured
JWKS, or missing role all deny access (401/403).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from jose.exceptions import JWTError

from core.config import Settings
from core.schemas import CurrentUser, Role

_ALGORITHMS = ("RS256", "ES256")
_ROLE_VALUES = {r.value for r in Role}

JWKSSource = Callable[[], dict[str, Any]]


class TokenVerifier:
    """Verifies Supabase JWTs against a JWKS, with key caching + rotation."""

    def __init__(
        self,
        jwks_source: JWKSSource,
        audience: str,
        issuer: str | None = None,
        algorithms: tuple[str, ...] = _ALGORITHMS,
    ) -> None:
        self._jwks_source = jwks_source
        self._audience = audience
        self._issuer = issuer
        self._algorithms = list(algorithms)
        self._keys: dict[str, dict[str, Any]] | None = None

    def _load_keys(self, force: bool = False) -> dict[str, dict[str, Any]]:
        if self._keys is None or force:
            jwks = self._jwks_source()
            self._keys = {k["kid"]: k for k in jwks.get("keys", []) if "kid" in k}
        return self._keys

    def _find_key(self, kid: str) -> dict[str, Any]:
        keys = self._load_keys()
        if kid not in keys:
            keys = self._load_keys(force=True)  # rotation: refetch once
        if kid not in keys:
            raise JWTError(f"unknown key id: {kid}")
        return keys[kid]

    def verify(self, token: str) -> dict[str, Any]:
        """Return verified claims, or raise JWTError on any failure."""
        header = jwt.get_unverified_header(token)
        alg = header.get("alg")
        if alg not in self._algorithms:
            raise JWTError(f"unsupported algorithm: {alg}")
        key = self._find_key(header.get("kid", ""))
        options = {"verify_aud": True, "require": ["exp", "sub"]}
        claims: dict[str, Any] = jwt.decode(
            token,
            key,
            algorithms=[alg],
            audience=self._audience,
            issuer=self._issuer if self._issuer else None,
            options={**options, "verify_iss": bool(self._issuer)},
        )
        return claims


def _http_jwks_source(url: str) -> JWKSSource:
    def fetch() -> dict[str, Any]:
        response = httpx.get(url, timeout=5.0)
        response.raise_for_status()
        data: dict[str, Any] = response.json()
        return data

    return fetch


def _unconfigured_source() -> dict[str, Any]:
    # Fail-closed: with no JWKS configured, every token fails to verify.
    raise JWTError("JWKS endpoint is not configured")


def build_verifier(settings: Settings) -> TokenVerifier:
    """Construct the token verifier from settings (fail-closed if unconfigured)."""
    url = settings.jwks_url
    source: JWKSSource = _http_jwks_source(url) if url else _unconfigured_source
    return TokenVerifier(
        jwks_source=source,
        audience=settings.supabase_jwt_audience,
        issuer=settings.supabase_jwt_issuer,
    )


def _user_from_claims(claims: dict[str, Any]) -> CurrentUser:
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    app_metadata = claims.get("app_metadata") or {}
    role_raw = app_metadata.get("role")
    role = Role(role_raw) if role_raw in _ROLE_VALUES else None
    return CurrentUser(user_id=sub, tenant_id=app_metadata.get("tenant_id"), role=role)


_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> CurrentUser:
    """FastAPI dependency: resolve and verify the caller, or raise 401."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    verifier: TokenVerifier = request.app.state.verifier
    try:
        claims = verifier.verify(credentials.credentials)
    except (JWTError, httpx.HTTPError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        ) from None
    return _user_from_claims(claims)


def require_role(*roles: Role) -> Callable[..., CurrentUser]:
    """Dependency factory enforcing tenant RBAC (fail-closed on missing role)."""
    allowed = set(roles)

    def dependency(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role is None or user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return user

    return dependency

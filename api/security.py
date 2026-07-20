"""Authentication and RBAC for the control API (CLAUDE.md §4.3, SPEC §8).

Supabase JWTs are verified against the project's JWKS (asymmetric keys). The
verified principal carries the tenant id and role from ``app_metadata`` — the
same claim RLS reads. Everything is fail-closed: no/invalid token, unconfigured
JWKS, or missing role all deny access (401/403).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from jose.exceptions import JWTError

from core import db, read_tokens, tenant_tokens
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


def get_ai_reader(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> CurrentUser:
    """Resolve the caller for the /ai read API: a console JWT OR a read token.

    Server-to-server callers (the mip-rum facade) present an ``xsr_`` read token;
    console users present a Supabase JWT. Both resolve to a tenant; fail-closed.
    """
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    raw = credentials.credentials
    if raw.startswith(read_tokens.TOKEN_PREFIX):
        url: str | None = request.app.state.database_url
        if not url:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database not configured"
            )
        with db.connection(url) as conn:
            tenant_id = read_tokens.resolve_tenant(conn, raw)
        if tenant_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid read token"
            )
        return CurrentUser(user_id="read_token", tenant_id=tenant_id, role=Role.viewer)
    verifier: TokenVerifier = request.app.state.verifier
    try:
        claims = verifier.verify(raw)
    except (JWTError, httpx.HTTPError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        ) from None
    return _user_from_claims(claims)


@dataclass(frozen=True)
class GatewayPrincipal:
    """A resolved machine-to-machine caller: its tenant and the agent (token id)."""

    tenant_id: str
    token_id: str


def resolve_gateway_principal(request: Request, raw_token: str | None) -> GatewayPrincipal:
    """Resolve the tenant + agent for a gateway token (from header OR URL path).

    Fail-closed (CLAUDE.md §4.4): missing token, unconfigured DB, or an
    unknown/revoked token all deny (401/503).
    """
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing gateway token"
        )
    url: str | None = request.app.state.database_url
    if not url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database not configured"
        )
    try:
        with db.connection(url) as conn:
            token_id, tenant_id = tenant_tokens.authenticate_gateway_principal(conn, raw_token)
            conn.commit()
    except PermissionError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid gateway token"
        ) from None
    return GatewayPrincipal(tenant_id=tenant_id, token_id=token_id)


def get_gateway_principal(
    request: Request,
    x_gateway_token: str | None = Header(default=None, alias="X-Gateway-Token"),
) -> GatewayPrincipal:
    """FastAPI dependency: resolve the agent from the ``X-Gateway-Token`` header."""
    return resolve_gateway_principal(request, x_gateway_token)


def get_gateway_tenant(
    principal: GatewayPrincipal = Depends(get_gateway_principal),
) -> str:
    """Resolve just the tenant for a machine-to-machine call (compat shim)."""
    return principal.tenant_id


def require_role(*roles: Role) -> Callable[..., CurrentUser]:
    """Dependency factory enforcing tenant RBAC (fail-closed on missing role)."""
    allowed = set(roles)

    def dependency(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role is None or user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return user

    return dependency

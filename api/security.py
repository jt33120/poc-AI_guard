"""Authentication and RBAC for the control API (CLAUDE.md §4.3, SPEC §8).

Supabase JWTs are verified against the project's JWKS (asymmetric keys). The
verified principal carries the tenant id and role from ``app_metadata`` — the
same claim RLS reads. Everything is fail-closed: no/invalid token, unconfigured
JWKS, or missing role all deny access (401/403).

**Portée.** Ce module authentifie la *console* — un humain, un JWT Supabase, un JWKS
distant. L'authentification *machine* (jeton de passerelle, Postgres seul) vit dans
:mod:`api.gateway_auth`, et la séparation est une propriété de souveraineté, pas un
rangement : le chemin de décision importe la seconde, et lui rendre la première le
ferait dépendre d'un service distant pour rendre un verdict (`AD-25`, `FR-176`).
Remettre les deux ensemble fait échouer `scripts/audit_sovereignty.py`.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx
import psycopg
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from jose.exceptions import JWTError

from core import control_plane, db, read_tokens, role_map
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


@dataclass(frozen=True, slots=True)
class Federation:
    """La correspondance groupe→rôle d'un émetteur OIDC client (`FR-196`).

    Construite une fois au démarrage : une correspondance malformée doit refuser de
    démarrer, pas produire un 500 au premier login.
    """

    groups_claim: str
    tenant_claim: str
    group_roles: dict[str, Role]


def build_federation(settings: Settings) -> Federation | None:
    """La fédération déclarée, ou ``None`` si ce déploiement n'en a pas.

    Rien n'est lu hors du profil ``oidc_groups`` : un déploiement Supabase existant ne
    doit pas changer de comportement parce qu'une variable traîne dans son
    environnement.
    """
    if settings.issuer_claims != "oidc_groups":
        return None
    return Federation(
        groups_claim=settings.issuer_groups_claim,
        tenant_claim=settings.issuer_tenant_claim,
        group_roles=role_map.parse_group_roles(settings.issuer_group_roles),
    )


def _user_from_claims(claims: dict[str, Any], federation: Federation | None = None) -> CurrentUser:
    """Le principal vérifié : sujet, tenant, rôle. Fail-closed sur chacun des trois.

    ``app_metadata.role`` gagne quand il est présent — c'est la forme GoTrue, déjà
    servie. La correspondance de groupes n'est consultée qu'à défaut, pour que la
    fédération soit une porte de plus et non un changement de comportement.
    """
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    app_metadata = claims.get("app_metadata") or {}
    role_raw = app_metadata.get("role")
    if role_raw in _ROLE_VALUES:
        return CurrentUser(
            user_id=sub, tenant_id=app_metadata.get("tenant_id"), role=Role(role_raw)
        )
    if federation is None:
        return CurrentUser(user_id=sub, tenant_id=app_metadata.get("tenant_id"), role=None)
    groups = role_map.groups_in(claims, federation.groups_claim)
    tenant = role_map.claim_at(claims, federation.tenant_claim)
    return CurrentUser(
        user_id=sub,
        tenant_id=tenant if isinstance(tenant, str) else None,
        role=role_map.role_for_groups(groups, federation.group_roles),
    )


def _record_federated_role(request: Request, user: CurrentUser, claims: dict[str, Any]) -> None:
    """Écrire l'attribution de rôle déduite des groupes, si elle a changé.

    `FR-196` exige que chaque attribution soit un événement de plan de contrôle.
    Écrire à chaque requête noierait le journal sous ce qui ne s'est pas produit :
    :func:`core.control_plane.record_assignment` ne grave que les changements.

    **Ne concerne que le chemin fédéré.** Un ``app_metadata.role`` GoTrue a été
    attribué par l'administrateur de l'IdP, pas déduit par nous ; il n'y a rien à
    consigner, et le coût de la requête reste chez qui a choisi la fédération.

    Un journal inaccessible refuse l'accès (503) plutôt que d'accorder un rôle sans
    trace : une attribution non consignée est exactement le trou que ce FR ferme
    (`CLAUDE.md` §4.4, §9). La console dépend de toute façon de la base.
    """
    federation: Federation | None = getattr(request.app.state, "federation", None)
    if federation is None or user.role is None or not user.tenant_id:
        return
    url: str | None = request.app.state.database_url
    if not url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database not configured"
        )
    groups = role_map.groups_in(claims, federation.groups_claim)
    try:
        with db.connection(url) as conn:
            control_plane.record_assignment(
                conn,
                tenant_id=user.tenant_id,
                subject=user.user_id,
                role=user.role,
                groups=groups,
            )
            conn.commit()
    except psycopg.Error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Control plane log unavailable",
        ) from None


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
    user = _user_from_claims(claims, getattr(request.app.state, "federation", None))
    _record_federated_role(request, user, claims)
    return user


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
    user = _user_from_claims(claims, getattr(request.app.state, "federation", None))
    _record_federated_role(request, user, claims)
    return user


def require_role(*roles: Role) -> Callable[..., CurrentUser]:
    """Dependency factory enforcing tenant RBAC (fail-closed on missing role)."""
    allowed = set(roles)

    def dependency(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role is None or user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return user

    return dependency

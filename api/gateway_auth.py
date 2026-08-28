"""Authentification machine-à-machine : le porteur d'un jeton de passerelle.

Séparé de :mod:`api.security` pour une raison de souveraineté, pas de rangement
(`AD-25`, `FR-176`). La console vérifie un JWT Supabase contre un **JWKS distant**,
donc `api.security` peut sortir. Résoudre l'appelant d'un agent, lui, ne consulte que
Postgres — et c'est la première étape de tout verdict : sans principal, aucun filtre
n'a de tenant à qui appliquer une policy.

Les deux dans le même module, le chemin de décision héritait de la sortie réseau de
la console, et la revendication « le produit décide hors ligne » devenait fausse par
un import. La frontière est donc ici, et la garde `scripts/audit_sovereignty.py`
échoue si elle se refranchit.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request, status

from core import db, tenant_tokens


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

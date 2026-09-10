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

import logging
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request, status

from api import ratelimit
from core import db, tenant_tokens

logger = logging.getLogger(__name__)


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
        _refus("missing", None)
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
            token_id, tenant_id, authorize_rpm, proxy_rpm = (
                tenant_tokens.authenticate_gateway_principal(conn, raw_token)
            )
            conn.commit()
    except PermissionError:
        _refus("rejected", raw_token)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid gateway token"
        ) from None
    _publier_le_debit(request, tenant_id, authorize_rpm, proxy_rpm)
    return GatewayPrincipal(tenant_id=tenant_id, token_id=token_id)


def _publier_le_debit(
    request: Request, tenant_id: str, authorize_rpm: int | None, proxy_rpm: int | None
) -> None:
    """Faire connaître au limiteur le tenant, puis ce que son palier lui accorde.

    **L'ordre des deux gestes est la seule chose délicate ici.** Poser le tenant change
    la clé de compartiment que `client_key` calcule ; les débits doivent être déposés
    sous *cette* clé-là, celle que slowapi relira quelques microsecondes plus tard.
    Publier avant de poser le tenant déposerait sous l'ancienne clé — `ip:` ou
    `jeton:` — et le résolveur retomberait silencieusement sur le plafond
    d'infrastructure, c'est-à-dire sur le comportement d'avant ce lot.

    Cette dépendance s'exécute **avant** le limiteur : FastAPI résout les dépendances,
    puis appelle la fonction de route, qui est l'enveloppe posée par
    `@limiter.shared_limit`, et c'est elle qui vérifie la limite avant de déléguer.
    """
    setattr(request.state, ratelimit.ETAT_TENANT, tenant_id)
    ratelimit.publier_debits(ratelimit.client_key(request), authorize_rpm, proxy_rpm)


def _refus(motif: str, raw_token: str | None) -> None:
    """Journalise un refus d'authentification de passerelle.

    Il n'en restait **aucune** trace : ni journal, ni `audit_log` (ce chemin
    n'appelle pas `log_event`), ni Sentry — une `HTTPException` est gérée par
    FastAPI et n'atteint jamais le handler d'`api/errors.py`. Un jeton révoqué qui
    martèle l'API, ou un balayage de jetons, ne laissait pour seul indice qu'un
    `last_used_at` qui ne bougeait pas.

    L'**empreinte** et jamais le jeton : elle suffit à compter les tentatives par
    porteur, et elle ne peut pas servir à rejouer. C'est la lecture stricte de
    §4.10 — des métadonnées, pas le secret.
    """
    extra: dict[str, str] = {"reason": motif}
    if raw_token:
        extra["token_fp"] = tenant_tokens.hash_token(raw_token)[:16]
    logger.warning("gateway_auth_refused", extra=extra)


def get_gateway_principal(
    request: Request,
    x_gateway_token: str | None = Header(default=None, alias="X-Gateway-Token"),
) -> GatewayPrincipal:
    """FastAPI dependency: resolve the agent from the ``X-Gateway-Token`` header."""
    return resolve_gateway_principal(request, x_gateway_token)


def get_gateway_principal_from_path(
    request: Request,
    token: str,
) -> GatewayPrincipal:
    """Le principal des routes du proxy qui portent le jeton dans le **chemin**.

    Une dépendance et non un appel dans le corps, et ce n'est pas cosmétique : les
    dépendances sont résolues **avant** que le limiteur ne calcule son compartiment.
    Résolu dans le corps, le tenant arrivait trop tard, et ces deux routes-là restaient
    compartimentées sur la clé fournisseur de l'agent pendant que les quatre autres
    passaient au palier — deux comportements pour une seule limite vendue.
    """
    return resolve_gateway_principal(request, token)


def get_gateway_tenant(
    principal: GatewayPrincipal = Depends(get_gateway_principal),
) -> str:
    """Resolve just the tenant for a machine-to-machine call (compat shim)."""
    return principal.tenant_id

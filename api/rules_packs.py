"""Règles sur mesure xSOM : lecture par le client, composition par xSOM, retrait par le poste.

Trois publics, trois portes, et aucune ne mène à l'autre :

* **le client** (`GET /v1/rules-pack`) lit son réglage sous RLS : version, validité,
  détecteurs, couverture des postes. Il ne l'écrit pas ; il demande un ajustement à xSOM ;
* **l'opérateur xSOM** (`/v1/xsom/…`) compose, essaie, signe et publie. Il est désigné par
  ``XSOM_OPERATOR_SUBJECTS`` côté serveur (:mod:`core.operators`), jamais par un rôle que
  l'administrateur du client pourrait se donner ;
* **le poste** (`GET /v1/extension/rules-pack`) récupère l'enveloppe signée avec son jeton
  de passerelle, exactement comme `/v1/extension/policy` (§7).

Les termes en clair et le texte d'essai ne sont ni conservés ni journalisés : ils ne
vivent que le temps de la requête (`core/rules_packs.py`).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, model_validator

from api.deps import database_url, require_tenant
from api.gateway_auth import GatewayPrincipal, get_gateway_principal
from api.ratelimit import limiter, rules_pack_rate_limit
from api.security import get_current_user, is_xsom_operator, require_xsom_operator
from core import db, extension_devices, rules_packs
from core.schemas import CurrentUser, Role

router = APIRouter(tags=["rules-packs"])
console_router = APIRouter(tags=["rules-packs"])

#: Termes saisis sur l'ensemble d'une composition : la borne de §2.4, appliquée avant
#: tout calcul pour qu'une requête démesurée soit refusée sans être traitée.
_MAX_DRAFT_TERMS = 20_000


class DryRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    draft: rules_packs.PackDraft
    sample: str | None = Field(default=None, max_length=rules_packs.MAX_SAMPLE_CHARS, repr=False)

    @model_validator(mode="after")
    def _bounded(self) -> DryRunRequest:
        _check_terms_budget(self.draft)
        return self


class PublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    draft: rules_packs.PackDraft
    expected_version: int = Field(alias="expectedVersion", ge=0, le=2_147_483_646)

    @model_validator(mode="after")
    def _bounded(self) -> PublishRequest:
        _check_terms_budget(self.draft)
        return self


class RevokeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1, le=2_147_483_647)


def _check_terms_budget(draft: rules_packs.PackDraft) -> None:
    total = sum(
        len(d.match.terms or [])
        for d in draft.detectors
        if isinstance(d.match, rules_packs.TermsDraft)
    )
    if total > _MAX_DRAFT_TERMS:
        raise ValueError("too many terms")


def _refusal(exc: rules_packs.RulesPackError) -> HTTPException:
    """Un refus explicable : le code, le détecteur ou le test en cause, jamais le contenu."""
    if isinstance(exc, rules_packs.SigningUnavailable):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=exc.as_dict())
    if isinstance(exc, rules_packs.VersionConflict):
        return HTTPException(status.HTTP_409_CONFLICT, detail=exc.as_dict())
    if exc.code in ("engine_busy", "engine_failed"):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=exc.as_dict())
    if exc.code == "pack_id_mismatch":
        return HTTPException(status.HTTP_409_CONFLICT, detail=exc.as_dict())
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=exc.as_dict())


def _pack_view(latest: rules_packs.Published, *, show_patterns: bool) -> dict[str, Any]:
    payload = latest.payload
    expires = payload["expiresAt"]
    return {
        "packId": latest.pack_id,
        "version": latest.version,
        "issuedAt": payload["issuedAt"],
        "expiresAt": expires,
        "issuer": payload["issuer"],
        "keyId": latest.key_id,
        "payloadDigest": latest.payload_digest,
        "publishedAt": latest.created_at,
        "revoked": latest.revoked,
        "expired": expires <= datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "detectors": rules_packs.summary(payload, show_patterns=show_patterns),
        "tests": {
            "positives": len(payload["tests"]["positives"]),
            "negatives": len(payload["tests"]["negatives"]),
        },
    }


# ---------------------------------------------------------------------------
# Le client : lecture seule, sous RLS
# ---------------------------------------------------------------------------
@console_router.get("/v1/rules-pack")
def tenant_rules_pack(
    request: Request, user: CurrentUser = Depends(get_current_user)
) -> dict[str, Any]:
    tenant = require_tenant(user)
    role = user.role or Role.viewer
    with db.tenant_reader(
        database_url(request), user_id=user.user_id, tenant_id=tenant, role=role
    ) as conn:
        latest = rules_packs.current(conn, tenant)
        chain = rules_packs.verify_chain(conn, tenant)
        history = rules_packs.history(conn, tenant)
        coverage = rules_packs.coverage(conn, tenant, latest.payload_digest) if latest else None
    return {
        "pack": _pack_view(latest, show_patterns=role is Role.admin) if latest else None,
        "coverage": coverage,
        "history": history,
        "chainIntact": chain.ok,
        "xsomOperator": is_xsom_operator(request.app.state.settings, user),
    }


# ---------------------------------------------------------------------------
# L'opérateur xSOM : composer, essayer, signer, publier
# ---------------------------------------------------------------------------
def _tenant_name(conn: Any, tenant_id: UUID) -> str:
    row = conn.execute("select name from tenants where id = %s", (str(tenant_id),)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return str(row[0])


@console_router.get("/v1/xsom/tenants")
def operator_tenants(
    request: Request, _: CurrentUser = Depends(require_xsom_operator)
) -> list[dict[str, Any]]:
    with db.connection(database_url(request)) as conn:
        rows = conn.execute(
            "select t.id::text, t.name, p.pack_id, p.version, p.created_at from tenants t "
            "left join lateral (select pack_id, version, created_at from rules_pack_events e "
            "where e.tenant_id = t.id and e.event = 'published' order by e.id desc limit 1) p "
            "on true order by t.name limit 500"
        ).fetchall()
    return [
        {"id": row[0], "name": row[1], "packId": row[2], "version": row[3], "publishedAt": row[4]}
        for row in rows
    ]


def _editable(payload: dict[str, Any]) -> dict[str, Any]:
    """Le paquet publié, rendu à l'opérateur pour la version suivante — sans empreintes."""
    detectors = []
    for detector in payload["detectors"]:
        match = detector["match"]
        if match["type"] == "terms":
            match = {
                "type": "terms",
                "termsCount": len(match["digests"]),
                "maxWords": match["maxWords"],
            }
        detectors.append({**detector, "match": match})
    return {"packId": payload["packId"], "detectors": detectors, "tests": payload["tests"]}


@console_router.get("/v1/xsom/tenants/{tenant_id}/rules-pack")
def operator_rules_pack(
    tenant_id: UUID, request: Request, _: CurrentUser = Depends(require_xsom_operator)
) -> dict[str, Any]:
    tenant = str(tenant_id)
    with db.connection(database_url(request)) as conn:
        name = _tenant_name(conn, tenant_id)
        latest = rules_packs.current(conn, tenant)
        coverage = rules_packs.coverage(conn, tenant, latest.payload_digest) if latest else None
        history = rules_packs.history(conn, tenant)
        chain = rules_packs.verify_chain(conn, tenant)
    signing_ready = True
    try:
        rules_packs.signer(request.app.state.settings)
    except rules_packs.SigningUnavailable:
        signing_ready = False
    return {
        "tenant": {"id": tenant, "name": name},
        "pack": _pack_view(latest, show_patterns=True) if latest else None,
        "draft": _editable(latest.payload) if latest else None,
        "coverage": coverage,
        "history": history,
        "chainIntact": chain.ok,
        "signingReady": signing_ready,
    }


def _utf16_offsets(text: str) -> list[int]:
    """Position UTF-16 de chaque point de code : la console découpe en unités JavaScript."""
    offsets = [0]
    for char in text:
        offsets.append(offsets[-1] + (2 if ord(char) > 0xFFFF else 1))
    return offsets


def _payload(
    draft: rules_packs.PackDraft, tenant: str, latest: rules_packs.Published | None
) -> dict[str, Any]:
    """La version suivante telle qu'elle serait signée ; ``publish`` en refixe le numéro.

    Une version retirée ne prête pas ses empreintes : il faut ressaisir les termes.
    """
    return rules_packs.build_payload(
        draft,
        tenant_id=tenant,
        version=(latest.version if latest else 0) + 1,
        previous=latest.payload if latest and not latest.revoked else None,
    )


#: Refus qui ne disent rien de la composition : le moteur est occupé ou a échoué.
_INFRASTRUCTURE = frozenset({"engine_busy", "engine_failed"})


@console_router.post("/v1/xsom/tenants/{tenant_id}/rules-pack/dry-run")
@limiter.limit(rules_pack_rate_limit)
def operator_dry_run(
    tenant_id: UUID,
    body: DryRunRequest,
    request: Request,
    _: CurrentUser = Depends(require_xsom_operator),
) -> dict[str, Any]:
    tenant = str(tenant_id)
    with db.connection(database_url(request)) as conn:
        _tenant_name(conn, tenant_id)
        latest = rules_packs.current(conn, tenant)
    version = (latest.version if latest else 0) + 1
    try:
        payload = _payload(body.draft, tenant, latest)
        evaluation = rules_packs.evaluate(payload, body.sample)
    except rules_packs.RulesPackError as exc:
        if exc.code in _INFRASTRUCTURE:
            raise _refusal(exc) from None
        # Un refus de la composition est une réponse de l'essai, pas une panne.
        return {
            "valid": False,
            "error": exc.as_dict(),
            "version": version,
            "detections": [],
            "truncated": False,
        }
    labels = {d["id"]: d["label"] for d in payload["detectors"]}
    offsets = _utf16_offsets(body.sample or "")
    return {
        "valid": evaluation.error is None,
        "error": evaluation.error,
        "version": version,
        "detections": [
            {
                "detector": found["detector"],
                "label": labels.get(found["detector"], found["detector"]),
                "start": offsets[found["start"]],
                "end": offsets[found["end"]],
            }
            for found in evaluation.detections
        ],
        "truncated": evaluation.truncated,
    }


@console_router.post("/v1/xsom/tenants/{tenant_id}/rules-pack/publish")
@limiter.limit(rules_pack_rate_limit)
def operator_publish(
    tenant_id: UUID,
    body: PublishRequest,
    request: Request,
    user: CurrentUser = Depends(require_xsom_operator),
) -> dict[str, Any]:
    tenant = str(tenant_id)
    try:
        # Fermé d'abord : sans clé d'autorité, on ne calcule ni n'éprouve rien.
        signing = rules_packs.signer(request.app.state.settings)
        with db.connection(database_url(request)) as conn:
            _tenant_name(conn, tenant_id)
            latest = rules_packs.current(conn, tenant)
        payload = _payload(body.draft, tenant, latest)
        # Éprouvé hors de toute transaction : le calcul isolé peut durer des secondes.
        rules_packs.validate(payload)
        with db.connection(database_url(request)) as conn:
            sealed = rules_packs.publish(
                conn,
                tenant_id=tenant,
                payload=payload,
                expected_version=body.expected_version,
                signing=signing,
                created_by=user.user_id,
                expected_revoked=latest.revoked if latest else False,
            )
            conn.commit()
    except rules_packs.RulesPackError as exc:
        raise _refusal(exc) from None
    return {
        "version": sealed["payload"]["version"],
        "packId": sealed["payload"]["packId"],
        "payloadDigest": sealed["payloadDigest"],
        "keyId": sealed["keyId"],
    }


@console_router.post(
    "/v1/xsom/tenants/{tenant_id}/rules-pack/revoke", status_code=status.HTTP_204_NO_CONTENT
)
def operator_revoke(
    tenant_id: UUID,
    body: RevokeRequest,
    request: Request,
    user: CurrentUser = Depends(require_xsom_operator),
) -> None:
    with db.connection(database_url(request)) as conn:
        _tenant_name(conn, tenant_id)
        if not rules_packs.revoke(
            conn, tenant_id=str(tenant_id), version=body.version, revoked_by=user.user_id
        ):
            raise HTTPException(status_code=404, detail="No revocable version")
        conn.commit()


# ---------------------------------------------------------------------------
# Le poste : même authentification que /v1/extension/policy (§7)
# ---------------------------------------------------------------------------
@router.get("/v1/extension/rules-pack")
def workstation_rules_pack(
    request: Request, principal: GatewayPrincipal = Depends(get_gateway_principal)
) -> dict[str, Any]:
    with db.connection(database_url(request)) as conn:
        try:
            extension_devices.device_for(conn, principal.tenant_id, principal.token_id)
        except LookupError:
            raise HTTPException(status_code=404, detail="Device not registered") from None
        return {"rulesPack": rules_packs.for_device(conn, principal.tenant_id)}

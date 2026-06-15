"""Control-API routes for the policy and the effective tool view (SPEC §8, M3)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from api.deps import database_url, require_tenant
from api.security import get_current_user, require_role
from core import db, policy_store, servers
from core.policy import PolicyError, evaluate, parse_policy
from core.schemas import CurrentUser, PolicyDocument, PolicyUpdate, Role, ToolView
from gateway.downstream import DownstreamProxy, ServerSpec

router = APIRouter(prefix="/v1", tags=["policy"])

_require_admin = require_role(Role.admin)


@router.get("/policy", response_model=PolicyDocument)
def get_policy(request: Request, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        yaml_text, version = policy_store.load_yaml(conn, tenant_id)
    return {"yaml": yaml_text, "version": version}


@router.put("/policy", response_model=PolicyDocument)
def put_policy(
    payload: PolicyUpdate,
    request: Request,
    user: CurrentUser = Depends(_require_admin),
) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    try:
        parse_policy(payload.yaml)  # validate before persisting (422 on failure)
    except PolicyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    url = database_url(request)
    with db.connection(url) as conn:
        version = policy_store.save_yaml(conn, tenant_id, payload.yaml)
    return {"yaml": payload.yaml, "version": version}


@router.get("/tools", response_model=list[ToolView])
async def list_tools(
    request: Request, user: CurrentUser = Depends(get_current_user)
) -> list[dict[str, Any]]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.connection(url) as conn:
        rows = servers.enabled_specs(conn, tenant_id)
        policy = policy_store.load_policy(conn, tenant_id)

    proxy = DownstreamProxy(
        [
            ServerSpec(name=name, transport=transport, config=config)
            for name, transport, config in rows
        ]
    )
    views: list[dict[str, Any]] = []
    for tool in await proxy.list_tools():
        resolved = await proxy.resolve(tool.name)
        canonical = f"{resolved[0]}.{resolved[1]}" if resolved else tool.name
        outcome = evaluate(policy, canonical, {})
        views.append(
            {
                "name": tool.name,
                "canonical": canonical,
                "action_class": outcome.action_class.value if outcome.action_class else None,
                "decision": outcome.decision.value,
            }
        )
    return views

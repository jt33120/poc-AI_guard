"""Control-API routes for the policy and the effective tool view (SPEC §8, M3)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from api.deps import database_url, require_tenant
from api.ratelimit import limiter, policy_draft_rate_limit
from api.security import get_current_user, require_role
from core import audit, db, judge, policy_assistant, policy_store, servers
from core.config import Settings
from core.policy import PolicyError, evaluate, parse_policy
from core.schemas import (
    CurrentUser,
    PolicyDocument,
    PolicyDraftRequest,
    PolicyUpdate,
    Role,
    ToolView,
)
from gateway.downstream import DownstreamProxy, ServerSpec

router = APIRouter(prefix="/v1", tags=["policy"])

_require_admin = require_role(Role.admin)


@router.post("/policy/draft", response_model=PolicyDocument)
@limiter.limit(policy_draft_rate_limit)
def draft_policy(
    payload: PolicyDraftRequest,
    request: Request,
    user: CurrentUser = Depends(_require_admin),
) -> dict[str, Any]:
    """Draft a validated policy YAML from a plain-language description (admin)."""
    require_tenant(user)
    settings: Settings = request.app.state.settings
    if not settings.mistral_api_key:
        raise HTTPException(status_code=503, detail="Policy assistant is not configured")
    completer = judge.litellm_completer(settings.mistral_model, settings.mistral_api_key)
    try:
        yaml_text = policy_assistant.draft_policy(completer, payload.prompt)
    except PolicyError as exc:
        raise HTTPException(
            status_code=422, detail="Could not turn that into a valid policy — try rephrasing."
        ) from exc
    # version 0 marks an unsaved draft; the admin reviews then saves via PUT.
    return {"yaml": yaml_text, "version": 0}


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
        observed = audit.distinct_tools(conn, tenant_id)

    proxy = DownstreamProxy(
        [
            ServerSpec(name=name, transport=transport, config=config)
            for name, transport, config in rows
        ]
    )
    views: list[dict[str, Any]] = []
    seen: set[str] = set()
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
        seen.add(canonical)

    # Policy-declared actions: agents using the cooperative /v1/authorize path have
    # no MCP downstream server, so the policy itself is the catalogue of actions.
    for rule in policy.tools:
        if rule.name in seen:
            continue
        outcome = evaluate(policy, rule.name, {})
        action_class = outcome.action_class.value if outcome.action_class else None
        if action_class is None and rule.classify == "ambiguous":
            action_class = "ambiguous"
        views.append(
            {
                "name": rule.name,
                "canonical": rule.name,
                "action_class": action_class,
                "decision": outcome.decision.value,
            }
        )
        seen.add(rule.name)

    # Observed actions: tools the agent actually called (from the audit trail),
    # auto-classified when there's no explicit rule — the Inspector discovers the
    # agent's real surface without any manual declaration.
    for name in observed:
        if name in seen:
            continue
        outcome = evaluate(policy, name, {})
        views.append(
            {
                "name": name,
                "canonical": name,
                "action_class": outcome.action_class.value if outcome.action_class else None,
                "decision": outcome.decision.value,
            }
        )
        seen.add(name)
    return views

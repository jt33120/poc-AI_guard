"""LLM provider proxy — zero-code monitoring of agent tool-calls.

The agent points its OpenAI ``base_url`` at this proxy and presents its tenant
gateway token (``X-Gateway-Token``). xSOM forwards the request to the provider
using the agent's *own* provider key (in ``Authorization`` — never stored), then
inspects the tool-calls the model asked for and writes one hash-chained audit
entry per call (decision computed from the tenant policy).

This is monitoring mode: the provider response is returned **unchanged** — the
agent still executes the call, so this gives full visibility + audit without
hard enforcement (use the cooperative ``/v1/authorize`` path to *block*). Only
metadata + ``args_hash`` is ever logged, never message content or keys (§4.10).
Streaming requests are passed through transparently (not inspected in this MVP).
"""

from __future__ import annotations

import json
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from api.deps import database_url
from api.ratelimit import limiter, llm_proxy_rate_limit
from api.security import get_gateway_tenant
from core import approvals, audit, db, policy_store
from core.config import Settings
from core.policy import Approval, evaluate

router = APIRouter(prefix="/proxy/openai", tags=["llm-proxy"])

# Monitoring decisions use the same verdict vocabulary as /v1/authorize so the
# dashboard buckets them consistently (a would-review action logs as "hold").
_VERDICT: dict[Approval, str] = {
    Approval.auto: "allow",
    Approval.human_in_the_loop: "hold",
    Approval.human_dual: "hold",
    Approval.deny: "deny",
}

_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(120.0))
    return _client


def _extract_tool_calls(data: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """Pull (name, arguments) for every tool-call the model requested."""
    calls: list[tuple[str, dict[str, Any]]] = []
    for choice in data.get("choices") or []:
        message = (choice or {}).get("message") or {}
        for call in message.get("tool_calls") or []:
            fn = (call or {}).get("function") or {}
            name = fn.get("name")
            if not name:
                continue
            raw = fn.get("arguments")
            try:
                args = json.loads(raw) if isinstance(raw, str) else raw
            except (ValueError, TypeError):
                args = None
            calls.append((name, args if isinstance(args, dict) else {}))
    return calls


def _audit_tool_calls(url: str, tenant_id: str, data: dict[str, Any]) -> None:
    calls = _extract_tool_calls(data)
    if not calls:
        return
    request_id = data.get("id")
    with db.connection(url) as conn:
        policy = policy_store.load_policy(conn, tenant_id)
    # Write audit on a fresh connection so each log_event is a top-level,
    # committed transaction (a preceding SELECT would nest it in a savepoint
    # that db.connection rolls back on close).
    with db.connection(url) as conn:
        for name, args in calls:
            outcome = evaluate(policy, name, args)
            audit.log_event(
                conn,
                tenant_id=tenant_id,
                decision=_VERDICT.get(outcome.decision, outcome.decision.value),
                tool_name=name,
                action_class=outcome.action_class.value if outcome.action_class else None,
                args_hash=approvals.args_hash(args),
                request_id=request_id if isinstance(request_id, str) else None,
            )


@router.post("/v1/chat/completions")
@limiter.limit(llm_proxy_rate_limit)
async def openai_chat_completions(
    request: Request,
    tenant_id: str = Depends(get_gateway_tenant),
) -> Response:
    settings: Settings = request.app.state.settings
    url = database_url(request)
    body = await request.body()
    upstream = settings.openai_base_url.rstrip("/") + "/v1/chat/completions"
    headers = {
        "Authorization": request.headers.get("authorization", ""),
        "Content-Type": "application/json",
    }

    try:
        streaming = bool(json.loads(body or b"{}").get("stream"))
    except (ValueError, TypeError):
        streaming = False

    client = _http()

    if streaming:
        # Transparent passthrough so streaming agents never break (not inspected).
        upstream_req = client.build_request("POST", upstream, content=body, headers=headers)
        upstream_resp = await client.send(upstream_req, stream=True)
        return StreamingResponse(
            upstream_resp.aiter_raw(),
            status_code=upstream_resp.status_code,
            media_type=upstream_resp.headers.get("content-type", "text/event-stream"),
            background=BackgroundTask(upstream_resp.aclose),
        )

    upstream_resp = await client.post(upstream, content=body, headers=headers)
    if upstream_resp.status_code == 200:
        try:
            data = upstream_resp.json()
        except ValueError:
            data = None
        if isinstance(data, dict):
            # Don't block the event loop on the synchronous DB write.
            await run_in_threadpool(_audit_tool_calls, url, tenant_id, data)
    return Response(
        content=upstream_resp.content,
        status_code=upstream_resp.status_code,
        media_type=upstream_resp.headers.get("content-type", "application/json"),
    )

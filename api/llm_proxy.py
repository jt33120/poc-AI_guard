"""LLM provider proxy — zero-code monitoring (and optional enforcement).

The agent points its provider ``base_url`` at this proxy and presents its tenant
gateway token (``X-Gateway-Token``). xSOM forwards to the provider using the
agent's *own* key (never stored), inspects the tool-calls the model requested,
and writes one hash-chained audit entry per call (decision from the tenant
policy) attributed to the calling agent. It also records token usage + an
estimated cost per completion for the usage dashboard.

Providers: OpenAI / Mistral / OpenRouter (OpenAI-compatible Chat Completions)
and Anthropic Messages.

Modes (``X-XSOM-Mode`` header):
  * ``monitor`` (default) — the provider response is returned unchanged.
  * ``enforce`` — tool-calls that aren't auto-allowed (``hold``/``deny``) are
    stripped from the response so the agent can't run them. True
    human-in-the-loop *approval* still belongs on the cooperative
    ``/v1/authorize`` path (the proxy can't pause a single completion).

Only metadata + ``args_hash`` and token *counts* are ever logged, never content
or keys (§4.10). Streaming is passed through transparently (not inspected).
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
from api.security import GatewayPrincipal, get_gateway_principal
from core import approvals, audit, db, policy_store, pricing
from core import usage as usage_store
from core.config import Settings
from core.policy import Approval, Policy, evaluate

router = APIRouter(prefix="/proxy", tags=["llm-proxy"])

# Monitoring decisions use the same verdict vocabulary as /v1/authorize so the
# dashboard buckets them consistently (a would-review action logs as "hold").
_VERDICT: dict[Approval, str] = {
    Approval.auto: "allow",
    Approval.human_in_the_loop: "hold",
    Approval.human_dual: "hold",
    Approval.deny: "deny",
}

_BLOCKED_NOTE = "[xSOM blocked the requested action(s) by policy.]"

_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(120.0))
    return _client


def _parse_args(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _extract_tool_calls(data: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """OpenAI: (name, arguments) for every tool-call the model requested."""
    calls: list[tuple[str, dict[str, Any]]] = []
    for choice in data.get("choices") or []:
        message = (choice or {}).get("message") or {}
        for call in message.get("tool_calls") or []:
            fn = (call or {}).get("function") or {}
            name = fn.get("name")
            if name:
                calls.append((name, _parse_args(fn.get("arguments"))))
    return calls


def _extract_tool_use(data: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """Anthropic: (name, input) for every tool_use block in the message content."""
    calls: list[tuple[str, dict[str, Any]]] = []
    for block in data.get("content") or []:
        if (block or {}).get("type") == "tool_use" and block.get("name"):
            calls.append(
                (block["name"], block.get("input") if isinstance(block.get("input"), dict) else {})
            )
    return calls


def _extract_usage(style: str, data: dict[str, Any]) -> tuple[str | None, int, int] | None:
    """(model, prompt_tokens, completion_tokens) from the provider response, or None."""
    usage = data.get("usage")
    if not isinstance(usage, dict):
        return None
    raw_model = data.get("model")
    model = raw_model if isinstance(raw_model, str) else None
    if style == "anthropic":
        prompt = _as_int(usage.get("input_tokens"))
        completion = _as_int(usage.get("output_tokens"))
    else:
        prompt = _as_int(usage.get("prompt_tokens"))
        completion = _as_int(usage.get("completion_tokens"))
    if prompt == 0 and completion == 0:
        return None
    return (model, prompt, completion)


def _verdict(policy: Policy, name: str, args: dict[str, Any]) -> tuple[str | None, str]:
    outcome = evaluate(policy, name, args)
    action_class = outcome.action_class.value if outcome.action_class else None
    return action_class, _VERDICT.get(outcome.decision, outcome.decision.value)


def _process(
    style: str, data: dict[str, Any], policy: Policy, enforce: bool
) -> list[tuple[str, str | None, str, str]]:
    """Audit rows [(tool, class, decision, args_hash)]; strip non-allowed calls if enforce."""
    audited: list[tuple[str, str | None, str, str]] = []

    def judge(name: str, args: dict[str, Any]) -> str:
        action_class, decision = _verdict(policy, name, args)
        audited.append((name, action_class, decision, approvals.args_hash(args)))
        return decision

    if style == "openai":
        for choice in data.get("choices") or []:
            message = (choice or {}).get("message") or {}
            calls = message.get("tool_calls")
            if not isinstance(calls, list):
                continue
            kept = []
            for call in calls:
                fn = (call or {}).get("function") or {}
                name = fn.get("name")
                if name and judge(name, _parse_args(fn.get("arguments"))) != "allow" and enforce:
                    continue
                kept.append(call)
            if enforce:
                message["tool_calls"] = kept
                if not kept and not message.get("content"):
                    message["content"] = _BLOCKED_NOTE
    elif style == "anthropic":
        content = data.get("content")
        if isinstance(content, list):
            kept = []
            for block in content:
                if (block or {}).get("type") == "tool_use" and block.get("name"):
                    args = block.get("input") if isinstance(block.get("input"), dict) else {}
                    if judge(block["name"], args) != "allow" and enforce:
                        continue
                kept.append(block)
            if enforce:
                data["content"] = kept
    return audited


def _inspect(
    url: str,
    tenant_id: str,
    gateway_token_id: str | None,
    provider: str,
    style: str,
    data: dict[str, Any],
    enforce: bool,
) -> None:
    with db.connection(url) as conn:
        policy = policy_store.load_policy(conn, tenant_id)
    audited = _process(style, data, policy, enforce)
    usage = _extract_usage(style, data)
    if not audited and usage is None:
        return
    raw_id = data.get("id")
    request_id = raw_id if isinstance(raw_id, str) else None
    # Fresh connection: each log_event is then a top-level, committed transaction.
    with db.connection(url) as conn:
        for name, action_class, decision, args_hash in audited:
            audit.log_event(
                conn,
                tenant_id=tenant_id,
                decision=decision,
                tool_name=name,
                action_class=action_class,
                args_hash=args_hash,
                request_id=request_id,
                gateway_token_id=gateway_token_id,
            )
        if usage is not None:
            model, prompt_tokens, completion_tokens = usage
            usage_store.record_usage(
                conn,
                tenant_id=tenant_id,
                gateway_token_id=gateway_token_id,
                provider=provider,
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=pricing.cost_usd(provider, model, prompt_tokens, completion_tokens),
                request_id=request_id,
            )
            conn.commit()


def _base_url(settings: Settings, provider: str) -> str:
    return {
        "openai": settings.openai_base_url,
        "mistral": settings.mistral_base_url,
        "openrouter": settings.openrouter_base_url,
        "anthropic": settings.anthropic_base_url,
    }[provider]


async def _forward(request: Request, principal: GatewayPrincipal, provider: str) -> Response:
    settings: Settings = request.app.state.settings
    url = database_url(request)
    body = await request.body()
    enforce = request.headers.get("x-xsom-mode", "").lower() == "enforce"
    style = "anthropic" if provider == "anthropic" else "openai"
    base = _base_url(settings, provider).rstrip("/")

    if style == "openai":
        upstream = base + "/v1/chat/completions"
        fwd_headers = {
            "Authorization": request.headers.get("authorization", ""),
            "Content-Type": "application/json",
        }
    else:
        upstream = base + "/v1/messages"
        fwd_headers = {
            "x-api-key": request.headers.get("x-api-key", ""),
            "anthropic-version": request.headers.get("anthropic-version", "2023-06-01"),
            "Content-Type": "application/json",
        }

    try:
        streaming = bool(json.loads(body or b"{}").get("stream"))
    except (ValueError, TypeError):
        streaming = False

    client = _http()
    if streaming:
        upstream_req = client.build_request("POST", upstream, content=body, headers=fwd_headers)
        upstream_resp = await client.send(upstream_req, stream=True)
        return StreamingResponse(
            upstream_resp.aiter_raw(),
            status_code=upstream_resp.status_code,
            media_type=upstream_resp.headers.get("content-type", "text/event-stream"),
            background=BackgroundTask(upstream_resp.aclose),
        )

    upstream_resp = await client.post(upstream, content=body, headers=fwd_headers)
    if upstream_resp.status_code == 200:
        try:
            data = upstream_resp.json()
        except ValueError:
            data = None
        if isinstance(data, dict):
            await run_in_threadpool(
                _inspect,
                url,
                principal.tenant_id,
                principal.token_id,
                provider,
                style,
                data,
                enforce,
            )
            if enforce:
                return Response(content=json.dumps(data).encode(), media_type="application/json")
    return Response(
        content=upstream_resp.content,
        status_code=upstream_resp.status_code,
        media_type=upstream_resp.headers.get("content-type", "application/json"),
    )


@router.post("/openai/v1/chat/completions")
@limiter.limit(llm_proxy_rate_limit)
async def openai_chat_completions(
    request: Request, principal: GatewayPrincipal = Depends(get_gateway_principal)
) -> Response:
    return await _forward(request, principal, "openai")


@router.post("/mistral/v1/chat/completions")
@limiter.limit(llm_proxy_rate_limit)
async def mistral_chat_completions(
    request: Request, principal: GatewayPrincipal = Depends(get_gateway_principal)
) -> Response:
    return await _forward(request, principal, "mistral")


@router.post("/openrouter/v1/chat/completions")
@limiter.limit(llm_proxy_rate_limit)
async def openrouter_chat_completions(
    request: Request, principal: GatewayPrincipal = Depends(get_gateway_principal)
) -> Response:
    return await _forward(request, principal, "openrouter")


@router.post("/anthropic/v1/messages")
@limiter.limit(llm_proxy_rate_limit)
async def anthropic_messages(
    request: Request, principal: GatewayPrincipal = Depends(get_gateway_principal)
) -> Response:
    return await _forward(request, principal, "anthropic")

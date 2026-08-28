"""LLM provider proxy — zero-code monitoring, with enforcement on by default.

The agent points its provider ``base_url`` at this proxy and presents its tenant
gateway token (``X-Gateway-Token``). xSOM forwards to the provider using the
agent's *own* key (never stored), inspects the tool-calls the model requested,
and writes one hash-chained audit entry per call (decision from the tenant
policy) attributed to the calling agent. It also records token usage + an
estimated cost per completion for the usage dashboard.

Providers: OpenAI / Mistral / OpenRouter (OpenAI-compatible Chat Completions)
and Anthropic Messages.

**Enforcement is the default, and it is not the caller's to choose** (`G-25`).
Tool-calls that aren't auto-allowed (``hold``/``deny``) are stripped from the
response so the agent can't run them. True human-in-the-loop *approval* still
belongs on the cooperative ``/v1/authorize`` path (the proxy can't pause a single
completion).

An admin may open a bounded **observation window** on one agent through the
control plane (``core/monitor.py``): during it, refused calls are relayed and
recorded as ``monitor_*`` so a prospect can see what enforcement *would* do
without breaking their fleet. Irreversible actions and external sends are never
covered by a window (`AD-27.2`). This used to be an ``X-XSOM-Mode`` request
header — which handed the decision to the agent being controlled.

Only metadata + ``args_hash`` and token *counts* are ever logged, never content
or keys (§4.10). Streaming is passed through transparently (not inspected).
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from api.deps import database_url
from api.ratelimit import limiter, llm_proxy_rate_limit
from api.security import GatewayPrincipal, get_gateway_principal, resolve_gateway_principal
from core import approvals, audit, billing, db, dlp, dlp_config, monitor, policy_store, pricing
from core import usage as usage_store
from core.config import Settings
from core.policy import ActionClass, Approval, Policy, evaluate

logger = logging.getLogger("xsom.llm_proxy")

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


def _extract_billed(provider: str, data: dict[str, Any]) -> float | None:
    """OpenRouter returns the *real* per-call cost (USD) inline; None otherwise."""
    if provider != "openrouter":
        return None
    usage = data.get("usage")
    if not isinstance(usage, dict):
        return None
    cost = usage.get("cost")
    try:
        return float(cost) if cost is not None else None
    except (TypeError, ValueError):
        return None


def _augment_openrouter(body: bytes) -> bytes:
    """Ask OpenRouter to include the real cost in the response (``usage.include``)."""
    try:
        payload = json.loads(body or b"{}")
    except (ValueError, TypeError):
        return body
    if not isinstance(payload, dict):
        return body
    usage = payload.get("usage")
    payload["usage"] = {**usage, "include": True} if isinstance(usage, dict) else {"include": True}
    return json.dumps(payload).encode()


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
    style: str, data: dict[str, Any], policy: Policy, observing: bool
) -> list[tuple[str, str | None, str, str]]:
    """Audit rows [(tool, class, decision, args_hash)]; drop the calls that must not stand.

    ``observing`` comes from the control plane, never from the request (`G-25`). Under
    an open window a refused call is let through and recorded as ``monitor_*`` -- but
    **only** for classes observation may cover: irreversible actions and external
    sends are dropped in every mode (`AD-27.2`).
    """
    audited: list[tuple[str, str | None, str, str]] = []

    def drop(name: str, args: dict[str, Any]) -> bool:
        """Whether this tool call must be removed from the relayed response."""
        raw_class, decision = _verdict(policy, name, args)
        action_class = ActionClass(raw_class) if raw_class else None
        blocked = decision != "allow"
        relaxed = blocked and observing and monitor.observes(action_class)
        # AD-27.3: the distinction lives in `decision`, which is inside the hashed
        # payload -- otherwise "we blocked it" and "we would have blocked it" hash
        # identically and the standalone verifier cannot tell them apart.
        recorded = f"monitor_{decision}" if relaxed else decision
        audited.append((name, raw_class, recorded, approvals.args_hash(args)))
        return blocked and not relaxed

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
                if name and drop(name, _parse_args(fn.get("arguments"))):
                    continue
                kept.append(call)
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
                    if drop(block["name"], args):
                        continue
                kept.append(block)
            data["content"] = kept
    return audited


def _inspect(
    url: str,
    tenant_id: str,
    gateway_token_id: str | None,
    provider: str,
    style: str,
    data: dict[str, Any],
    observing: bool,
    latency_ms: float | None = None,
) -> None:
    with db.connection(url) as conn:
        policy = policy_store.load_policy(conn, tenant_id)
    audited = _process(style, data, policy, observing)
    usage = _extract_usage(style, data)
    billed = _extract_billed(provider, data)
    if not audited and usage is None and billed is None:
        return
    raw_id = data.get("id")
    upstream_id = raw_id if isinstance(raw_id, str) else None
    # FR-161: the provider's completion id is a *declared* value -- whoever is at the
    # other end of this connection chose it. It used to be written straight into
    # `audit_log.request_id`, which is inside the hashed payload, so an upstream (or
    # anything able to answer as one) picked part of what the chain attests, and could
    # collide it with a real gateway request id. The audit row now carries a
    # server-minted id, one per inspected response so the tool calls of a single
    # completion still group, and keeps the provider's own id beside it, labelled.
    request_id = uuid4().hex
    raw_model = data.get("model")
    model_name = raw_model if isinstance(raw_model, str) else None
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
                upstream_request_id=upstream_id,
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
                # Not the audit id: reconciliation is against the provider's records,
                # so it is the provider's identifier that belongs here.
                request_id=upstream_id,
                latency_ms=latency_ms,
            )
        if billed is not None:
            # Authoritative cost the provider itself reported (exact, not estimated).
            billing.record_billed(
                conn,
                tenant_id=tenant_id,
                gateway_token_id=gateway_token_id,
                provider=provider,
                source="openrouter_inline",
                model=model_name,
                amount_usd=billed,
                external_id=upstream_id,
            )
        conn.commit()


def _observing(url: str, principal: GatewayPrincipal) -> bool:
    """Whether an admin has an observation window open on this agent (G-25).

    A control plane we cannot read is not permission to stop enforcing: any failure
    answers "no window", which means enforce.
    """
    try:
        with db.connection(url) as conn:
            window = monitor.active_window(conn, principal.tenant_id, principal.token_id)
    except Exception:
        logger.warning("monitor_lookup_failed", extra={"tenant_id": principal.tenant_id})
        return False
    return window is not None


def _load_dlp_state(url: str, tenant_id: str, settings: Settings) -> dlp_config.DlpState:
    """Load the tenant's effective DLP config (its row, else env defaults)."""
    with db.connection(url) as conn:
        return dlp_config.load(conn, tenant_id, settings)


def _audit_egress(
    url: str,
    tenant_id: str,
    gateway_token_id: str | None,
    provider: str,
    scan: dlp.ScanResult,
) -> None:
    """Record an egress DLP event (best-effort). Only kinds + a hash — no value."""
    try:
        with db.connection(url) as conn:
            audit.log_event(
                conn,
                tenant_id=tenant_id,
                decision=scan.decision,
                tool_name=f"{provider}.egress",
                action_class="external_send",
                args_hash=scan.digest(),
                error="dlp:" + ",".join(scan.kinds),
                gateway_token_id=gateway_token_id,
            )
            conn.commit()
    except Exception:  # audit is best-effort; a blocked call stays blocked regardless
        logger.warning("dlp_audit_failed", extra={"provider": provider})


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

    # Egress data-loss guard: scan the outbound prompt for secrets/PII BEFORE it
    # leaves for the provider. Blocks fixed-form secrets, flags/redacts PII per the
    # tenant's config. Platform-gated by DLP_ENABLED (zero overhead when off); when
    # on, the tenant's console config decides verdicts. Value never logged.
    if settings.dlp_enabled:
        state = await run_in_threadpool(_load_dlp_state, url, principal.tenant_id, settings)
        if state.enabled:
            scan = await run_in_threadpool(dlp.scan_request, body, state.policy)
            if scan.findings:
                await run_in_threadpool(
                    _audit_egress, url, principal.tenant_id, principal.token_id, provider, scan
                )
            if scan.blocked:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Egress blocked by DLP: sensitive data ({', '.join(scan.kinds)})",
                )
            if scan.redacted_body is not None:
                body = scan.redacted_body

    # The agent being controlled does not get to say whether it is controlled
    # (G-25). Enforcement is the default; only an open control-plane window, opened
    # by an admin and bounded in time, relaxes it -- and never for the irreversible.
    observing = await run_in_threadpool(_observing, url, principal)
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

    # OpenRouter returns the real per-call cost when asked (non-streaming only).
    if provider == "openrouter" and not streaming:
        body = _augment_openrouter(body)

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

    started = time.monotonic()
    upstream_resp = await client.post(upstream, content=body, headers=fwd_headers)
    latency_ms = (time.monotonic() - started) * 1000
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
                observing,
                latency_ms,
            )
            # The response is rewritten in every mode: under observation `_process`
            # keeps what a window may cover, so the payload only differs where the
            # window does not reach.
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


# --- Token-in-URL variants -----------------------------------------------------
# For tools that only let you set base_url + api_key (no custom header), the
# gateway token travels as a path segment, e.g. base_url:
#   .../proxy/openrouter/<xsg_token>/v1   (OpenAI-compatible SDKs)
#   .../proxy/anthropic/<xsg_token>       (Anthropic SDK)
# The agent's own provider key still rides in Authorization / x-api-key.
_OPENAI_PATH_PROVIDERS = {"openai", "mistral", "openrouter"}


@router.post("/{provider}/{token}/v1/chat/completions")
@limiter.limit(llm_proxy_rate_limit)
async def openai_style_token_path(provider: str, token: str, request: Request) -> Response:
    if provider not in _OPENAI_PATH_PROVIDERS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown provider")
    principal = resolve_gateway_principal(request, token)
    return await _forward(request, principal, provider)


@router.post("/anthropic/{token}/v1/messages")
@limiter.limit(llm_proxy_rate_limit)
async def anthropic_token_path(token: str, request: Request) -> Response:
    principal = resolve_gateway_principal(request, token)
    return await _forward(request, principal, "anthropic")

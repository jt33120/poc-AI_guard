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
from api.gateway_auth import (
    GatewayPrincipal,
    get_gateway_principal,
    get_gateway_principal_from_path,
)
from api.ratelimit import limiter, proxy_rpm_limit
from core import (
    approvals,
    audit,
    billing,
    db,
    dlp,
    dlp_config,
    entitlements,
    monitor,
    policy_store,
    pricing,
    prompt_guard,
    prompt_leak,
)
from core import usage as usage_store
from core.config import Settings
from core.entitlements import Capability, Entitlement, Meter, Metric
from core.judge import Judge, build_judge, resolve_ambiguous
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


def _verdict(
    policy: Policy, name: str, args: dict[str, Any], judge: Judge | None
) -> tuple[str | None, str]:
    """Le verdict de cette porte — **la même étape de classification que les deux autres.**

    `resolve_ambiguous` manquait ici, et son propre docstring affirme pourtant être
    « shared by every ingress path, so the classification step cannot drift between
    them ». Deux appelants seulement l'invoquaient : `core/decision.py` et
    `gateway/server.py`. Conséquence exacte, pour un même tenant et une même policy :
    une règle `{classify: ambiguous, approval: auto}` était honorée **telle quelle**
    par le proxy — l'appel d'outil partait — là où les deux autres portes la
    plancherisent à `irreversible`, donc à une approbation humaine.

    Et la ligne d'audit écrite par cette porte portait `action_class` à NULL : rien,
    dans la chaîne, ne signalait que l'action n'avait pas été classée. Un juge absent
    ne coûte aucun appel de modèle et rend `irreversible` (`AD-34`), donc le correctif
    est gratuit pour les déploiements sans clé.
    """
    outcome = resolve_ambiguous(evaluate(policy, name, args), judge, name, args)
    action_class = outcome.action_class.value if outcome.action_class else None
    return action_class, _VERDICT.get(outcome.decision, outcome.decision.value)


def _process(
    style: str, data: dict[str, Any], policy: Policy, observing: bool, judge: Judge | None
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
        raw_class, decision = _verdict(policy, name, args, judge)
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
    judge: Judge | None = None,
    #: Ce que la garde a déjà coûté **avant** que la requête ne parte chez le
    #: fournisseur : quota, capacités, DLP, garde-prompt, fenêtre d'observation.
    #: La classification qui suit s'y ajoute ; l'aller-retour du fournisseur, non.
    cout_amont_ms: int = 0,
) -> None:
    depuis = time.monotonic()
    with db.connection(url) as conn:
        policy = policy_store.load_policy(conn, tenant_id)
    audited = _process(style, data, policy, observing, judge)
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
    # **Les deux segments, et rien entre les deux.** Sur cette porte le verdict se
    # rend en deux temps : ce qui précède l'appel du modèle, et la classification de
    # ce qu'il a répondu. Le fournisseur est au milieu, et il peut durer des
    # secondes — le compter ferait publier comme surcoût de xSOM le temps d'OpenAI.
    cout = cout_amont_ms + audit.cout_de_garde(depuis)
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
                # `observing` was read from the control plane in `_observing`, never
                # from this request -- which is the whole of FR-160 on this path.
                origin=audit.Origin.llm_proxy(observing=observing),
                decision_ms=cout,
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


def _observing(url: str, principal: GatewayPrincipal, droit: Entitlement) -> bool:
    """Whether an admin has an observation window open on this agent (G-25).

    A control plane we cannot read is not permission to stop enforcing: any failure
    answers "no window", which means enforce.

    Et la fenêtre est une **capacité vendue** (`monitor_windows`), distincte de
    `monitor_admin` qui verrouille la route qui l'ouvre. Sans la capacité, il n'y a
    pas de fenêtre — donc pas de relâchement. C'est la seule direction dans laquelle
    un palier peut toucher ce garde : elle **resserre**, comme partout ailleurs dans
    la gamme. L'inverse — un palier qui ouvrirait une fenêtre — serait la
    facturation devenue moteur de policy.
    """
    if not droit.allows(Capability.monitor_windows):
        return False
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


def _extract_prompt(body: bytes) -> str:
    """Le texte que l'agent soumet, tous rôles confondus, pour le garde tiers.

    Concaténer plutôt que ne prendre que le dernier message : une injection se loge
    aussi bien dans un `system` fabriqué par l'agent que dans le tour courant, et un
    garde qui ne regarderait qu'une moitié attesterait d'un contrôle qui n'a pas eu
    lieu sur l'autre.
    """
    try:
        data = json.loads(body)
    except Exception:
        return ""
    morceaux: list[str] = []
    for message in data.get("messages") or []:
        contenu = (message or {}).get("content")
        if isinstance(contenu, str):
            morceaux.append(contenu)
        elif isinstance(contenu, list):
            morceaux += [
                bloc["text"]
                for bloc in contenu
                if isinstance(bloc, dict) and isinstance(bloc.get("text"), str)
            ]
    systeme = data.get("system")
    if isinstance(systeme, str):
        morceaux.append(systeme)
    return "\n".join(morceaux)


def _audit_prompt_guard(
    url: str,
    tenant_id: str,
    gateway_token_id: str | None,
    provider: str,
    verdict: prompt_guard.Verdict,
) -> None:
    """Chaîner le verdict du garde tiers (`FR-193`). Best-effort, et **jamais bloquant**.

    C'est la preuve exigible du mode `Orchestré` : le verdict d'un tiers entre dans la
    chaîne. Ce qui n'y entre pas, c'est le prompt — seulement son empreinte et les
    catégories que le tiers a rendues (`CLAUDE.md` §4.10).

    Aucun appelant ne lit le retour de cette fonction, et c'est le point : sur ce
    chemin, un verdict ne peut pas retenir une requête. `M-01/garde_prompt` est
    publiée `Orchestré`, pas `Bloqué`.
    """
    try:
        with db.connection(url) as conn:
            audit.log_event(
                conn,
                tenant_id=tenant_id,
                decision=verdict.decision,
                tool_name=f"{provider}.prompt_guard",
                args_hash=verdict.prompt_digest,
                error=",".join(verdict.categories) or None,
                gateway_token_id=gateway_token_id,
                # `enforcing` : une fenêtre d'observation relâche des *appels d'outils*,
                # jamais une observation — il n'y a rien à relâcher ici.
                origin=audit.Origin.llm_proxy(observing=False),
            )
            conn.commit()
    except Exception:  # l'observation est best-effort ; elle ne retient jamais l'appel
        logger.warning("prompt_guard_audit_failed", extra={"tenant_id": tenant_id})


def _audit_prompt_leak(
    url: str,
    tenant_id: str,
    gateway_token_id: str | None,
    provider: str,
    digest: str,
    words: int,
) -> None:
    """Chaîner une régurgitation verbatim du prompt système (`FR-190`, `M-14/prompt`).

    Mode `Détecté` : nous enregistrons, nous n'interrompons pas. La réponse est déjà
    partie vers l'agent quand cette ligne s'écrit, et c'est voulu — réécrire une
    complétion serait de la modération de sortie, que le produit n'est pas.

    Dans la chaîne : l'empreinte du prompt et la **longueur** de la suite recopiée.
    Jamais le texte, ni celui du prompt ni celui de la sortie (§4.10) — la longueur
    suffit à un opérateur pour juger de la gravité, et elle ne fuit rien.
    """
    try:
        with db.connection(url) as conn:
            audit.log_event(
                conn,
                tenant_id=tenant_id,
                decision=prompt_leak.DECISION,
                tool_name=f"{provider}.prompt_leak",
                args_hash=digest,
                error=f"verbatim_words={words}",
                gateway_token_id=gateway_token_id,
                origin=audit.Origin.llm_proxy(observing=False),
            )
            conn.commit()
    except Exception:  # observation best-effort ; elle ne retient jamais la réponse
        logger.warning("prompt_leak_audit_failed", extra={"tenant_id": tenant_id})


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
                # `enforcing`, and not because nobody passed anything: an observation
                # window relaxes *tool calls* it may cover (`monitor.observes`), never
                # egress DLP, which is about what leaves rather than what is done.
                origin=audit.Origin.llm_proxy(observing=False),
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


def _audit_streamed(
    url: str | None,
    tenant_id: str,
    gateway_token_id: str,
    provider: str,
    *,
    observing: bool,
    decision_ms: int | None = None,
) -> None:
    """`G-26` option B — inscrire qu'une complétion a été streamée, donc non inspectée.

    Avec `stream: true`, la réponse est relayée telle quelle : aucun appel d'outil
    n'est examiné. Ce n'est pas une revendication fausse — `coverage/rows.yaml` ne
    revendique `llm_proxy` que pour `M-10 / egress`, que la DLP couvre bien puisqu'elle
    s'applique en amont de cette branche (`AD-35` : une capacité absente est un manque
    déclaré).

    Ce qui manquait est plus étroit : **l'absence de trace ne se voyait nulle part.**
    Le silence était indiscernable d'une absence de trafic, et un évaluateur qui le
    trouvait seul le lisait comme une omission plutôt que comme un choix. Une ligne par
    complétion streamée rend l'angle mort *auditable* : la console peut dire « N % du
    trafic de cet agent n'a pas été observé ».

    Métadonnées seules — aucun nom d'outil, aucun argument : nous ne les avons pas
    regardés, et en inventer serait pire que de n'en pas écrire.
    """
    if not url:
        return
    try:
        with db.connection(url) as conn:
            audit.log_event(
                conn,
                tenant_id=tenant_id,
                decision="streamed_uninspected",
                gateway_token_id=gateway_token_id,
                error=f"provider={provider}",
                origin=audit.Origin.llm_proxy(observing=observing),
                decision_ms=decision_ms,
            )
            conn.commit()
    except Exception:  # l'audit est best-effort ; il ne casse jamais le relais
        logger.warning("streamed_audit_failed", extra={"tenant_id": tenant_id})


def _audit_unparsed(
    url: str | None,
    tenant_id: str,
    gateway_token_id: str,
    provider: str,
    *,
    observing: bool,
    decision_ms: int | None = None,
) -> None:
    """Le second angle mort du proxy : un 200 dont le corps n'est pas exploitable.

    Le fournisseur a répondu `200`, mais `upstream_resp.json()` lève ou ne rend pas
    un objet : la réponse est relayée **telle quelle**, sans qu'aucun appel d'outil
    soit examiné. C'est exactement la situation que `_audit_streamed` déclare pour le
    streaming — et ce jumeau-ci ne déclarait rien, alors que ce module argumente
    lui-même que « le silence était indiscernable d'une absence de trafic ».

    La différence compte : un fournisseur qui change de format de réponse, ou une
    passerelle intermédiaire qui réécrit le corps, ouvre cette branche pour **tout**
    le trafic d'un agent, et l'enforcement disparaît sans qu'aucune ligne ne bouge.

    Métadonnées seules, comme pour le streaming : nous n'avons pas lu le corps, et en
    inventer un contenu serait pire que de n'en pas écrire.
    """
    if not url:
        return
    try:
        with db.connection(url) as conn:
            audit.log_event(
                conn,
                tenant_id=tenant_id,
                decision="relayed_unparsed",
                gateway_token_id=gateway_token_id,
                error=f"provider={provider}",
                origin=audit.Origin.llm_proxy(observing=observing),
                decision_ms=decision_ms,
            )
            conn.commit()
    except Exception:  # l'audit est best-effort ; il ne casse jamais le relais
        logger.warning("unparsed_audit_failed", extra={"tenant_id": tenant_id})


def _debiter_un_appel(url: str, tenant_id: str) -> tuple[Entitlement, Meter]:
    """Débiter `proxy_calls` avant que l'appel ne coûte quoi que ce soit.

    `proxy_calls` était publiée par `metric_catalog`, plafonnée par `plan_limits`
    dans les trois paliers, affichée au client — et **comptée nulle part**. Une
    limite qui ne s'applique pas a le coût commercial d'une promesse et l'effet
    technique de rien : le client paie pour un plafond qu'il ne peut pas atteindre,
    et nous facturons un volume que nous ne mesurons pas.

    Placé en tête de `_forward`, avant la DLP et avant le garde-prompt : les deux
    coûtent du calcul et une lecture de base, et un appel qu'on va refuser n'a pas à
    les payer. Une base injoignable rend `unknown`, que l'appelant lit comme une
    indisponibilité — jamais comme une permission.
    """
    try:
        with db.connection(url) as conn:
            # Une seule lecture du droit pour tout le chemin : le plafond d'appels,
            # puis les trois capacités qui le consultent — le proxy lui-même, la DLP
            # et le garde-prompt. Deux requêtes identiques par appel de modèle se
            # paieraient sur tout le trafic de la flotte.
            droit = entitlements.load_entitlement(conn, tenant_id)
            etat = entitlements.flux_allows(conn, tenant_id, Metric.proxy_calls, droit=droit)
            return droit, etat
    except Exception:
        logger.warning("proxy_quota_unreadable", extra={"tenant_id": tenant_id})
        return entitlements.AUCUNE, Meter.unknown


async def _forward(request: Request, principal: GatewayPrincipal, provider: str) -> Response:
    # Le chronomètre de la garde, premier segment. Il court jusqu'à l'envoi chez le
    # fournisseur, s'arrête pendant l'aller-retour, et repart dans `_inspect` : sur
    # cette porte le verdict se rend en deux temps, de part et d'autre du modèle.
    depuis = time.monotonic()
    settings: Settings = request.app.state.settings
    url = database_url(request)

    droit, etat = await run_in_threadpool(_debiter_un_appel, url, principal.tenant_id)
    if etat is Meter.capped:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="plan limit reached: proxy calls for this period",
        )
    if etat is Meter.unknown:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Quota store unavailable",
        )
    # Le routeur du proxy ne porte aucun verrou de gamme : `requires` résout un jeton
    # **console**, que ce chemin ne présente pas (`X-Gateway-Token`). Le verrou vit
    # donc ici, là où le principal EST résolu — un quota et une capacité se
    # vérifient où l'identité existe, pas où le montage est commode.
    if not droit.allows(Capability.llm_proxy):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="'llm_proxy' is not included in your plan",
        )

    body = await request.body()

    # Egress data-loss guard: scan the outbound prompt for secrets/PII BEFORE it
    # leaves for the provider. Blocks fixed-form secrets, flags/redacts PII per the
    # tenant's config. Platform-gated by DLP_ENABLED (zero overhead when off); when
    # on, the tenant's console config decides verdicts. Value never logged.
    # `settings.dlp_enabled` est l'interrupteur **plateforme** ; la capacité est
    # l'interrupteur **commercial**. Il manquait : la DLP inspectait l'egress de tous
    # les paliers, y compris ceux qui ne l'ont pas achetée. `dlp_config` verrouillait
    # le réglage fin et laissait le service lui-même gratuit.
    if settings.dlp_enabled and droit.allows(Capability.dlp):
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

    # `FR-193` — le garde-prompt tiers. Il tourne **après** la DLP (qui, elle, peut
    # refuser) et son verdict n'est lu par personne : la requête part quoi qu'il ait
    # dit. C'est ce que `Orchestré` autorise à revendiquer, et l'endroit exact où le
    # produit s'arrête de ne pas être un pare-feu de prompts.
    guard = getattr(request.app.state, "prompt_guard", None)
    if guard is not None and droit.allows(Capability.prompt_guard):
        texte = _extract_prompt(body)
        if texte:
            verdict = await run_in_threadpool(guard.inspect, texte)
            await run_in_threadpool(
                _audit_prompt_guard,
                url,
                principal.tenant_id,
                principal.token_id,
                provider,
                verdict,
            )

    # The agent being controlled does not get to say whether it is controlled
    # (G-25). Enforcement is the default; only an open control-plane window, opened
    # by an admin and bounded in time, relaxes it -- and never for the irreversible.
    observing = await run_in_threadpool(_observing, url, principal, droit)
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

    # Fin du segment amont : tout ce qui suit est le fournisseur, puis l'inspection.
    cout_amont = audit.cout_de_garde(depuis)

    client = _http()
    if streaming:
        # Écrit **avant** le relais, pas dans le `BackgroundTask` de fermeture. La note
        # de décision disait « hors chemin de réponse » ; en construisant, l'ordre s'est
        # avéré porter la question : une ligne écrite après la fin du flux manque
        # exactement pour les sessions qui ont échoué en cours de route — celles qu'un
        # auditeur regarde en premier. Le fait « cette requête est streamée, donc non
        # inspectée » est connu ici, avant qu'aucun octet ne circule, et le coût est un
        # `insert` devant un appel de modèle qui dure des centaines de millisecondes.
        await run_in_threadpool(
            _audit_streamed,
            url,
            principal.tenant_id,
            principal.token_id,
            provider,
            observing=observing,
            decision_ms=cout_amont,
        )
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
            # `FR-190` — le modèle a-t-il recraché ses propres consignes, mot pour mot ?
            # Après la réponse, sans la modifier : `Détecté`, pas `Bloqué`.
            reference = prompt_leak.system_prompt(body)
            if reference:
                mots = prompt_leak.leaked_span(reference, prompt_leak.completion_text(data))
                if mots is not None:
                    await run_in_threadpool(
                        _audit_prompt_leak,
                        url,
                        principal.tenant_id,
                        principal.token_id,
                        provider,
                        prompt_leak.prompt_digest(reference),
                        mots,
                    )
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
                build_judge(settings),
                cout_amont,
            )
            # The response is rewritten in every mode: under observation `_process`
            # keeps what a window may cover, so the payload only differs where the
            # window does not reach.
            return Response(content=json.dumps(data).encode(), media_type="application/json")
        # 200, mais illisible : relayé sans inspection, et désormais écrit.
        await run_in_threadpool(
            _audit_unparsed,
            url,
            principal.tenant_id,
            principal.token_id,
            provider,
            observing=observing,
            decision_ms=cout_amont,
        )
    return Response(
        content=upstream_resp.content,
        status_code=upstream_resp.status_code,
        media_type=upstream_resp.headers.get("content-type", "application/json"),
    )


# `shared_limit` et une portée **nommée** pour les six routes, et non `limit`.
# slowapi range ses compartiments par chemin (`key_style="url"`) : avec `limit`, un
# agent obtenait six quotas au lieu d'un et multipliait son débit par six en changeant
# de fournisseur — ou simplement en passant du jeton en en-tête au jeton dans l'URL.
# `proxy_rpm` est **un** quota vendu, il lui faut **un** compartiment.
@router.post("/openai/v1/chat/completions")
@limiter.shared_limit(proxy_rpm_limit, scope="proxy_rpm")
async def openai_chat_completions(
    request: Request, principal: GatewayPrincipal = Depends(get_gateway_principal)
) -> Response:
    return await _forward(request, principal, "openai")


@router.post("/mistral/v1/chat/completions")
@limiter.shared_limit(proxy_rpm_limit, scope="proxy_rpm")
async def mistral_chat_completions(
    request: Request, principal: GatewayPrincipal = Depends(get_gateway_principal)
) -> Response:
    return await _forward(request, principal, "mistral")


@router.post("/openrouter/v1/chat/completions")
@limiter.shared_limit(proxy_rpm_limit, scope="proxy_rpm")
async def openrouter_chat_completions(
    request: Request, principal: GatewayPrincipal = Depends(get_gateway_principal)
) -> Response:
    return await _forward(request, principal, "openrouter")


@router.post("/anthropic/v1/messages")
@limiter.shared_limit(proxy_rpm_limit, scope="proxy_rpm")
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
@limiter.shared_limit(proxy_rpm_limit, scope="proxy_rpm")
async def openai_style_token_path(
    provider: str,
    token: str,
    request: Request,
    principal: GatewayPrincipal = Depends(get_gateway_principal_from_path),
) -> Response:
    if provider not in _OPENAI_PATH_PROVIDERS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown provider")
    return await _forward(request, principal, provider)


@router.post("/anthropic/{token}/v1/messages")
@limiter.shared_limit(proxy_rpm_limit, scope="proxy_rpm")
async def anthropic_token_path(
    token: str,
    request: Request,
    principal: GatewayPrincipal = Depends(get_gateway_principal_from_path),
) -> Response:
    return await _forward(request, principal, "anthropic")

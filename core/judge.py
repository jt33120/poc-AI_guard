"""Thin LLM judge (LiteLLM -> Mistral) — SPEC §6, M6.

Used only for two things: (1) resolving ``classify: ambiguous`` rules into an
action class, and (2) generating compliance-export narratives. The judge never
authorizes or denies — it only classifies; the deterministic matrix + HITL keep
the decision. On any doubt, error, or budget exhaustion it over-classifies to
``irreversible`` (the most cautious class). Cost is bounded by a call cap, and
only *redacted* arguments are ever sent to the model (CLAUDE.md §4.10) — and the
judge enforces that itself rather than trusting its caller to have done it.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any

from core import dlp
from core.approvals import redact
from core.policy import ActionClass, PolicyOutcome, escalate_for_class

#: (system_prompt, user_prompt) -> raw model text (expected JSON).
Completer = Callable[[str, str], str]

_VALID = {c.value for c in ActionClass}

logger = logging.getLogger("xsom.judge")

_CLASSIFY_SYSTEM = (
    "You are a security action classifier for an AI-agent tool gateway. "
    "Given a tool name and (redacted) arguments, output STRICT JSON: "
    '{"action_class": one of "read"|"write"|"external_send"|"irreversible", '
    '"rationale": "<short>"}. '
    "Classify by the worst plausible effect; when in doubt choose the more "
    "dangerous class. You never authorize or deny — you only classify."
)

_NARRATE_SYSTEM = (
    "You write concise compliance-report narratives (2-3 sentences) from decision "
    "counts. Never invent specifics and never include personal data."
)


class Judge:
    """Bounded LLM classifier/narrator with a hard call cap (fail-closed)."""

    def __init__(self, completer: Completer, *, max_calls: int = 200) -> None:
        self._completer = completer
        self._max_calls = max_calls
        self._calls = 0
        self._classifications = 0

    @property
    def calls(self) -> int:
        """Appels **tentés**. C'est le compteur du budget : un fournisseur en panne
        ne doit pas pouvoir faire dépenser plus que `max_calls`."""
        return self._calls

    @property
    def classifications(self) -> int:
        """Appels dont une classe est réellement revenue du modèle.

        Distinct de :attr:`calls`, et c'est tout l'objet. `resolve_ambiguous` posait
        `judge_used = judge.calls > before`, or `self._calls += 1` précède le `try` :
        un appel qui expirait ou qui rendait du JSON invalide était donc **crédité au
        juge**, et la ligne d'audit portait `judge_used=True` sur une classification
        que le modèle n'a jamais faite. Le docstring de `resolve_ambiguous` énonce
        l'inverse comme invariant (`AD-21.4`), et `core/compliance.py` compte ces
        lignes comme des classifications réelles.

        Une panne Mistral bascule tout outil ambigu en `irreversible` donc en HITL :
        la file d'approbation se remplit, ce qui est le bon comportement — et le
        journal attestait que le juge avait tranché.
        """
        return self._classifications

    def _over_budget(self) -> bool:
        return self._calls >= self._max_calls

    def classify(self, tool_name: str, arguments: dict[str, Any]) -> ActionClass:
        """Resolve an ambiguous tool to an action class (irreversible on any doubt).

        The argument is not assumed redacted. `approvals.redact` masks by **key name**,
        so une PII dans la valeur d'une clé anodine (`body`, `text`) la traversait —
        c'est `G-22`. Le juge est un tiers hors périmètre : il passe donc les
        détecteurs du produit sur la charge sérialisée, ce qui couvre aussi les
        valeurs imbriquées qu'un masquage clé-par-clé ne voit pas.

        Les mêmes détecteurs que la DLP d'egress, pas une seconde série de motifs :
        deux jeux de règles divergent, et le jour où ils divergent le produit bloque
        chez un client ce qu'il laisse filer vers son propre juge.
        """
        if self._over_budget():
            return ActionClass.irreversible
        self._calls += 1
        user = json.dumps({"tool": tool_name, "arguments": arguments}, sort_keys=True)
        user = dlp.redact_text(user, dlp.scan_text(user))
        try:
            raw = self._completer(_CLASSIFY_SYSTEM, user)
            value = json.loads(raw).get("action_class")
        except Exception as exc:
            # Le **type** seul, jamais la charge (§4.10) : `TimeoutError` et
            # `RateLimitError` demandent des réactions opposées, et rien dans le
            # dépôt ne les distinguait — l'échec était silencieux.
            logger.warning("judge_call_failed", extra={"error_type": type(exc).__name__})
            return ActionClass.irreversible
        if value in _VALID:
            self._classifications += 1
            return ActionClass(value)
        logger.warning("judge_call_unusable", extra={"error_type": "unparsable_class"})
        return ActionClass.irreversible

    def narrate(self, framework: str, counts: dict[str, int], total: int) -> str:
        """Generate an export narrative, or raise to let callers fall back."""
        if self._over_budget():
            raise RuntimeError("judge budget exhausted")
        self._calls += 1
        user = json.dumps(
            {"framework": framework, "counts": counts, "total": total}, sort_keys=True
        )
        return self._completer(_NARRATE_SYSTEM, user).strip()


def litellm_completer(
    model: str, api_key: str, timeout: float = 8.0
) -> Completer:  # pragma: no cover - needs network
    """Default completer calling Mistral via LiteLLM with strict JSON output."""

    def complete(system: str, user: str) -> str:
        import litellm

        response = litellm.completion(
            model=model,
            api_key=api_key,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.0,
            max_tokens=400,
            # Borné : voir `Settings.judge_timeout_seconds`. Sans lui, un point de
            # terminaison qui accepte la connexion sans répondre gèle la décision
            # pour toute la flotte du plan.
            timeout=timeout,
        )
        content: str = response.choices[0].message.content or ""
        return content

    return complete


def build_judge(settings: Any) -> Judge | None:
    """Construct a judge from settings, or None when no model key is configured."""
    if not settings.mistral_api_key:
        return None
    completer = litellm_completer(
        settings.mistral_model, settings.mistral_api_key, settings.judge_timeout_seconds
    )
    return Judge(completer, max_calls=settings.judge_max_calls)


def resolve_ambiguous(
    outcome: PolicyOutcome,
    judge: Judge | None,
    tool_name: str,
    arguments: dict[str, Any],
) -> PolicyOutcome:
    """Classify a ``classify: ambiguous`` outcome, then floor it for that class.

    Shared by every ingress path, so the classification step cannot drift between
    them (ARCHITECTURE-V2.5 AD-4/AD-21).

    **An unconfigured judge is not an inert one** (AD-34). With no model key the
    step still runs and contributes its *failure* class — ``irreversible`` — so an
    ambiguous rule can never be honoured at its declared ``approval``. That is the
    guarantee ``.env.example`` documents ("ambiguous tools are treated as
    irreversible, so they go to human approval instead of being auto-allowed");
    before this, the escalation was skipped entirely when no judge existed and the
    rule's own approval stood, which could be ``auto``.

    The returned ``judge_used`` says whether a model call was actually made, so the
    audit log never credits a fail-closed default to the judge (AD-21.4).
    """
    if not outcome.ambiguous:
        return outcome
    if judge is None:
        judged, reason, used = ActionClass.irreversible, "judge_unavailable", False
    else:
        tentes, classes = judge.calls, judge.classifications
        judged = judge.classify(tool_name, redact(arguments))
        # `classifications` et non `calls` : le second s'incrémente **avant** l'appel,
        # donc un juge qui expire ou qui rend du JSON invalide se créditait
        # lui-même une classification qu'il n'a pas faite (`AD-21.4`). Trois états à
        # distinguer, pas deux — et le troisième était invisible.
        used = judge.classifications > classes
        if used:
            reason = "judge"
        elif judge.calls > tentes:
            reason = "judge_error"  # le modèle a été appelé et n'a pas répondu
        else:
            reason = "judge_over_budget"  # il n'a même pas été appelé
    return PolicyOutcome(
        action_class=judged,
        decision=escalate_for_class(outcome.decision, judged),
        rule_name=outcome.rule_name,
        reason=reason,
        ambiguous=True,
        judge_used=used,
    )

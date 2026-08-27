"""Thin LLM judge (LiteLLM -> Mistral) — SPEC §6, M6.

Used only for two things: (1) resolving ``classify: ambiguous`` rules into an
action class, and (2) generating compliance-export narratives. The judge never
authorizes or denies — it only classifies; the deterministic matrix + HITL keep
the decision. On any doubt, error, or budget exhaustion it over-classifies to
``irreversible`` (the most cautious class). Cost is bounded by a call cap, and
only *redacted* arguments are ever sent to the model (CLAUDE.md §4.10).
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from core.approvals import redact
from core.policy import ActionClass, PolicyOutcome, escalate_for_class

#: (system_prompt, user_prompt) -> raw model text (expected JSON).
Completer = Callable[[str, str], str]

_VALID = {c.value for c in ActionClass}

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

    @property
    def calls(self) -> int:
        return self._calls

    def _over_budget(self) -> bool:
        return self._calls >= self._max_calls

    def classify(self, tool_name: str, redacted_arguments: dict[str, Any]) -> ActionClass:
        """Resolve an ambiguous tool to an action class (irreversible on any doubt)."""
        if self._over_budget():
            return ActionClass.irreversible
        self._calls += 1
        user = json.dumps({"tool": tool_name, "arguments": redacted_arguments}, sort_keys=True)
        try:
            raw = self._completer(_CLASSIFY_SYSTEM, user)
            value = json.loads(raw).get("action_class")
        except Exception:
            return ActionClass.irreversible
        if value in _VALID:
            return ActionClass(value)
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


def litellm_completer(model: str, api_key: str) -> Completer:  # pragma: no cover - needs network
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
        )
        content: str = response.choices[0].message.content or ""
        return content

    return complete


def build_judge(settings: Any) -> Judge | None:
    """Construct a judge from settings, or None when no model key is configured."""
    if not settings.mistral_api_key:
        return None
    completer = litellm_completer(settings.mistral_model, settings.mistral_api_key)
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
        before = judge.calls
        judged = judge.classify(tool_name, redact(arguments))
        # Over budget, `classify` fails closed without calling the model. Compare the
        # counter rather than assuming a judge object means a model call (AD-21.4).
        used = judge.calls > before
        reason = "judge" if used else "judge_over_budget"
    return PolicyOutcome(
        action_class=judged,
        decision=escalate_for_class(outcome.decision, judged),
        rule_name=outcome.rule_name,
        reason=reason,
        ambiguous=True,
        judge_used=used,
    )

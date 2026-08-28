"""Thin LLM judge: over-classification, cost cap, narration (SPEC §6, M6)."""

from __future__ import annotations

import pytest

from core.judge import Judge, resolve_ambiguous
from core.policy import ActionClass, Approval, PolicyOutcome


def test_classify_returns_model_action_class() -> None:
    judge = Judge(lambda _s, _u: '{"action_class": "write", "rationale": "ok"}')
    assert judge.classify("shell.exec", {"cmd": "ls"}) is ActionClass.write


def test_classify_overclasses_on_invalid_json() -> None:
    judge = Judge(lambda _s, _u: "not json")
    assert judge.classify("shell.exec", {"cmd": "rm -rf /"}) is ActionClass.irreversible


def test_judge_never_emits_an_authorization() -> None:
    # 'deny'/'auto' are not action classes — anything off-enum becomes irreversible.
    judge = Judge(lambda _s, _u: '{"action_class": "deny"}')
    assert judge.classify("shell.exec", {}) is ActionClass.irreversible


def test_cost_cap_bounds_model_calls() -> None:
    calls = {"n": 0}

    def completer(_s: str, _u: str) -> str:
        calls["n"] += 1
        return '{"action_class": "read"}'

    judge = Judge(completer, max_calls=2)
    judge.classify("t", {})
    judge.classify("t", {})
    over_budget = judge.classify("t", {})  # third call must not hit the model

    assert calls["n"] == 2  # cost is bounded: the model was hit at most max_calls times
    assert over_budget is ActionClass.irreversible  # fail-closed once capped
    assert judge.calls == 2


def test_narrate_uses_model_output() -> None:
    judge = Judge(lambda _s, _u: "  A concise summary.  ")
    assert judge.narrate("ai_act", {"allow": 1}, 1) == "A concise summary."


def test_narrate_raises_when_over_budget() -> None:
    judge = Judge(lambda _s, _u: "x", max_calls=0)
    with pytest.raises(RuntimeError):
        judge.narrate("ai_act", {}, 0)


def _ambiguous(approval: Approval) -> PolicyOutcome:
    return PolicyOutcome(None, approval, "rule", "ambiguous: needs judge", ambiguous=True)


def test_resolve_leaves_unambiguous_outcomes_untouched() -> None:
    outcome = PolicyOutcome(ActionClass.read, Approval.auto, "rule", "policy rule")
    assert resolve_ambiguous(outcome, None, "mock.echo", {}) is outcome


def test_resolve_without_a_judge_is_fail_closed() -> None:
    # The guarantee .env.example documents: with no model key configured, an
    # ambiguous rule is treated as irreversible and goes to a human -- it is NOT
    # honoured at its declared `auto`.
    out = resolve_ambiguous(_ambiguous(Approval.auto), None, "shell.exec", {"cmd": "rm -rf /"})
    assert out.action_class is ActionClass.irreversible
    assert out.decision is Approval.human_in_the_loop
    assert out.reason == "judge_unavailable"


def test_resolve_without_a_judge_never_credits_the_judge_in_the_audit() -> None:
    # AD-21.4: judge_used means a model call was made, not that the rule was ambiguous.
    out = resolve_ambiguous(_ambiguous(Approval.auto), None, "shell.exec", {})
    assert out.ambiguous is True and out.judge_used is False


def test_resolve_over_budget_is_fail_closed_and_not_credited() -> None:
    judge = Judge(lambda _s, _u: '{"action_class": "read"}', max_calls=0)
    out = resolve_ambiguous(_ambiguous(Approval.auto), judge, "shell.exec", {})
    assert out.action_class is ActionClass.irreversible
    assert out.decision is Approval.human_in_the_loop
    assert out.reason == "judge_over_budget" and out.judge_used is False


def test_resolve_with_a_judge_uses_its_class_and_is_credited() -> None:
    judge = Judge(lambda _s, _u: '{"action_class": "read"}')
    out = resolve_ambiguous(_ambiguous(Approval.auto), judge, "mock.echo", {})
    assert out.action_class is ActionClass.read
    assert out.decision is Approval.auto  # a read is not floored
    assert out.reason == "judge" and out.judge_used is True


def test_resolve_never_lowers_the_rule_approval() -> None:
    # The judge classifies; it can only tighten. A `deny` rule stays denied even
    # when the model says the action is a harmless read.
    judge = Judge(lambda _s, _u: '{"action_class": "read"}')
    out = resolve_ambiguous(_ambiguous(Approval.deny), judge, "mock.echo", {})
    assert out.decision is Approval.deny


def test_resolve_redacts_arguments_before_the_model_sees_them() -> None:
    seen: list[str] = []

    def completer(_s: str, user: str) -> str:
        seen.append(user)
        return '{"action_class": "read"}'

    resolve_ambiguous(
        _ambiguous(Approval.auto),
        Judge(completer),
        "mock.mail",
        {"api_token": "sk-live-1234", "to": "ops@client.fr"},
    )
    # Two masquages complémentaires, et il a fallu les deux (G-22, fermé).
    # Par nom de clé (`approvals.redact`) : `api_token` n'a aucune forme reconnaissable,
    # seul son nom le trahit. Par contenu (`core.dlp`, dans le juge) : `ops@client.fr`
    # est sous une clé anodine, et c'est le détecteur qui le voit.
    assert "sk-live-1234" not in seen[0]
    assert "ops@client.fr" not in seen[0]
    # La forme traverse — c'est elle qui porte la classification.
    assert "mock.mail" in seen[0]
    assert "to" in seen[0]

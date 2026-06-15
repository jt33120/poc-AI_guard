"""Thin LLM judge: over-classification, cost cap, narration (SPEC §6, M6)."""

from __future__ import annotations

import pytest

from core.judge import Judge
from core.policy import ActionClass


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

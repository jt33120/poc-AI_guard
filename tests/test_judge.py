"""Thin LLM judge: over-classification, cost cap, narration (SPEC §6, M6)."""

from __future__ import annotations

import pytest

from core.judge import Judge, litellm_completer, resolve_ambiguous
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


def test_a_completer_that_raises_is_classified_irreversible() -> None:
    """Le mode de panne le plus probable du juge n'était exercé nulle part.

    Les seize constructions de `Judge` de la suite passent toutes un completer qui
    *retourne* une chaîne — mal formée parfois, mais qui retourne. Or un juge tombe
    par timeout, par 429 ou par coupure réseau, pas par JSON invalide : c'est le
    chemin que Mistral prendra un mardi matin, et le seul que personne ne jouait.

    La direction est la seule tenable : ne pas avoir pu classer se lit comme la
    classe la plus lourde, jamais comme une absence de risque.
    """

    def completer_qui_tombe(_s: str, _u: str) -> str:
        raise TimeoutError("upstream timed out")

    judge = Judge(completer_qui_tombe)
    assert judge.classify("shell.exec", {"cmd": "ls"}) is ActionClass.irreversible


def test_a_failed_call_still_counts_against_the_budget() -> None:
    """Et il consomme le budget, sinon un endpoint en panne devient une boucle.

    `self._calls += 1` précède le `try`, donc un fournisseur qui refuse toutes les
    requêtes ne peut pas faire dépenser plus que `max_calls` appels. C'est écrit ici
    parce que « ne compter que les succès » est le geste naturel de quelqu'un qui
    voudrait rendre le budget plus juste — et qui ouvrirait une facture non bornée.
    """

    def completer_qui_tombe(_s: str, _u: str) -> str:
        raise TimeoutError("upstream timed out")

    judge = Judge(completer_qui_tombe, max_calls=2)
    for _ in range(5):
        judge.classify("shell.exec", {"cmd": "ls"})
    assert judge.calls == 2


def test_a_failed_judge_call_is_not_credited_to_the_judge() -> None:
    """La ligne d'audit attestait une classification que le modèle n'a jamais faite.

    `resolve_ambiguous` posait `judge_used = judge.calls > before`, et
    `self._calls += 1` **précède** le `try`. Un appel qui expire, qui prend un 429 ou
    qui rend du JSON invalide incrémentait donc le compteur, et la ligne portait
    `judge_used=True` avec `reason="judge"`. Le docstring de `resolve_ambiguous`
    énonce l'inverse comme invariant (`AD-21.4`), et `core/compliance.py` compte ces
    lignes comme des classifications réelles.

    Concrètement : une panne Mistral bascule tout outil ambigu en `irreversible` donc
    en HITL — la file d'approbation se remplit, ce qui est le bon comportement — et le
    journal affirmait que le juge avait tranché. Défaut de conformité autant que
    d'exploitation.

    Trois états, pas deux : classé, appelé sans réponse, pas appelé du tout.
    """

    def qui_tombe(_s: str, _u: str) -> str:
        raise TimeoutError("upstream timed out")

    ambigu = PolicyOutcome(None, Approval.auto, "regle", "ambiguous: needs judge", ambiguous=True)
    resolu = resolve_ambiguous(ambigu, Judge(qui_tombe), "shell.exec", {"cmd": "ls"})

    assert resolu.action_class is ActionClass.irreversible, "le plancher doit tenir"
    assert resolu.judge_used is False, "un juge en panne ne s'attribue pas une classification"
    assert resolu.reason == "judge_error"


def test_an_unparsable_answer_is_not_credited_either() -> None:
    """Le modèle a répondu, mais pas quelque chose d'exploitable. Même verdict.

    Distinct du cas précédent parce que le chemin de code l'est : ici le completer
    rend une chaîne, `json.loads` la refuse. C'est le mode de panne d'un modèle qui
    bavarde autour du JSON, et il est plus fréquent que la coupure réseau.
    """
    ambigu = PolicyOutcome(None, Approval.auto, "regle", "ambiguous: needs judge", ambiguous=True)
    resolu = resolve_ambiguous(
        ambigu, Judge(lambda _s, _u: "bien sûr ! voici : {..."), "shell.exec", {"cmd": "ls"}
    )

    assert resolu.action_class is ActionClass.irreversible
    assert resolu.judge_used is False
    assert resolu.reason == "judge_error"


def test_a_successful_classification_is_still_credited() -> None:
    """Non-vacuité : un correctif qui ne créditerait plus jamais le juge passerait
    les deux contrôles ci-dessus, et rendrait la métrique de conformité muette."""
    ambigu = PolicyOutcome(None, Approval.auto, "regle", "ambiguous: needs judge", ambiguous=True)
    resolu = resolve_ambiguous(
        ambigu,
        Judge(lambda _s, _u: '{"action_class": "write"}'),
        "shell.exec",
        {"cmd": "ls"},
    )

    assert resolu.judge_used is True
    assert resolu.reason == "judge"


def test_an_exhausted_budget_stays_distinguishable_from_a_failure() -> None:
    """Trois états, trois raisons. Le budget épuisé n'est pas une panne du modèle.

    L'un se corrige en relevant `JUDGE_MAX_CALLS` ou en cassant une boucle d'agent,
    l'autre en regardant le fournisseur. Les confondre envoie l'astreinte dans le
    mur, et c'est ce que faisait `judge_over_budget` avant qu'un troisième cas
    existe.
    """
    judge = Judge(lambda _s, _u: '{"action_class": "read"}', max_calls=1)
    judge.classify("x", {})  # consomme le budget

    ambigu = PolicyOutcome(None, Approval.auto, "regle", "ambiguous: needs judge", ambiguous=True)
    resolu = resolve_ambiguous(ambigu, judge, "shell.exec", {"cmd": "ls"})

    assert resolu.judge_used is False
    assert resolu.reason == "judge_over_budget"
    assert resolu.action_class is ActionClass.irreversible


def test_the_model_call_carries_a_timeout() -> None:
    """La seule sortie réseau non bornée du dépôt, et elle est dans la décision.

    Toutes les autres portent un délai — `core/notify.py` 10 s, `core/signup.py`
    15 s, `core/egress.py` 30/300 s, `api/llm_proxy.py` 120 s, `api/security.py`
    5 s, `api/health.py` 3 s. Celle-ci, non, et c'est celle qui est appelée
    **synchroniquement** dans la boucle de `/v1/authorize` et de la passerelle : un
    point de terminaison qui accepte la connexion sans jamais répondre gèle la
    décision pour tous les tenants du plan.

    Le contrôle porte sur les kwargs réellement passés, pas sur une relecture.
    """
    import sys
    import types

    captures: dict[str, object] = {}
    faux = types.ModuleType("litellm")
    faux.completion = lambda **kw: captures.update(kw) or _Reponse()  # type: ignore[attr-defined]
    ancien = sys.modules.get("litellm")
    sys.modules["litellm"] = faux
    try:
        judge_completer = litellm_completer("mistral/x", "cle", 3.5)
        judge_completer("sys", "user")
    finally:
        if ancien is None:
            del sys.modules["litellm"]
        else:
            sys.modules["litellm"] = ancien

    assert captures["timeout"] == 3.5


class _Reponse:
    """La forme minimale que `litellm_completer` lit."""

    class _Choix:
        class _Message:
            content = '{"action_class": "read"}'

        message = _Message()

    choices = (_Choix(),)

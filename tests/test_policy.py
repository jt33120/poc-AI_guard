"""Unit tests for the deterministic policy engine (SPEC §6/§10, M3)."""

from __future__ import annotations

import pytest

from core.policy import (
    ActionClass,
    Approval,
    Policy,
    PolicyDefaults,
    PolicyError,
    ToolRule,
    authorize,
    classify,
    evaluate,
    parse_policy,
)

_POLICY_YAML = """
tools:
  - name: filesystem.read_file
    class: read
    approval: auto
  - name: mail.send
    class: external_send
    approval: human_in_the_loop
    constraints: { allowed_domains: ["@client.fr"], dry_run: true }
  - name: crm.delete_contact
    class: irreversible
    approval: human_dual
    constraints: { dry_run: true }
  - name: shell.exec
    classify: ambiguous
    approval: human_in_the_loop
defaults:
  unknown_tool: deny
  hitl_timeout_seconds: 3600
  on_approval_service_down: deny
"""


def _policy():
    return parse_policy(_POLICY_YAML)


def test_parse_valid_policy() -> None:
    policy = _policy()
    assert {rule.name for rule in policy.tools} == {
        "filesystem.read_file",
        "mail.send",
        "crm.delete_contact",
        "shell.exec",
    }
    assert policy.defaults.unknown_tool is Approval.deny


def test_parse_invalid_yaml_raises() -> None:
    with pytest.raises(PolicyError):
        parse_policy("tools: [::::")


def test_parse_unknown_approval_raises() -> None:
    with pytest.raises(PolicyError):
        parse_policy("tools:\n  - name: t\n    class: read\n    approval: maybe\n")


def test_parse_duplicate_names_raises() -> None:
    bad = (
        "tools:\n"
        "  - {name: t, class: read, approval: auto}\n"
        "  - {name: t, class: write, approval: auto}\n"
    )
    with pytest.raises(PolicyError):
        parse_policy(bad)


def test_parse_requires_class_or_classify() -> None:
    with pytest.raises(PolicyError):
        parse_policy("tools:\n  - name: t\n    approval: auto\n")


def test_parse_class_and_classify_mutually_exclusive() -> None:
    bad = "tools:\n  - name: t\n    class: read\n    classify: ambiguous\n    approval: auto\n"
    with pytest.raises(PolicyError):
        parse_policy(bad)


def test_classify_known_and_ambiguous_and_unknown() -> None:
    policy = _policy()
    assert classify(policy, "filesystem.read_file", {}) is ActionClass.read
    assert classify(policy, "shell.exec", {}) is None  # ambiguous -> needs judge
    assert classify(policy, "does.not.exist", {}) is None


def test_authorize_known_and_unknown() -> None:
    policy = _policy()
    assert authorize(policy, "filesystem.read_file") is Approval.auto
    assert authorize(policy, "crm.delete_contact") is Approval.human_dual
    assert authorize(policy, "does.not.exist") is Approval.deny  # fail-closed


def test_evaluate_read_is_auto() -> None:
    outcome = evaluate(_policy(), "filesystem.read_file", {})
    assert outcome.action_class is ActionClass.read
    assert outcome.decision is Approval.auto


def test_evaluate_irreversible_is_human_dual() -> None:
    outcome = evaluate(_policy(), "crm.delete_contact", {"contact_id": "c1"})
    assert outcome.action_class is ActionClass.irreversible
    assert outcome.decision is Approval.human_dual


def test_evaluate_unknown_is_deny() -> None:
    outcome = evaluate(_policy(), "does.not.exist", {})
    assert outcome.action_class is None
    assert outcome.decision is Approval.deny


def test_evaluate_ambiguous_flags_for_judge() -> None:
    outcome = evaluate(_policy(), "shell.exec", {"cmd": "rm -rf /"})
    assert outcome.ambiguous is True
    assert outcome.action_class is None


def test_allowed_domains_constraint_allows_matching_domain() -> None:
    outcome = evaluate(_policy(), "mail.send", {"to": "alice@client.fr", "body": "hi"})
    assert outcome.decision is Approval.human_in_the_loop


def test_allowed_domains_constraint_denies_foreign_domain() -> None:
    outcome = evaluate(_policy(), "mail.send", {"to": "attacker@evil.com"})
    assert outcome.decision is Approval.deny
    assert outcome.reason == "constraint violated"


_AMBIGUOUS_CONSTRAINED = """
tools:
  - name: agent.relay
    classify: ambiguous
    approval: human_in_the_loop
    constraints: { allowed_domains: ["@client.fr"] }
defaults:
  unknown_tool: deny
"""


def test_constraints_are_enforced_on_an_ambiguous_rule() -> None:
    # FR-199: the ambiguous branch used to return before the constraint check, so a
    # rule carrying both read as bounded and was not. The bound must hold whether or
    # not the action class is known -- it does not depend on knowing it.
    policy = parse_policy(_AMBIGUOUS_CONSTRAINED)
    outcome = evaluate(policy, "agent.relay", {"to": "attacker@evil.com"})
    assert outcome.decision is Approval.deny
    assert outcome.reason == "constraint violated"
    assert outcome.ambiguous is False  # denied before classifying; no judge is owed


def test_a_satisfied_constraint_still_reaches_the_judge() -> None:
    policy = parse_policy(_AMBIGUOUS_CONSTRAINED)
    outcome = evaluate(policy, "agent.relay", {"to": "alice@client.fr"})
    assert outcome.ambiguous is True
    assert outcome.action_class is None


# --- auto-classification (zero-config onboarding) ----------------------------

_AUTO_YAML = """
tools:
  - name: billing.refund
    class: irreversible
    approval: human_dual
defaults:
  unknown_tool: deny
  auto_classify: true
  class_approvals:
    read: auto
    write: auto
    external_send: human_in_the_loop
    irreversible: human_in_the_loop
"""


def _auto_policy():
    return parse_policy(_AUTO_YAML)


def test_auto_classify_reads_run_automatically() -> None:
    outcome = evaluate(_auto_policy(), "crm.get_contact", {})
    assert outcome.action_class is ActionClass.read
    assert outcome.decision is Approval.auto
    assert outcome.reason == "auto-classified by name"


def test_auto_classify_sends_need_human() -> None:
    outcome = evaluate(_auto_policy(), "slack.send_message", {})
    assert outcome.action_class is ActionClass.external_send
    assert outcome.decision is Approval.human_in_the_loop


def test_auto_classify_deletes_are_irreversible() -> None:
    outcome = evaluate(_auto_policy(), "db.delete_row", {})
    assert outcome.action_class is ActionClass.irreversible
    assert outcome.decision is Approval.human_in_the_loop


def test_auto_classify_unrecognized_name_fails_closed() -> None:
    outcome = evaluate(_auto_policy(), "frobnicate", {})
    assert outcome.action_class is None
    assert outcome.decision is Approval.deny


def test_explicit_rule_overrides_auto_classify() -> None:
    # billing.refund would heuristically be 'irreversible' too, but the explicit
    # rule's human_dual must win over the class default.
    outcome = evaluate(_auto_policy(), "billing.refund", {})
    assert outcome.decision is Approval.human_dual


def test_auto_classify_off_by_default_keeps_unknown_deny() -> None:
    # The baseline policy has no auto_classify -> unknown tools still deny.
    assert authorize(_policy(), "anything.get_thing") is Approval.deny


def test_classify_by_name_safety_ordering() -> None:
    from core.policy import classify_by_name

    assert classify_by_name("user.delete_and_notify") is ActionClass.irreversible
    assert classify_by_name("report.send_summary") is ActionClass.external_send
    assert classify_by_name("candidate.search") is ActionClass.read
    assert classify_by_name("candidate.update") is ActionClass.write
    assert classify_by_name("xyzzy") is None


# --- closed constraint vocabulary (EXH-2 / G-11) -----------------------------


def _with_constraint(body: str) -> str:
    return f"tools:\n  - name: t\n    class: write\n    approval: auto\n    constraints: {body}\n"


def test_unknown_constraint_key_is_rejected_at_parse_time() -> None:
    # `business_hours_only` used to parse, display as a bound, and do nothing.
    with pytest.raises(PolicyError) as exc:
        parse_policy(_with_constraint("{ business_hours_only: true }"))
    assert "business_hours_only" in str(exc.value)
    assert "known constraints" in str(exc.value)  # the error names the vocabulary


def test_malformed_known_constraint_is_rejected_at_parse_time() -> None:
    with pytest.raises(PolicyError):
        parse_policy(_with_constraint('{ allowed_domains: "@client.fr" }'))  # string, not list
    with pytest.raises(PolicyError):
        parse_policy(_with_constraint("{ allowed_domains: [] }"))  # empty allows nothing, silently
    with pytest.raises(PolicyError):
        parse_policy(_with_constraint("{ dry_run: yes-please }"))  # not a boolean


def test_every_vocabulary_member_is_accepted() -> None:
    from core.policy import _KNOWN_CONSTRAINTS

    samples: dict[str, str] = {
        "allowed_domains": '["@client.fr"]',
        "allowed_clients": '["c1"]',
        "dry_run": "true",
    }
    # A key in the vocabulary with no sample here means the vocabulary grew without
    # this test growing with it -- which is how the silent-ignore defect got in.
    assert set(samples) == set(_KNOWN_CONSTRAINTS)
    for key, value in samples.items():
        parse_policy(_with_constraint(f"{{ {key}: {value} }}"))


def test_unenforceable_constraint_denies_at_evaluation() -> None:
    # Parse-time rejection is the ergonomics; this is the guarantee. A rule built
    # around the parser (a stored document, a hand-built ToolRule) still fails closed.
    rule = ToolRule.model_construct(
        name="t",
        action_class=ActionClass.write,
        classify=None,
        approval=Approval.auto,
        constraints={"business_hours_only": True},
    )
    policy = Policy.model_construct(tools=[rule], defaults=PolicyDefaults())
    outcome = evaluate(policy, "t", {})
    assert outcome.decision is Approval.deny
    assert outcome.reason == "constraint violated"


def test_dry_run_raises_the_approval_floor() -> None:
    # A dry run nobody is shown is not a dry run: declaring it forces a human.
    policy = parse_policy(
        "tools:\n"
        "  - name: crm.purge\n"
        "    class: irreversible\n"
        "    approval: auto\n"
        "    constraints: { dry_run: true }\n"
    )
    assert evaluate(policy, "crm.purge", {}).decision is Approval.human_in_the_loop


def test_dry_run_floor_never_lowers_a_stricter_approval() -> None:
    policy = parse_policy(
        "tools:\n"
        "  - name: crm.purge\n"
        "    class: irreversible\n"
        "    approval: human_dual\n"
        "    constraints: { dry_run: true }\n"
    )
    assert evaluate(policy, "crm.purge", {}).decision is Approval.human_dual


def test_dry_run_false_forces_nothing() -> None:
    policy = parse_policy(
        "tools:\n"
        "  - name: crm.note\n"
        "    class: write\n"
        "    approval: auto\n"
        "    constraints: { dry_run: false }\n"
    )
    assert evaluate(policy, "crm.note", {}).decision is Approval.auto


def test_service_down_verdict_treats_an_unknown_class_as_the_worst_case() -> None:
    from core.policy import service_down_verdict

    policy = parse_policy("defaults: {unknown_tool: deny, on_approval_service_down: auto}\n")
    # Not knowing what an action does is not a reason to be lenient about it.
    assert service_down_verdict(policy, None) is Approval.deny
    assert service_down_verdict(policy, ActionClass.irreversible) is Approval.deny
    assert service_down_verdict(policy, ActionClass.external_send) is Approval.deny
    assert service_down_verdict(policy, ActionClass.write) is Approval.auto
    assert service_down_verdict(_policy(), ActionClass.write) is Approval.deny  # default

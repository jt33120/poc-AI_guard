"""Unit tests for the deterministic policy engine (SPEC §6/§10, M3)."""

from __future__ import annotations

import pytest

from core.policy import (
    ActionClass,
    Approval,
    PolicyError,
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

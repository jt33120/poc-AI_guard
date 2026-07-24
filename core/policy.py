"""Deterministic policy engine: classify actions and authorize them (SPEC §6/§10).

This is the hot path — fast, reproducible, testable, with no LLM in the loop.
Unknown tools and constraint violations fail closed (deny). The LLM judge (M6)
only resolves ``classify: ambiguous`` rules into an action class; it never
authorizes on its own.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

_EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")


class ActionClass(StrEnum):
    read = "read"
    write = "write"
    external_send = "external_send"
    irreversible = "irreversible"


class Approval(StrEnum):
    auto = "auto"
    notify = "notify"  # relay, but record it distinctly (notify-and-proceed, M11)
    human_in_the_loop = "human_in_the_loop"
    human_dual = "human_dual"
    deny = "deny"


#: Safe per-class approvals used when ``auto_classify`` is on and a class isn't
#: explicitly overridden — reads/writes run, external sends and irreversible
#: actions pause for a human (fail toward review).
_CLASS_DEFAULTS: dict[ActionClass, Approval] = {
    ActionClass.read: Approval.auto,
    ActionClass.write: Approval.auto,
    ActionClass.external_send: Approval.human_in_the_loop,
    ActionClass.irreversible: Approval.human_in_the_loop,
}

#: Name heuristics for zero-config onboarding. Checked in order of decreasing
#: risk so an ambiguous name errs toward the safer class (irreversible/send win
#: over read/write — misclassifying never *relaxes* control).
_NAME_HEURISTICS: tuple[tuple[re.Pattern[str], ActionClass], ...] = (
    (
        re.compile(
            r"delet|destroy|drop|wipe|purge|remove|terminat|deploy|revoke|truncat|reset|cancel",
            re.I,
        ),
        ActionClass.irreversible,
    ),
    (
        re.compile(
            r"send|email|mail|publish|post|notify|messag|sms|charge"
            r"|payment|pay|transfer|tweet|webhook|dispatch|invite",
            re.I,
        ),
        ActionClass.external_send,
    ),
    (
        re.compile(
            r"get|list|read|search|find|fetch|query|view|describ"
            r"|show|lookup|count|browse|inspect|retriev",
            re.I,
        ),
        ActionClass.read,
    ),
    (
        re.compile(
            r"creat|updat|write|insert|set|add|edit|modif|upsert|put"
            r"|patch|move|renam|tag|assign|shortlist|save|upload",
            re.I,
        ),
        ActionClass.write,
    ),
)


def classify_by_name(tool_name: str) -> ActionClass | None:
    """Best-effort action class from the tool name (server prefix ignored)."""
    base = tool_name.rsplit(".", 1)[-1]
    for pattern, action_class in _NAME_HEURISTICS:
        if pattern.search(base):
            return action_class
    return None


class PolicyError(ValueError):
    """Raised when a policy document is invalid (API maps this to HTTP 422)."""


class ToolRule(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str = Field(min_length=1, max_length=200)
    action_class: ActionClass | None = Field(default=None, alias="class")
    classify: Literal["ambiguous"] | None = None
    approval: Approval
    constraints: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_class_or_classify(self) -> ToolRule:
        if self.classify is None and self.action_class is None:
            raise ValueError(f"tool '{self.name}': one of 'class' or 'classify' is required")
        if self.classify is not None and self.action_class is not None:
            raise ValueError(f"tool '{self.name}': 'class' and 'classify' are mutually exclusive")
        return self


class RiskBands(BaseModel):
    """Ascending score ceilings (1-100) that map a risk score to an approval tier:
    ``<auto`` → auto, ``<notify`` → notify, ``<hitl`` → human_in_the_loop, else deny."""

    model_config = ConfigDict(extra="forbid")

    auto: int = Field(default=30, ge=1, le=100)
    notify: int = Field(default=60, ge=1, le=100)
    hitl: int = Field(default=85, ge=1, le=100)

    @model_validator(mode="after")
    def _ascending(self) -> RiskBands:
        if not self.auto <= self.notify <= self.hitl:
            raise ValueError("risk_bands must be ascending: auto <= notify <= hitl")
        return self


class PolicyDefaults(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unknown_tool: Approval = Approval.deny
    hitl_timeout_seconds: int = Field(default=3600, ge=1, le=86400)
    on_approval_service_down: Approval = Approval.deny
    # Zero-config onboarding: classify un-listed tools by name and gate them by
    # class. Off by default so existing policies are unaffected (backward compat).
    auto_classify: bool = False
    # Supply-chain integrity (M10): fingerprint downstream tools and quarantine
    # drifted / poisoned ones. Off by default (backward compatible). When on and
    # auto_approve_tools is false, a newly-seen tool is quarantined until an
    # operator approves it; when true, a first sighting is auto-approved.
    integrity_enabled: bool = False
    auto_approve_tools: bool = False
    # Graduated autonomy (M11): when set, an `auto` decision is risk-scored and
    # may be tightened to notify / human review / deny. Off by default (opt-in).
    risk_bands: RiskBands | None = None
    # Indirect prompt-injection guard (M12): when a tool result looks injected the
    # session is tainted, and a following irreversible/external action within the
    # window is escalated to a human or denied. Off by default (opt-in).
    taint_policy: Literal["off", "escalate", "deny"] = "off"
    taint_window: int = Field(default=5, ge=1, le=100)
    class_approvals: dict[ActionClass, Approval] = Field(
        default_factory=lambda: dict(_CLASS_DEFAULTS)
    )

    def approval_for_class(self, action_class: ActionClass) -> Approval:
        return self.class_approvals.get(action_class, _CLASS_DEFAULTS[action_class])


class Policy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tools: list[ToolRule] = Field(default_factory=list)
    defaults: PolicyDefaults = Field(default_factory=PolicyDefaults)

    @model_validator(mode="after")
    def _unique_names(self) -> Policy:
        names = [rule.name for rule in self.tools]
        if len(names) != len(set(names)):
            raise ValueError("duplicate tool names in policy")
        return self

    def rule_for(self, tool_name: str) -> ToolRule | None:
        for rule in self.tools:
            if rule.name == tool_name:
                return rule
        return None


@dataclass(frozen=True)
class PolicyOutcome:
    """Result of evaluating a tool call against the policy."""

    action_class: ActionClass | None
    decision: Approval
    rule_name: str | None
    reason: str
    ambiguous: bool = False


def parse_policy(text: str) -> Policy:
    """Parse and validate a policy YAML document, or raise PolicyError."""
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise PolicyError(f"invalid YAML: {exc}") from exc
    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise PolicyError("policy must be a mapping")
    try:
        return Policy.model_validate(data)
    except ValidationError as exc:
        raise PolicyError(str(exc)) from exc


def classify(policy: Policy, tool_name: str, arguments: dict[str, Any]) -> ActionClass | None:
    """Return the deterministic action class, or None if unknown / needs the judge."""
    rule = policy.rule_for(tool_name)
    if rule is None:
        return classify_by_name(tool_name) if policy.defaults.auto_classify else None
    if rule.classify == "ambiguous":
        return None
    return rule.action_class


def authorize(policy: Policy, tool_name: str) -> Approval:
    """Return the policy decision for a tool (defaults.unknown_tool if unknown)."""
    rule = policy.rule_for(tool_name)
    if rule is None:
        if policy.defaults.auto_classify:
            action_class = classify_by_name(tool_name)
            if action_class is not None:
                return policy.defaults.approval_for_class(action_class)
        return policy.defaults.unknown_tool
    return rule.approval


def _iter_strings(arguments: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for value in arguments.values():
        if isinstance(value, str):
            out.append(value)
        elif isinstance(value, list):
            out.extend(item for item in value if isinstance(item, str))
    return out


def _allowed_domains_ok(allowed: list[str], arguments: dict[str, Any]) -> bool:
    for text in _iter_strings(arguments):
        for email in _EMAIL.findall(text):
            domain = "@" + email.split("@")[-1]
            if not any(domain == d or domain.endswith(d) for d in allowed):
                return False
    return True


def _constraints_ok(rule: ToolRule, arguments: dict[str, Any]) -> bool:
    allowed = rule.constraints.get("allowed_domains")
    if isinstance(allowed, list):
        return _allowed_domains_ok(allowed, arguments)
    return True


_APPROVAL_ORDER = {
    Approval.auto: 0,
    Approval.notify: 1,
    Approval.human_in_the_loop: 2,
    Approval.human_dual: 3,
    Approval.deny: 4,
}


def escalate_for_class(base: Approval, action_class: ActionClass) -> Approval:
    """Raise an ambiguous tool's approval to a safe floor for the judged class.

    The judge only sets a *minimum* (never relaxes): external_send/irreversible
    force at least human-in-the-loop; it can never produce ``auto`` or ``deny``.
    """
    floor = (
        Approval.human_in_the_loop
        if action_class in (ActionClass.external_send, ActionClass.irreversible)
        else Approval.auto
    )
    return base if _APPROVAL_ORDER[base] >= _APPROVAL_ORDER[floor] else floor


def evaluate(policy: Policy, tool_name: str, arguments: dict[str, Any]) -> PolicyOutcome:
    """Full decision for a tool call: action class + authorization (fail-closed)."""
    rule = policy.rule_for(tool_name)
    if rule is None:
        if policy.defaults.auto_classify:
            action_class = classify_by_name(tool_name)
            if action_class is not None:
                return PolicyOutcome(
                    action_class,
                    policy.defaults.approval_for_class(action_class),
                    None,
                    "auto-classified by name",
                )
        return PolicyOutcome(None, policy.defaults.unknown_tool, None, "unknown tool")
    if rule.classify == "ambiguous":
        return PolicyOutcome(
            None, rule.approval, rule.name, "ambiguous: needs judge", ambiguous=True
        )
    if not _constraints_ok(rule, arguments):
        return PolicyOutcome(rule.action_class, Approval.deny, rule.name, "constraint violated")
    return PolicyOutcome(rule.action_class, rule.approval, rule.name, "policy rule")

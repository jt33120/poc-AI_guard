"""Deterministic per-action risk scoring for graduated autonomy (M11, axis C).

Turns a tool call into a 0-100 risk score from four deterministic factors:

* **reversibility** — the action class (read < write < external_send < irreversible);
* **blast radius** — how many targets the args fan out to (recipients / wildcards);
* **data sensitivity** — secrets / PII in the args (reuses ``core.dlp``);
* **novelty** — whether this (agent, tool) pair has been seen before.

A configurable band maps the score to an approval tier, so the share of actions
that need a human shrinks as trust is earned. No LLM on this path (CLAUDE.md §5):
pure, reproducible, testable. Metadata only — dlp returns hashes, never raw
values (§4.10).
"""

from __future__ import annotations

import re
from typing import Any

from core import dlp
from core.policy import ActionClass, Approval, RiskBands, raise_to

#: Base risk by reversibility of the action class.
_BASE: dict[ActionClass, int] = {
    ActionClass.read: 5,
    ActionClass.write: 25,
    ActionClass.external_send: 55,
    ActionClass.irreversible: 75,
}

#: Consecutive clean approvals before an (agent, tool) earns a one-band discount.
TRUST_THRESHOLD = 5
_TRUST_STEP = 30  # ~ one band width
_DEFAULT_BASE = 25  # unknown class → treat like a write

_EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")


def _iter_strings(arguments: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for value in arguments.values():
        if isinstance(value, str):
            out.append(value)
        elif isinstance(value, list):
            out.extend(item for item in value if isinstance(item, str))
    return out


def _blast_radius(arguments: dict[str, Any]) -> int:
    """Points for how many targets an action fans out to (recipients / wildcards)."""
    recipients: set[str] = set()
    for text in _iter_strings(arguments):
        recipients.update(_EMAIL.findall(text))
        if "*" in text or text.strip().lower() in ("all", "everyone"):
            return 15  # an unbounded fan-out dominates
    list_targets = sum(len(v) for v in arguments.values() if isinstance(v, list))
    fan_out = max(len(recipients), list_targets)
    if fan_out >= 3:
        return 10
    if fan_out >= 1:
        return 5
    return 0


def _sensitivity(arguments: dict[str, Any]) -> int:
    """Points for secrets / PII detected in the arguments (reuses core.dlp)."""
    worst = 0
    for text in _iter_strings(arguments):
        for finding in dlp.scan_text(text):
            if finding.category is dlp.Category.secret:
                return 25  # a secret is the most sensitive signal
            if finding.category is dlp.Category.pii:
                worst = max(worst, 15)
    return worst


def risk_score(
    action_class: ActionClass | None, arguments: dict[str, Any], *, seen_before: bool
) -> int:
    """A deterministic 0-100 risk score for a single action."""
    base = _BASE.get(action_class, _DEFAULT_BASE) if action_class is not None else _DEFAULT_BASE
    score = base + _blast_radius(arguments) + _sensitivity(arguments)
    if not seen_before:
        score += 10  # novelty: an (agent, tool) pair never observed before
    return max(0, min(100, score))


#: Default bands (immutable singleton, safe to share as an argument default).
DEFAULT_BANDS = RiskBands()


def band(
    score: int, bands: RiskBands = DEFAULT_BANDS, action_class: ActionClass | None = None
) -> Approval:
    """Map a risk score to an approval tier, flooring irreversible actions."""
    if score < bands.auto:
        tier = Approval.auto
    elif score < bands.notify:
        tier = Approval.notify
    elif score < bands.hitl:
        tier = Approval.human_in_the_loop
    else:
        tier = Approval.deny
    # An irreversible action is never auto/notify, whatever the score (the floor).
    if action_class is ActionClass.irreversible and tier in (Approval.auto, Approval.notify):
        return Approval.human_in_the_loop
    return tier


def trust_discount(clean_streak: int, *, threshold: int = TRUST_THRESHOLD) -> int:
    """Points to subtract once an (agent, tool) has earned trust (N clean approvals)."""
    return _TRUST_STEP if clean_streak >= threshold else 0


def escalate_by_risk(
    base: Approval,
    action_class: ActionClass | None,
    arguments: dict[str, Any],
    bands: RiskBands | None,
    *,
    seen_before: bool,
    clean_streak: int,
) -> Approval:
    """Tighten an ``auto`` decision to its risk-scored tier — never relaxes (opt-in).

    Only an ``auto`` outcome is scored (an explicit stricter policy rule always
    wins); the result can only move *up* the severity order. Earned trust lowers
    the score, but the irreversible floor in :func:`band` still holds.
    """
    if bands is None or base is not Approval.auto:
        return base
    score = risk_score(action_class, arguments, seen_before=seen_before)
    score = max(0, score - trust_discount(clean_streak))
    tier = band(score, bands, action_class)
    return raise_to(base, tier)

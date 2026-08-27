"""Bounded deterministic predicates over tool arguments (FR-157).

An executor tool's danger lives in its *arguments*, not its name: `bash ls` and
`bash rm -rf /` are the same tool. A single class per tool is therefore either
uselessly strict (deny everything the tool can do) or dangerously loose (auto-allow
everything it can do). This module is what lets a rule say *which* invocations are
which -- deterministically, with no model on the path.

**Bounded on purpose.** One predicate per rule, over one named field, from a closed
vocabulary: pattern, membership, equality, comparison. There is no `and`, no `or`,
no nesting, and no arithmetic. Ordered rules give the expressiveness that matters
without giving the policy author a programming language -- a policy that can compute
is a policy nobody can review, and `CLAUDE.md` §4 asks the opposite.

**Fails closed, always.** A missing field, a wrong type, a value the comparison
cannot be applied to: every one of them answers *no match*, and the caller's
declared default takes over. Not knowing whether a predicate holds is never
evidence that it does.
"""

from __future__ import annotations

import re
from typing import Any

#: The closed predicate vocabulary. A key outside it is rejected when the policy is
#: parsed -- the same doctrine as the constraint registry (`AD-36`), one level down.
OPERATORS: frozenset[str] = frozenset({"matches", "equals", "one_of", "gt", "gte", "lt", "lte"})

_NUMERIC = frozenset({"gt", "gte", "lt", "lte"})


def operator_shape_error(operator: str, value: Any) -> str | None:
    """Why ``value`` is not an acceptable operand for ``operator``, or None."""
    if operator not in OPERATORS:
        return f"unknown predicate '{operator}' (known: {', '.join(sorted(OPERATORS))})"
    if operator == "matches":
        if not isinstance(value, str) or not value:
            return "'matches' takes a non-empty regular expression"
        try:
            re.compile(value)
        except re.error as exc:
            return f"'matches' is not a valid regular expression: {exc}"
        return None
    if operator == "one_of":
        if not isinstance(value, list) or not value:
            return "'one_of' takes a non-empty list"
        return None
    if operator in _NUMERIC and isinstance(value, bool):
        # bool is an int in Python; comparing a flag to a threshold is a mistake,
        # not an intention.
        return f"'{operator}' takes a number, not a boolean"
    if operator in _NUMERIC and not isinstance(value, int | float):
        return f"'{operator}' takes a number"
    return None


def _as_number(value: Any) -> float | None:
    """The value as a number, or None when a comparison cannot be applied to it."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    return None


def holds(operator: str, operand: Any, actual: Any) -> bool:
    """Whether ``actual`` satisfies ``operator``/``operand``. False on any doubt.

    ``actual`` is a value taken from agent-supplied arguments, so every shape is
    possible and none is trusted. Anything the predicate cannot evaluate is *not
    satisfied* -- never satisfied-by-default.
    """
    if operator == "matches":
        return isinstance(actual, str) and re.search(str(operand), actual, re.I) is not None
    if operator == "equals":
        # `1 == True` in Python; a policy comparing to 1 does not mean "or true".
        if isinstance(operand, bool) != isinstance(actual, bool):
            return False
        return bool(operand == actual)
    if operator == "one_of":
        if not isinstance(operand, list):  # pragma: no cover - shape checked at parse
            return False
        return any(
            isinstance(item, bool) == isinstance(actual, bool) and item == actual
            for item in operand
        )
    number = _as_number(actual)
    if number is None:
        return False
    threshold = _as_number(operand)
    if threshold is None:  # pragma: no cover - shape checked at parse
        return False
    if operator == "gt":
        return number > threshold
    if operator == "gte":
        return number >= threshold
    if operator == "lt":
        return number < threshold
    if operator == "lte":
        return number <= threshold
    return False  # pragma: no cover - operator vocabulary is closed at parse time

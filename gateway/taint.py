"""Indirect prompt-injection taint tracking at the action boundary (M12, axis D).

xSOM is not a prompt firewall — it watches *actions*. When a tool RESULT carries
content that looks like injected instructions or exfiltration (a fetched web
page, a document, an email body), the session is marked *tainted*. A subsequent
irreversible / external-send action within the taint window is then gated
(escalated to a human or denied, per policy) — an indirect-injection payload can
carry the agent up to the edge of a risky action, but not through it.

Scans content for signals only; never stores it (CLAUDE.md §4.10). Pure and
deterministic — no LLM on the path.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: Instructions an attacker plants in fetched content to redirect the agent.
_INJECT = re.compile(
    r"ignore\s+(?:all\s+)?(?:previous|prior|above)"
    r"|disregard\s+(?:the\s+)?(?:previous|prior|above|instruction)"
    r"|forward\s+(?:this|it|all|everything|the)\b"
    r"|send\s+(?:all|everything|the\s+\w+)\b.{0,40}\bto\b"
    r"|exfiltrat"
    r"|you\s+are\s+now\b"
    r"|new\s+instructions?\s*:"
    r"|do\s+not\s+(?:tell|inform|mention\s+to)\s+the\s+user",
    re.I | re.S,
)
#: Invisible / bidi control chars used to smuggle instructions into a result.
_INVISIBLE = re.compile("[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]")


def taints_result(text: str | None) -> str | None:
    """Return a short reason if a tool result looks like it carries an injection."""
    if not text:
        return None
    if _INVISIBLE.search(text):
        return "invisible_characters"
    if _INJECT.search(text):
        return "injected_instructions"
    return None


@dataclass
class TaintState:
    """Per-session taint: the call sequence at which the last taint was observed."""

    tainted_at: int | None = None
    source_tool: str | None = None
    reason: str | None = None

    def mark(self, *, call_seq: int, source_tool: str, reason: str) -> None:
        self.tainted_at = call_seq
        self.source_tool = source_tool
        self.reason = reason

    def active(self, *, call_seq: int, window: int) -> bool:
        """Whether a taint observed earlier still covers the current call."""
        if self.tainted_at is None:
            return False
        return 0 < call_seq - self.tainted_at <= window

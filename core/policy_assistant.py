"""Natural-language → policy YAML assistant (LiteLLM → Mistral).

Turns a plain-language description ("my agent reads the CRM and emails
candidates; never let it delete anything") into a valid xSOM policy document.
The model only drafts; the deterministic ``parse_policy`` validator is the gate —
invalid output triggers one repair attempt and then fails closed (never returns
an unvalidated policy). Reuses the judge's bounded Mistral completer.
"""

from __future__ import annotations

from collections.abc import Callable

from core.policy import PolicyError, parse_policy

#: (system_prompt, user_prompt) -> raw model text.
Completer = Callable[[str, str], str]

_SYSTEM = """You generate authorization policies for xSOM AI Guard, a gateway that
controls what an AI agent is allowed to DO (its tool calls). Output ONLY a YAML
policy document — no prose, no markdown code fences.

Schema:
  tools:                      # optional; explicit rules for specific named tools
    - name: <tool name>       # e.g. crm.delete_contact
      class: read | write | external_send | irreversible
      approval: auto | human_in_the_loop | human_dual
  defaults:
    unknown_tool: human_in_the_loop | human_dual | deny
    auto_classify: true | false
    class_approvals:
      read: <approval>
      write: <approval>
      external_send: <approval>
      irreversible: <approval>

Rules:
- Classify by worst plausible effect: read = reads only; write = reversible
  change; external_send = email/message/publish/payment/outbound; irreversible
  = delete/deploy/wipe/refund.
- Prefer `auto_classify: true` with `class_approvals`, so tools the user did not
  name are still handled by their class.
- Be least-privilege and fail closed: `unknown_tool: deny`. `auto` is NOT a
  legal value for it and the policy will be rejected: "only observe, do not
  block" is a bounded observation window opened by an admin from the control
  plane, not a policy that auto-allows every tool nobody has named.
- Map intent: "block/forbid" -> deny; "ask a human / needs approval" ->
  human_in_the_loop; "two approvers / dual control / four eyes" -> human_dual;
  "let it run / automatic / fine" -> auto.
- Only add `tools` entries for specific tools the user names; otherwise rely on
  `class_approvals`.
"""


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        lines = t.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        t = "\n".join(lines)
    return t.strip()


def draft_policy(completer: Completer, prompt: str) -> str:
    """Draft a validated policy YAML from a description, or raise PolicyError."""

    def _ask(extra: str = "") -> str:
        text = _strip_fences(completer(_SYSTEM, prompt + extra))
        if not text:
            raise PolicyError("model returned an empty policy")
        parse_policy(text)  # the deterministic gate — raises PolicyError if bad
        return text

    try:
        return _ask()
    except PolicyError as exc:
        repair = (
            f"\n\nYour previous YAML was invalid ({exc}). "
            "Return ONLY a corrected, valid YAML policy."
        )
        return _ask(repair)

"""Compliance exports: AI Act / GDPR reports as JSON + PDF (SPEC §9, M5).

The narrative is deterministic here; M6 lets the LLM judge produce the prose
(via the optional ``narrator`` hook). Reports contain audit metadata + human
-supervision proofs only — never argument values or PII (CLAUDE.md §4.10).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

AI_ACT = "ai_act"
RGPD = "rgpd"
FRAMEWORKS = (AI_ACT, RGPD)

Narrator = Callable[[str, dict[str, int], int], str]

# Every decision the system writes maps to exactly one bucket. The tally used to be
# read by picking four keys out of it, so `notify`, `hold`, the guard events and --
# worst of all -- the `monitor_*` family fell out of the summary while still counting
# toward the total: a compliance narrative whose own arithmetic did not close, in the
# document a regulator reads. Anything unmapped now lands in `unclassified`, is
# reported, and is named in the prose, so a new decision value can never quietly
# vanish from a summary again.
_BUCKETS: dict[str, str] = {
    "allow": "auto_allowed",
    "notify": "allowed_with_notice",
    "hitl_pending": "held_for_human",
    "hold": "held_for_human",
    "hitl_approved": "human_approved",
    "deny": "refused",
    "hitl_denied": "refused",
    "expired": "refused",
    "rbac_denied": "refused",
    "tainted_action": "refused",
    # `FR-166` : l'ordre d'arrêt d'un opérateur, et l'état d'arrêt illisible. Sans
    # ces deux lignes ils tomberaient en `unclassified` dans le récit de conformité —
    # une action refusée qui ne se compte pas comme refusée.
    "agent_stopped": "refused",
    "stop_state_unreadable": "refused",
    # Recorded guard events rather than verdicts on an action: a tool that drifted,
    # a session marked tainted, a DLP finding on a body that still went out.
    "taint_marked": "guard_recorded",
    # `FR-190` / `FR-193` : trois observations sur le chemin du proxy. Ce sont des
    # événements de garde, pas des verdicts sur une action — les compter comme des
    # refus gonflerait le récit de conformité avec ce que nous n'avons pas empêché.
    "prompt_leak_verbatim": "guard_recorded",
    "prompt_guard_flagged": "guard_recorded",
    "prompt_guard_clean": "guard_recorded",
    "prompt_guard_unavailable": "guard_recorded",
    "tool_drift": "guard_recorded",
    "poison_suspected": "guard_recorded",
    "tool_quarantined": "guard_recorded",
    "flag": "guard_recorded",
    "redacted": "guard_recorded",
}

# `monitor_x` means: an observation window was open, and an action the policy would
# have stopped was let through and recorded (AD-27.3). It is not "auto-allowed", and
# counting it as such is the single most misleading thing this summary could do.
_MONITOR_PREFIX = "monitor_"
_OBSERVED = "observed_not_enforced"
_UNCLASSIFIED = "unclassified"

BUCKETS: tuple[str, ...] = (
    "auto_allowed",
    "allowed_with_notice",
    "held_for_human",
    "human_approved",
    "refused",
    "guard_recorded",
    _OBSERVED,
    _UNCLASSIFIED,
)


def summarise(counts: dict[str, int]) -> dict[str, int]:
    """Partition a decision tally into buckets. Nothing is dropped, ever.

    `sum(summarise(counts).values()) == sum(counts.values())` is the property the
    whole function exists for, and the test asserts it against the full decision
    vocabulary the codebase writes.
    """
    out = dict.fromkeys(BUCKETS, 0)
    for decision, n in counts.items():
        if decision.startswith(_MONITOR_PREFIX):
            out[_OBSERVED] += n
        else:
            out[_BUCKETS.get(decision, _UNCLASSIFIED)] += n
    return out


def default_narrative(framework: str, counts: dict[str, int], total: int) -> str:
    b = summarise(counts)
    tail = ""
    if b[_OBSERVED]:
        # Stated, never folded into "allowed": an operator opened a window and the
        # gateway stood down. That is exactly what an auditor is looking for.
        tail += (
            f" {b[_OBSERVED]} action(s) were let through under an open observation "
            f"window and recorded rather than enforced."
        )
    if b[_UNCLASSIFIED]:
        tail += f" {b[_UNCLASSIFIED]} decision(s) are of a kind this summary does not classify."
    if framework == AI_ACT:
        return (
            f"AI Act oversight summary: {total} agent-action decisions were recorded "
            f"({b['auto_allowed']} auto-allowed, {b['allowed_with_notice']} allowed with "
            f"notice, {b['held_for_human']} held for human review, {b['human_approved']} "
            f"executed after human approval, {b['refused']} refused, "
            f"{b['guard_recorded']} guard events)." + tail
        )
    return (
        f"GDPR processing record: {total} processing decisions were logged with metadata "
        f"only (no personal-data values are stored — only an args hash). "
        f"{b['auto_allowed']} automatic, {b['human_approved']} human-approved, "
        f"{b['refused']} refused." + tail
    )


def build_report(
    *,
    framework: str,
    events: list[dict[str, Any]],
    approvals: list[dict[str, Any]],
    range_from: str | None = None,
    range_to: str | None = None,
    narrator: Narrator | None = None,
) -> dict[str, Any]:
    """Assemble a compliance report dict for the given framework."""
    if framework not in FRAMEWORKS:
        raise ValueError(f"unknown framework: {framework}")
    counts: dict[str, int] = dict(Counter(e["decision"] for e in events))
    make_narrative = narrator or default_narrative
    report: dict[str, Any] = {
        "framework": framework,
        "generated_at": datetime.now(UTC).isoformat(),
        "range": {"from": range_from, "to": range_to},
        "event_count": len(events),
        "summary": counts,
        # The partition, published beside the raw tally so a reader can check that
        # the numbers close without re-deriving the mapping.
        "summary_by_outcome": summarise(counts),
        "ingress_mix": dict(Counter(e.get("ingress") or "unrecorded" for e in events)),
        "narrative": make_narrative(framework, counts, len(events)),
        "events": events,
    }
    if framework == AI_ACT:
        report["human_supervision"] = [
            {
                "approval_id": a["id"],
                "tool": a["tool_name"],
                "status": a["status"],
                "required_count": a["required_count"],
                "approved_by": a["approved_by"],
                "decided_by": a["decided_by"],
            }
            for a in approvals
        ]
    else:
        report["processing_note"] = (
            "Audit metadata only; argument values and PII are never stored (args_hash only)."
        )
        report["retention"] = "configurable"
    return report


def render_pdf(report: dict[str, Any]) -> bytes:
    """Render a report dict to a simple PDF document."""
    from fpdf import FPDF

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_font("Helvetica", style="B", size=16)
    pdf.cell(0, 10, f"xSOM AI Guard - {report['framework'].upper()} report")
    pdf.ln(12)

    pdf.set_font("Helvetica", size=10)
    pdf.cell(0, 6, f"Generated at: {report['generated_at']}")
    pdf.ln(6)
    pdf.cell(0, 6, f"Events: {report['event_count']}")
    pdf.ln(10)

    pdf.set_font("Helvetica", style="B", size=12)
    pdf.cell(0, 6, "Narrative")
    pdf.ln(8)
    pdf.set_font("Helvetica", size=10)
    pdf.multi_cell(0, 5, _ascii(report["narrative"]))
    pdf.ln(4)

    pdf.set_font("Helvetica", style="B", size=12)
    pdf.cell(0, 6, "Decision summary")
    pdf.ln(8)
    pdf.set_font("Helvetica", size=10)
    for decision, count in sorted(report["summary"].items()):
        pdf.cell(0, 5, f"- {decision}: {count}")
        pdf.ln(5)

    # The caveat travels with the artefact. A PDF that omits what the JSON pack
    # says about its own verification *is* the overstatement FR-169 forbids --
    # and the PDF is the copy that gets handed over.
    verification = (
        report.get("articles", {}).get("article_12_record_keeping", {}).get("verification")
    )
    if verification:
        pdf.ln(4)
        pdf.set_font("Helvetica", style="B", size=12)
        pdf.cell(0, 6, "Verification")
        pdf.ln(8)
        pdf.set_font("Helvetica", size=10)
        pdf.multi_cell(0, 5, _ascii(verification["statement"]))

    return bytes(pdf.output())


def _ascii(text: str) -> str:
    # Core PDF fonts are latin-1; keep narrative bytes safe.
    return text.encode("latin-1", "replace").decode("latin-1")

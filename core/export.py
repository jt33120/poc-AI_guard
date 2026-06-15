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


def default_narrative(framework: str, counts: dict[str, int], total: int) -> str:
    allowed = counts.get("allow", 0)
    approved = counts.get("hitl_approved", 0)
    held = counts.get("hitl_pending", 0)
    refused = counts.get("deny", 0) + counts.get("hitl_denied", 0) + counts.get("expired", 0)
    if framework == AI_ACT:
        return (
            f"AI Act oversight summary: {total} agent-action decisions were recorded "
            f"({allowed} auto-allowed, {held} held for human review, {approved} executed "
            f"after human approval, {refused} refused). Irreversible actions are never "
            f"executed without recorded human supervision."
        )
    return (
        f"GDPR processing record: {total} processing decisions were logged with metadata "
        f"only (no personal-data values are stored — only an args hash). {allowed} automatic, "
        f"{approved} human-approved, {refused} refused."
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

    return bytes(pdf.output())


def _ascii(text: str) -> str:
    # Core PDF fonts are latin-1; keep narrative bytes safe.
    return text.encode("latin-1", "replace").decode("latin-1")

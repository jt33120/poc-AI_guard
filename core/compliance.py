"""EU AI Act compliance plane (M9, BUILD_PLAN_V1.1 axis A).

Turns the immutable hash-chained audit log + HITL records the gateway already
produces into an *attestable, exportable* compliance artefact — no new data, we
package what M5/M4 already write:

* **Article 12 (record-keeping)** — the audit chain is tamper-evident; we attest
  its integrity via :func:`core.audit.verify_chain` and enforce a retention floor
  (operational data younger than the floor can never be purged, fail-closed). The
  audit log itself is append-only, so its retention is unbounded by construction.
* **Article 14 (human oversight)** — irreversible / external-send actions are
  gated by a human (HITL); we measure oversight coverage and flag any such action
  that was auto-allowed (a policy hole = an oversight gap).
* **Article 26 (deployer duties)** — a decision summary + a generated FRIA
  scaffold pre-filled from the tenant's own activity.

Reads metadata only — never argument values or PII (CLAUDE.md §4.10). No LLM on
the path; the narrative prose reuses the export ``narrator`` hook.
"""

from __future__ import annotations

from typing import Any

import psycopg

from core import audit, export
from core import usage as usage_store

#: EU AI Act art. 12 mandates high-risk logs be retained at least 6 months.
MIN_RETENTION_DAYS = 183

#: Action classes that must never be auto-executed without human oversight (art. 14).
_GATED_CLASSES = ("irreversible", "external_send")


class RetentionError(Exception):
    """Raised when a purge would delete records younger than the retention floor."""


def guard_retention(days: int, *, floor: int = MIN_RETENTION_DAYS) -> None:
    """Fail-closed: refuse any purge that would breach the mandated retention window."""
    if days < floor:
        raise RetentionError(
            f"retention floor is {floor} days (EU AI Act art. 12); "
            f"refusing to purge data younger than that (requested {days})"
        )


def enforce_retention_purge(
    conn: psycopg.Connection, *, days: int, floor: int = MIN_RETENTION_DAYS
) -> int:
    """The sanctioned retention purge for operational data: guard, then delete.

    Only operational usage rows are ever purged (they are not hash-chained); the
    audit log is append-only and never deleted. Returns rows removed.
    """
    guard_retention(days, floor=floor)
    return usage_store.purge_older_than(conn, days=days)


def chain_integrity(conn: psycopg.Connection, tenant_id: str | None = None) -> dict[str, Any]:
    """Article 12 proof: recompute the audit hash-chain and report its integrity."""
    result = audit.verify_chain(conn, tenant_id)
    return {"ok": result.ok, "entries": result.count, "first_broken_id": result.broken_id}


def verification_independence() -> dict[str, Any]:
    """What the Article 12 check actually proves — and what it does not (FR-169 / INV-12).

    `chain_integrity` recomputes the chain **from the same rows, over the same
    connection, inside the same process that wrote them**. That detects a row
    edited in place; it cannot detect an operator who rewrote the whole chain
    forward, because nothing outside this system ever witnessed a prior state.

    A regulator's question is not "is the chain self-consistent" — it is "how do I
    know the operator did not rewrite it". Answering the first and presenting it as
    the second is the failure this requirement was written to prevent, so the pack
    now carries the answer in a machine-readable field instead of leaving
    `tamper_evident: true` to be read as more than it is.

    Independence would need a witness this deployment does not have: a signed
    checkpoint whose key lives outside the database host, or an external anchor.
    Neither exists yet, so this is computed rather than written — the day a signer
    ships, it is this function that has to learn about it, and until it does the
    pack keeps saying `independent: false`. An unconfigured witness contributes its
    *absence*, exactly as an unconfigured dependency contributes its failure tier
    (`AD-34`).
    """
    return {
        "method": "recomputed_in_place",
        "independent": False,
        "witness": None,
        "checkpoint_signature": None,
        "signing_key_location": None,
        "statement": (
            "The audit chain was recomputed by the system that wrote it, from its own "
            "database. This proves internal consistency and detects an edited row. It "
            "is not independent verification: no external witness, signed checkpoint "
            "or third-party anchor is configured for this deployment."
        ),
    }


def oversight_coverage(conn: psycopg.Connection) -> dict[str, Any]:
    """Article 14 metric: were all irreversible/external actions gated by a human?"""
    row = conn.execute(
        "select "
        " count(*) filter (where action_class = any(%s)) as gated, "
        " count(*) filter (where action_class = any(%s) and decision = 'allow') as auto_allowed, "
        " count(*) filter (where decision in "
        "   ('hitl_pending','hitl_approved','hitl_denied','expired')) as human_events "
        "from audit_log",
        (list(_GATED_CLASSES), list(_GATED_CLASSES)),
    ).fetchone()
    gated, auto_allowed, human_events = (row[0], row[1], row[2]) if row else (0, 0, 0)
    return {
        "gated": int(gated),
        "auto_allowed": int(auto_allowed),
        "human_events": int(human_events),
        # An irreversible/external action that ran without a human is an oversight gap.
        "coverage_ok": int(auto_allowed) == 0,
    }


def oldest_entry_age_days(conn: psycopg.Connection) -> int | None:
    """Age in days of the oldest audit entry (None if the log is empty)."""
    row = conn.execute(
        "select floor(extract(epoch from (now() - min(ts))) / 86400)::int from audit_log"
    ).fetchone()
    return int(row[0]) if row and row[0] is not None else None


def status(
    conn: psycopg.Connection,
    tenant_id: str | None = None,
    *,
    retention_floor_days: int = MIN_RETENTION_DAYS,
) -> dict[str, Any]:
    """Readiness snapshot: is the tenant's evidence base compliant right now?"""
    integrity = chain_integrity(conn, tenant_id)
    coverage = oversight_coverage(conn)
    # Append-only log → retention is only ever *too short* if the floor is
    # misconfigured below the legal minimum.
    retention_ok = retention_floor_days >= MIN_RETENTION_DAYS
    return {
        "chain_ok": integrity["ok"],
        "entries": integrity["entries"],
        "first_broken_id": integrity["first_broken_id"],
        "oversight_gated": coverage["gated"],
        "oversight_auto_allowed": coverage["auto_allowed"],
        "oversight_coverage_ok": coverage["coverage_ok"],
        "retention_floor_days": retention_floor_days,
        "oldest_entry_age_days": oldest_entry_age_days(conn),
        "retention_ok": retention_ok,
        "ready": integrity["ok"] and coverage["coverage_ok"] and retention_ok,
    }


def fria_scaffold(decision_summary: dict[str, int]) -> dict[str, Any]:
    """A Fundamental Rights Impact Assessment skeleton, pre-filled from activity."""
    total = sum(decision_summary.values())
    return {
        "purpose": "Autonomous agent action control gateway (xSOM AI Guard).",
        "affected_rights": [
            "data protection / privacy (metadata-only logging, no PII stored)",
            "human oversight of automated decisions",
        ],
        "risk_controls": [
            "Deterministic authorization policy applied before every tool call.",
            "Human-in-the-loop approval enforced at the gateway for irreversible actions.",
            "Tamper-evident hash-chained audit log (append-only).",
        ],
        "decisions_recorded": total,
        "residual_risk": "low" if decision_summary.get("allow", 0) <= total else "review",
        "review_note": "Auto-generated scaffold — a qualified person must review and sign off.",
    }


_ENFORCED_INGRESS = "mcp_gateway"


def _oversight_scope(ingress_mix: dict[str, int]) -> dict[str, Any]:
    """Which of the recorded decisions the oversight guarantee actually covers."""
    enforced = ingress_mix.get(_ENFORCED_INGRESS, 0)
    cooperative = sum(n for door, n in ingress_mix.items() if door != _ENFORCED_INGRESS)
    return {
        "enforced_at_gateway": enforced,
        "cooperative_or_unrecorded": cooperative,
        "statement": (
            f"{enforced} decision(s) passed through the MCP gateway, which an agent "
            f"cannot bypass: for these, an irreversible action was not executed without "
            f"recorded human supervision. {cooperative} decision(s) came through a "
            f"cooperative or unrecorded path, where the guarantee depends on the agent "
            f"honouring the verdict it was given."
        ),
    }


def build_evidence_pack(
    conn: psycopg.Connection,
    *,
    tenant_id: str | None,
    events: list[dict[str, Any]],
    approvals: list[dict[str, Any]],
    range_from: str | None = None,
    range_to: str | None = None,
    retention_floor_days: int = MIN_RETENTION_DAYS,
    narrator: export.Narrator | None = None,
) -> dict[str, Any]:
    """Assemble the EU AI Act evidence pack (art. 12/14/26) as a JSON-ready dict.

    Superset of :func:`core.export.build_report` (ai_act), so ``export.render_pdf``
    renders it unchanged; the extra ``articles`` block carries the article mapping.
    """
    base = export.build_report(
        framework=export.AI_ACT,
        events=events,
        approvals=approvals,
        range_from=range_from,
        range_to=range_to,
        narrator=narrator,
    )
    integrity = chain_integrity(conn, tenant_id)
    coverage = oversight_coverage(conn)
    base["standard"] = "EU AI Act (Regulation 2024/1689)"
    base["articles"] = {
        "article_12_record_keeping": {
            "tamper_evident": integrity["ok"],
            "entries": integrity["entries"],
            "first_broken_id": integrity["first_broken_id"],
            "retention_floor_days": retention_floor_days,
            "log_model": "append-only, hash-chained",
            "verification": verification_independence(),
        },
        "article_14_human_oversight": {
            **coverage,
            # The product used to assert, unconditionally and in prose, that
            # "irreversible actions are never executed without recorded human
            # supervision". That holds at the MCP gateway, which an agent cannot
            # route around. It does not hold by itself on the cooperative paths,
            # where the agent must choose to honour the verdict. Since FR-160 the
            # log says which door each decision came through, so the scope is now
            # stated from the data -- and stated in a structured field, because a
            # narrator hook can rewrite prose and cannot rewrite this.
            "scope": _oversight_scope(base["ingress_mix"]),
        },
        "article_26_deployer": {
            "decision_summary": base["summary"],
            "fria": fria_scaffold(base["summary"]),
        },
    }
    base["compliant"] = (
        integrity["ok"] and coverage["coverage_ok"] and retention_floor_days >= MIN_RETENTION_DAYS
    )
    return base

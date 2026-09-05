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

from core import audit, corpora, export, prompt_guard, shadow_ai, verdicts
from core import usage as usage_store
from core.audit import EnforcementMode
from core.monitor import NEVER_OBSERVED

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


#: Les décisions qui disent qu'un humain a été saisi. `expired` en fait partie : une
#: demande qui a expiré **a** été soumise à revue et n'a pas été approuvée — la compter
#: hors revue ferait disparaître le cas où la supervision a fonctionné en ne répondant
#: pas, qui est précisément celui qu'un évaluateur cherche.
_HUMAN_DECISIONS = ("hitl_pending", "hitl_approved", "hitl_denied", "expired")


def critical_decision_review(conn: psycopg.Connection) -> dict[str, Any]:
    """`FR-192` — l'attestation « décision critique sous revue humaine ».

    **Ce qu'elle atteste :** que les actions de classe critique — irréversible et envoi
    externe — sont passées par une revue humaine, avec le compte de celles qui ont été
    approuvées, refusées, laissées expirer, ou qui attendent encore.

    **Ce qu'elle n'atteste pas, et le bloc le dit lui-même :** la *qualité* de la
    décision. `PRD` §5.2 — xSOM n'est pas une plateforme d'évaluation de modèle, et ce
    FR ne score aucune hallucination. Un humain a regardé ; nous le prouvons. Ce qu'il
    a conclu ne nous appartient pas.

    La source est le journal **chaîné**, jamais la table `approvals` : celle-ci est
    mutable par construction (une approbation change d'état), donc une attestation qui
    la lirait serait adossée à ce qu'on peut réécrire. Toute la valeur de la section
    tient à ce que sa source ne le soit pas.
    """
    row = conn.execute(
        "select "
        " count(*) filter (where action_class = any(%s)) as critical, "
        " count(*) filter (where action_class = any(%s) and decision = any(%s)) as reviewed, "
        " count(*) filter (where decision = 'hitl_approved') as approved, "
        " count(*) filter (where decision = 'hitl_denied') as refused, "
        " count(*) filter (where decision = 'expired') as expired, "
        " count(*) filter (where decision = 'hitl_pending') as pending "
        "from audit_log",
        (list(_GATED_CLASSES), list(_GATED_CLASSES), list(_HUMAN_DECISIONS)),
    ).fetchone()
    critical, reviewed, approved, refused, expired, pending = (
        (int(v) for v in row) if row else (0, 0, 0, 0, 0, 0)
    )
    return {
        "critical_actions": critical,
        "under_human_review": reviewed,
        "approved": approved,
        "refused": refused,
        "expired_unanswered": expired,
        "awaiting_review": pending,
        "source": "chained audit log",
        "attests": (
            "Qu'une action de classe critique a été soumise à un humain, horodatée et "
            "attribuée dans un journal inaltérable. Pas la qualité de la décision "
            "prise : xSOM n'évalue aucun modèle et ne score aucune hallucination."
        ),
    }


def prompt_guard_attestation(conn: psycopg.Connection, settings: Any = None) -> dict[str, Any]:
    """`FR-193` — attester la **présence** du garde-prompt tiers (`M-01/attestation`).

    Le compte des verdicts chaînés est lu dans le journal, pas dans la configuration :
    un garde déclaré actif qui n'a jamais rendu un verdict est un garde qui ne tourne
    pas, et un `configured: true` seul ne le dirait pas. C'est la même exigence de
    fraîcheur que `corpora` impose aux déclarations de provenance.
    """
    rows = conn.execute(
        "select decision, count(*) from audit_log where decision = any(%s) group by decision",
        ([prompt_guard.FLAGGED, prompt_guard.CLEAN, prompt_guard.UNAVAILABLE],),
    ).fetchall()
    seen = {decision: int(n) for decision, n in rows}
    enabled = bool(getattr(settings, "prompt_guard_enabled", False))
    provider = str(getattr(settings, "mistral_model", "")) if enabled else ""
    return prompt_guard.attestation_section(enabled=enabled, provider=provider, seen=seen)


def _shadow_ai_section(conn: psycopg.Connection) -> dict[str, Any]:
    """`FR-189` — l'inventaire déposé, ou l'aveu qu'il n'y en a pas."""
    courant = shadow_ai.current(conn)
    if courant is None:
        return shadow_ai.attestation_section(None)
    inventory, window = courant
    return shadow_ai.attestation_section(inventory, window=window)


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


def observation_disclosure(conn: psycopg.Connection, tenant_id: str | None) -> dict[str, Any]:
    """Periods during which enforcement was relaxed, disclosed with the proof (`FR-179`).

    An observation window stands the gateway down on one agent for a bounded time.
    That is a legitimate, attributed, opt-in operation — and it is exactly the kind
    of fact a supervision proof must carry rather than average away. A pack that
    reported human-oversight coverage across a period containing an unenforced
    window would be answering a narrower question than the one being asked.

    `AD-27.2` bounds the exposure and the pack says so: no window ever relaxed an
    irreversible action or an external send. The disclosure exists so that limit is
    read together with the numbers, not discovered afterwards.
    """
    row = conn.execute(
        "select count(*), count(distinct gateway_token_id), min(opened_at), "
        " max(coalesce(closed_at, expires_at)), "
        " count(*) filter (where closed_at is null and expires_at > now()) "
        "from monitor_windows"
    ).fetchone()
    windows, agents, first, last, running = row if row else (0, 0, None, None, 0)

    seen = conn.execute(
        "select count(*), count(*) filter (where decision like 'monitor\\_%%') "
        "from audit_log where enforcement_mode = %s",
        (EnforcementMode.observing.value,),
    ).fetchone()
    observed_calls, relaxed_calls = (seen[0], seen[1]) if seen else (0, 0)

    if not windows:
        statement = (
            "Enforcement was active throughout: no observation window was ever opened "
            "for this tenant."
        )
    else:
        statement = (
            f"{windows} observation window(s) over {agents} agent(s) relaxed enforcement "
            f"for a bounded period. {observed_calls} call(s) were decided under one, of "
            f"which {relaxed_calls} were let through and recorded rather than enforced. "
            f"No window ever covered "
            f"{', '.join(sorted(c.value for c in NEVER_OBSERVED))}: those actions were "
            "blocked throughout. Decisions taken under a window are not evidence of "
            "enforcement and are excluded from the oversight figures above."
        )
    return {
        "windows": int(windows),
        "agents_observed": int(agents),
        "still_running": int(running),
        "from": first.isoformat() if first else None,
        "to": last.isoformat() if last else None,
        "calls_decided_under_observation": int(observed_calls),
        "calls_let_through": int(relaxed_calls),
        "never_relaxed": sorted(c.value for c in NEVER_OBSERVED),
        "statement": statement,
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


#: Les sections que l'Evidence Pack produit, en chemins `article.section`.
#:
#: La généralisation de `CM-7` aux modes `D`/`O`/`A` a besoin d'un vocabulaire fermé :
#: une facette `Attesté` déclare la section qui la porte, et le générateur de carte
#: refuse une section absente d'ici. Sans cela, « Attesté » se revendique en écrivant
#: un mot dans un YAML — ce qui est exactement la revendication non gardée que le
#: produit existe pour ne pas commettre.
#:
#: `tests/test_compliance.py` compare cette liste au pack **réellement construit**,
#: donc elle ne peut pas dériver de ce que le code produit.
EVIDENCE_SECTIONS: frozenset[str] = frozenset(
    {
        "article_12_record_keeping.tamper_evident",
        "article_12_record_keeping.verification",
        "article_14_human_oversight.scope",
        "article_14_human_oversight.observation",
        "article_14_human_oversight.critical_decision_review",
        "article_26_deployer.decision_summary",
        "article_26_deployer.fria",
        "article_26_deployer.corpus_provenance",
        "article_26_deployer.third_party_verdicts",
        "article_26_deployer.prompt_guard",
        "article_26_deployer.shadow_ai",
    }
)


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
    settings: Any = None,
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
            # FR-179: an unenforced period does not get to sit silently inside a
            # supervision proof. It is disclosed with the figures it affects.
            "observation": observation_disclosure(conn, tenant_id),
            # `FR-192` : l'attestation de revue humaine sur les décisions critiques.
            # Elle vit sous l'article 14 parce que c'est l'article de la supervision,
            # et elle porte sa propre limite — ce qu'elle n'atteste pas.
            "critical_decision_review": critical_decision_review(conn),
        },
        "article_26_deployer": {
            "decision_summary": base["summary"],
            "fria": fria_scaffold(base["summary"]),
            # FR-184 : la provenance des corpus est une **déclaration** de
            # l'exploitant, et l'article 26 est l'endroit où ses obligations
            # atterrissent. Elle voyage avec sa péremption : « 12 corpus déclarés »
            # sans dire que sept n'ont pas été revus depuis deux ans transformerait
            # une attestation en argument.
            "corpus_provenance": corpora.provenance_section(conn),
            # `FR-191` : les verdicts d'analyseurs tiers reçus du client. Sous
            # l'article 26 parce que ce sont les obligations de l'**exploitant** qui
            # y atterrissent, et que ces contrôles sont les siens : ils tournent dans
            # sa CI, avec ses règles. Nous n'en attestons que la réception.
            "third_party_verdicts": verdicts.provenance_section(conn),
            # `FR-193` : la présence du garde-prompt, attestée depuis le journal.
            "prompt_guard": prompt_guard_attestation(conn, settings),
            # `FR-189` : l'inventaire du Shadow AI, dérivé d'un extrait fourni par
            # l'exploitant. Absent, il est publié **comme absent** : le silence se
            # lirait « aucun Shadow AI », qui est l'inverse de la vérité.
            "shadow_ai": _shadow_ai_section(conn),
        },
    }
    base["compliant"] = (
        integrity["ok"] and coverage["coverage_ok"] and retention_floor_days >= MIN_RETENTION_DAYS
    )
    return base

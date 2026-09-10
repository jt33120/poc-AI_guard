"""EU AI Act compliance plane (M9): retention guard, chain integrity, oversight."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from core import approvals, audit, compliance
from tests.conftest import DBHandle

# `log_event` requires the ingestion adapter to name its door (FR-160). These
# tests exercise the audit store itself, not a door, so they all state the same
# one; the tests that care which door it was assert on it explicitly.
_ORIGIN = audit.Origin.mcp_gateway()

_TENANT = "00000000-0000-0000-0000-000000000001"  # usage_events.tenant_id is uuid


def _old_usage(db: DBHandle, *, days: int, n: int = 1) -> None:
    db.conn.execute(
        "insert into tenants (id, name) values (%s, 'A') on conflict do nothing", (_TENANT,)
    )
    for _ in range(n):
        db.conn.execute(
            "insert into usage_events "
            "(tenant_id, provider, model, prompt_tokens, completion_tokens, total_tokens, "
            " cost_usd, ts) "
            "values (%s, 'openai', 'gpt', 1, 1, 2, 0.0, now() - make_interval(days => %s))",
            (_TENANT, days),
        )
    db.conn.commit()


# --- retention guard (pure) --------------------------------------------------
def test_guard_retention_refuses_below_floor() -> None:
    with pytest.raises(compliance.RetentionError):
        compliance.guard_retention(100, floor=183)


def test_guard_retention_allows_at_or_above_floor() -> None:
    compliance.guard_retention(183, floor=183)  # no raise
    compliance.guard_retention(365, floor=183)


# --- enforced retention purge (operational data only) ------------------------
def test_enforce_retention_purge_deletes_above_floor(db: DBHandle) -> None:
    _old_usage(db, days=400)
    removed = compliance.enforce_retention_purge(db.conn, days=365, floor=183)
    db.conn.commit()
    assert removed == 1


def test_enforce_retention_purge_refuses_below_floor(db: DBHandle) -> None:
    _old_usage(db, days=400)
    with pytest.raises(compliance.RetentionError):
        compliance.enforce_retention_purge(db.conn, days=100, floor=183)
    remaining = db.conn.execute("select count(*) from usage_events").fetchone()
    assert remaining is not None and remaining[0] == 1  # nothing deleted


# --- article 12: chain integrity --------------------------------------------
def test_chain_integrity_reports_ok(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="allow", tool_name="a.b", origin=_ORIGIN)
    audit.log_event(db.conn, tenant_id="t1", decision="deny", tool_name="a.c", origin=_ORIGIN)
    result = compliance.chain_integrity(db.conn, "t1")
    assert result["ok"] is True and result["entries"] == 2 and result["first_broken_id"] is None


def test_chain_integrity_reports_tampering(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="allow", tool_name="a.b", origin=_ORIGIN)
    audit.log_event(db.conn, tenant_id="t1", decision="allow", tool_name="a.c", origin=_ORIGIN)
    with db.conn.transaction():
        db.conn.execute("set local session_replication_role = replica")
        db.conn.execute(
            "update audit_log set decision = 'deny' where id = (select min(id) from audit_log)"
        )
    result = compliance.chain_integrity(db.conn, "t1")
    assert result["ok"] is False and result["first_broken_id"] is not None


# --- article 14: human oversight coverage -----------------------------------
def test_oversight_flags_auto_allowed_irreversible(db: DBHandle) -> None:
    # An irreversible action that was auto-allowed = an oversight gap.
    audit.log_event(
        db.conn, tenant_id="t1", decision="allow", action_class="irreversible", origin=_ORIGIN
    )
    coverage = compliance.oversight_coverage(db.conn)
    assert coverage["gated"] == 1 and coverage["auto_allowed"] == 1
    assert coverage["coverage_ok"] is False


def test_oversight_ok_when_gated_by_human(db: DBHandle) -> None:
    audit.log_event(
        db.conn,
        tenant_id="t1",
        decision="hitl_approved",
        action_class="irreversible",
        origin=_ORIGIN,
    )
    audit.log_event(db.conn, tenant_id="t1", decision="allow", action_class="read", origin=_ORIGIN)
    coverage = compliance.oversight_coverage(db.conn)
    assert coverage["auto_allowed"] == 0 and coverage["coverage_ok"] is True


# --- readiness status --------------------------------------------------------
def test_status_ready_when_clean(db: DBHandle) -> None:
    audit.log_event(
        db.conn,
        tenant_id="t1",
        decision="hitl_approved",
        action_class="irreversible",
        origin=_ORIGIN,
    )
    st = compliance.status(db.conn, "t1", retention_floor_days=183)
    assert st["chain_ok"] is True and st["oversight_coverage_ok"] is True
    assert st["retention_ok"] is True and st["ready"] is True
    assert st["oldest_entry_age_days"] is not None and st["oldest_entry_age_days"] >= 0


def test_status_not_ready_when_retention_floor_too_low(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="allow", action_class="read", origin=_ORIGIN)
    st = compliance.status(db.conn, "t1", retention_floor_days=90)
    assert st["retention_ok"] is False and st["ready"] is False


# --- article 26 / evidence pack ---------------------------------------------
def test_evidence_pack_carries_article_mapping(db: DBHandle) -> None:
    audit.log_event(
        db.conn,
        tenant_id="t1",
        decision="hitl_approved",
        action_class="irreversible",
        origin=_ORIGIN,
    )
    events = audit.list_events(db.conn)
    pack = compliance.build_evidence_pack(
        db.conn, tenant_id="t1", events=events, approvals=[], retention_floor_days=183
    )
    assert pack["standard"].startswith("EU AI Act")
    articles = pack["articles"]
    assert articles["article_12_record_keeping"]["tamper_evident"] is True
    assert "coverage_ok" in articles["article_14_human_oversight"]
    assert "fria" in articles["article_26_deployer"]
    assert pack["compliant"] is True


def test_the_declared_sections_are_the_ones_the_pack_produces(db: DBHandle) -> None:
    """`EVIDENCE_SECTIONS` est un contrat, pas un commentaire.

    Une facette `Attesté` déclare la section d'Evidence Pack qui la porte, et le
    générateur de carte refuse une section absente de cette liste. La liste doit donc
    correspondre à ce que le pack **produit réellement** : une section qu'on y écrit
    sans l'implémenter rendrait une revendication `Attesté` vérifiable contre une
    constante au lieu du produit.

    L'inclusion va dans un seul sens, délibérément : le pack peut porter des blocs que
    la carte ne revendique pas (une facette n'a pas à exister pour chaque section),
    mais aucune section déclarée ne peut manquer du pack.
    """
    pack = compliance.build_evidence_pack(
        db.conn, tenant_id="t1", events=[], approvals=[], retention_floor_days=183
    )
    reels = {
        f"{article}.{section}" for article, blocs in pack["articles"].items() for section in blocs
    }
    manquantes = compliance.EVIDENCE_SECTIONS - reels
    assert not manquantes, (
        f"sections déclarées que le pack ne produit pas : {sorted(manquantes)}. "
        "Soit la section est à implémenter, soit la déclaration est à retirer — une "
        "facette « Attesté » adossée à une section absente est une revendication vide."
    )


def test_an_emptied_journal_is_not_reported_as_ready(db: DBHandle) -> None:
    """L'attestation qui disait que tout allait bien sur un journal anéanti.

    `verify_chain` sur zéro ligne ne parcourt rien, donc ne trouve aucune rupture :
    `ok=True`. Combiné à `oversight_coverage`, dont le `coverage_ok` est
    `auto_allowed == 0` — vrai aussi quand il n'y a **aucune** ligne —, le dossier
    sortait `chain_ok: true`, `ready: true`. Le trou TRUNCATE que `0028` referme
    rendait cet état atteignable en une commande.

    Le témoin est mécanique : toute approbation naît d'un `hitl_pending` écrit dans
    `audit_log`. Des approbations sans une seule ligne de journal n'est pas un état
    que le produit sait produire.

    `chain_ok` reste **vrai** — la chaîne est cohérente, et c'est exactement ce qui
    rendait l'anomalie invisible. Elle sort dans son propre champ.
    """
    tenant_id = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant_id,))
    approvals.create(
        db.conn,
        tenant_id=tenant_id,
        request_id=uuid4().hex,
        tool_name="crm.delete",
        action_class="irreversible",
        ah="h",
        arguments_summary={},
        dry_run={},
        required_count=1,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
        requested_by=None,
    )
    db.conn.commit()

    etat = compliance.status(db.conn, tenant_id)

    assert etat["entries"] == 0
    assert etat["chain_ok"] is True, "la chaîne EST cohérente — c'est le piège"
    assert etat["journal_missing"] is True
    assert etat["ready"] is False


def test_a_brand_new_tenant_is_not_accused_of_losing_its_journal(db: DBHandle) -> None:
    """L'erreur symétrique, et pourquoi `chain_ok` ne doit pas mentir.

    Zéro ligne est l'état normal d'un client le jour de son inscription. Un garde qui
    répondrait « journal disparu » à un tenant neuf rendrait un démarrage
    indistinguable d'un effacement — et serait désactivé dans la semaine.
    """
    tenant_id = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'B')", (tenant_id,))
    db.conn.commit()

    etat = compliance.status(db.conn, tenant_id)

    assert etat["entries"] == 0
    assert etat["journal_missing"] is False
    assert etat["ready"] is True

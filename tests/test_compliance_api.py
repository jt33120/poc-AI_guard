"""Control API: EU AI Act compliance status + evidence pack export (M9)."""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import audit, compliance
from core.config import Settings
from tests.conftest import DBHandle

# `log_event` requires the ingestion adapter to name its door (FR-160). These
# tests exercise the audit store itself, not a door, so they all state the same
# one; the tests that care which door it was assert on it explicitly.
_ORIGIN = audit.Origin.mcp_gateway()


def _client(db_url: str, verifier: TokenVerifier, *, retention_days: int = 183) -> TestClient:
    app = create_app(
        Settings(
            _env_file=None, env="dev", database_url=db_url, audit_retention_days=retention_days
        )
    )
    app.state.verifier = verifier
    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _tenant(db: DBHandle) -> str:
    tid = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tid,))
    db.conn.commit()
    return str(tid)


def test_status_ready_when_clean(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    audit.log_event(
        db.conn,
        tenant_id=tenant,
        decision="hitl_approved",
        action_class="irreversible",
        origin=_ORIGIN,
    )
    audit.log_event(
        db.conn, tenant_id=tenant, decision="allow", action_class="read", origin=_ORIGIN
    )
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=tenant, role="viewer")

    r = client.get("/v1/compliance/status", headers=_auth(token))
    assert r.status_code == 200
    body = r.json()
    assert body["chain_ok"] is True
    assert body["oversight_coverage_ok"] is True
    assert body["retention_ok"] is True
    assert body["ready"] is True


def test_status_flags_oversight_gap(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    # An irreversible action auto-allowed = an oversight gap -> not ready.
    audit.log_event(
        db.conn, tenant_id=tenant, decision="allow", action_class="irreversible", origin=_ORIGIN
    )
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=tenant, role="viewer")

    body = client.get("/v1/compliance/status", headers=_auth(token)).json()
    assert body["oversight_auto_allowed"] == 1
    assert body["oversight_coverage_ok"] is False
    assert body["ready"] is False


def test_status_not_ready_when_retention_floor_too_low(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    audit.log_event(
        db.conn, tenant_id=tenant, decision="allow", action_class="read", origin=_ORIGIN
    )
    client = _client(db.url, test_verifier, retention_days=90)  # below the 183-day floor
    token = make_token(tenant_id=tenant, role="viewer")

    body = client.get("/v1/compliance/status", headers=_auth(token)).json()
    assert body["retention_floor_days"] == 90
    assert body["retention_ok"] is False
    assert body["ready"] is False


def test_status_is_tenant_isolated(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    audit.log_event(
        db.conn, tenant_id=tenant, decision="allow", action_class="read", origin=_ORIGIN
    )
    client = _client(db.url, test_verifier)
    other = make_token(tenant_id=str(uuid4()), role="viewer")

    reponse = client.get("/v1/compliance/status", headers=_auth(other))

    # **L'isolation est désormais tenue plus tôt, et plus fort.** Ce contrôle
    # vérifiait que RLS rendait zéro ligne à un porteur étranger. Depuis la gamme
    # (`0030`), un tenant que la base ne connaît pas n'a **aucune capacité** — le
    # repli de `load_entitlement` est `AUCUNE` et jamais `free` — donc il n'atteint
    # plus la route du tout. La propriété d'origine tient toujours par en dessous ;
    # celle-ci est simplement celle qui s'exprime en premier.
    assert reponse.status_code == 402, reponse.text


def test_export_json_and_pdf(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    audit.log_event(
        db.conn,
        tenant_id=tenant,
        decision="hitl_approved",
        action_class="irreversible",
        origin=_ORIGIN,
    )
    audit.log_event(
        db.conn, tenant_id=tenant, decision="deny", action_class="external_send", origin=_ORIGIN
    )
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=tenant, role="admin")

    js = client.get("/v1/compliance/export", headers=_auth(token))
    assert js.status_code == 200
    body = js.json()
    assert body["standard"].startswith("EU AI Act")
    assert body["articles"]["article_12_record_keeping"]["tamper_evident"] is True
    assert "fria" in body["articles"]["article_26_deployer"]

    pdf = client.get("/v1/compliance/export?render=pdf", headers=_auth(token))
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:4] == b"%PDF"


def test_export_invalid_render_returns_422(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=tenant, role="admin")
    assert client.get("/v1/compliance/export?render=bogus", headers=_auth(token)).status_code == 422


def _semer(db: DBHandle, tenant: str, combien: int) -> None:
    for i in range(combien):
        audit.log_event(
            db.conn,
            tenant_id=tenant,
            decision="allow" if i % 2 else "deny",
            action_class="read",
            origin=_ORIGIN,
        )
    db.conn.commit()


def test_the_pack_declares_its_truncation_and_counts_the_whole_period(db: DBHandle) -> None:
    """Deux périmètres dans le même dossier, et rien ne le disait.

    `api/compliance.py` lit au plus dix mille événements ; `event_count`, `summary`
    et `ingress_mix` étaient calculés **sur cette tranche**, pendant que
    `chain_integrity` et `oversight_coverage` interrogeaient la table **entière**,
    dans le même dictionnaire. Pour tout tenant qui dépasse, `article_12.entries`
    annonçait l'historique complet et `article_26.decision_summary` n'en résumait
    qu'un bout.

    C'est le seul défaut du dossier qui produit un document **cohérent en
    apparence** : aucune relecture ne voit un chiffre faux, il faut compter. Le
    contrôle n'exerce pas le seuil de dix mille — il exerce la **propriété** : une
    liste plus courte que la période doit se déclarer, et les totaux doivent porter
    sur la période.
    """
    tenant = _tenant(db)
    _semer(db, tenant, 50)
    tranche = audit.list_events(db.conn, limit=10)

    pack = compliance.build_evidence_pack(db.conn, tenant_id=tenant, events=tranche, approvals=[])

    assert pack["events_listed"] == 10
    assert pack["events_total"] == 50
    assert pack["events_truncated"] is True
    assert pack["event_count"] == 50, "le compte annoncé doit être celui de la période"
    assert sum(pack["summary"].values()) == 50, (
        "le résumé de décisions doit fermer sur la période, pas sur la tranche — "
        "sinon `article_26.decision_summary` reste faux une fois la troncature "
        "déclarée, et c'est ce chiffre-là qu'un régulateur lit"
    )
    assert sum(pack["ingress_mix"].values()) == 50


def test_an_untruncated_pack_says_so(db: DBHandle) -> None:
    """Non-vacuité : un dossier qui se déclarerait toujours tronqué ne dirait rien.

    Et c'est le cas courant — la grande majorité des tenants tient sous la tranche.
    Un avertissement permanent serait ignoré au bout d'une semaine.
    """
    tenant = _tenant(db)
    _semer(db, tenant, 5)

    pack = compliance.build_evidence_pack(
        db.conn, tenant_id=tenant, events=audit.list_events(db.conn, limit=100), approvals=[]
    )

    assert pack["events_truncated"] is False
    assert pack["events_total"] == pack["events_listed"] == 5


def test_the_export_route_reads_a_bounded_slice_and_declares_it(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Et la route publie bien les trois champs, pas seulement la fonction.

    Une propriété tenue par `build_evidence_pack` et perdue par son appelant serait
    exactement le genre d'écart que cette session a déjà rencontré deux fois.
    """
    tenant = _tenant(db)
    _semer(db, tenant, 3)
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=tenant, role="admin")

    corps = client.get("/v1/compliance/export", headers=_auth(token)).json()

    assert corps["events_total"] == 3
    assert corps["events_listed"] == 3
    assert corps["events_truncated"] is False


def test_the_window_filters_bound_the_totals_too(db: DBHandle) -> None:
    """Les bornes de période s'appliquent au **compte**, pas seulement à la liste.

    `core/export.py` recopie `from`/`to` dans l'en-tête `range` du dossier. Si le
    compte ignorait ces bornes, l'en-tête annoncerait une période et les chiffres en
    couvriraient une autre — la même faute que la troncature, en plus discret.
    """
    tenant = _tenant(db)
    db.conn.execute(
        "insert into audit_log (ts, tenant_id, decision, ingress, enforcement_mode, "
        " prev_hash, entry_hash) values "
        "('2020-01-01T00:00:00Z', %s, 'allow', 'mcp_gateway', 'enforcing', 'p', 'e1'), "
        "('2030-01-01T00:00:00Z', %s, 'deny', 'mcp_gateway', 'enforcing', 'e1', 'e2')",
        (tenant, tenant),
    )
    db.conn.commit()

    assert audit.count_events(db.conn) == 2
    assert audit.count_events(db.conn, from_ts="2025-01-01T00:00:00Z") == 1
    assert audit.count_events(db.conn, to_ts="2025-01-01T00:00:00Z") == 1

    decisions, _ = audit.tally(db.conn, from_ts="2025-01-01T00:00:00Z")
    assert decisions == {"deny": 1}

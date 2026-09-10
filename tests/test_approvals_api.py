"""Control API for approvals: queue, decision, RBAC, isolation (SPEC §8, M4)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import approval_chain, approvals
from core.config import Settings
from tests.conftest import DBHandle


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _seed_pending(db: DBHandle, tenant_id: str) -> str:
    record = approvals.create(
        db.conn,
        tenant_id=tenant_id,
        request_id=uuid4().hex,
        tool_name="crm.delete_contact",
        action_class="irreversible",
        ah="hash-1",
        arguments_summary={"contact_id": "c1"},
        dry_run={"summary": "Execute crm.delete_contact"},
        required_count=1,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
        requested_by=None,
    )
    db.conn.commit()
    return record.id


def test_list_decide_rbac_and_isolation(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant_a, tenant_b = uuid4(), uuid4()
    db.conn.execute(
        "insert into tenants (id, name) values (%s, 'A'), (%s, 'B')", (tenant_a, tenant_b)
    )
    db.conn.commit()
    approval_id = _seed_pending(db, str(tenant_a))

    client = _client(db.url, test_verifier)
    op_a = make_token(tenant_id=str(tenant_a), role="operator")
    viewer_a = make_token(tenant_id=str(tenant_a), role="viewer")
    admin_b = make_token(tenant_id=str(tenant_b), role="admin")

    # Operator A sees the pending approval (RLS).
    listed = client.get("/v1/approvals?status=pending", headers=_auth(op_a)).json()
    assert [a["id"] for a in listed] == [approval_id]

    # Tenant B sees nothing (isolation).
    assert client.get("/v1/approvals", headers=_auth(admin_b)).json() == []

    # Viewer cannot decide (RBAC).
    forbidden = client.post(
        f"/v1/approvals/{approval_id}/decision",
        headers=_auth(viewer_a),
        json={"decision": "approve"},
    )
    assert forbidden.status_code == 403

    # Tenant B cannot decide A's approval (isolation -> 404).
    cross = client.post(
        f"/v1/approvals/{approval_id}/decision",
        headers=_auth(admin_b),
        json={"decision": "approve"},
    )
    assert cross.status_code == 404

    # Operator A approves -> 200 approved.
    approved = client.post(
        f"/v1/approvals/{approval_id}/decision", headers=_auth(op_a), json={"decision": "approve"}
    )
    assert approved.status_code == 200 and approved.json()["status"] == "approved"

    # Deciding again -> 409 (already decided).
    again = client.post(
        f"/v1/approvals/{approval_id}/decision", headers=_auth(op_a), json={"decision": "deny"}
    )
    assert again.status_code == 409


def test_invalid_status_filter_returns_422(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=str(tenant), role="operator")
    assert client.get("/v1/approvals?status=bogus", headers=_auth(token)).status_code == 422


def _seed_dual(db: DBHandle, tenant_id: str) -> str:
    """A pending approval that needs two distinct humans."""
    record = approvals.create(
        db.conn,
        tenant_id=tenant_id,
        request_id=uuid4().hex,
        tool_name="crm.delete_contact",
        action_class="irreversible",
        ah="hash-dual",
        arguments_summary={"contact_id": "c1"},
        dry_run={"summary": "Execute crm.delete_contact"},
        required_count=2,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
        requested_by=None,
    )
    db.conn.commit()
    return record.id


def test_the_decider_is_the_authenticated_caller_not_the_request(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """`M-08` rests on this: the approver is *who signed the call*, never a claim.

    The property holds today by construction -- `decide()` is handed `user.user_id`
    from the verified token, and `DecisionRequest` forbids extras. Nothing asserted
    it, though, so the day an interactive channel is added (`FR-159`) and passes an
    id along from a payload, no test would notice. This is that assertion.
    """
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    approval_id = _seed_pending(db, str(tenant))
    client = _client(db.url, test_verifier)
    token = make_token(sub="operator-real", tenant_id=str(tenant), role="operator")

    # An attempt to name someone else as the decider is refused outright.
    spoof = client.post(
        f"/v1/approvals/{approval_id}/decision",
        headers=_auth(token),
        json={"decision": "approve", "decided_by": "someone-else"},
    )
    assert spoof.status_code == 422

    assert (
        client.post(
            f"/v1/approvals/{approval_id}/decision",
            headers=_auth(token),
            json={"decision": "approve"},
        ).status_code
        == 200
    )
    approved_by = db.conn.execute(
        "select approved_by from approvals where id = %s", (approval_id,)
    ).fetchone()
    assert approved_by is not None
    assert list(approved_by[0]) == ["operator-real"]


def test_separation_of_duties_counts_authenticated_identities(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """The same human twice is one human -- and the count is of *signed* identities.

    This is the sentence `M-08` states without reservation: the impersonated
    executive cannot approve their own request by pressing the button twice.
    """
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    approval_id = _seed_dual(db, str(tenant))
    client = _client(db.url, test_verifier)
    first = make_token(sub="op-1", tenant_id=str(tenant), role="operator")
    second = make_token(sub="op-2", tenant_id=str(tenant), role="admin")

    def approve(token: str) -> str:
        resp = client.post(
            f"/v1/approvals/{approval_id}/decision",
            headers=_auth(token),
            json={"decision": "approve"},
        )
        assert resp.status_code == 200, resp.text
        return str(resp.json()["status"])

    assert approve(first) == "pending"
    assert approve(first) == "pending"  # the same signature, twice, is still one human
    assert approve(second) == "approved"


def _evenements(db: DBHandle, tenant_id: str) -> list[tuple[str, str, int, int]]:
    return [
        (r[0], r[1], r[2], r[3])
        for r in db.conn.execute(
            "select event, subject, approved_count, required_count "
            "from approval_decision_events where tenant_id = %s order by id",
            (tenant_id,),
        ).fetchall()
    ]


def test_the_human_decision_is_chained_at_the_click_not_at_the_poll(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Le cas le plus net : l'agent ne revient jamais, et la décision existe quand même.

    Avant, cette route n'écrivait **rien** — ni audit, ni chaîne. La ligne
    `hitl_approved` du journal n'apparaissait qu'au *poll* suivant de l'agent. Un
    agent qui plante, qui abandonne, ou dont l'opérateur a coupé le processus
    emportait donc avec lui la seule trace de l'approbation humaine d'une action
    irréversible ; il ne restait qu'une ligne dans `approvals`, une file de travail
    qu'un `update` réécrit.

    Ce contrôle n'appelle jamais `poll`. C'est tout son objet : un test qui approuve
    *puis* interroge ne distingue pas les deux mondes.
    """
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    approval_id = _seed_pending(db, str(tenant))
    client = _client(db.url, test_verifier)
    token = make_token(sub="op-chaine", tenant_id=str(tenant), role="operator")

    resp = client.post(
        f"/v1/approvals/{approval_id}/decision", headers=_auth(token), json={"decision": "approve"}
    )
    assert resp.status_code == 200

    assert _evenements(db, str(tenant)) == [("approved", "op-chaine", 1, 1)]
    assert approval_chain.verify_chain(db.conn, str(tenant)).ok is True


def test_a_refusal_is_chained_too_and_names_its_author(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Le refus est la moitié qu'on oublie, et c'est celle qu'on conteste.

    « Pourquoi mon agent n'a-t-il pas pu faire X » est la question que l'on pose
    après coup, et elle a besoin de la même trace que l'approbation.
    """
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    approval_id = _seed_pending(db, str(tenant))
    client = _client(db.url, test_verifier)
    token = make_token(sub="op-refus", tenant_id=str(tenant), role="operator")

    client.post(
        f"/v1/approvals/{approval_id}/decision", headers=_auth(token), json={"decision": "deny"}
    )

    assert _evenements(db, str(tenant)) == [("denied", "op-refus", 0, 1)]


def test_a_dual_control_approval_chains_each_signature_with_its_quorum(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """`human_dual` doit pouvoir se **prouver**, pas seulement se déclarer.

    Le quorum atteint entre dans la charge hachée à chaque signature : une chaîne
    qui ne porterait que « approuvé » ne distinguerait pas une action levée par deux
    personnes d'une action levée par une seule dont le compteur a été retouché.

    La seconde signature du même humain n'écrit rien de plus au quorum — c'est la
    même propriété que `test_separation_of_duties_counts_authenticated_identities`,
    vue depuis la chaîne.
    """
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    approval_id = _seed_dual(db, str(tenant))
    client = _client(db.url, test_verifier)
    premier = make_token(sub="op-1", tenant_id=str(tenant), role="operator")
    second = make_token(sub="op-2", tenant_id=str(tenant), role="admin")

    for jeton in (premier, second):
        assert (
            client.post(
                f"/v1/approvals/{approval_id}/decision",
                headers=_auth(jeton),
                json={"decision": "approve"},
            ).status_code
            == 200
        )

    assert _evenements(db, str(tenant)) == [
        ("approved", "op-1", 1, 2),
        ("approved", "op-2", 2, 2),
    ]
    assert approval_chain.verify_chain(db.conn, str(tenant)).ok is True


def test_the_decision_chain_refuses_to_be_rewritten(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """La table est append-only, sinon elle ne vaut pas mieux que celle qu'elle double.

    Toute la raison d'être de cette chaîne est que `approvals` est mutable par
    conception. Une seconde table mutable n'aurait rien apporté.
    """
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    approval_id = _seed_pending(db, str(tenant))
    client = _client(db.url, test_verifier)
    client.post(
        f"/v1/approvals/{approval_id}/decision",
        headers=_auth(make_token(sub="op-1", tenant_id=str(tenant), role="operator")),
        json={"decision": "approve"},
    )

    for sql in (
        "update approval_decision_events set subject = 'quelqun-dautre'",
        "delete from approval_decision_events",
        "truncate approval_decision_events",
    ):
        with pytest.raises(psycopg.errors.RaiseException):
            db.conn.execute(sql)
        db.conn.rollback()

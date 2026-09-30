"""La salle de supervision compte toute la fenêtre, en SQL, et ne voit que son tenant.

La vue d'ensemble comptait les refus dans le navigateur, sur les 500 dernières lignes :
« les refus de la semaine » y voulait dire « les refus du dernier lot chargé ». Ces
tests fixent ce que `/v1/supervision` promet à la place : la même partition que le
dossier de conformité, des séries sans trou, des mesures de la garde elle-même, les
objectifs du PRD pour les approbations, et une chaîne d'audit recalculée.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import approvals, audit, supervision
from core.config import Settings
from tests.conftest import DBHandle

_ORIGIN = audit.Origin.mcp_gateway()


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _tenant(db: DBHandle, name: str) -> tuple[str, str]:
    tid, gid = uuid4(), uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, %s)", (tid, name))
    db.conn.execute(
        "insert into gateway_tokens (id, tenant_id, name, token_hash) values (%s, %s, 'bot', %s)",
        (gid, tid, f"hash-{gid}"),
    )
    return str(tid), str(gid)


def _event(
    db: DBHandle,
    tid: str,
    decision: str,
    *,
    tool: str = "crm.read",
    action_class: str = "read",
    agent: str | None = None,
    decision_ms: int | None = None,
) -> None:
    audit.log_event(
        db.conn,
        tenant_id=tid,
        decision=decision,
        tool_name=tool,
        action_class=action_class,
        gateway_token_id=agent,
        decision_ms=decision_ms,
        origin=_ORIGIN,
    )


def _approval(db: DBHandle, tid: str, *, expires_in: timedelta) -> str:
    record = approvals.create(
        db.conn,
        tenant_id=tid,
        request_id=f"req-{uuid4()}",
        tool_name="mail.send",
        action_class="external_send",
        ah="hash",
        arguments_summary={},
        dry_run={},
        required_count=1,
        expires_at=datetime.now(UTC) + expires_in,
        requested_by=None,
    )
    return str(record.id)


def _seed(db: DBHandle) -> tuple[str, str]:
    tid, gid = _tenant(db, "SUP")
    for ms in (10, 20, 30):
        _event(db, tid, "allow", agent=gid, decision_ms=ms)
    _event(db, tid, "notify", tool="mail.send", action_class="external_send", agent=gid)
    _event(db, tid, "hitl_pending", tool="db.drop", action_class="irreversible", agent=gid)
    _event(db, tid, "hitl_approved", tool="db.drop", action_class="irreversible", agent=gid)
    _event(db, tid, "deny", tool="db.drop", action_class="irreversible", agent=gid)
    _event(db, tid, "deny", tool="fs.delete", action_class="write")
    _event(db, tid, "monitor_deny", tool="fs.delete", action_class="write")

    quick = _approval(db, tid, expires_in=timedelta(hours=1))
    slow = _approval(db, tid, expires_in=timedelta(hours=1))
    _approval(db, tid, expires_in=timedelta(seconds=-1))  # left to expire
    _approval(db, tid, expires_in=timedelta(hours=1))  # still waiting
    db.conn.execute(
        "update approvals set status = 'approved', decided_at = created_at + interval '2 seconds'"
        " where id = %s",
        (quick,),
    )
    db.conn.execute(
        "update approvals set status = 'denied', decided_at = created_at + interval '400 seconds'"
        " where id = %s",
        (slow,),
    )
    db.conn.commit()
    return tid, gid


def test_the_whole_window_is_counted_with_the_compliance_partition(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid, _ = _seed(db)
    body = (
        _client(db.url, test_verifier)
        .get("/v1/supervision?window=24h", headers=_auth(make_token(tenant_id=tid)))
        .json()
    )
    assert body["total"] == 9
    assert body["buckets"] == {
        "auto_allowed": 3,
        "allowed_with_notice": 1,
        "held_for_human": 1,
        "human_approved": 1,
        "refused": 2,
        "guard_recorded": 0,
        "observed_not_enforced": 1,
        "not_inspected": 0,
        "unclassified": 0,
    }
    assert body["step_seconds"] == 3600
    assert len(body["series"]) == 24
    for name, count in body["buckets"].items():
        assert sum(point["buckets"][name] for point in body["series"]) == count


def test_the_guard_measures_itself(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid, _ = _seed(db)
    latency = (
        _client(db.url, test_verifier)
        .get("/v1/supervision", headers=_auth(make_token(tenant_id=tid)))
        .json()["latency"]
    )
    assert latency["samples"] == 3
    assert latency["p50"] == 20.0
    assert 20.0 < latency["p95"] <= 30.0
    assert sum(point["samples"] for point in latency["series"]) == 3


def test_where_the_guard_intervenes(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid, gid = _seed(db)
    body = (
        _client(db.url, test_verifier)
        .get("/v1/supervision", headers=_auth(make_token(tenant_id=tid)))
        .json()
    )
    classes = {c["action_class"]: c for c in body["classes"]}
    assert [c["action_class"] for c in body["classes"]] == [
        "read",
        "write",
        "external_send",
        "irreversible",
    ]
    assert classes["irreversible"]["buckets"]["refused"] == 1
    assert classes["irreversible"]["total"] == 3
    assert body["tools"][0] == {"tool": "db.drop", "total": 3, "held": 2, "refused": 1}
    assert body["agents"] == [
        {
            "id": gid,
            "name": "bot",
            "total": 7,
            "held": 2,
            "refused": 1,
            "last_active": body["agents"][0]["last_active"],
        }
    ]


def test_approvals_are_measured_against_the_prd_targets(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid, _ = _seed(db)
    stats = (
        _client(db.url, test_verifier)
        .get("/v1/supervision", headers=_auth(make_token(tenant_id=tid)))
        .json()["approvals"]
    )
    assert (stats["created"], stats["approved"], stats["denied"]) == (4, 1, 1)
    assert (stats["expired"], stats["pending"], stats["pending_now"]) == (1, 1, 1)
    assert stats["median_decision_s"] == pytest.approx(201.0)
    assert stats["rubber_stamps"] == 1
    assert stats["expiry_rate"] == pytest.approx(1 / 3, abs=1e-4)
    assert [b["count"] for b in stats["histogram"]] == [1, 0, 0, 1, 0, 0]
    assert stats["targets"] == {
        "median_decision_s": 300.0,
        "expiry_rate": 0.1,
        "rubber_stamp_s": 5.0,
    }


def test_the_probes_recompute_the_chain(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid, _ = _seed(db)
    probes = (
        _client(db.url, test_verifier)
        .get("/v1/supervision", headers=_auth(make_token(tenant_id=tid)))
        .json()["probes"]
    )
    assert probes["chain_ok"] is True
    assert probes["chain_entries"] == 9
    assert probes["chain_broken_id"] is None
    assert probes["database_ms"] >= 0
    assert probes["last_event_at"] is not None


def test_another_tenant_sees_none_of_it(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    _seed(db)
    other, _ = _tenant(db, "OTHER")
    db.conn.commit()
    body = (
        _client(db.url, test_verifier)
        .get("/v1/supervision?window=30d", headers=_auth(make_token(tenant_id=other)))
        .json()
    )
    assert body["total"] == 0
    assert body["agents"] == [] and body["tools"] == []
    assert body["approvals"]["created"] == 0
    assert body["probes"]["chain_entries"] == 0


def test_scope_to_one_agent(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid, gid = _seed(db)
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=tid)
    scoped = client.get(f"/v1/supervision?agent_id={gid}", headers=_auth(token)).json()
    assert scoped["total"] == 7
    empty = client.get(f"/v1/supervision?agent_id={uuid4()}", headers=_auth(token)).json()
    assert empty["total"] == 0


@pytest.mark.parametrize("query", ["window=90d", "window=", "agent_id=not-a-uuid", "client_id=1"])
def test_bounded_inputs(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str], query: str
) -> None:
    tid, _ = _seed(db)
    response = _client(db.url, test_verifier).get(
        f"/v1/supervision?{query}", headers=_auth(make_token(tenant_id=tid))
    )
    assert response.status_code == 422


def test_requires_a_session(db: DBHandle, test_verifier: TokenVerifier) -> None:
    assert _client(db.url, test_verifier).get("/v1/supervision").status_code == 401


@pytest.mark.parametrize(("window", "points"), [("24h", 24), ("7d", 28), ("30d", 30)])
def test_every_window_is_aligned_and_complete(window: supervision.Window, points: int) -> None:
    moment = datetime(2026, 9, 28, 17, 42, 5, tzinfo=UTC)
    start, end, step = supervision.bounds(window, moment)
    assert start < moment < end
    assert (end - start) / step == points
    assert end - moment <= step


def test_a_point_covers_the_step_its_events_fell_in(db: DBHandle) -> None:
    tid, _ = _seed(db)
    later = datetime.now(UTC) + timedelta(hours=3)
    report = supervision.build(db.conn, tenant_id=tid, window="24h", now=later)
    nonempty = [p for p in report.series if sum(p.buckets.values())]
    assert len(nonempty) == 1
    assert report.series.index(nonempty[0]) in (20, 21)

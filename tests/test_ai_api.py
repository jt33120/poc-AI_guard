"""AI observability API: OTLP ingestion, idempotency, summary shape, retention."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import usage as usage_store
from core.config import Settings
from tests.conftest import DBHandle


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _tenant(db: DBHandle) -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'P')", (tid,))
    db.conn.commit()
    return tid


def _otlp(
    *,
    span_id: str,
    provider: str = "openai",
    model: str = "gpt-4o",
    operation: str = "chat",
    route: str = "/v1/chat",
    session_id: str | None = None,
    app: str | None = None,
    in_tok: int = 1000,
    out_tok: int = 500,
    latency_ms: float = 250.0,
) -> dict[str, Any]:
    start = int(time.time() * 1e9)
    attrs = [
        ("gen_ai.system", {"stringValue": provider}),
        ("gen_ai.request.model", {"stringValue": model}),
        ("gen_ai.operation.name", {"stringValue": operation}),
        ("gen_ai.route", {"stringValue": route}),
        ("gen_ai.usage.input_tokens", {"intValue": str(in_tok)}),
        ("gen_ai.usage.output_tokens", {"intValue": str(out_tok)}),
    ]
    span: dict[str, Any] = {
        "name": "gen_ai.chat",
        "spanId": span_id,
        "traceId": "tr1",
        "startTimeUnixNano": str(start),
        "endTimeUnixNano": str(start + int(latency_ms * 1e6)),
        "attributes": [{"key": k, "value": v} for k, v in attrs],
    }
    if session_id is not None:
        span["traceState"] = f"mip=s:{session_id}"
    resource = [{"key": "mip.app_id", "value": {"stringValue": app}}] if app else []
    return {
        "resourceSpans": [{"resource": {"attributes": resource}, "scopeSpans": [{"spans": [span]}]}]
    }


def _token(client: TestClient, admin: str) -> str:
    return client.post(
        "/v1/gateway-tokens", headers={"Authorization": f"Bearer {admin}"}, json={"name": "backend"}
    ).json()["token"]


def test_ingest_is_idempotent_on_span_id(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    raw = _token(client, admin)

    payload = _otlp(span_id="span-a")
    first = client.post("/v1/ai-traces", headers={"X-Gateway-Token": raw}, json=payload)
    assert first.status_code == 200 and first.json() == {"ingested": 1, "rejected": 0}
    # Same span again → deduped.
    again = client.post("/v1/ai-traces", headers={"X-Gateway-Token": raw}, json=payload)
    assert again.json() == {"ingested": 0, "rejected": 0}

    with psycopg.connect(db.url) as check:
        row = check.execute(
            "select source, provider, model, total_tokens, latency_ms, status, operation "
            "from usage_events where tenant_id = %s and span_id = 'span-a'",
            (tid,),
        ).fetchone()
    assert row is not None
    assert row[0] == "otlp" and row[1] == "openai" and row[2] == "gpt-4o"
    assert row[3] == 1500 and float(row[4]) == 250.0 and row[5] == "ok" and row[6] == "chat"


def test_ingest_requires_gateway_token(db: DBHandle, test_verifier: TokenVerifier) -> None:
    client = _client(db.url, test_verifier)
    resp = client.post("/v1/ai-traces", json=_otlp(span_id="x"))
    assert resp.status_code == 401


def test_summary_shape_from_ingested_calls(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    raw = _token(client, admin)
    client.post("/v1/ai-traces", headers={"X-Gateway-Token": raw}, json=_otlp(span_id="s1"))
    client.post(
        "/v1/ai-traces",
        headers={"X-Gateway-Token": raw},
        json=_otlp(span_id="s2", model="gpt-4o-mini", in_tok=200, out_tok=100),
    )

    body = client.get(
        "/v1/ai/summary?window=30d", headers={"Authorization": f"Bearer {admin}"}
    ).json()
    assert body["ai_calls"] == 2
    assert body["ai_tokens"] == 1800  # (1000+500) + (200+100)
    assert body["ai_cost_usd"] > 0
    assert body["ai_p75_latency_ms"] == 250.0
    assert body["ai_error_rate"] == 0.0
    models = {m["model"] for m in body["ai_by_model"]}
    assert models == {"gpt-4o", "gpt-4o-mini"}
    op = body["ai_by_operation"][0]
    assert op["operation"] == "chat" and op["route"] == "/v1/chat"
    # Quality signals are not wired yet → explicitly null (never omitted).
    assert op["regen_rate"] is None and op["csat"] is None and op["anomaly"] is False
    assert len(body["ai_series"]) == 1


def test_summary_defaults_window_and_empty_is_zero(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    body = client.get("/v1/ai/summary", headers={"Authorization": f"Bearer {admin}"}).json()
    assert body["window"] == "30d" and body["ai_calls"] == 0 and body["ai_by_model"] == []


def test_ai_detail_and_costs_endpoints(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    raw = _token(client, admin)
    client.post("/v1/ai-traces", headers={"X-Gateway-Token": raw}, json=_otlp(span_id="d1"))
    client.post(
        "/v1/ai-traces",
        headers={"X-Gateway-Token": raw},
        json=_otlp(span_id="d2", route="/v1/embeddings", operation="embeddings"),
    )
    auth = {"Authorization": f"Bearer {admin}"}

    detail = client.get("/v1/ai?window=7d&recent=10", headers=auth).json()
    assert detail["overview"]["calls"] == 2
    assert {b["route"] for b in detail["by_route"]} == {"/v1/chat", "/v1/embeddings"}
    assert len(detail["recent"]) == 2
    assert detail["recent"][0]["status"] == "ok"

    costs = client.get("/v1/ai/costs?group_by=route", headers=auth).json()
    assert costs["group_by"] == "route"
    assert {r["key"] for r in costs["rows"]} == {"/v1/chat", "/v1/embeddings"}
    # An unknown group_by falls back to model (allowlist), never injects.
    bad = client.get("/v1/ai/costs?group_by=DROP", headers=auth).json()
    assert bad["group_by"] == "model"


def test_anomalies_empty_on_sparse_data(db: DBHandle) -> None:
    from core import ai_summary

    # The z-score baseline needs >=3 prior *complete* days; today's rows are excluded,
    # so with no history the query returns empty — and, crucially, never raises.
    with psycopg.connect(db.url) as conn:
        assert ai_summary.anomalies(conn) == {}


def test_app_filter_and_read_token_auth(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    raw = _token(client, admin)
    auth = {"Authorization": f"Bearer {admin}"}
    # Two apps' calls under the same tenant.
    gw = {"X-Gateway-Token": raw}
    client.post("/v1/ai-traces", headers=gw, json=_otlp(span_id="a1", app="uti"))
    client.post("/v1/ai-traces", headers=gw, json=_otlp(span_id="b1", app="other"))

    # Mint a server-to-server read token (shown once).
    minted = client.post("/v1/read-tokens", headers=auth, json={"name": "mip-rum"})
    read_tok = minted.json()["token"]
    assert read_tok.startswith("xsr_")
    s2s = {"Authorization": f"Bearer {read_tok}"}

    # The read token authorizes /ai/summary and ?app= scopes to one app.
    uti = client.get("/v1/ai/summary?app=uti", headers=s2s).json()
    assert uti["ai_calls"] == 1
    both = client.get("/v1/ai/summary", headers=s2s).json()
    assert both["ai_calls"] == 2  # no app filter → the whole tenant

    # A read token cannot ingest (it's read-only): not in gateway_tokens → 401.
    ingest = client.post(
        "/v1/ai-traces", headers={"X-Gateway-Token": read_tok}, json=_otlp(span_id="z")
    )
    assert ingest.status_code == 401
    # Revoking the read token makes it stop working.
    tid_row = client.get("/v1/read-tokens", headers=auth).json()[0]["id"]
    assert client.delete(f"/v1/read-tokens/{tid_row}", headers=auth).status_code == 204
    assert client.get("/v1/ai/summary", headers=s2s).status_code == 401


def test_retention_and_session_erasure(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    raw = _token(client, admin)
    client.post(
        "/v1/ai-traces",
        headers={"X-Gateway-Token": raw},
        json=_otlp(span_id="erase-me", session_id="sess-x"),
    )
    with psycopg.connect(db.url) as conn:
        removed = usage_store.erase_session(conn, session_id="sess-x")
        conn.commit()
        assert removed == 1
        left = conn.execute(
            "select count(*) from usage_events where tenant_id = %s and session_id = 'sess-x'",
            (tid,),
        ).fetchone()
        assert left is not None and left[0] == 0
        # Nothing old to purge → 0, and the call is safe.
        assert usage_store.purge_older_than(conn, days=30) == 0

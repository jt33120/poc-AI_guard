"""G-26 option B — une complétion streamée laisse une trace de sa propre non-inspection.

Avec `stream: true` — le défaut de la plupart des frameworks d'agents — la réponse est
relayée telle quelle et aucun appel d'outil n'est examiné.

**Ce n'est pas une revendication fausse.** `coverage/rows.yaml` ne revendique
`llm_proxy` que pour `M-10 / egress`, et la DLP s'applique en amont de cette branche.
Le contrôle d'appels d'outils est revendiqué sur `mcp` seulement, et `CM-7` refuserait
le contraire. Sous `AD-35`, c'est l'état sanctionné : une capacité absente est un
manque déclaré.

Ce qui manquait était plus étroit : **l'absence de trace ne se voyait nulle part.** Le
silence était indiscernable d'une absence de trafic. Ces tests fixent les deux moitiés
— la ligne est écrite quand on streame, et elle ne l'est pas quand on ne streame pas.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from typing import Any, ClassVar
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from api import llm_proxy
from api.main import create_app
from api.security import TokenVerifier
from core.config import Settings
from tests.conftest import DBHandle

_POLICY = """tools: []
defaults:
  unknown_tool: deny
  auto_classify: true
  class_approvals:
    read: auto
    write: auto
    external_send: human_in_the_loop
    irreversible: human_in_the_loop
"""

_NON_STREAMED = {
    "id": "chatcmpl-plain",
    "model": "gpt-4o",
    "choices": [{"message": {"role": "assistant", "content": "bonjour"}}],
}


class _FakeStreamResp:
    status_code = 200
    headers: ClassVar[dict[str, str]] = {"content-type": "text/event-stream"}

    async def aiter_raw(self) -> AsyncIterator[bytes]:
        yield b'data: {"choices":[{"delta":{"content":"bon"}}]}\n\n'
        yield b"data: [DONE]\n\n"

    async def aclose(self) -> None:
        return None


class _FakeResp:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.status_code = 200
        self.content = json.dumps(payload).encode()
        self.headers = {"content-type": "application/json"}

    def json(self) -> dict[str, Any]:
        return json.loads(self.content)


class _FakeClient:
    """Sert les deux chemins : `send(stream=True)` et `post`."""

    is_closed = False

    def __init__(self) -> None:
        self.streamed = 0
        self.posted = 0
        self.captured: dict[str, Any] = {}

    def build_request(
        self, method: str, url: str, content: bytes, headers: dict[str, str]
    ) -> dict[str, Any]:
        return {"method": method, "url": url, "content": content, "headers": headers}

    async def send(self, request: dict[str, Any], stream: bool = False) -> _FakeStreamResp:
        self.streamed += 1
        self.captured = request
        return _FakeStreamResp()

    async def post(self, url: str, content: bytes, headers: dict[str, str]) -> _FakeResp:
        self.posted += 1
        self.captured = {"url": url, "content": content, "headers": headers}
        return _FakeResp(_NON_STREAMED)


def _client(db_url: str, verifier: TokenVerifier, **extra: Any) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url, **extra))
    app.state.verifier = verifier
    return TestClient(app)


def _tenant(db: DBHandle) -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'S')", (tid,))
    db.conn.commit()
    return tid


def _agent(client: TestClient, db: DBHandle, make_token: Callable[..., str]) -> tuple[str, str]:
    tid = _tenant(db)
    admin = make_token(tenant_id=tid, role="admin")
    assert (
        client.put(
            "/v1/policy", headers={"Authorization": f"Bearer {admin}"}, json={"yaml": _POLICY}
        ).status_code
        == 200
    )
    raw = client.post(
        "/v1/gateway-tokens", headers={"Authorization": f"Bearer {admin}"}, json={"name": "bot"}
    ).json()["token"]
    return tid, raw


def _rows(db_url: str, tid: str) -> list[tuple[Any, ...]]:
    with psycopg.connect(db_url) as check:
        return check.execute(
            "select decision, tool_name, args_hash from audit_log where tenant_id = %s order by id",
            (tid,),
        ).fetchall()


def test_a_streamed_completion_records_that_it_was_not_inspected(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client(db.url, test_verifier)
    tid, raw = _agent(client, db, make_token)
    fake = _FakeClient()
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)

    resp = client.post(
        "/proxy/openai/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-agentkey"},
        json={"model": "gpt-4o", "stream": True, "messages": [{"role": "user", "content": "hi"}]},
    )

    # La moitié passante : le flux traverse toujours. Une garde qui casse le streaming
    # ne rend rien auditable, elle rend le produit inutilisable.
    assert resp.status_code == 200
    assert b"bon" in resp.content
    assert fake.streamed == 1

    rows = _rows(db.url, tid)
    assert [r[0] for r in rows] == ["streamed_uninspected"]
    # Métadonnées seules : nous n'avons regardé aucun appel, en nommer un serait pire
    # que de n'en écrire aucun.
    assert rows[0][1] is None
    assert rows[0][2] is None


def test_a_non_streamed_completion_records_no_such_line(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """La moitié discriminante.

    Sans elle, le test ci-dessus passerait sur un proxy qui écrit « non inspecté » à
    chaque requête — ce qui rendrait la métrique « N % du trafic non observé »
    exactement fausse dans le sens qui arrange.
    """
    client = _client(db.url, test_verifier)
    tid, raw = _agent(client, db, make_token)
    fake = _FakeClient()
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)

    resp = client.post(
        "/proxy/openai/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-agentkey"},
        json={"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]},
    )

    assert resp.status_code == 200
    assert fake.posted == 1 and fake.streamed == 0
    assert "streamed_uninspected" not in [r[0] for r in _rows(db.url, tid)]


def test_the_egress_guard_still_applies_to_a_streamed_request(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """La borne de l'angle mort, assertée plutôt qu'affirmée.

    `M-10 / egress` est publié `Bloqué` sur `llm_proxy`, et cette revendication ne
    tiendrait pas si le streaming la contournait. Le blocage DLP est en amont de la
    branche — ce test le prouve au lieu de le déduire de la lecture du code.
    """
    client = _client(db.url, test_verifier, dlp_enabled=True)
    tid, raw = _agent(client, db, make_token)
    fake = _FakeClient()
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)

    resp = client.post(
        "/proxy/openai/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-agentkey"},
        json={
            "model": "gpt-4o",
            "stream": True,
            "messages": [{"role": "user", "content": "ma clé est sk-ant-api03-" + "A" * 90}],
        },
    )

    assert resp.status_code == 403
    assert "Egress blocked" in resp.json()["detail"]
    # Et rien n'est parti chez le fournisseur : le refus précède le relais.
    assert fake.streamed == 0
    assert tid  # le tenant existe ; l'assertion ci-dessus porte sur son trafic

"""`decision_ms` — ce que la garde coûte, et ce qu'elle ne doit surtout pas compter.

Le produit publiait son surcoût en **allers-retours SQL** (`perf/overhead.json`) et
jamais en millisecondes mesurées : un prospect qui demande « ça me coûte combien »
recevait une unité qu'il ne sait pas convertir. Et la colonne qui aurait pu répondre,
`latency_ms`, mesure autre chose — l'outil aval sur la passerelle, le fournisseur sur
le proxy —, c'est-à-dire des durées que xSOM **subit**, pas des durées qu'il produit.

Pire : sur les classes risquées, la passerelle écrit la preuve **avant** d'agir (§4.2),
donc `latency_ms` y est `null` par construction. La colonne était vide exactement sur
les actions que l'acheteur regarde.

Le contrôle central de ce fichier est donc le troisième : un aval lent ne doit pas
gonfler `decision_ms`. C'est la seule façon de savoir qu'on mesure bien la garde, et
c'est la mutation la plus facile à introduire — mesurer à l'écriture au lieu du verdict
donne un code plus court qui passe tous les autres tests.
"""

from __future__ import annotations

import asyncio
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from mcp import types

from api.security import TokenVerifier
from core import audit, decision, policy_store
from core import db as core_db
from core.policy import parse_policy
from gateway.server import ApprovalContext, PolicyBackend
from tests.conftest import DBHandle
from tests.test_preuve_avant_action import FakeProxy

POLICY = """tools: []
defaults:
  unknown_tool: deny
  auto_classify: true
  class_approvals:
    read: auto
    write: auto
    external_send: auto
    irreversible: auto
"""


class ProxyLent(FakeProxy):
    """Un aval qui met du temps. C'est lui que `decision_ms` ne doit pas compter."""

    def __init__(self, secondes: float) -> None:
        super().__init__()
        self._secondes = secondes

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        await asyncio.sleep(self._secondes)
        return await super().call_tool(name, arguments)


def _tenant(db: DBHandle) -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'C')", (tid,))
    db.conn.commit()
    return tid


def _backend(proxy: Any, *, tenant_id: str, url: str) -> PolicyBackend:
    ctx = ApprovalContext(
        database_url=url, tenant_id=tenant_id, timeout_seconds=3600, gateway_token_id=None
    )
    return PolicyBackend(parse_policy(POLICY), proxy, ctx)  # type: ignore[arg-type]


def _cout(db: DBHandle, tenant_id: str) -> list[tuple[str, int | None, int | None]]:
    """(decision, decision_ms, latency_ms) — les deux durées, côte à côte."""
    with psycopg.connect(db.url) as check:
        return [
            (str(r[0]), r[1], r[2])
            for r in check.execute(
                "select decision, decision_ms, latency_ms from audit_log "
                "where tenant_id = %s order by id",
                (tenant_id,),
            ).fetchall()
        ]


# ---------------------------------------------------------------------------
# La porte obligatoire
# ---------------------------------------------------------------------------
async def test_the_mandatory_door_records_what_the_guard_cost(db: DBHandle) -> None:
    """Une décision de policy laisse une mesure. Sans elle, la colonne est décorative."""
    tenant = _tenant(db)
    backend = _backend(FakeProxy(), tenant_id=tenant, url=db.url)

    await backend.call_tool("read_doc", {})

    lignes = _cout(db, tenant)
    assert [d for d, _, _ in lignes] == ["allow"]
    assert lignes[0][1] is not None, "aucune mesure : `decision_ms` n'est pas alimenté"


async def test_a_slow_downstream_does_not_inflate_the_guards_cost(db: DBHandle) -> None:
    """**Le contrôle qui vaut le fichier.**

    L'aval dort 300 ms. `latency_ms` doit le voir — c'est ce qu'il mesure — et
    `decision_ms` ne doit pas : sinon le produit publierait comme son propre surcoût
    la lenteur du serveur d'en face, sur le chiffre même qu'il met en avant.

    La mutation que ce test attrape est la plus tentante du lot : mesurer à l'écriture
    de la ligne plutôt qu'au verdict. Le code est plus court, et tous les autres
    contrôles de ce fichier restent verts.
    """
    tenant = _tenant(db)
    backend = _backend(ProxyLent(0.3), tenant_id=tenant, url=db.url)

    await backend.call_tool("read_doc", {})

    (_, decision_ms, latency_ms) = _cout(db, tenant)[0]
    assert latency_ms is not None and latency_ms >= 250, (
        "`latency_ms` ne voit plus l'aval — il mesurait pourtant exactement cela"
    )
    assert decision_ms is not None and decision_ms < 200, (
        f"`decision_ms` vaut {decision_ms} ms alors que la garde n'a rien fait de long :\n"
        "  il compte l'outil aval, c'est-à-dire une durée que xSOM subit et ne produit pas.\n"
        "  fix : mesurer au moment du VERDICT (`audit.cout_de_garde`), jamais au moment\n"
        "  de l'écriture — deux sites d'audit de `gateway/server.py` écrivent après le relais."
    )


async def test_a_refusal_before_the_policy_engine_is_measured_too(db: DBHandle) -> None:
    """Les refus les plus rapides du produit comptent aussi.

    RBAC, quarantaine et ordre d'arrêt rendent leur verdict avant le moteur de policy.
    Les omettre biaiserait vers le haut tout centile qu'un exploitant calculerait — il
    ne verrait que les décisions coûteuses.
    """
    tenant = _tenant(db)
    policy = parse_policy(
        "tools:\n"
        "  - name: mock.secret\n"
        "    class: read\n"
        "    approval: auto\n"
        "    constraints:\n"
        "      allowed_clients: [autre]\n"
        "defaults:\n"
        "  unknown_tool: deny\n"
    )
    ctx = ApprovalContext(
        database_url=db.url, tenant_id=tenant, timeout_seconds=3600, gateway_token_id=None
    )
    backend = PolicyBackend(policy, FakeProxy(), ctx)  # type: ignore[arg-type]

    await backend.call_tool("secret", {})

    lignes = _cout(db, tenant)
    assert [d for d, _, _ in lignes] == ["rbac_denied"]
    assert lignes[0][1] is not None, "un refus RBAC ne laisse aucune mesure"


# ---------------------------------------------------------------------------
# La porte coopérative
# ---------------------------------------------------------------------------
def test_the_cooperative_door_records_it_as_well(db: DBHandle) -> None:
    """Les trois portes répondent à la même question, ou le chiffre publié ne veut rien dire."""
    tenant = _tenant(db)
    policy_store.save_yaml(db.conn, tenant, POLICY)
    db.conn.commit()

    with core_db.connection(db.url) as conn:
        policy = policy_store.load_policy(conn, tenant)
    verdict = decision.authorize(
        database_url=db.url,
        policy=policy,
        tenant_id=tenant,
        tool="read_doc",
        arguments={},
    )

    assert verdict["decision"] == "allow"
    lignes = _cout(db, tenant)
    assert lignes and lignes[0][1] is not None, "`/v1/authorize` n'alimente pas `decision_ms`"


# ---------------------------------------------------------------------------
# Ce que la colonne ne doit jamais faire
# ---------------------------------------------------------------------------
def test_the_measure_never_enters_the_hashed_payload(db: DBHandle) -> None:
    """**La chaîne déjà écrite doit rester vérifiable.**

    `decision_ms` est une colonne ANNEXE. La faire entrer dans `payload_v1`
    recalculerait une charge différente pour chaque entrée déjà écrite et rendrait le
    journal entier invérifiable — sur une table qu'aucun UPDATE ne répare.

    Le contrôle est direct : deux entrées identiques sur tout sauf la mesure doivent
    hacher pareil, et la chaîne doit se vérifier.
    """
    tenant = _tenant(db)
    with core_db.connection(db.url) as conn:
        premier = audit.log_event(
            conn,
            tenant_id=tenant,
            decision="allow",
            tool_name="t",
            origin=audit.Origin.authorize_api(),
            decision_ms=3,
        )
        second = audit.log_event(
            conn,
            tenant_id=tenant,
            decision="allow",
            tool_name="t",
            origin=audit.Origin.authorize_api(),
            decision_ms=41_000,
        )
        conn.commit()
        assert audit.verify_chain(conn, tenant).ok

    assert premier != second, "deux entrées consécutives ne peuvent pas partager un hachage"
    # Et la preuve directe : la charge canonique ne nomme pas la colonne.
    charge = audit.payload_v1(
        ts_iso="2026-01-01T00:00:00+00:00",
        tenant_id=tenant,
        user_id=None,
        request_id=None,
        tool_name="t",
        action_class=None,
        decision="allow",
        policy_rule_id=None,
        judge_used=False,
        args_hash=None,
        latency_ms=None,
        error=None,
    )
    assert "decision_ms" not in charge


def test_the_stopwatch_never_goes_backwards() -> None:
    """Une mesure négative n'a pas de sens dans un histogramme, et se bornerait mal ailleurs."""
    import time

    assert audit.cout_de_garde(time.monotonic() + 5) == 0


def test_zero_and_null_do_not_say_the_same_thing(db: DBHandle) -> None:
    """`0` = mesuré, sous la milliseconde. `null` = pas mesuré. La nuance est publiée.

    Sans elle, un exploitant qui voit `0` ne sait pas s'il a affaire à une garde
    instantanée ou à un site d'audit qu'on a oublié d'instrumenter — et les deux
    demandent des réactions opposées.
    """
    tenant = _tenant(db)
    with core_db.connection(db.url) as conn:
        audit.log_event(
            conn, tenant_id=tenant, decision="allow", origin=audit.Origin.authorize_api()
        )
        audit.log_event(
            conn,
            tenant_id=tenant,
            decision="allow",
            origin=audit.Origin.authorize_api(),
            decision_ms=0,
        )
        conn.commit()

    assert [m for _, m, _ in _cout(db, tenant)] == [None, 0]


# ---------------------------------------------------------------------------
# Le proxy de modèles
# ---------------------------------------------------------------------------
UNE_COMPLETION: dict[str, Any] = {
    "id": "chatcmpl-cost",
    "object": "chat.completion",
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {"name": "delete_contact", "arguments": "{}"},
                    }
                ],
            },
        }
    ],
}


def test_the_proxy_measures_the_guard_on_both_sides_of_the_provider(
    db: DBHandle, test_verifier: TokenVerifier, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Sur cette porte le verdict se rend en deux temps, de part et d'autre du modèle.

    Le fournisseur est au milieu et peut durer des secondes. Le compter ferait publier
    comme surcoût de xSOM le temps d'OpenAI, ce qui est à la fois faux et le genre de
    chiffre qu'un concurrent adore citer.
    """
    from tests.test_llm_proxy import _client, _FakeClient, _FakeResp

    tid = _tenant(db)
    policy_store.save_yaml(
        db.conn,
        tid,
        "tools: []\ndefaults:\n  unknown_tool: deny\n  auto_classify: true\n",
    )
    db.conn.commit()
    client: TestClient = _client(db.url, test_verifier)

    from core import tenant_tokens

    raw, _ = tenant_tokens.mint(db.conn, tenant_id=tid, name="bot")
    db.conn.commit()

    class LentAmont(_FakeClient):
        async def post(self, *a: Any, **k: Any) -> Any:
            await asyncio.sleep(0.3)
            return _FakeResp(UNE_COMPLETION)

    monkeypatch.setattr("api.llm_proxy._http", lambda: LentAmont(_FakeResp(UNE_COMPLETION)))
    resp = client.post(
        "/proxy/openai/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk"},
        json={"model": "gpt-4o", "messages": [{"role": "user", "content": "x"}]},
    )
    assert resp.status_code == 200

    mesures = [m for _, m, _ in _cout(db, tid) if m is not None]
    assert mesures, "le proxy n'alimente pas `decision_ms`"
    assert max(mesures) < 200, (
        f"`decision_ms` vaut {max(mesures)} ms : le proxy compte l'aller-retour du "
        "fournisseur dans le coût de la garde."
    )

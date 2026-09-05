"""`FR-166` — un ordre d'arrêt atteint une session vivante, et sa panne refuse.

Le constat hérité portait sur un arrêt d'urgence par tenant dont la lecture ratée
laissait passer les `write`. Ce mécanisme n'existe pas : il n'y a ni table `halts`,
ni endpoint d'arrêt, ni classe d'action épargnée — il n'y a **aucun arrêt du tout à
faire échouer**.

L'écart réel est antérieur, et c'est une divergence d'ingestion (`AD-28`). Trois états
de plan de contrôle sont lus **une fois**, au démarrage du processus MCP — le jeton, la
policy, la liste des serveurs — et jamais relus. L'ordre d'arrêt, lui, existe déjà :
`POST /v1/gateway-tokens/{id}/revoke`, `cli token revoke`, le bouton de la console. Il
n'atteignait simplement pas l'agent tant que celui-ci ne se reconnectait pas, alors que
`/v1/authorize` relit le même jeton à chaque requête. Le même ordre avait donc deux
effets selon la porte — et la porte MCP est l'obligatoire.

La direction d'échec est plus stricte ici que pour les deux autres gardes qui
plafonnent aux classes risquées : un arrêt d'urgence s'invoque pendant un incident,
c'est-à-dire au moment précis où la base est dégradée. Un arrêt qui cesse de valoir
quand la base tousse n'est pas un arrêt.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import mcp.types as types
import pytest

from core import tenant_tokens
from core.policy import parse_policy
from gateway.server import ApprovalContext, PolicyBackend
from tests.conftest import DBHandle

#: Un DSN qui ne répond pas : c'est la panne du magasin, sans toucher au cluster.
_UNREACHABLE = "postgresql://nobody@127.0.0.1:1/none"

#: Toutes les autres gardes neutralisées, pour qu'aucune ne puisse être la cause du
#: refus qu'on mesure. Sans cela un test vert ne dirait pas *quel* garde a mordu.
_POLICY = """
tools:
  - name: mock.read_row
    class: read
    approval: auto
  - name: mock.update_row
    class: write
    approval: auto
defaults:
  unknown_tool: deny
  taint_policy: "off"
  integrity_enabled: false
"""


class FakeProxy:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def list_tools(self) -> list[types.Tool]:
        return []

    async def resolve(self, name: str) -> tuple[str, str]:
        return ("mock", name)

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        self.calls.append(name)
        return types.CallToolResult(content=[types.TextContent(type="text", text="ok")])


def _agent(db: DBHandle) -> tuple[str, str]:
    """Un tenant et un jeton de passerelle actif — l'identité d'un agent connecté."""
    tenant_id = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant_id,))
    db.conn.commit()
    _, view = tenant_tokens.mint(db.conn, tenant_id=tenant_id, name="agent-1")
    db.conn.commit()
    return tenant_id, str(view["id"])


def _backend(proxy: FakeProxy, *, url: str, tenant_id: str, token_id: str) -> PolicyBackend:
    ctx = ApprovalContext(database_url=url, tenant_id=tenant_id, gateway_token_id=token_id)
    return PolicyBackend(parse_policy(_POLICY), proxy, ctx)  # type: ignore[arg-type]


async def test_a_revoked_token_stops_a_live_session(db: DBHandle) -> None:
    """L'ordre d'arrêt existant atteint enfin l'agent, sans qu'il se reconnecte.

    Le même backend joue deux appels : le premier passe, on révoque, le second est
    refusé. C'est la forme qui compte — un test qui aurait construit un second backend
    après la révocation aurait mesuré une reconnexion, c'est-à-dire le comportement qui
    marchait déjà.
    """
    tenant_id, token_id = _agent(db)
    proxy = FakeProxy()
    backend = _backend(proxy, url=db.url, tenant_id=tenant_id, token_id=token_id)

    first = await backend.call_tool("update_row", {"id": 1})
    assert first.isError is False and proxy.calls == ["update_row"]

    tenant_tokens.revoke(db.conn, tenant_id, token_id)

    second = await backend.call_tool("update_row", {"id": 2})
    assert second.isError is True
    assert proxy.calls == ["update_row"]  # l'aval n'a pas été atteint une seconde fois
    decisions = [
        r[0] for r in db.conn.execute("select decision from audit_log order by id").fetchall()
    ]
    assert "agent_stopped" in decisions


async def test_a_revoked_token_stops_reads_too(db: DBHandle) -> None:
    """Un ordre explicite d'arrêt arrête tout, lecture comprise.

    C'est la différence avec l'état *illisible* du test suivant : là on ignore ce que
    l'opérateur veut, ici on le sait.
    """
    tenant_id, token_id = _agent(db)
    proxy = FakeProxy()
    backend = _backend(proxy, url=db.url, tenant_id=tenant_id, token_id=token_id)
    tenant_tokens.revoke(db.conn, tenant_id, token_id)

    result = await backend.call_tool("read_row", {"id": 1})
    assert result.isError is True and proxy.calls == []


async def test_an_unreadable_stop_state_refuses_a_write(db: DBHandle) -> None:
    """Le test qui mord : magasin injoignable ⇒ l'écriture est refusée.

    Sans le garde, `evaluate` rend `auto`, le taint est `off`, le risque ne tourne pas
    et l'échec d'écriture d'audit est avalé : l'appel est relayé. C'est la seule
    assertion du fichier qui ne peut pas passer sans le correctif.
    """
    tenant_id, token_id = _agent(db)
    proxy = FakeProxy()
    backend = _backend(proxy, url=_UNREACHABLE, tenant_id=tenant_id, token_id=token_id)

    result = await backend.call_tool("update_row", {"id": 1})
    assert result.isError is True
    assert proxy.calls == []


async def test_an_unreadable_stop_state_still_lets_a_read_through(db: DBHandle) -> None:
    """La moitié qui empêche le correctif d'être une panne.

    « Refuse toute classe sauf lecture » a deux moitiés ; un garde qui refuse tout
    satisferait la première et serait une indisponibilité, pas un contrôle.
    """
    tenant_id, token_id = _agent(db)
    proxy = FakeProxy()
    backend = _backend(proxy, url=_UNREACHABLE, tenant_id=tenant_id, token_id=token_id)

    result = await backend.call_tool("read_row", {"id": 1})
    assert result.isError is False and proxy.calls == ["read_row"]


async def test_an_active_token_is_not_stopped(db: DBHandle) -> None:
    """Le contrôle négatif du garde : sans révocation, rien ne change.

    Il vaut d'être écrit parce que le garde ouvre une connexion par appel : s'il
    refusait sur n'importe quelle anomalie de lecture, les quatre tests ci-dessus
    resteraient verts et la passerelle serait inutilisable.
    """
    tenant_id, token_id = _agent(db)
    proxy = FakeProxy()
    backend = _backend(proxy, url=db.url, tenant_id=tenant_id, token_id=token_id)

    for tool in ("read_row", "update_row"):
        result = await backend.call_tool(tool, {"id": 1})
        assert result.isError is False
    assert proxy.calls == ["read_row", "update_row"]


def test_a_vanished_token_row_counts_as_revoked(db: DBHandle) -> None:
    """Fail-closed sur la ligne introuvable : on ne devine pas en faveur de l'agent."""
    tenant_id, token_id = _agent(db)
    assert tenant_tokens.revoked(db.conn, tenant_id, token_id) is False
    assert tenant_tokens.revoked(db.conn, tenant_id, str(uuid4())) is True


@pytest.mark.parametrize("tool", ["read_row", "update_row"])
async def test_no_agent_identity_leaves_the_guard_out_of_the_way(db: DBHandle, tool: str) -> None:
    """Sans identité d'agent il n'y a pas d'ordre d'arrêt à lire — les autres gardes tiennent.

    Ce chemin existe dans les tests et dans le proxy LLM ; le garde ne doit pas le
    transformer en refus général, sinon il déplace le fail-closed du taint
    (`taint_unresolvable`) au lieu de s'y ajouter.
    """
    tenant_id, _ = _agent(db)
    proxy = FakeProxy()
    ctx = ApprovalContext(database_url=db.url, tenant_id=tenant_id, gateway_token_id=None)
    backend = PolicyBackend(parse_policy(_POLICY), proxy, ctx)  # type: ignore[arg-type]

    result = await backend.call_tool(tool, {"id": 1})
    assert result.isError is False and proxy.calls == [tool]

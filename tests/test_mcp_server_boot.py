"""The MCP gateway server boots; the default backend exposes zero tools."""

from __future__ import annotations

import mcp.types as types

from gateway.server import SERVER_NAME, EmptyBackend, build_server


async def test_default_backend_exposes_zero_tools() -> None:
    assert await EmptyBackend().list_tools() == []


def test_server_builds_with_name() -> None:
    server = build_server()
    assert server.name == SERVER_NAME


def test_list_and_call_tool_handlers_are_registered() -> None:
    server = build_server()
    assert types.ListToolsRequest in server.request_handlers
    assert types.CallToolRequest in server.request_handlers


class BackendEspion:
    """Un backend qui note ce que l'adaptateur MCP lui a réellement transmis."""

    def __init__(self) -> None:
        self.recu: list[tuple[str, dict[str, object]]] = []

    async def list_tools(self) -> list[types.Tool]:
        return []

    async def call_tool(self, name: str, arguments: dict[str, object]) -> types.CallToolResult:
        self.recu.append((name, arguments))
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=f"'{name}' not permitted by policy")],
            isError=True,
        )


async def test_the_call_tool_handler_passes_the_arguments_and_returns_the_refusal() -> None:
    """L'adaptateur entre le SDK MCP et la passerelle, réellement invoqué.

    Les trois contrôles au-dessus vérifient que les handlers sont **présents** dans
    le dictionnaire ; leurs corps ne sont exécutés par aucun test. C'est le seul
    morceau de code que tout appel d'agent traverse, et il tient en deux lignes :
    un `arguments` perdu dans l'adaptateur — ou une convention changée par une mise
    à jour du SDK — laisserait la totalité des tests de policy et de HITL au vert
    pendant que la porte obligatoire ne contrôlerait plus rien, puisqu'ils appellent
    tous `PolicyBackend.call_tool` directement, en court-circuitant ceci.

    Les arguments comptent autant que le nom : la classification par argument
    (`classify: by_argument`), les contraintes de policy et le hachage d'audit
    lisent tous `arguments`. Vidé en route, chaque garde qui en dépend s'ouvre en
    silence.
    """
    espion = BackendEspion()
    server = build_server(espion)  # type: ignore[arg-type]

    resultat = await server.request_handlers[types.CallToolRequest](
        types.CallToolRequest(
            method="tools/call",
            params=types.CallToolRequestParams(
                name="delete_contact", arguments={"contact_id": "c1"}
            ),
        )
    )

    assert espion.recu == [("delete_contact", {"contact_id": "c1"})]
    rendu = resultat.root
    assert isinstance(rendu, types.CallToolResult)
    assert rendu.isError is True
    assert "not permitted by policy" in rendu.content[0].text  # type: ignore[union-attr]

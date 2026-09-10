"""Le même verdict par les trois portes, sur la même policy.

Un agent peut atteindre xSOM par trois chemins : la **passerelle MCP**
(`gateway/server.py`, la seule contraignante — elle exécute ou n'exécute pas),
`/v1/authorize` (`core/decision.py`, coopérative — l'agent honore le verdict), et
le **proxy LLM** (`api/llm_proxy.py`, qui retire de la réponse les appels d'outil
non autorisés).

Chacune a ses tests, tous verts, et **aucun ne compare**. C'est la forme de
dérive qui ne se voit pas : elle n'échoue nulle part, elle produit simplement deux
comportements pour un même tenant selon la porte empruntée.

Elle était là. `_verdict` du proxy n'appelait jamais `resolve_ambiguous` — alors
que le docstring de cette fonction affirme être « shared by every ingress path, so
the classification step cannot drift between them », et que `grep` ne lui trouvait
que deux appelants. Conséquence, pour une règle `{classify: ambiguous, approval:
auto}` : le proxy l'honorait telle quelle et laissait partir l'appel d'outil, là où
les deux autres portes la plancherisent à `irreversible`, donc à une approbation
humaine (`AD-34`).

Ce fichier est le garde qui empêche la quatrième porte de repartir de zéro.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

import mcp.types as types
import pytest

from api.llm_proxy import _verdict
from core.decision import authorize
from core.judge import Judge
from core.policy import ActionClass, parse_policy
from gateway.server import ApprovalContext, PolicyBackend
from tests.conftest import DBHandle

#: Une règle ambiguë déclarée `auto` : le cas exact où les portes divergeaient.
#:
#: `shell.exec` est le bon exemple parce qu'il est indécidable sans regarder les
#: arguments — `ls` et `rm -rf /` portent le même nom d'outil. C'est pour ça que
#: `classify: ambiguous` existe, et pour ça qu'un juge absent doit planchériser.
_POLICY = parse_policy(
    """
tools:
  - {name: mock.shell_exec, classify: ambiguous, approval: auto}
  - {name: mock.echo, class: read, approval: auto}
defaults: {unknown_tool: deny, taint_policy: "off"}
"""
)

_ARGS = {"command": "rm -rf /var/data"}


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


def _juge(classe: ActionClass) -> Judge:
    """Un juge qui classe sans réseau — le vrai objet, un completer fictif.

    On enveloppe `Judge` plutôt que de le remplacer : c'est lui qui compte les
    appels, applique le budget et retombe sur `irreversible` à la moindre anomalie
    de réponse. Un faux juge court-circuiterait exactement ce qu'on veut exercer.
    """
    return Judge(lambda _s, _u: json.dumps({"action_class": classe.value}), max_calls=10)


def _tenant(db: DBHandle) -> str:
    tid = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tid,))
    db.conn.commit()
    return str(tid)


def _par_le_proxy(judge: Judge | None) -> tuple[str | None, str]:
    """Le proxy LLM : il rend directement (classe, verdict)."""
    return _verdict(_POLICY, "mock.shell_exec", _ARGS, judge)


def _par_authorize(db: DBHandle, tenant_id: str, judge: Judge | None) -> tuple[str | None, str]:
    """`/v1/authorize` : même vocabulaire de verdict (`allow` / `hold` / `deny`)."""
    rendu = authorize(
        database_url=db.url,
        policy=_POLICY,
        tenant_id=tenant_id,
        tool="mock.shell_exec",
        arguments=_ARGS,
        judge=judge,
    )
    return rendu["action_class"], rendu["decision"]


async def _par_la_passerelle(
    db: DBHandle, tenant_id: str, judge: Judge | None
) -> tuple[str | None, str]:
    """La passerelle MCP : le verdict se lit dans ce qu'elle a **fait**.

    Elle ne rend pas de verdict nommé — elle relaie, ou elle ne relaie pas. On le
    normalise depuis l'effet observable et depuis la ligne d'audit qu'elle écrit,
    qui est l'endroit où sa classification devient publique.
    """
    proxy = FakeProxy()
    ctx = ApprovalContext(database_url=db.url, tenant_id=tenant_id, timeout_seconds=3600)
    backend = PolicyBackend(_POLICY, proxy, ctx, judge=judge)  # type: ignore[arg-type]
    resultat = await backend.call_tool("shell_exec", _ARGS)

    ligne = db.conn.execute(
        "select action_class, decision from audit_log where tenant_id = %s order by id desc "
        "limit 1",
        (tenant_id,),
    ).fetchone()
    classe = ligne[0] if ligne else None

    texte = resultat.content[0].text  # type: ignore[union-attr]
    if not resultat.isError:
        return classe, "allow"
    return classe, "hold" if "requires_approval" in texte else "deny"


async def test_an_ambiguous_rule_gets_the_same_verdict_on_all_three_doors(
    db: DBHandle,
) -> None:
    """Sans juge : les trois portes doivent planchériser à `irreversible`, donc tenir.

    C'est le contrôle qui échouait avant le correctif : le proxy rendait
    `(None, "allow")` — pas de classe, et l'appel d'outil relayé — pendant que les
    deux autres rendaient `("irreversible", "hold")`. Le même tenant, la même
    policy, la même règle.
    """
    tenant_a, tenant_b = _tenant(db), _tenant(db)

    proxy = _par_le_proxy(None)
    porte_http = _par_authorize(db, tenant_a, None)
    passerelle = await _par_la_passerelle(db, tenant_b, None)

    assert proxy == porte_http == passerelle == ("irreversible", "hold"), (
        f"les portes divergent — proxy={proxy}, /v1/authorize={porte_http}, "
        f"passerelle={passerelle}\n"
        "  une propriété vraie sur un chemin ne se lit pas comme vraie partout "
        "(`AD-28`) :\n"
        "  chaque porte doit passer par `resolve_ambiguous`, qui est l'étape de "
        "classification partagée."
    )


async def test_a_judged_read_relaxes_on_all_three_doors(db: DBHandle) -> None:
    """Le sens inverse, et la non-vacuité du contrôle précédent.

    Sans lui, un correctif qui ferait répondre « tenu » à tout, partout, passerait
    le test ci-dessus. Ici le juge classe `read` : le plancher de
    `escalate_for_class` ne mord pas, et les trois portes doivent relayer.
    """
    tenant_a, tenant_b = _tenant(db), _tenant(db)

    proxy = _par_le_proxy(_juge(ActionClass.read))
    porte_http = _par_authorize(db, tenant_a, _juge(ActionClass.read))
    passerelle = await _par_la_passerelle(db, tenant_b, _juge(ActionClass.read))

    assert proxy == porte_http == passerelle == ("read", "allow")


@pytest.mark.parametrize(
    ("classe", "attendu"),
    [
        (ActionClass.irreversible, "hold"),
        (ActionClass.external_send, "hold"),
        (ActionClass.write, "allow"),
        (ActionClass.read, "allow"),
    ],
)
def test_the_shared_floor_is_the_same_function_for_every_class(
    classe: ActionClass, attendu: str
) -> None:
    """Le plancher par classe, éprouvé sur les quatre classes plutôt que sur une.

    Le proxy est la porte la moins chère à interroger — pas de base, pas d'agent —
    donc c'est ici qu'on balaie la table. Les deux contrôles ci-dessus prouvent que
    les trois portes partagent cette fonction ; celui-ci prouve ce que la fonction
    fait de chaque classe.
    """
    assert _verdict(_POLICY, "mock.shell_exec", _ARGS, _juge(classe)) == (classe.value, attendu)

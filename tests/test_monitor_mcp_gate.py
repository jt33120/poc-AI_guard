"""AD-27 sur la passerelle MCP : la fenêtre d'observation couvre les deux chemins.

Le mode observation existait depuis le rang 4, **sur le proxy LLM seulement**. Un même
tenant obtenait donc deux comportements selon la porte empruntée. `AD-28` dit qu'une
propriété vraie sur un chemin ne se lit pas comme vraie partout — ici la divergence
n'était pas voulue, seulement pas encore refermée.

Étendre l'observation au gateway MCP touche le chemin **obligatoire**, celui dont
dépend toute garantie `Bloqué`. Les scénarios ci-dessous sont donc écrits pour ce
chemin précisément, et non hérités de ceux du proxy : la moitié de ce fichier existe
pour prouver ce qu'une fenêtre **ne** relâche **pas**.
"""

from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path
from typing import Any
from uuid import uuid4

from core import monitor
from core.policy import ActionClass, Approval, PolicyOutcome, parse_policy
from gateway.downstream import DownstreamProxy, ServerSpec
from gateway.server import ApprovalContext, PolicyBackend
from tests.conftest import DBHandle

_MOCK = Path(__file__).resolve().parent / "fixtures" / "mock_mcp_server.py"
_TOKEN = "tok-observed"

_POLICY = parse_policy(
    """
tools:
  - {name: mock.echo, class: read, approval: deny}
  - {name: mock.delete_contact, class: irreversible, approval: human_in_the_loop}
  - {name: mock.mail_send, class: external_send, approval: deny}
defaults: {unknown_tool: deny}
"""
)


def _tenant(db: DBHandle) -> str:
    tenant_id = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant_id,))
    db.conn.commit()
    return tenant_id


def _backend(db: DBHandle, tenant_id: str, *, token_id: str | None = _TOKEN) -> PolicyBackend:
    proxy = DownstreamProxy(
        [
            ServerSpec(
                name="mock",
                transport="stdio",
                config={"command": sys.executable, "args": [str(_MOCK)]},
            )
        ]
    )
    ctx = ApprovalContext(
        database_url=db.url,
        tenant_id=tenant_id,
        timeout_seconds=3600,
        gateway_token_id=token_id,
    )
    return PolicyBackend(_POLICY, proxy, ctx)


def _open(db: DBHandle, tenant_id: str, token_id: str = _TOKEN) -> None:
    monitor.open_window(
        db.conn, tenant_id=tenant_id, gateway_token_id=token_id, hours=2, max_hours=24
    )
    db.conn.commit()


def _text(result: Any) -> str:
    return str(result.content[0].text)


def _decisions(db: DBHandle, tenant_id: str) -> list[str]:
    rows = db.conn.execute(
        "select decision from audit_log where tenant_id = %s order by id", (tenant_id,)
    ).fetchall()
    return [r[0] for r in rows]


# --- Ce qu'une fenêtre relâche ----------------------------------------------------


async def test_an_open_window_relays_a_denied_read_and_records_it_distinctly(
    db: DBHandle,
) -> None:
    """La moitié utile : sans elle, activer l'enforcement retire tous les appels."""
    tenant_id = _tenant(db)
    _open(db, tenant_id)

    result = await _backend(db, tenant_id).call_tool("echo", {"text": "bonjour"})

    assert result.isError is False
    assert "bonjour" in _text(result)
    assert _decisions(db, tenant_id) == ["monitor_deny"]


async def test_an_open_window_relays_a_held_action_of_an_observable_class(
    db: DBHandle,
) -> None:
    tenant_id = _tenant(db)
    db.conn.execute(
        "insert into tenants (id, name) values (%s, 'B')", (uuid4(),)
    )  # un voisin, pour que la fenêtre ait quelque chose à ne pas déborder
    db.conn.commit()
    _open(db, tenant_id)

    policy = parse_policy(
        "tools:\n"
        "  - {name: mock.echo, class: write, approval: human_in_the_loop}\n"
        "defaults: {unknown_tool: deny}\n"
    )
    proxy = DownstreamProxy(
        [
            ServerSpec(
                name="mock",
                transport="stdio",
                config={"command": sys.executable, "args": [str(_MOCK)]},
            )
        ]
    )
    backend = PolicyBackend(
        policy,
        proxy,
        ApprovalContext(
            database_url=db.url,
            tenant_id=tenant_id,
            timeout_seconds=3600,
            gateway_token_id=_TOKEN,
        ),
    )

    result = await backend.call_tool("echo", {"text": "salut"})

    assert result.isError is False
    assert _decisions(db, tenant_id) == ["monitor_hold"]


# --- Ce qu'une fenêtre ne relâche jamais ------------------------------------------


async def test_a_window_never_relays_an_irreversible_action(db: DBHandle) -> None:
    """La garantie qui compte, assertée **sur le chemin MCP** et pas héritée.

    C'est le chemin obligatoire : si une écriture de plan de contrôle pouvait y mettre
    l'irréversible au repos, toute revendication `Bloqué` du produit deviendrait
    conditionnelle à un réglage.
    """
    tenant_id = _tenant(db)
    _open(db, tenant_id)

    result = await _backend(db, tenant_id).call_tool("delete_contact", {"contact_id": "c1"})

    assert result.isError is True
    assert "requires_approval" in _text(result)
    assert "deleted" not in _text(result)
    assert "monitor_deny" not in _decisions(db, tenant_id)
    assert "monitor_hold" not in _decisions(db, tenant_id)


async def test_a_window_never_relays_an_external_send(db: DBHandle) -> None:
    tenant_id = _tenant(db)
    _open(db, tenant_id)

    result = await _backend(db, tenant_id).call_tool(
        "mail_send", {"to": "x@example.test", "subject": "s"}
    )

    assert result.isError is True
    assert "not permitted" in _text(result)
    assert _decisions(db, tenant_id) == ["deny"]


async def test_a_window_never_relays_a_call_from_an_agent_without_identity(
    db: DBHandle,
) -> None:
    """`AD-10` : sans identité d'agent, aucune fenêtre ne s'applique — on applique."""
    tenant_id = _tenant(db)
    _open(db, tenant_id)

    result = await _backend(db, tenant_id, token_id=None).call_tool("echo", {"text": "bonjour"})

    assert result.isError is True
    assert _decisions(db, tenant_id) == ["deny"]


async def test_another_agents_window_does_not_relax_this_one(db: DBHandle) -> None:
    """La fenêtre est portée par le jeton de passerelle, pas par le tenant."""
    tenant_id = _tenant(db)
    _open(db, tenant_id, token_id="un-autre-agent")

    result = await _backend(db, tenant_id).call_tool("echo", {"text": "bonjour"})

    assert result.isError is True
    assert _decisions(db, tenant_id) == ["deny"]


# --- La moitié discriminante ------------------------------------------------------


async def test_without_a_window_nothing_changes(db: DBHandle) -> None:
    """Le contrôle négatif du mécanisme : fenêtre fermée, le refus tient.

    Sans lui, les tests ci-dessus passeraient sur une passerelle qui relaie tout.
    """
    tenant_id = _tenant(db)

    result = await _backend(db, tenant_id).call_tool("echo", {"text": "bonjour"})

    assert result.isError is True
    assert "not permitted" in _text(result)
    assert _decisions(db, tenant_id) == ["deny"]


async def test_an_expired_window_stops_relaxing(db: DBHandle) -> None:
    """Une fenêtre bornée qui ne se refermerait pas serait un contournement permanent."""
    tenant_id = _tenant(db)
    _open(db, tenant_id)
    db.conn.execute(
        "update monitor_windows set expires_at = now() - interval '1 minute' where tenant_id = %s",
        (tenant_id,),
    )
    db.conn.commit()

    result = await _backend(db, tenant_id).call_tool("echo", {"text": "bonjour"})

    assert result.isError is True
    assert _decisions(db, tenant_id) == ["deny"]


# --- La clause de taint : redondante aujourd'hui, pas demain -----------------------


async def test_taint_escalation_is_never_relaxed(db: DBHandle) -> None:
    """La clause exercée directement, parce que `call_tool` ne peut pas l'atteindre.

    `_taint_blocks` n'escalade que `irreversible` et `external_send`, que
    `monitor.observes` refuse déjà : par `call_tool`, cette branche ne tranche jamais.
    Un garde qu'on ne peut pas faire échouer est exactement le contrôle décoratif que
    ce chantier retire — on l'exerce donc sur son contrat, avec une classe observable,
    plutôt que de le déclarer couvert.
    """
    tenant_id = _tenant(db)
    _open(db, tenant_id)
    backend = _backend(db, tenant_id)

    escalade = PolicyOutcome(
        action_class=ActionClass.write,  # observable — seule la raison doit trancher
        decision=Approval.human_in_the_loop,
        rule_name="r",
        reason="taint",
    )
    assert backend._observation_relaxes(escalade) is False

    # Le même verdict sans l'origine « taint » est, lui, relâché : c'est la raison qui
    # tranche, pas la classe ni le palier.
    ordinaire = replace(escalade, reason="policy")
    assert backend._observation_relaxes(ordinaire) is True


def test_every_class_taint_escalates_is_a_class_no_window_observes() -> None:
    """Le couplage entre les deux listes, rendu mécanique.

    Si `_taint_blocks` s'élargissait un jour à `write`, la clause de raison ci-dessus
    cesserait d'être redondante — et ce test le dirait au lieu de laisser la question
    se poser en production.
    """
    escalade_par_taint = {ActionClass.irreversible, ActionClass.external_send}
    assert escalade_par_taint <= monitor.NEVER_OBSERVED, (
        "le taint escalade une classe qu'une fenêtre peut observer : la clause "
        "`reason == 'taint'` de `_observation_relaxes` devient load-bearing, "
        "et il faut un scénario bout-en-bout pour elle"
    )


async def test_a_window_never_relaxes_an_rbac_refusal(db: DBHandle) -> None:
    """L'exclusion que j'avais argumentée en lisant le code, ici exécutée.

    RBAC retourne **avant** l'évaluation de policy, donc une fenêtre ne peut pas
    l'atteindre. C'est vrai en lisant le flux — et c'est exactement le genre de
    raisonnement structurel que ce chantier a trouvé faux à plusieurs reprises. Une
    fenêtre qui laisserait un agent appeler un outil auquel il n'a pas droit ne serait
    pas une observation, ce serait une élévation de privilège à durée déterminée.
    """
    tenant_id = _tenant(db)
    _open(db, tenant_id)

    policy = parse_policy(
        "tools:\n"
        "  - name: mock.echo\n"
        "    class: read\n"
        "    approval: auto\n"
        "    constraints:\n"
        '      allowed_clients: ["c1"]\n'
        "defaults: {unknown_tool: deny}\n"
    )
    proxy = DownstreamProxy(
        [
            ServerSpec(
                name="mock",
                transport="stdio",
                config={"command": sys.executable, "args": [str(_MOCK)]},
            )
        ]
    )
    backend = PolicyBackend(
        policy,
        proxy,
        ApprovalContext(
            database_url=db.url,
            tenant_id=tenant_id,
            timeout_seconds=3600,
            gateway_token_id=_TOKEN,
            client_id="c2",  # hors de l'allowlist
        ),
    )

    result = await backend.call_tool("echo", {"text": "bonjour"})

    assert result.isError is True
    assert "not authorized" in _text(result)
    assert _decisions(db, tenant_id) == ["rbac_denied"]

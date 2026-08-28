"""AD-25 / FR-176 — le chemin de décision ne peut pas joindre le réseau.

Deux moitiés, et la seconde est celle qui compte. La première affirme que le pli réel
est propre (`SM-15 = 0`). Mais une garde qui n'a jamais échoué est indiscernable d'une
garde cassée : si `_reseau` ne reconnaissait plus rien, ou si le parcours s'arrêtait à
la première arête, le dépôt resterait vert pour toujours. La seconde moitié la fait
donc échouer exprès, sur les trois formes qu'elle est censée attraper.
"""

from __future__ import annotations

import re
import socket
import sys
from pathlib import Path
from uuid import uuid4

import pytest

from core import approvals
from core.policy import parse_policy
from gateway.downstream import DownstreamProxy, ServerSpec
from gateway.server import ApprovalContext, PolicyBackend
from scripts import audit_sovereignty as sov
from tests.conftest import DBHandle

_MOCK = Path(__file__).resolve().parent / "fixtures" / "mock_mcp_server.py"


# --- 1. Le pli réel ---------------------------------------------------------------


def test_the_real_decision_path_cannot_reach_the_network() -> None:
    """`SM-15 = 0` : la métrique que la revendication de souveraineté engage."""
    violations, erreurs = sov.audit()
    assert erreurs == []
    assert violations == [], "\n".join(
        f"{v.module} peut sortir ({', '.join(v.reseau)}) via {' → '.join(v.chemin)}"
        for v in violations
    )


def test_every_declared_exemption_is_still_on_the_path() -> None:
    """Une exemption périmée protège un défaut futur ; `audit` la signale."""
    _, vus, _ = sov._closure(sov._sources())
    assert set(sov._HORS_PLI) <= vus


def test_each_exemption_carries_a_written_reason() -> None:
    """Le hors-pli est une revendication de revue, pas une liste de noms."""
    for module, raison in sov._HORS_PLI.items():
        assert len(raison) > 80, f"{module} est exempté sans justification lisible"


# --- 2. La garde échoue-t-elle quand elle doit ? -----------------------------------


def _arbre(tmp_path: Path, modules: dict[str, str]) -> dict[str, Path]:
    """Un faux graphe d'imports sur disque, rendu au format de `_sources`."""
    sources = {}
    for nom, code in modules.items():
        path = tmp_path / f"{nom.replace('.', '_')}.py"
        path.write_text(code, encoding="utf-8")
        sources[nom] = path
    return sources


def test_the_gate_catches_a_fold_module_that_gains_egress(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Le contrôle négatif : un filtre qui gagne `httpx` fait échouer le build.

    C'est exactement le défaut qu'`AD-25` dit prévenir — « une fonctionnalité future
    ajoutant discrètement un appel hors UE ». Sans ce test, rien ne dirait que la
    garde le verrait encore.
    """
    monkeypatch.setattr(sov, "_ADAPTATEURS", ("faux.adaptateur",))
    monkeypatch.setattr(sov, "_HORS_PLI", {})
    sources = _arbre(
        tmp_path,
        {
            "faux.adaptateur": "from faux import filtre\n",
            "faux.filtre": "import httpx\n",
        },
    )

    violations, _, _ = sov._closure(sources)

    assert [v.module for v in violations] == ["faux.filtre"]
    assert violations[0].reseau == ("httpx",)
    # Le chemin est rendu pour que l'échec soit réparable sans relire le graphe.
    assert violations[0].chemin == ("faux.adaptateur", "faux.filtre")


def test_the_gate_catches_an_import_deferred_into_a_function_body(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Un `import` dans un corps de fonction sort autant qu'un import de module.

    `gateway/server.py` en contient un (le juge, ligne 551) : une analyse limitée aux
    noeuds de tête le manquerait, et déplacer un import de trois lignes suffirait à
    contourner la garde.
    """
    monkeypatch.setattr(sov, "_ADAPTATEURS", ("faux.adaptateur",))
    monkeypatch.setattr(sov, "_HORS_PLI", {})
    sources = _arbre(
        tmp_path,
        {
            "faux.adaptateur": "from faux import filtre\n",
            "faux.filtre": "def f():\n    import requests\n    return requests\n",
        },
    )

    violations, _, _ = sov._closure(sources)

    assert [v.module for v in violations] == ["faux.filtre"]
    assert violations[0].reseau == ("requests",)


def test_the_gate_does_not_traverse_through_a_module_it_exempts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Ce qu'un module hors pli tire derrière lui ne devient pas le chemin de décision.

    Sinon exempter le relais reviendrait à exempter tout ce que le relais importe, et
    l'exemption cesserait d'être bornée.
    """
    monkeypatch.setattr(sov, "_ADAPTATEURS", ("faux.adaptateur",))
    monkeypatch.setattr(sov, "_HORS_PLI", {"faux.relais": "relais après décision"})
    sources = _arbre(
        tmp_path,
        {
            "faux.adaptateur": "from faux import relais\n",
            "faux.relais": "import httpx\nfrom faux import transport\n",
            "faux.transport": "import socket\n",
        },
    )

    violations, vus, _ = sov._closure(sources)

    assert violations == []
    assert "faux.transport" not in vus, "le parcours a traversé un module hors pli"


def test_a_stale_exemption_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    """Un module exempté qui a quitté le chemin doit être retiré, pas oublié."""
    monkeypatch.setitem(sov._HORS_PLI, "cli.main", "exemption qui ne s'applique plus")
    _, erreurs = sov.audit()
    assert any("exemption périmée" in e and "cli.main" in e for e in erreurs)


def test_the_gate_refuses_an_import_it_cannot_follow(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Une garde statique n'est vraie que si son graphe est complet.

    Un import calculé rendrait le parcours aveugle sans rien changer à l'affichage :
    `SM-15 = 0` continuerait de s'imprimer après que la garde a cessé de regarder.
    Le dépôt n'en contient aucun, donc les refuser ferme le trou au lieu de le
    documenter à côté.
    """
    monkeypatch.setattr(sov, "_ADAPTATEURS", ("faux.adaptateur",))
    monkeypatch.setattr(sov, "_HORS_PLI", {})
    sources = _arbre(
        tmp_path,
        {
            "faux.adaptateur": "from faux import filtre\n",
            "faux.filtre": (
                "import importlib\n\n\ndef f():\n    return importlib.import_module('httpx')\n"
            ),
        },
    )

    _, _, opaques = sov._closure(sources)

    assert any("import calculé" in o and "faux.filtre" in o for o in opaques)


def test_the_gate_refuses_a_relative_import(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Même raison : l'analyse ne résout pas les imports relatifs, elle les refuse."""
    monkeypatch.setattr(sov, "_ADAPTATEURS", ("faux.adaptateur",))
    monkeypatch.setattr(sov, "_HORS_PLI", {})
    sources = _arbre(
        tmp_path,
        {
            "faux.adaptateur": "from faux import filtre\n",
            "faux.filtre": "from . import voisin\n",
        },
    )

    _, _, opaques = sov._closure(sources)

    assert any("import relatif" in o for o in opaques)


# --- 3. La revendication hors ligne, de bout en bout (FR-177) ----------------------


def _bloque_hors_perimetre(monkeypatch: pytest.MonkeyPatch) -> None:
    """Coupe toute connexion sortante ; le périmètre de l'exploitant reste joignable.

    Le critère de `QO-3` est la dépendance opérationnelle, pas l'absence de socket :
    Postgres est *dans* le périmètre. Le harnais le modélise en n'autorisant que la
    boucle locale, où tourne le cluster éphémère des tests.

    Portée, dite plutôt que sous-entendue : le blocage voit les sockets **Python**.
    `libpq` ouvre les siens en C et passe donc à travers — ce qui est sans effet ici
    (Postgres est autorisé), mais signifie qu'une sortie ouverte depuis une extension
    native échapperait à ce harnais. C'est l'analyse statique qui couvre ce cas, et
    c'est la raison pour laquelle les deux moitiés existent.
    """
    reel = socket.socket.connect

    def connect(self: socket.socket, address: object) -> None:
        hote = address[0] if isinstance(address, tuple) else ""
        if hote not in ("127.0.0.1", "::1", "localhost"):
            raise OSError(f"egress bloqué par le harnais de souveraineté : {address!r}")
        reel(self, address)  # type: ignore[arg-type]

    monkeypatch.setattr(socket.socket, "connect", connect)


def test_the_offline_harness_actually_blocks(monkeypatch: pytest.MonkeyPatch) -> None:
    """Le contrôle négatif du harnais lui-même.

    Sans lui, le test hors ligne ci-dessous passerait même si le blocage ne bloquait
    rien — il prouverait « une décision a été rendue », pas « rendue sans sortir ».
    """
    _bloque_hors_perimetre(monkeypatch)
    with pytest.raises(OSError, match="egress bloqué"):
        socket.create_connection(("93.184.216.34", 443), timeout=1)


async def test_an_irreversible_action_is_still_held_with_all_egress_cut(
    db: DBHandle, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`FR-176` en exécution : le verdict se rend sans qu'aucun appel ne sorte.

    L'analyse statique dit que rien ne *peut* sortir ; ceci dit que rien n'en a
    besoin. Les deux sont nécessaires — un module peut être réseau-muet et dépendre
    d'un autre qui, lui, échouerait sans réseau.
    """
    tenant_id = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant_id,))
    db.conn.commit()

    policy = parse_policy(
        "tools:\n"
        "  - {name: mock.echo, class: read, approval: auto}\n"
        "  - {name: mock.delete_contact, class: irreversible, approval: human_in_the_loop}\n"
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
        policy, proxy, ApprovalContext(database_url=db.url, tenant_id=tenant_id, timeout_seconds=60)
    )

    _bloque_hors_perimetre(monkeypatch)

    held = await backend.call_tool("delete_contact", {"contact_id": "c1"})
    assert held.isError is True
    text = held.content[0].text  # type: ignore[attr-defined]
    assert "requires_approval" in text
    assert "deleted" not in text

    # Et la moitié passante : hors ligne, un appel légitime aboutit encore. Une garde
    # qui refuse tout serait « hors ligne » sans rien prouver.
    match = re.search(r"approval_id=([0-9a-f-]+)", text)
    assert match is not None
    approval_id = match.group(1)
    approvals.decide(db.conn, tenant_id, approval_id, "approve", "op-1")
    done = await backend.call_tool("delete_contact", {"contact_id": "c1"})
    assert done.isError is False
    assert "deleted c1" in done.content[0].text  # type: ignore[attr-defined]

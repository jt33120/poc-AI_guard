"""`EXH-9`, seconde moitié — publier ce que la passerelle coûte, sans surpromettre.

> *« An inline gateway with no published p95 overhead number will be rejected on that
> basis alone. »* — `docs/product/PLAN-REVIEW.md`

Le constat est juste, et la réponse évidente serait un p95 en millisecondes. Ce module
ne le produit pas, délibérément, et c'est la partie du travail qui demande d'être
défendue plutôt que codée.

**Pourquoi pas une milliseconde.** Un chiffre de latence n'est un engagement que si les
conditions qui l'ont produit ressemblent à celles du client. Les nôtres n'y ressemblent
pas : le cluster de test tourne `fsync=off`, `synchronous_commit=off`,
`full_page_writes=off` (`tests/pgcluster.py`), donc chaque commit chronométré ici est
plus rapide qu'aucun commit ne le sera jamais en production ; et un exécuteur CI
partagé n'a pas de p95 reproductible. Publier ce nombre en l'appelant « notre surcoût »
serait exactement la classe d'affirmation que ce dépôt passe son temps à retirer — la
même que la sonde de readiness verte sur un émetteur illisible (`FR-195`).

**Ce qui est publié à la place.** Le nombre de **connexions PostgreSQL** et
d'**allers-retours SQL** que la chaîne de gardes exige par appel, chemin par chemin.
Ce sont des entiers, ils ne dépendent d'aucune machine, et ils répondent mieux à la
question de l'acheteur : `core/db.py` ouvre **une connexion neuve par opération** — il
n'y a pas de pool — donc « deux connexions par appel autorisé » dit son coût dans
n'importe quel centre de données, une fois multiplié par la latence d'établissement
que l'exploitant, lui, connaît. Un gate d'entiers ne flotte pas ; un gate de
millisecondes sur un exécuteur partagé finirait désarmé, et un gate désarmé ne protège
rien.

Le registre attrape ce qui compte vraiment : une garde nouvelle qui ajoute un
aller-retour sur le chemin de décision devient visible au build suivant. C'est
précisément la régression qu'`EXH-9` redoute — « roughly nine guards on an inline hot
path » — et le défaut que la chasse à ce chiffre a d'abord trouvé, le document de
policy ré-analysé à chaque requête, en était déjà un cas.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from core.config import Settings
from core.policy import parse_policy
from gateway.downstream import DownstreamProxy, ServerSpec
from gateway.server import ApprovalContext, PolicyBackend
from tests.conftest import DBHandle

_REPO = Path(__file__).resolve().parent.parent
_COUNTS_OUT = _REPO / "perf" / ".counts.json"
_MOCK = _REPO / "tests" / "fixtures" / "mock_mcp_server.py"

#: La policy du registre. Petite et explicite : le registre compte des allers-retours,
#: pas du temps, donc sa taille ne change pas les chiffres — mais elle doit être
#: **lisible**, parce qu'un lecteur doit pouvoir refaire le raisonnement à la main.
_POLICY_YAML = """\
tools:
  - name: mock.echo
    class: read
    approval: auto
  - name: mock.delete_contact
    class: irreversible
    approval: human_in_the_loop
  - name: mock.mail_send
    class: external_send
    approval: deny
defaults:
  unknown_tool: deny
  hitl_timeout_seconds: 3600
  on_approval_service_down: deny
"""


class _Counts:
    """Connexions ouvertes et instructions SQL émises, sur une fenêtre."""

    def __init__(self) -> None:
        self.connections = 0
        self.statements = 0


@contextmanager
def _counting(monkeypatch: pytest.MonkeyPatch) -> Iterator[_Counts]:
    """Compter les E/S base réellement faites, sans toucher au code mesuré.

    On enveloppe `psycopg.connect` et `Cursor.execute` plutôt que d'instrumenter la
    passerelle : un compteur que le code mesuré connaît finit par mesurer le
    compteur.
    """
    counts = _Counts()
    vrai_connect = psycopg.connect
    vrai_execute = psycopg.Cursor.execute

    def connect(*a: Any, **k: Any) -> Any:
        counts.connections += 1
        return vrai_connect(*a, **k)

    def execute(self: Any, *a: Any, **k: Any) -> Any:
        counts.statements += 1
        return vrai_execute(self, *a, **k)

    monkeypatch.setattr(psycopg, "connect", connect)
    monkeypatch.setattr(psycopg.Cursor, "execute", execute)
    try:
        yield counts
    finally:
        monkeypatch.undo()


def _tenant(db: DBHandle) -> str:
    tid = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'B')", (tid,))
    db.conn.commit()
    return str(tid)


def _backend(db: DBHandle, tenant_id: str) -> PolicyBackend:
    proxy = DownstreamProxy(
        [
            ServerSpec(
                name="mock",
                transport="stdio",
                config={"command": sys.executable, "args": [str(_MOCK)]},
            )
        ]
    )
    ctx = ApprovalContext(database_url=db.url, tenant_id=tenant_id, timeout_seconds=3600)
    return PolicyBackend(parse_policy(_POLICY_YAML), proxy, ctx)


def _record(nom: str, counts: _Counts, registre: dict[str, dict[str, int]]) -> None:
    registre[nom] = {"connexions": counts.connections, "instructions_sql": counts.statements}


async def test_the_registry_is_measured_and_written(
    db: DBHandle, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Mesurer le registre et l'écrire pour le gate. Aucun seuil ici — que des faits.

    L'assertion de dérive vit dans `scripts/measure_overhead.py --check`, comme
    `CM-7` vit dans `gen_coverage.py` : le test **produit** ce que le gate compare,
    pour la même raison — un test qui décide seul de ce qui est acceptable finit par
    être modifié en même temps que le code qu'il garde.
    """
    registre: dict[str, dict[str, int]] = {}
    tid = _tenant(db)

    # --- chemin MCP (obligatoire) -------------------------------------------------
    backend = _backend(db, tid)
    # Préchauffage : il peuple la table de routage aval, qui n'est bâtie qu'une fois
    # par session. La compter reviendrait à imputer à chaque appel un coût de
    # démarrage que l'agent ne paie qu'au premier.
    await backend.call_tool("echo", {"text": "chauffe"})
    for nom, outil, args in (
        ("mcp.autorise", "echo", {"text": "a"}),
        ("mcp.refuse", "mail_send", {"to": "a@b.test", "subject": "s"}),
        ("mcp.premiere_attente", "delete_contact", {"contact_id": "c1"}),
    ):
        with _counting(monkeypatch) as c:
            await backend.call_tool(outil, args)
        _record(nom, c, registre)

    # --- chemin HTTP (coopératif) -------------------------------------------------
    # Peu d'échantillons, et c'est délibéré : les comptes sont déterministes, donc
    # répéter n'apporte rien — et `AUTHORIZE_RATE_LIMIT` vaut 120/minute, donc une
    # boucle longue mesurerait des 429 au lieu de la chaîne de gardes.
    app = create_app(Settings(_env_file=None, env="dev", database_url=db.url))
    client = TestClient(app)

    from core import policy_store, tenant_tokens

    policy_store.save_yaml(db.conn, tid, _POLICY_YAML)
    brut, _ = tenant_tokens.mint(db.conn, tenant_id=tid, name="bench")
    db.conn.commit()
    entetes = {"X-Gateway-Token": brut}

    for nom, outil in (("http.autorise", "mock.echo"), ("http.refuse", "mock.mail_send")):
        with _counting(monkeypatch) as c:
            client.post(
                "/v1/authorize",
                headers=entetes,
                json={"tool": outil, "arguments": {"to": "a@b.test", "subject": "s"}},
            )
        _record(nom, c, registre)

    _COUNTS_OUT.parent.mkdir(parents=True, exist_ok=True)
    _COUNTS_OUT.write_text(json.dumps(registre, indent=2, sort_keys=True), encoding="utf-8")

    # Le seul controle ici : la mesure a bien eu lieu sur chaque chemin. Un registre
    # a zero connexion voudrait dire qu'on a mesure a cote.
    assert set(registre) == {
        "mcp.autorise",
        "mcp.refuse",
        "mcp.premiere_attente",
        "http.autorise",
        "http.refuse",
    }
    assert all(v["connexions"] > 0 for v in registre.values()), registre


def test_the_counter_sees_a_connection_it_did_not_make(monkeypatch: pytest.MonkeyPatch) -> None:
    """Le controle de non-vacuite du compteur lui-meme.

    Un compteur qui rend toujours zero satisferait un registre entier sans rien
    mesurer. Celui-ci doit voir une connexion faite hors de son propre code.
    """
    with _counting(monkeypatch) as c:
        assert c.connections == 0
        with pytest.raises(psycopg.Error):
            psycopg.connect("postgresql://127.0.0.1:1/nulle-part", connect_timeout=1)
    assert c.connections == 1

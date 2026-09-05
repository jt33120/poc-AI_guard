"""`FR-163` — rien d'illimité n'entre dans une charge que personne ne peut corriger.

Le constat hérité annonçait un puits de texte libre par une colonne `note` d'événement
de plan de contrôle. Cette colonne n'existe pas, et le plan de contrôle n'écrit rien
dans `audit_log` — mais le puits, lui, était ouvert, sur des colonnes que le constat
ne nommait pas et par des portes qui existent déjà.

`payload_v1` n'impose ni longueur ni vocabulaire, `audit_log.tool_name/error/
policy_rule_id` sont des `text` sans contrainte, et le journal est append-only sans
aucun chemin d'effacement (`CLAUDE.md` §4.2) : ce qui y entre y reste. Or deux des
trois portes laissaient passer une chaîne **choisie par un tiers** :

* `gateway/server.py` — un nom d'outil que la résolution n'a pas reconnu est repris
  tel quel, donc choisi par l'agent ;
* `api/llm_proxy.py` — le nom d'outil vient du corps de réponse du fournisseur LLM,
  ni borné ni même typé.

La troisième porte était déjà fermée : `AuthorizeRequest.tool` est borné à 200
caractères depuis toujours. C'est cette borne-là qui est reprise ici, pas un nombre
neuf — l'écart n'était pas qu'il fallait choisir une limite, c'est que deux portes
sur trois ne l'appliquaient pas (`AD-28`).
"""

from __future__ import annotations

import pytest

from core import audit
from core.schemas import AuthorizeRequest
from tests.conftest import DBHandle

_ORIGIN = audit.Origin.mcp_gateway()


def test_the_three_ingress_paths_share_one_bound() -> None:
    """La porte coopérative posait déjà la borne ; les deux autres l'empruntent.

    Épinglé pour que la valeur ne puisse pas diverger en silence : deux bornes
    différentes sur le même champ selon la porte, c'est `AD-28` violé par un nombre.
    """
    field = AuthorizeRequest.model_fields["tool"]
    bound = next(m.max_length for m in field.metadata if hasattr(m, "max_length"))
    assert bound == audit.MAX_FIELD


def test_an_unbounded_tool_name_does_not_enter_the_chained_payload(db: DBHandle) -> None:
    """La borne s'applique avant le hachage, et la chaîne reste vérifiable.

    Les deux assertions comptent autant l'une que l'autre. La première dit que la
    valeur non bornée n'entre pas ; la seconde dit que le correctif n'est pas une
    panne — borner l'insertion sans borner le hachage (ou l'inverse) rendrait
    l'entrée définitivement invérifiable, sur une table qu'aucun UPDATE ne répare.
    """
    audit.log_event(
        db.conn,
        tenant_id="t1",
        decision="deny",
        tool_name="X" * 5000,
        policy_rule_id="R" * 5000,
        error="Y" * 5000,
        origin=_ORIGIN,
    )
    row = db.conn.execute(
        "select tool_name, policy_rule_id, error from audit_log limit 1"
    ).fetchone()
    assert row is not None
    assert all(len(value) <= audit.MAX_FIELD for value in row)
    assert audit.verify_chain(db.conn, "t1").ok is True


def test_a_bounded_value_is_stored_verbatim(db: DBHandle) -> None:
    """Le contrôle qui empêche la troncature d'être une mutilation générale.

    Sans lui, `_bounded` pourrait tronquer tout le monde à un caractère et les deux
    autres tests resteraient verts.
    """
    audit.log_event(
        db.conn, tenant_id="t2", decision="deny", tool_name="crm.delete_customer", origin=_ORIGIN
    )
    row = db.conn.execute("select tool_name from audit_log limit 1").fetchone()
    assert row is not None and row[0] == "crm.delete_customer"


@pytest.mark.parametrize("value", [{"a": 1}, ["x"], 42])
def test_a_non_string_tool_name_still_produces_an_entry(db: DBHandle, value: object) -> None:
    """Un fournisseur LLM qui renvoie autre chose qu'une chaîne ne supprime pas la preuve.

    C'est la conséquence à laquelle on ne pense pas : l'insertion d'un objet dans une
    colonne `text` échoue, l'écriture d'audit est enveloppée dans un best-effort chez
    tous ses appelants, et l'appel refusé part donc **sans ligne d'audit**. Un amont
    hostile obtenait ainsi la suppression de sa propre trace en renvoyant un nom
    d'outil malformé.
    """
    audit.log_event(
        db.conn,
        tenant_id="t3",
        decision="deny",
        tool_name=value,  # type: ignore[arg-type]
        origin=_ORIGIN,
    )
    row = db.conn.execute("select tool_name from audit_log limit 1").fetchone()
    assert row is not None and isinstance(row[0], str)
    assert audit.verify_chain(db.conn, "t3").ok is True

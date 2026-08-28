"""FR-184 / G-04 — la provenance des corpus est déclarée, datée, et périssable.

`M-03 / provenance` est publié en mode **`A` — Attesté**, et le mot est le périmètre :
xSOM ne vérifie pas d'où viennent les données d'un client, il rend sa déclaration
auditable. Prétendre bloquer l'empoisonnement de données serait faux, et `FR-175`
refuse d'écrire « nous bloquons » sur une ligne `Attesté`.

Ce que ces tests fixent, c'est la différence entre une attestation et un formulaire :
la **fraîcheur**. Une déclaration faite une fois et jamais revue ne dit presque rien.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest

from core import corpora
from tests.conftest import DBHandle

_NOW = datetime.now(UTC)


def _tenant(db: DBHandle, name: str = "A") -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, %s)", (tid, name))
    db.conn.commit()
    return tid


def _declare(db: DBHandle, tid: str, **kw: Any) -> corpora.Corpus:
    defaults: dict[str, Any] = {
        "name": "base-clients",
        "kind": "vector_store",
        "source": "export CRM interne, hebdomadaire",
        "steward": "Direction des données",
        "last_reviewed_at": _NOW - timedelta(days=10),
    }
    return corpora.declare(db.conn, tenant_id=tid, **{**defaults, **kw})


def test_a_declaration_is_stored_with_its_review_date(db: DBHandle) -> None:
    tid = _tenant(db)
    corpus = _declare(db, tid)
    assert corpus.kind == "vector_store"
    assert corpus.steward == "Direction des données"
    assert corpus.stale is False


def test_redeclaring_replaces_rather_than_stacks(db: DBHandle) -> None:
    """« Quelle est la provenance de ce corpus » doit avoir une réponse, pas une pile.

    L'historique appartient au journal d'audit ; ceci porte l'état. Deux déclarations
    concurrentes obligeraient un lecteur à deviner laquelle fait foi.
    """
    tid = _tenant(db)
    _declare(db, tid, source="export CRM interne")
    _declare(db, tid, source="export CRM interne + tickets support")
    db.conn.commit()

    tous = corpora.list_corpora(db.conn)
    assert len(tous) == 1
    assert tous[0].source == "export CRM interne + tickets support"


def test_an_unreviewed_declaration_goes_stale(db: DBHandle) -> None:
    """La propriété qui empêche l'attestation d'être décorative.

    Le corpus a changé, la source a changé, le responsable est parti — et la
    déclaration, elle, est toujours là. La péremption est ce qui rend le bloc
    actionnable pour un auditeur.
    """
    tid = _tenant(db)
    vieux = _NOW - timedelta(days=corpora.REVIEW_HORIZON_DAYS + 1)
    corpus = _declare(db, tid, last_reviewed_at=vieux)
    assert corpus.stale is True
    assert corpus.review_age_days > corpora.REVIEW_HORIZON_DAYS


def test_a_review_dated_in_the_future_is_refused(db: DBHandle) -> None:
    """Une revue à venir n'est pas une revue.

    Sans ce refus, une déclaration périmée se rajeunit d'une frappe — et la
    péremption, qui est tout l'intérêt du champ, devient facultative.
    """
    tid = _tenant(db)
    with pytest.raises(corpora.CorpusError, match="futur"):
        _declare(db, tid, last_reviewed_at=_NOW + timedelta(days=1))


def test_an_unknown_kind_is_refused(db: DBHandle) -> None:
    """Le vocabulaire est fermé : la distinction porte le risque.

    Un index alimenté en continu se ré-empoisonne ; un jeu figé non. Un champ libre
    effacerait la seule chose que ce champ sert à dire.
    """
    tid = _tenant(db)
    with pytest.raises(corpora.CorpusError, match="type inconnu"):
        _declare(db, tid, kind="peu importe")


def test_the_evidence_section_publishes_staleness_not_just_a_count(db: DBHandle) -> None:
    """`FR-184` : le bloc porte le compte **et** la péremption.

    Publier « 3 corpus déclarés » sans dire que deux sont périmés transformerait une
    attestation en argument — l'inverse exact de son usage devant un auditeur.
    """
    tid = _tenant(db)
    vieux = _NOW - timedelta(days=corpora.REVIEW_HORIZON_DAYS + 30)
    _declare(db, tid, name="frais", last_reviewed_at=_NOW - timedelta(days=5))
    _declare(db, tid, name="perime-1", kind="dataset", last_reviewed_at=vieux)
    _declare(db, tid, name="perime-2", kind="dataset", last_reviewed_at=vieux)
    db.conn.commit()

    section = corpora.provenance_section(db.conn)

    assert section["declared"] == 3
    assert section["stale"] == 2
    assert section["stale_names"] == ["perime-1", "perime-2"]
    assert section["by_kind"] == {"dataset": 2, "vector_store": 1}
    # Le bloc dit lui-même ce qu'il n'est pas : la phrase voyage avec la donnée, donc
    # elle ne peut pas être perdue en la citant.
    assert "ne vérifie pas" in section["basis"]


def test_the_section_is_honest_about_an_empty_registry(db: DBHandle) -> None:
    """Zéro déclaré n'est pas « rien à déclarer ».

    Le bloc doit sortir quand même : une section absente se lit comme un oubli de
    l'outil, une section à zéro se lit comme un fait sur le client.
    """
    _tenant(db)
    section = corpora.provenance_section(db.conn)
    assert section["declared"] == 0
    assert section["stale"] == 0
    assert section["by_kind"] == {}

"""`FR-191` — un verdict tiers reçu, chaîné, et jamais rejugé.

Le mode revendiqué est `Orchestré`, et toute la valeur du lot tient à ce que ce mot
soit exact. « Un contrôle tiers fait le travail ; xSOM collecte son verdict et le
chaîne » : l'analyseur tourne chez le client, avec ses règles, et nous n'en tirons
aucune conclusion propre. Écrire notre propre analyseur serait construire le contrôle
au lieu de l'orchestrer — le franchissement que `CLAUDE.md` §2 interdit.

Ce que ces tests gardent, c'est donc autant ce que le produit fait que ce qu'il ne fait
pas.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import psycopg
import pytest

from core import verdicts
from tests.conftest import DBHandle


def _tenant(db: DBHandle) -> str:
    tenant_id = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant_id,))
    db.conn.commit()
    return tenant_id


def _receipt(**overrides: object) -> verdicts.Receipt:
    base = {
        "analyzer": "semgrep",
        "analyzer_version": "1.86.0",
        "ruleset": "p/ci",
        "repository": "acme/api",
        "commit_sha": "9f1c2ab",
        "verdict": "pass",
        "findings": {"high": 0, "medium": 2},
        "ran_at": datetime(2026, 3, 1, 9, 0, tzinfo=UTC),
    }
    base.update(overrides)
    return verdicts.Receipt(**base)  # type: ignore[arg-type]


@pytest.mark.covers("M-15", "sast", ingress="http", sens="verdict_tiers")
async def test_a_third_party_verdict_enters_a_chain(db: DBHandle) -> None:
    """La preuve exigible du mode `Orchestré`.

    Nommer le substitut — ce que `FR-178` demandait déjà — dit **qui** est le tiers.
    Il ne dit pas qu'une seule ligne de ce que le tiers a conclu nous soit parvenue.
    C'est cette seconde moitié qui manquait aux cinq facettes `O` du registre, et
    c'est elle qu'on asserte ici : le reçu est stocké, son empreinte est chaînée, et
    la chaîne se vérifie.
    """
    tenant_id = _tenant(db)
    entry_hash = verdicts.ingest(db.conn, tenant_id=tenant_id, receipt=_receipt())
    db.conn.commit()

    row = db.conn.execute(
        "select analyzer, verdict, receipt_digest, prev_hash, entry_hash "
        "from third_party_verdicts where tenant_id = %s",
        (tenant_id,),
    ).fetchone()
    assert row is not None
    assert row[0] == "semgrep" and row[1] == "pass"
    assert row[3] == "GENESIS" and row[4] == entry_hash
    assert verdicts.verify_chain(db.conn, tenant_id).ok is True


async def test_the_chain_links_successive_receipts(db: DBHandle) -> None:
    """Chaîner un seul reçu ne prouve rien : c'est le lien qui rend l'insertion visible."""
    tenant_id = _tenant(db)
    first = verdicts.ingest(db.conn, tenant_id=tenant_id, receipt=_receipt())
    second = verdicts.ingest(db.conn, tenant_id=tenant_id, receipt=_receipt(commit_sha="0ab99f1"))
    db.conn.commit()

    rows = db.conn.execute(
        "select prev_hash, entry_hash from third_party_verdicts where tenant_id = %s order by id",
        (tenant_id,),
    ).fetchall()
    assert rows[0][1] == first
    assert rows[1][0] == first and rows[1][1] == second
    result = verdicts.verify_chain(db.conn, tenant_id)
    assert result.ok is True and result.count == 2


async def test_the_table_refuses_to_be_rewritten(db: DBHandle) -> None:
    """Append-only, y compris pour le backend.

    Une preuve qu'on peut corriger n'en est pas une. Le trigger lève pour
    `service_role` comme pour les autres, donc ce test — qui tourne sur la connexion
    de service — est le bon endroit pour le montrer.
    """
    tenant_id = _tenant(db)
    verdicts.ingest(db.conn, tenant_id=tenant_id, receipt=_receipt())
    db.conn.commit()

    with pytest.raises(psycopg.errors.RaiseException):
        db.conn.execute("update third_party_verdicts set verdict = 'pass'")
    db.conn.rollback()
    with pytest.raises(psycopg.errors.RaiseException):
        db.conn.execute("delete from third_party_verdicts")
    db.conn.rollback()


async def test_a_tampered_receipt_breaks_the_chain(db: DBHandle) -> None:
    """Le contrôle négatif de la chaîne : sait-elle seulement dire non ?

    Le trigger empêche la réécriture, donc la falsification est simulée en insérant
    directement une ligne dont l'empreinte ne correspond pas — c'est ce qu'obtiendrait
    quelqu'un ayant contourné l'API. Sans cette assertion, `verify_chain` pourrait
    renvoyer `ok` sur n'importe quoi et les deux tests ci-dessus resteraient verts.
    """
    tenant_id = _tenant(db)
    verdicts.ingest(db.conn, tenant_id=tenant_id, receipt=_receipt())
    db.conn.commit()
    db.conn.execute(
        "insert into third_party_verdicts (tenant_id, analyzer, analyzer_version, ruleset, "
        " repository, commit_sha, verdict, findings, ran_at, receipt_digest, prev_hash, "
        " entry_hash) values (%s, 'semgrep', '1', 'p/ci', 'acme/api', 'deadbee', 'pass', "
        " '{}'::jsonb, now(), 'digest-inventé', 'GENESIS', 'hash-inventé')",
        (tenant_id,),
    )
    db.conn.commit()

    result = verdicts.verify_chain(db.conn, tenant_id)
    assert result.ok is False and result.broken_id is not None


async def test_the_same_receipt_twice_is_refused(db: DBHandle) -> None:
    """« Déjà reçu » et « reçu deux fois » ne sont pas la même chose pour qui relit."""
    tenant_id = _tenant(db)
    verdicts.ingest(db.conn, tenant_id=tenant_id, receipt=_receipt())
    db.conn.commit()
    with pytest.raises(verdicts.DuplicateReceipt):
        verdicts.ingest(db.conn, tenant_id=tenant_id, receipt=_receipt())
    db.conn.rollback()


async def test_the_digest_covers_the_verdict_itself(db: DBHandle) -> None:
    """Deux reçus qui ne diffèrent que par leur conclusion ont deux empreintes.

    C'est l'assertion qui empêche l'empreinte d'être un identifiant déguisé : si elle
    ne couvrait que l'analyseur et le commit, un `fail` remplacé par un `pass`
    passerait la vérification de chaîne sans difficulté.
    """
    assert verdicts.receipt_digest(_receipt(verdict="pass")) != verdicts.receipt_digest(
        _receipt(verdict="fail")
    )


async def test_the_section_reports_staleness_not_just_a_count(db: DBHandle) -> None:
    """Publier « 2 analyseurs » sans dire qu'un n'a pas tourné depuis six mois
    transformerait l'attestation en argument — la leçon que `corpora` a déjà servie."""
    tenant_id = _tenant(db)
    # Les deux dates sont relatives à maintenant, sinon le test vieillit tout seul :
    # un `ran_at` en dur devient périmé le jour où il dépasse l'horizon, et le test
    # passerait alors pour une raison qui n'est pas celle qu'il énonce.
    frais = datetime.now(UTC) - timedelta(days=1)
    vieux = datetime.now(UTC) - timedelta(days=verdicts.STALE_AFTER_DAYS + 30)
    verdicts.ingest(db.conn, tenant_id=tenant_id, receipt=_receipt(ran_at=frais))
    verdicts.ingest(
        db.conn,
        tenant_id=tenant_id,
        receipt=_receipt(analyzer="pip-audit", ran_at=vieux, commit_sha="1234567"),
    )
    db.conn.commit()

    section = verdicts.provenance_section(db.conn)
    assert section["analyzers"] == 2
    assert section["stale"] == 1
    perimes = [a["analyzer"] for a in section["by_analyzer"] if a["stale"]]
    assert perimes == ["pip-audit"]
    assert "ne rejuge pas" in section["basis"]

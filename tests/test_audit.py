"""Immutable hash-chained audit log: chaining, tamper detection, append-only (M5)."""

from __future__ import annotations

import psycopg
import pytest

from core import audit
from tests.conftest import DBHandle

# `log_event` requires the ingestion adapter to name its door (FR-160). These
# tests exercise the audit store itself, not a door, so they all state the same
# one; the tests that care which door it was assert on it explicitly.
_ORIGIN = audit.Origin.mcp_gateway()


def test_log_event_chains_entries(db: DBHandle) -> None:
    audit.log_event(
        db.conn,
        tenant_id="t1",
        decision="allow",
        tool_name="a.b",
        args_hash="x" * 64,
        origin=_ORIGIN,
    )
    audit.log_event(
        db.conn,
        tenant_id="t1",
        decision="deny",
        tool_name="a.c",
        args_hash="y" * 64,
        origin=_ORIGIN,
    )
    rows = db.conn.execute("select prev_hash, entry_hash from audit_log order by id").fetchall()
    assert rows[0][0] == audit.GENESIS
    assert rows[1][0] == rows[0][1]  # each entry chains to the previous one
    result = audit.verify_chain(db.conn, "t1")
    assert result.ok is True and result.count == 2


def test_verify_chain_detects_tampering(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="allow", tool_name="a.b", origin=_ORIGIN)
    audit.log_event(db.conn, tenant_id="t1", decision="allow", tool_name="a.c", origin=_ORIGIN)
    # Simulate an attacker with elevated access bypassing the append-only triggers.
    with db.conn.transaction():
        db.conn.execute("set local session_replication_role = replica")
        db.conn.execute(
            "update audit_log set decision = 'deny' where id = (select min(id) from audit_log)"
        )
    result = audit.verify_chain(db.conn, "t1")
    assert result.ok is False and result.broken_id is not None


def test_only_args_hash_is_stored(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="allow", args_hash="a" * 64, origin=_ORIGIN)
    row = db.conn.execute("select args_hash from audit_log limit 1").fetchone()
    assert row is not None and len(row[0]) == 64
    cols = {
        r[0]
        for r in db.conn.execute(
            "select column_name from information_schema.columns where table_name = 'audit_log'"
        ).fetchall()
    }
    assert "arguments" not in cols and "args" not in cols  # no raw-args column exists
    # `FR-163`, seconde clause : aucune note libre d'opérateur dans le journal
    # inaltérable. Ce test lit le **schéma vivant**, donc il attrape une colonne
    # arrivée par n'importe quelle route — un `alter table` hors migration comme un
    # fichier que le parseur de `test_rls_gate.py` ne saurait pas lire.
    #
    # Il n'y en a aucune aujourd'hui, et c'est le moment de l'interdire : `audit_log`
    # n'a aucun chemin d'effacement, donc une note d'opérateur y serait un puits de
    # PII permanent — à rebours de `CLAUDE.md` §4.10 et de la position sur
    # l'effacement. Les motifs libres se stockent sur la ligne mutable de l'objet et
    # sont référencés par empreinte, comme la règle de policy YAML le fait déjà.
    free_text = {"note", "notes", "comment", "comments", "justification", "memo", "free_text"}
    assert not (cols & free_text) and not {c for c in cols if c.endswith("_reason_text")}


def test_append_only_triggers_block_update_and_delete(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="allow", origin=_ORIGIN)
    with pytest.raises(psycopg.errors.RaiseException):
        db.conn.execute("update audit_log set decision = 'x'")
    db.conn.rollback()
    with pytest.raises(psycopg.errors.RaiseException):
        db.conn.execute("delete from audit_log")
    db.conn.rollback()


def test_truncate_is_refused_like_update_and_delete(db: DBHandle) -> None:
    """Le trou que le test ci-dessus laissait, et qu'aucune relecture ne voit.

    `0005_audit_log.sql` annonce des « triggers that hard-block mutation even for the
    service role », et les deux triggers présents le font croire. Mais ils sont
    `for each row`, et **un trigger ligne à ligne ne se déclenche pas sur TRUNCATE** :
    il faut `before truncate ... for each statement`. Il fallait connaître cette
    sémantique de PostgreSQL pour voir le trou, et le contrôle d'à côté n'exerçait
    qu'`update` et `delete`.

    Ce n'est pas théorique : `core/db.py` documente que l'immuabilité repose sur la
    **propriété de table**, et un propriétaire a le droit de TRUNCATE.

    Et le mode d'échec est le pire possible — voir
    `test_an_annihilated_journal_is_not_reported_as_intact` : sur une table vide,
    `verify_chain` rend `ok=True`. La preuve détruite, et l'attestation qui dit que
    tout va bien.
    """
    audit.log_event(db.conn, tenant_id="t1", decision="allow", origin=_ORIGIN)
    db.conn.commit()
    with pytest.raises(psycopg.errors.RaiseException):
        db.conn.execute("truncate audit_log")
    db.conn.rollback()
    assert db.conn.execute("select count(*) from audit_log").fetchone()[0] == 1  # type: ignore[index]


def test_the_two_other_chained_tables_refuse_truncate_too(db: DBHandle) -> None:
    """`control_plane_events` et `third_party_verdicts` répètent le même patron.

    Les trois tables chaînées du dépôt ont été écrites sur le modèle de la première,
    trou compris. Les nommer ici plutôt que dans leurs fichiers respectifs met les
    trois assertions côte à côte : c'est la propriété qui est commune, pas la table.
    """
    for table in ("control_plane_events", "third_party_verdicts"):
        with pytest.raises(psycopg.errors.RaiseException):
            db.conn.execute(f"truncate {table}")
        db.conn.rollback()


def test_an_annihilated_journal_is_not_reported_as_intact(db: DBHandle) -> None:
    """Ce que `verify_chain` dit d'une table vide — et pourquoi ce n'est pas assez.

    Aucune ligne à parcourir, donc aucune rupture : `ok=True, count=0`. Le résultat
    est honnête pris isolément, et trompeur là où il est lu. C'est `count` qui porte
    l'information, et c'est à l'appelant d'en faire quelque chose — voir
    `core/compliance.py`, qui distingue désormais « chaîne intacte » de « chaîne
    vide » plutôt que de répondre `ready: true` sur un journal anéanti.

    Ce contrôle fige la sémantique pour qu'on ne « corrige » pas `verify_chain` en
    lui faisant rendre `ok=False` sur un tenant neuf, ce qui rendrait le démarrage
    de tout nouveau client indistinguable d'un effacement.
    """
    resultat = audit.verify_chain(db.conn)
    assert resultat.ok is True
    assert resultat.count == 0


def test_chain_is_per_tenant(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="allow", origin=_ORIGIN)
    audit.log_event(db.conn, tenant_id="t2", decision="allow", origin=_ORIGIN)
    rows = db.conn.execute("select prev_hash from audit_log order by id").fetchall()
    assert all(r[0] == audit.GENESIS for r in rows)  # each tenant starts from GENESIS
    assert audit.verify_chain(db.conn).ok is True

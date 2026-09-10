"""Les témoins signés de la chaîne (`FR-169` / `INV-12`).

**Le trou que ce lot referme, en une phrase.** `verify_chain` part de `GENESIS` et
marche vers l'avant sur les lignes qu'elle trouve : un préfixe amputé de ses dernières
lignes est parfaitement cohérent, seulement plus court, et rien dans la base ne dit
combien il comptait hier. Sur une table vide elle rend `ok=True, count=0` — la preuve
détruite, et l'attestation qui dit que tout va bien.

Les triggers de `0005`/`0028` protègent de l'accident et de l'injection ; ils ne
protègent pas de qui peut les retirer, et le backend est **propriétaire** des tables.
Le premier test de ce fichier fait exactement ce que ferait cet adversaire-là :
désactiver les triggers, supprimer la queue, les réactiver. Sans témoin, tout est
vert. C'est le contrôle qui vaut le fichier.

Le second sujet est plus fin et vaut d'être écrit : ce que le témoin **n'achète pas**.
L'indépendance ne vient pas de l'algorithme mais de la garde de la clé privée, et
aucun code ne peut constater où un opérateur range un secret. Trois tests tiennent
cette ligne, parce que c'est la moitié de FR-169 qu'on est le plus tenté d'oublier :
signer fort avec une clé posée à côté de la base ne rend rien indépendant.
"""

from __future__ import annotations

import base64
import os
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from core import audit, checkpoints, compliance
from core import db as core_db
from core.config import Settings
from tests.conftest import DBHandle

GRAINE = base64.b64encode(bytes(range(32))).decode()


def _settings(*, cle: str | None = GRAINE, garde: str | None = None) -> Settings:
    return Settings(
        _env_file=None,
        env="dev",
        checkpoint_signing_key=cle,
        checkpoint_key_custody=garde,
    )


def _signer() -> checkpoints.Signer:
    signeur = checkpoints.build_signer(_settings())
    assert signeur is not None
    return signeur


def _tenant(db: DBHandle) -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'W')", (tid,))
    db.conn.commit()
    return tid


def _ecrire(db: DBHandle, tenant_id: str, combien: int) -> None:
    with core_db.connection(db.url) as conn:
        for _ in range(combien):
            audit.log_event(
                conn, tenant_id=tenant_id, decision="allow", origin=audit.Origin.mcp_gateway()
            )
        conn.commit()


def _supprimer_la_queue(db: DBHandle, tenant_id: str, combien: int) -> None:
    """Ce que ferait le propriétaire des tables, et que rien dans la base n'empêche.

    `0005` et `0028` posent des triggers `before update / delete / truncate`. Un
    propriétaire les désactive, supprime, les réactive — et `core/db.py` documente
    explicitement que l'immuabilité du produit repose sur la propriété. C'est le
    scénario que le témoin existe pour rendre visible, donc c'est celui qu'on joue.
    """
    with psycopg.connect(db.url, autocommit=True) as adm:
        adm.execute("alter table audit_log disable trigger all")
        adm.execute(
            "delete from audit_log where id in ("
            "  select id from audit_log where tenant_id = %s order by id desc limit %s)",
            (tenant_id, combien),
        )
        adm.execute("alter table audit_log enable trigger all")


def _supprimer_au_milieu(db: DBHandle, tenant_id: str, combien: int) -> None:
    """Supprimer **au milieu**, en laissant la dernière ligne attestée en place.

    C'est la variante qui isole le comptage : la ligne que le témoin nomme existe
    toujours et porte toujours le bon hachage, donc les deux contrôles d'ancrage
    passent. Seul le **nombre** d'entrées jusqu'à elle a changé.
    """
    with psycopg.connect(db.url, autocommit=True) as adm:
        adm.execute("alter table audit_log disable trigger all")
        adm.execute(
            "delete from audit_log where id in ("
            "  select id from audit_log where tenant_id = %s order by id offset 1 limit %s)",
            (tenant_id, combien),
        )
        adm.execute("alter table audit_log enable trigger all")


# ---------------------------------------------------------------------------
# Ce que le témoin voit et que la chaîne ne voit pas
# ---------------------------------------------------------------------------
def test_a_deleted_tail_is_invisible_to_the_chain_and_obvious_to_the_witness(
    db: DBHandle,
) -> None:
    """**Le contrôle qui vaut le fichier.**

    Les deux moitiés comptent. `verify_chain` doit rester **verte** : la chaîne
    restante est réellement cohérente, et prétendre le contraire serait rendre un
    tenant neuf indistinguable d'un effacement. C'est le témoin, et lui seul, qui
    doit protester.
    """
    tenant = _tenant(db)
    _ecrire(db, tenant, 5)
    with core_db.connection(db.url) as conn:
        checkpoints.record(conn, tenant_id=tenant, signer=_signer())
        conn.commit()

    _supprimer_la_queue(db, tenant, 2)

    with core_db.connection(db.url) as conn:
        chaine = audit.verify_chain(conn, tenant)
        temoin = checkpoints.verify(conn, tenant)

    assert chaine.ok and chaine.count == 3, (
        "la chaîne devrait rester cohérente : un préfixe amputé l'est toujours"
    )
    assert not temoin.ok and temoin.truncated
    assert temoin.detail is not None and "missing 2 entries" in temoin.detail


def test_a_wiped_journal_stops_attesting_that_all_is_well(db: DBHandle) -> None:
    """L'état extrême de `0028` : zéro ligne, `ok=True, count=0`, et tout va bien.

    Avec un témoin, l'affirmation « cette chaîne comptait 4 entrées » survit à
    l'effacement — parce qu'elle n'est pas dans la table effacée.
    """
    tenant = _tenant(db)
    _ecrire(db, tenant, 4)
    with core_db.connection(db.url) as conn:
        checkpoints.record(conn, tenant_id=tenant, signer=_signer())
        conn.commit()

    _supprimer_la_queue(db, tenant, 4)

    with core_db.connection(db.url) as conn:
        assert audit.verify_chain(conn, tenant).ok, "la table vide se vérifie, c'est le défaut"
        temoin = checkpoints.verify(conn, tenant)
    assert not temoin.ok and temoin.truncated


def test_writing_more_entries_never_looks_like_a_deletion(db: DBHandle) -> None:
    """Le contrôle compte `id <= last_audit_id`, pas le total.

    Sur le total, chaque entrée écrite depuis le témoin masquerait une suppression,
    une pour une — c'est-à-dire que le garde s'éteindrait tout seul sur un tenant
    actif, celui qui a le plus à perdre.
    """
    tenant = _tenant(db)
    _ecrire(db, tenant, 3)
    with core_db.connection(db.url) as conn:
        checkpoints.record(conn, tenant_id=tenant, signer=_signer())
        conn.commit()
    _ecrire(db, tenant, 10)

    with core_db.connection(db.url) as conn:
        assert checkpoints.verify(conn, tenant).ok

    _supprimer_la_queue(db, tenant, 11)  # il reste 2 des 3 attestées
    with core_db.connection(db.url) as conn:
        assert not checkpoints.verify(conn, tenant).ok


def test_fresh_writes_can_never_paper_over_a_deletion(db: DBHandle) -> None:
    """**Le contrôle qui isole le comptage, et il a fallu un banc pour le trouver.**

    Les contrôles ci-dessus suppriment la **queue** : la ligne que le témoin nomme
    disparaît, donc l'ancrage suffit à protester et le comptage n'est jamais interrogé.
    Un garde qui compterait le total les passerait tous.

    Ici la suppression est **au milieu** et suivie de dix écritures neuves. La
    dernière ligne attestée existe toujours et porte toujours son hachage — les deux
    contrôles d'ancrage sont muets. Le total repasse largement au-dessus de trois,
    donc un garde qui le compterait dirait que tout va bien. Seul le décompte
    `id <= last_audit_id` voit qu'il manque deux entrées.

    C'est le mode de panne le plus vicieux du lot : il éteint le garde tout seul,
    **sur le tenant le plus actif** — celui qui a le plus à perdre, et celui chez qui
    une suppression passe le plus inaperçue.
    """
    tenant = _tenant(db)
    _ecrire(db, tenant, 5)
    with core_db.connection(db.url) as conn:
        checkpoints.record(conn, tenant_id=tenant, signer=_signer())
        conn.commit()

    _supprimer_au_milieu(db, tenant, 2)
    _ecrire(db, tenant, 10)

    with core_db.connection(db.url) as conn:
        verdict = checkpoints.verify(conn, tenant)
    assert not verdict.ok and verdict.truncated, (
        "le témoin compte le total au lieu du préfixe attesté : dix écritures neuves "
        "viennent de racheter deux suppressions"
    )


def test_a_tenant_with_no_witness_says_so_rather_than_passing(db: DBHandle) -> None:
    """`witnessed: False` n'est pas une panne, c'est un aveu — et il doit être publié.

    Sans lui, un déploiement sans clé serait indistinguable d'un déploiement attesté :
    les deux répondraient « rien à signaler ».
    """
    tenant = _tenant(db)
    _ecrire(db, tenant, 2)
    with core_db.connection(db.url) as conn:
        verdict = checkpoints.verify(conn, tenant)
    assert verdict.ok and not verdict.attested and verdict.checkpoints == 0


# ---------------------------------------------------------------------------
# Le témoin lui-même
# ---------------------------------------------------------------------------
def test_a_rewritten_witness_no_longer_verifies(db: DBHandle) -> None:
    """Réécrire le témoin plutôt que le journal : la même attaque, un cran plus loin."""
    tenant = _tenant(db)
    _ecrire(db, tenant, 3)
    with core_db.connection(db.url) as conn:
        checkpoints.record(conn, tenant_id=tenant, signer=_signer())
        conn.commit()

    with psycopg.connect(db.url, autocommit=True) as adm:
        adm.execute("alter table audit_checkpoints disable trigger all")
        adm.execute("update audit_checkpoints set entries = 1 where tenant_id = %s", (tenant,))
        adm.execute("alter table audit_checkpoints enable trigger all")

    with core_db.connection(db.url) as conn:
        verdict = checkpoints.verify(conn, tenant)
    assert not verdict.ok
    assert verdict.detail is not None and "rewritten" in verdict.detail


def test_the_witnesses_chain_to_each_other(db: DBHandle) -> None:
    """Sinon on supprime le témoin gênant au lieu de supprimer des entrées."""
    tenant = _tenant(db)
    signeur = _signer()
    for _ in range(3):
        _ecrire(db, tenant, 2)
        with core_db.connection(db.url) as conn:
            checkpoints.record(conn, tenant_id=tenant, signer=signeur)
            conn.commit()

    with psycopg.connect(db.url, autocommit=True) as adm:
        adm.execute("alter table audit_checkpoints disable trigger all")
        adm.execute(
            "delete from audit_checkpoints where id = "
            "(select id from audit_checkpoints where tenant_id = %s order by id limit 1 offset 1)",
            (tenant,),
        )
        adm.execute("alter table audit_checkpoints enable trigger all")

    with core_db.connection(db.url) as conn:
        verdict = checkpoints.verify(conn, tenant)
    assert not verdict.ok
    assert verdict.detail is not None and "checkpoint chain" in verdict.detail


def test_the_table_is_append_only_for_the_ordinary_path(db: DBHandle) -> None:
    """UPDATE, DELETE et TRUNCATE, les trois dès la première migration.

    `0028` a dû revenir poser le trigger TRUNCATE sur trois tables parce qu'un trigger
    `for each row` ne se déclenche pas dessus. On ne recommence pas.
    """
    tenant = _tenant(db)
    _ecrire(db, tenant, 1)
    with core_db.connection(db.url) as conn:
        checkpoints.record(conn, tenant_id=tenant, signer=_signer())
        conn.commit()

    for instruction in (
        "update audit_checkpoints set entries = 0",
        "delete from audit_checkpoints",
        "truncate audit_checkpoints",
    ):
        with psycopg.connect(db.url) as essai, pytest.raises(psycopg.errors.RaiseException):
            essai.execute(instruction)


def test_no_column_of_the_table_can_hold_a_private_key(db: DBHandle) -> None:
    """`FR-169`, rendu **structurel** plutôt que consigné dans une note de revue.

    Le schéma ne porte que la clé publique. Une colonne nommée pour une clé privée
    serait le premier endroit où quelqu'un la rangerait « en attendant ».
    """
    colonnes = {
        str(r[0])
        for r in db.conn.execute(
            "select column_name from information_schema.columns "
            "where table_name = 'audit_checkpoints'"
        ).fetchall()
    }
    assert "public_key" in colonnes
    assert not {c for c in colonnes if "private" in c or "secret" in c or c == "signing_key"}


def test_a_third_party_can_verify_without_asking_us(db: DBHandle) -> None:
    """C'est la raison d'être d'Ed25519 ici, et elle se démontre en huit lignes.

    Un HMAC se vérifierait avec la clé qui l'a produit : la publier reviendrait à
    publier le pouvoir de forger. Ici l'auditeur prend la clé publique **de la ligne**,
    recalcule l'empreinte depuis `audit_log`, et tranche seul.
    """
    tenant = _tenant(db)
    _ecrire(db, tenant, 3)
    with core_db.connection(db.url) as conn:
        checkpoints.record(conn, tenant_id=tenant, signer=_signer())
        conn.commit()
        (temoin,) = checkpoints.liste(conn, tenant)

    recalcule = checkpoints.entry_digest(
        tenant_id=tenant,
        entries=temoin.entries,
        last_audit_id=temoin.last_audit_id,
        last_entry_hash=temoin.last_entry_hash,
        at=temoin.at,
        algorithm=temoin.algorithm,
        key_id=temoin.key_id,
        public_key=temoin.public_key,
    )
    publique = Ed25519PublicKey.from_public_bytes(base64.b64decode(temoin.public_key))
    publique.verify(base64.b64decode(temoin.signature), recalcule.encode())  # ne lève pas

    # Et une empreinte d'un octet différent ne passe pas : la vérification mord.
    with pytest.raises(InvalidSignature):
        publique.verify(base64.b64decode(temoin.signature), (recalcule + "x").encode())


def test_the_signed_digest_binds_the_key_that_signed_it() -> None:
    """**Ce qui ferme le remplacement de clé, énoncé directement.**

    Sans la clé publique dans l'empreinte, il suffirait de signer un faux témoin avec
    **sa propre** clé et de la coller dans la colonne : on vérifierait alors avec la
    clé de l'attaquant, et la signature retomberait parfaitement. Deux empreintes qui
    ne diffèrent que par la clé doivent différer — c'est toute la propriété, et elle
    se teste sans base ni signature.

    `key_id` y entre pour la même raison : il désigne la clé qu'un auditeur a reçue
    par un autre canal, et c'est ce qui rend la vérification comparable à quelque
    chose.
    """
    commun: dict[str, Any] = {
        "tenant_id": "t",
        "entries": 3,
        "last_audit_id": 12,
        "last_entry_hash": "abc",
        "at": datetime(2026, 1, 1, tzinfo=UTC),
        "algorithm": checkpoints.ALGORITHM,
    }
    une = checkpoints.entry_digest(**commun, key_id="k1", public_key="AAAA")
    autre = checkpoints.entry_digest(**commun, key_id="k1", public_key="BBBB")
    troisieme = checkpoints.entry_digest(**commun, key_id="k2", public_key="AAAA")
    assert une != autre, "la clé publique n'entre pas dans ce qui est signé"
    assert une != troisieme, "l'identifiant de clé n'entre pas dans ce qui est signé"


def test_swapping_the_public_key_does_not_let_a_forged_witness_through(db: DBHandle) -> None:
    """La clé publique entre dans l'empreinte signée, et c'est ce qui ferme l'attaque.

    Sans cela, il suffirait de signer un faux témoin avec **sa propre** clé et de la
    coller dans la colonne : on vérifierait alors avec la clé de l'attaquant.
    """
    tenant = _tenant(db)
    _ecrire(db, tenant, 2)
    with core_db.connection(db.url) as conn:
        checkpoints.record(conn, tenant_id=tenant, signer=_signer())
        conn.commit()
        (temoin,) = checkpoints.liste(conn, tenant)

    autre = checkpoints.Ed25519Signer(os.urandom(32))
    contrefait = checkpoints.Checkpoint(
        **{**temoin.__dict__, "public_key": autre.public_key, "key_id": autre.key_id}
    )
    contrefait = checkpoints.Checkpoint(
        **{
            **contrefait.__dict__,
            "signature": base64.b64encode(autre.sign(temoin.entry_digest.encode())).decode(),
        }
    )
    # La signature retombe bien sur l'empreinte **stockée**…
    assert checkpoints.signature_valide(contrefait)
    # …mais l'empreinte ne correspond plus à ce que les colonnes disent, parce que la
    # clé publique en fait partie. `verify` recalcule, donc l'attaque échoue.
    recalcule = checkpoints.entry_digest(
        tenant_id=tenant,
        entries=contrefait.entries,
        last_audit_id=contrefait.last_audit_id,
        last_entry_hash=contrefait.last_entry_hash,
        at=contrefait.at,
        algorithm=contrefait.algorithm,
        key_id=contrefait.key_id,
        public_key=contrefait.public_key,
    )
    assert recalcule != contrefait.entry_digest


def test_a_broken_chain_is_never_signed(db: DBHandle) -> None:
    """Signer sans vérifier produirait le pire artefact du produit : une altération
    revêtue de l'apparence d'un état attesté."""
    tenant = _tenant(db)
    _ecrire(db, tenant, 3)
    with psycopg.connect(db.url, autocommit=True) as adm:
        adm.execute("alter table audit_log disable trigger all")
        adm.execute(
            "update audit_log set decision = 'deny' where id = "
            "(select id from audit_log where tenant_id = %s order by id limit 1)",
            (tenant,),
        )
        adm.execute("alter table audit_log enable trigger all")

    with (
        core_db.connection(db.url) as conn,
        pytest.raises(checkpoints.CheckpointError, match="broken chain"),
    ):
        checkpoints.record(conn, tenant_id=tenant, signer=_signer())


def test_an_empty_journal_can_be_witnessed(db: DBHandle) -> None:
    """Un tenant neuf n'a rien à attester, et un relevé périodique ne doit pas avoir
    à traiter ce cas à part — un cas spécial rare finit par être traité mal."""
    tenant = _tenant(db)
    with core_db.connection(db.url) as conn:
        temoin = checkpoints.record(conn, tenant_id=tenant, signer=_signer())
        conn.commit()
        assert checkpoints.verify(conn, tenant).ok
    assert temoin.entries == 0
    assert temoin.last_audit_id is None
    assert temoin.last_entry_hash == audit.GENESIS


# ---------------------------------------------------------------------------
# Le signeur, et ce que la garde de la clé change
# ---------------------------------------------------------------------------
def test_an_absent_key_is_not_an_error_but_a_malformed_one_is() -> None:
    """La nuance qui sépare ce module de `core/secrets.py`.

    Lever sur l'absence ferait refuser de démarrer tout déploiement qui n'a pas encore
    posé de clé — c'est-à-dire tous. Une clé présente mais illisible, en revanche, est
    un opérateur qui **croit** avoir des témoins : elle arrête tout de suite.
    """
    assert checkpoints.build_signer(_settings(cle=None)) is None
    with pytest.raises(checkpoints.CheckpointError):
        checkpoints.build_signer(_settings(cle="pas du base64 !!"))
    with pytest.raises(checkpoints.CheckpointError, match="32 bytes"):
        checkpoints.build_signer(_settings(cle=base64.b64encode(b"court").decode()))


def test_the_pack_still_refuses_to_call_itself_independent_without_a_signer() -> None:
    """La réponse d'avant ce lot, préservée mot pour mot pour le déploiement par défaut."""
    verification = compliance.verification_independence()
    assert verification["independent"] is False
    assert verification["checkpoint_signature"] is None
    assert verification["signing_key_location"] is None


def test_a_key_kept_beside_the_database_buys_evidence_not_independence(db: DBHandle) -> None:
    """**La moitié de FR-169 qu'on est le plus tenté d'oublier.**

    Signer fort avec une clé rangée sur l'hôte de la base ne rend rien indépendant :
    qui prend l'hôte prend le journal **et** ses témoins. Le pack doit le dire au lieu
    de le laisser deviner.
    """
    tenant = _tenant(db)
    _ecrire(db, tenant, 2)
    with core_db.connection(db.url) as conn:
        checkpoints.record(conn, tenant_id=tenant, signer=_signer())
        conn.commit()
        temoin = checkpoints.verify(conn, tenant)

    verification = compliance.verification_independence(_settings(garde="same_host"), temoin)
    assert verification["checkpoint_signature"] == "ed25519"
    assert verification["signing_key_location"] == "same_host"
    assert verification["independent"] is False
    assert "not independent verification" in verification["statement"]

    # Non déclarée, la garde se lit comme `same_host` : la seule direction qui ne
    # surpromet pas, puisque personne n'a rempli le champ.
    muet = compliance.verification_independence(_settings(garde=None), temoin)
    assert muet["signing_key_location"] == "same_host"
    assert muet["independent"] is False


def test_a_key_kept_elsewhere_and_an_agreeing_witness_buy_independence(db: DBHandle) -> None:
    """Et l'inverse, sans quoi le champ ne servirait jamais à rien."""
    tenant = _tenant(db)
    _ecrire(db, tenant, 2)
    with core_db.connection(db.url) as conn:
        checkpoints.record(conn, tenant_id=tenant, signer=_signer())
        conn.commit()
        temoin = checkpoints.verify(conn, tenant)

    verification = compliance.verification_independence(_settings(garde="separate_host"), temoin)
    assert verification["independent"] is True
    assert verification["witness"] == {"checkpoints": 1, "agrees": True, "detail": None}


def test_a_disagreeing_witness_never_buys_independence(db: DBHandle) -> None:
    """Une clé bien gardée sur un témoin qui proteste ne prouve rien du tout."""
    tenant = _tenant(db)
    _ecrire(db, tenant, 3)
    with core_db.connection(db.url) as conn:
        checkpoints.record(conn, tenant_id=tenant, signer=_signer())
        conn.commit()
    _supprimer_la_queue(db, tenant, 1)
    with core_db.connection(db.url) as conn:
        temoin = checkpoints.verify(conn, tenant)

    verification = compliance.verification_independence(_settings(garde="kms"), temoin)
    assert verification["independent"] is False


# ---------------------------------------------------------------------------
# Ce que la console et le dossier en disent
# ---------------------------------------------------------------------------
def test_a_shrunken_journal_is_neither_ready_nor_compliant(db: DBHandle) -> None:
    """Les deux verdicts du produit doivent tomber du même côté.

    Un `status` non prêt et un pack conforme seraient une contradiction publiée, et
    c'est le pack qu'un régulateur lit.
    """
    tenant = _tenant(db)
    _ecrire(db, tenant, 4)
    with core_db.connection(db.url) as conn:
        checkpoints.record(conn, tenant_id=tenant, signer=_signer())
        conn.commit()
    _supprimer_la_queue(db, tenant, 2)

    with core_db.connection(db.url) as conn:
        etat = compliance.status(conn, tenant)
        pack = compliance.build_evidence_pack(
            conn, tenant_id=tenant, events=[], approvals=[], settings=_settings()
        )

    assert etat["chain_ok"] is True, "la chaîne restante est cohérente, et le dit"
    assert etat["entries_lost"] is True
    assert etat["witnessed"] is True
    assert etat["ready"] is False
    assert pack["compliant"] is False
    assert pack["articles"]["article_12_record_keeping"]["entries_lost"] is True

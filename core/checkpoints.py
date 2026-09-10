"""Les témoins signés de la chaîne d'audit (`FR-169` / `INV-12`).

**Ce que `verify_chain` ne peut pas voir.** Elle part de `GENESIS` et marche vers
l'avant sur les lignes qu'elle trouve. Une ligne modifiée en place se voit ; un
**préfixe amputé de ses dernières lignes** ne se voit pas — il est parfaitement
cohérent, seulement plus court, et rien dans la base ne dit combien il comptait hier.
Sur une table vide, elle ne parcourt rien et rend `ok=True, count=0` : la preuve
détruite, et l'attestation qui dit que tout va bien.

Un témoin est la phrase qui manquait : *à l'instant T, la chaîne du tenant X comptait
N entrées et finissait par H*. Elle est signée par une clé dont la partie privée
n'est pas dans la base et ne peut pas y être — `0032_audit_checkpoints.sql` n'a aucune
colonne où elle tomberait.

**Ed25519, pas HMAC.** Un HMAC se vérifie avec la clé qui l'a produit : la publier
pour permettre la vérification revient à publier le pouvoir de forger, et le témoin ne
vaudrait que pour nous-mêmes. Une signature Ed25519 se vérifie avec la clé publique
que la ligne porte : un régulateur, un auditeur ou le client recalculent l'empreinte
depuis `audit_log` et vérifient **sans rien nous demander**.

**Ce que le témoin n'achète pas.** L'indépendance ne se déduit pas de l'algorithme
mais de la **garde** de la clé privée. Une graine rangée dans l'environnement du même
hôte que la base tombe avec l'hôte. `CHECKPOINT_KEY_CUSTODY` fait déclarer cette garde
— déclarer, parce qu'aucun code ne peut constater où un opérateur range un secret — et
:func:`core.compliance.verification_independence` ne dit `independent: true` que
lorsqu'elle est ailleurs.

**Un témoin ne raccourcit jamais la vérification.** La tentation est immédiate :
repartir du dernier témoin et ne relire que la suite. Ce serait un gain de temps qui
est aussi un angle mort — ce que le témoin couvre cesserait d'être relu, donc une
altération *antérieure* au témoin deviendrait invisible pour toujours. :func:`verify`
s'ajoute à `audit.verify_chain`, elle ne la remplace pas.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Protocol

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from core import audit
from core.config import Settings

if TYPE_CHECKING:  # pragma: no cover - psycopg n'est qu'un type ici
    import psycopg

logger = logging.getLogger("xsom.checkpoints")

#: Le seul algorithme accepté, ici comme dans le `check` du schéma. Deux vocabulaires
#: qui doivent rester d'accord, et un test les confronte.
ALGORITHM = "ed25519"

#: Longueur exacte d'une graine Ed25519. Refusée ailleurs plutôt que tronquée : une
#: clé silencieusement tronquée signerait, et signerait faux.
_TAILLE_GRAINE = 32


class CheckpointError(Exception):
    """La configuration du signeur est inutilisable. Toujours fatale, jamais dégradée."""


class Signer(Protocol):
    """Ce dont un témoin a besoin. La partie privée ne sort jamais d'ici."""

    @property
    def key_id(self) -> str: ...

    @property
    def public_key(self) -> str:
        """La clé publique en base64 — celle qui est écrite dans la ligne."""
        ...

    def sign(self, payload: bytes) -> bytes: ...


class Ed25519Signer:
    """Signe avec une graine lue dans l'environnement du processus.

    La graine n'est jamais rendue ni journalisée : l'objet expose `key_id` et
    `public_key`, et c'est tout ce que le reste du produit peut obtenir de lui.
    """

    def __init__(self, seed: bytes) -> None:
        if len(seed) != _TAILLE_GRAINE:
            raise CheckpointError("CHECKPOINT_SIGNING_KEY must decode to 32 bytes")
        self._cle = Ed25519PrivateKey.from_private_bytes(seed)
        brute = self._cle.public_key().public_bytes(
            encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
        )
        self._publique = base64.b64encode(brute).decode()
        self._key_id = hashlib.sha256(brute).hexdigest()

    @property
    def key_id(self) -> str:
        return self._key_id

    @property
    def public_key(self) -> str:
        return self._publique

    def sign(self, payload: bytes) -> bytes:
        return self._cle.sign(payload)


def build_signer(settings: Settings) -> Signer | None:
    """Le signeur configuré, ou ``None`` quand il n'y en a pas.

    **Absent n'est pas une erreur ; malformé en est une.** C'est la nuance qui sépare
    cette fonction de :func:`core.secrets.build_key_provider`, qui lève dès qu'aucun
    fournisseur n'est configuré. Là-bas, l'absence casse une fonctionnalité que le
    client a demandée — stocker un identifiant — et lever est la bonne direction.
    Ici, lever ferait refuser de démarrer tout déploiement qui n'a pas encore posé de
    clé, c'est-à-dire tous : le produit tourne aujourd'hui sans témoin, et
    l'attestation le dit honnêtement. Une clé **présente mais illisible**, en revanche,
    est un opérateur qui croit avoir des témoins : elle arrête tout de suite.
    """
    brut = settings.checkpoint_signing_key
    if not brut:
        return None
    try:
        graine = base64.b64decode(brut, validate=True)
    except (ValueError, TypeError) as exc:
        raise CheckpointError("CHECKPOINT_SIGNING_KEY must be valid base64") from exc
    return Ed25519Signer(graine)


@dataclass(frozen=True)
class Checkpoint:
    """Un témoin, tel qu'il est écrit et tel qu'il se relit."""

    id: int
    entries: int
    last_audit_id: int | None
    last_entry_hash: str
    at: datetime
    algorithm: str
    key_id: str
    public_key: str
    signature: str
    entry_digest: str
    prev_hash: str
    entry_hash: str


def entry_digest(
    *,
    tenant_id: str,
    entries: int,
    last_audit_id: int | None,
    last_entry_hash: str,
    at: datetime,
    algorithm: str,
    key_id: str,
    public_key: str,
) -> str:
    """L'empreinte canonique du témoin : ce qui est **signé** et ce qui est chaîné.

    Même convention de sérialisation que `core/audit.payload_v1` et que les trois
    autres chaînes du produit (`sort_keys=True, separators=(",", ":")`). Une seconde
    convention finirait par diverger de la première, et un vérificateur qui a dérivé
    est un vérificateur qui accepte ce qu'il devrait refuser (`FR-163`).

    La clé publique entre dans l'empreinte : sans elle, un témoin signé par une autre
    clé et recollé ici passerait la vérification de signature — puisqu'on vérifierait
    avec la clé que l'attaquant a fournie. En la liant à l'empreinte, changer la clé
    change l'empreinte, donc invalide la signature et casse la chaîne des témoins.
    """
    canonical = json.dumps(
        {
            "tenant_id": tenant_id,
            "entries": entries,
            "last_audit_id": last_audit_id,
            "last_entry_hash": last_entry_hash,
            "at": audit.canonical_ts(at),
            "algorithm": algorithm,
            "key_id": key_id,
            "public_key": public_key,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _etat_du_journal(conn: psycopg.Connection, tenant_id: str) -> tuple[int, int | None, str]:
    """(entrées, dernier id, dernier `entry_hash`) pour ce tenant, à cet instant."""
    row = conn.execute(
        "select count(*), max(id) from audit_log where tenant_id = %s",
        (tenant_id,),
    ).fetchone()
    entries = int(row[0]) if row else 0
    dernier_id = int(row[1]) if row and row[1] is not None else None
    if dernier_id is None:
        return 0, None, audit.GENESIS
    hash_row = conn.execute(
        "select entry_hash from audit_log where id = %s", (dernier_id,)
    ).fetchone()
    return entries, dernier_id, str(hash_row[0]) if hash_row else audit.GENESIS


def record(conn: psycopg.Connection, *, tenant_id: str, signer: Signer) -> Checkpoint:
    """Poser un témoin sur l'état actuel de la chaîne de ce tenant.

    **La chaîne est vérifiée avant d'être signée.** Signer sans vérifier produirait un
    témoin qui atteste une chaîne déjà rompue : le pire des artefacts, puisqu'il donne
    à une altération l'apparence d'un état attesté. Une chaîne rompue lève.

    Le verrou consultatif est pris sur `checkpoint:<tenant>` et non sur le tenant nu :
    `core/audit.log_event` tient déjà `hashtext(tenant_id)` pendant qu'il écrit, et
    partager la même clé ferait attendre chaque décision de l'agent derrière un relevé
    périodique. Deux verrous distincts, pris dans des transactions distinctes, ne
    peuvent pas s'interbloquer — aucun des deux ne prend l'autre.
    """
    at = datetime.now(UTC)
    with conn.transaction():
        conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"checkpoint:{tenant_id}",))
        integrite = audit.verify_chain(conn, tenant_id)
        if not integrite.ok:
            raise CheckpointError(
                f"refusing to sign a broken chain (first broken id: {integrite.broken_id})"
            )
        entries, dernier_id, dernier_hash = _etat_du_journal(conn, tenant_id)
        digest = entry_digest(
            tenant_id=tenant_id,
            entries=entries,
            last_audit_id=dernier_id,
            last_entry_hash=dernier_hash,
            at=at,
            algorithm=ALGORITHM,
            key_id=signer.key_id,
            public_key=signer.public_key,
        )
        prev_row = conn.execute(
            "select entry_hash from audit_checkpoints where tenant_id::text = %s "
            "order by id desc limit 1",
            (tenant_id,),
        ).fetchone()
        prev_hash = str(prev_row[0]) if prev_row else audit.GENESIS
        entry_hash = audit.compute_entry_hash(prev_hash, digest)
        signature = base64.b64encode(signer.sign(digest.encode("utf-8"))).decode()
        row = conn.execute(
            "insert into audit_checkpoints "
            " (tenant_id, entries, last_audit_id, last_entry_hash, at, algorithm, key_id, "
            "  public_key, signature, entry_digest, prev_hash, entry_hash) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
            (
                tenant_id,
                entries,
                dernier_id,
                dernier_hash,
                at,
                ALGORITHM,
                signer.key_id,
                signer.public_key,
                signature,
                digest,
                prev_hash,
                entry_hash,
            ),
        ).fetchone()
    return Checkpoint(
        id=int(row[0]) if row else 0,
        entries=entries,
        last_audit_id=dernier_id,
        last_entry_hash=dernier_hash,
        at=at,
        algorithm=ALGORITHM,
        key_id=signer.key_id,
        public_key=signer.public_key,
        signature=signature,
        entry_digest=digest,
        prev_hash=prev_hash,
        entry_hash=entry_hash,
    )


def _depuis_ligne(row: tuple[Any, ...]) -> Checkpoint:
    return Checkpoint(
        id=int(row[0]),
        entries=int(row[1]),
        last_audit_id=int(row[2]) if row[2] is not None else None,
        last_entry_hash=str(row[3]),
        at=row[4],
        algorithm=str(row[5]),
        key_id=str(row[6]),
        public_key=str(row[7]),
        signature=str(row[8]),
        entry_digest=str(row[9]),
        prev_hash=str(row[10]),
        entry_hash=str(row[11]),
    )


def liste(conn: psycopg.Connection, tenant_id: str) -> list[Checkpoint]:
    """Les témoins de ce tenant, du plus ancien au plus récent."""
    return [
        _depuis_ligne(r)
        for r in conn.execute(
            "select id, entries, last_audit_id, last_entry_hash, at, algorithm, key_id, "
            "public_key, signature, entry_digest, prev_hash, entry_hash "
            "from audit_checkpoints where tenant_id::text = %s order by id",
            (tenant_id,),
        ).fetchall()
    ]


def signature_valide(checkpoint: Checkpoint) -> bool:
    """La signature du témoin retombe-t-elle sur son empreinte ?"""
    if checkpoint.algorithm != ALGORITHM:
        return False
    try:
        publique = Ed25519PublicKey.from_public_bytes(base64.b64decode(checkpoint.public_key))
        publique.verify(
            base64.b64decode(checkpoint.signature), checkpoint.entry_digest.encode("utf-8")
        )
    except (InvalidSignature, ValueError, TypeError):
        return False
    return True


@dataclass(frozen=True)
class Verification:
    """Ce que les témoins disent de l'état actuel du journal."""

    #: Combien de témoins ce tenant porte. Zéro veut dire « rien n'a jamais été
    #: attesté », et c'est une réponse, pas une panne.
    checkpoints: int
    #: Tout concorde : signatures valides, chaîne des témoins intacte, et le journal
    #: contient toujours au moins ce que chaque témoin affirme.
    ok: bool
    #: Le journal a **perdu** des entrées qu'un témoin attestait. C'est le mode de
    #: panne que cette table existe pour rendre visible.
    truncated: bool
    #: Ce qui cloche, en une phrase destinée à l'humain qui lit l'incident.
    detail: str | None = None

    @property
    def attested(self) -> bool:
        """Y a-t-il seulement quelque chose à attester ?"""
        return self.checkpoints > 0


def verify(conn: psycopg.Connection, tenant_id: str) -> Verification:
    """Confronter le journal actuel à ce que ses témoins ont attesté.

    Quatre contrôles, et le troisième est celui pour lequel la table existe :

    1. **La signature** de chaque témoin retombe sur son empreinte, recalculée depuis
       les colonnes stockées. Un témoin réécrit se voit.
    2. **La chaîne des témoins** est intacte. Sans elle, on supprimerait le témoin
       gênant au lieu de supprimer des entrées.
    3. **Le journal contient encore ce que le témoin affirme** : au moins `entries`
       lignes jusqu'à `last_audit_id`, et la ligne `last_audit_id` porte toujours le
       `entry_hash` attesté. C'est ce qui rend une suppression de queue visible.
    4. Les témoins sont **monotones** entre eux : le compte ne peut pas décroître d'un
       témoin au suivant, puisque `audit_log` n'a aucun chemin d'effacement.

    Le contrôle 3 compte `id <= last_audit_id` plutôt que le total : sinon toute
    entrée écrite depuis le témoin masquerait une suppression, un pour un.
    """
    temoins = liste(conn, tenant_id)
    if not temoins:
        return Verification(checkpoints=0, ok=True, truncated=False, detail=None)

    prev = audit.GENESIS
    precedent: Checkpoint | None = None
    for temoin in temoins:
        attendu = entry_digest(
            tenant_id=tenant_id,
            entries=temoin.entries,
            last_audit_id=temoin.last_audit_id,
            last_entry_hash=temoin.last_entry_hash,
            at=temoin.at,
            algorithm=temoin.algorithm,
            key_id=temoin.key_id,
            public_key=temoin.public_key,
        )
        if attendu != temoin.entry_digest:
            return _rompu(temoins, f"checkpoint {temoin.id}: rewritten (digest mismatch)")
        if not signature_valide(temoin):
            return _rompu(temoins, f"checkpoint {temoin.id}: signature does not verify")
        if temoin.prev_hash != prev or audit.compute_entry_hash(prev, attendu) != temoin.entry_hash:
            return _rompu(temoins, f"checkpoint {temoin.id}: broken checkpoint chain")
        if precedent is not None and temoin.entries < precedent.entries:
            return _rompu(
                temoins,
                f"checkpoint {temoin.id}: attests fewer entries than checkpoint {precedent.id}",
            )
        prev = temoin.entry_hash
        precedent = temoin

    dernier = temoins[-1]
    if dernier.last_audit_id is None:
        return Verification(checkpoints=len(temoins), ok=True, truncated=False, detail=None)

    row = conn.execute(
        "select count(*) from audit_log where tenant_id = %s and id <= %s",
        (tenant_id, dernier.last_audit_id),
    ).fetchone()
    presentes = int(row[0]) if row else 0
    if presentes < dernier.entries:
        manquantes = dernier.entries - presentes
        return _rompu(
            temoins,
            f"the journal is missing {manquantes} entries attested by checkpoint {dernier.id}",
            truncated=True,
        )

    hash_row = conn.execute(
        "select entry_hash from audit_log where tenant_id = %s and id = %s",
        (tenant_id, dernier.last_audit_id),
    ).fetchone()
    if hash_row is None:
        return _rompu(
            temoins,
            f"audit entry {dernier.last_audit_id}, attested by checkpoint {dernier.id}, is gone",
            truncated=True,
        )
    if str(hash_row[0]) != dernier.last_entry_hash:
        return _rompu(
            temoins,
            f"audit entry {dernier.last_audit_id} no longer carries the hash checkpoint "
            f"{dernier.id} attested",
        )
    return Verification(checkpoints=len(temoins), ok=True, truncated=False, detail=None)


def _rompu(temoins: list[Checkpoint], detail: str, *, truncated: bool = False) -> Verification:
    logger.warning("checkpoint_verification_failed", extra={"detail": detail})
    return Verification(checkpoints=len(temoins), ok=False, truncated=truncated, detail=detail)


def custody(settings: Settings) -> str:
    """Où la clé privée est **déclarée** vivre. Non déclarée ⇒ `same_host`.

    L'inconnu se lit comme le cas le plus défavorable, parce que c'est la seule
    direction qui ne surpromet pas : présenter une vérification comme indépendante
    sur la foi d'un champ que personne n'a rempli serait exactement la faute que
    `verification_independence` existe pour empêcher.
    """
    return settings.checkpoint_key_custody or "same_host"


def independent(settings: Settings) -> bool:
    """La garde de la clé met-elle le témoin hors de portée de qui prend la base ?

    C'est la seconde moitié de `FR-169`, et elle ne peut pas être constatée : le
    produit demande une déclaration à l'opérateur et la publie telle quelle, plutôt
    que de déduire une indépendance de l'algorithme employé. Signer fort avec une clé
    rangée à côté de la base ne rend rien indépendant.
    """
    return settings.checkpoint_signing_key is not None and custody(settings) != "same_host"

"""`FR-196` — les attributions de rôle, chaînées, dans leur propre journal.

Une attribution de rôle est un acte de **plan de contrôle** : elle change qui peut
approuver une action irréversible. `EXH-8` explique pourquoi elle doit être traçable —
c'est la contrepartie de la fédération. Déléguer l'annuaire à l'IdP du client est
correct ; perdre la trace de ce que le produit en a *déduit* ne l'est pas. Un
évaluateur qui demande « qui pouvait approuver, et depuis quand ? » doit trouver une
réponse ici et non dans les journaux de l'IdP, auxquels il n'a pas accès.

**Pourquoi une chaîne à part, et pas `audit_log`.** :class:`core.audit.Ingress` est un
vocabulaire fermé de **trois portes d'appel d'outil**, et `AD-28` en fait la clé des
revendications de couverture : « vrai sur `mcp` » ne se lit pas « vrai partout ». Une
attribution de rôle n'arrive par aucune de ces trois portes. Lui en inventer une
quatrième rendrait la carte de couverture fausse pour économiser une table. Le rang 9
a déjà tranché ce cas de figure pour les verdicts tiers (:mod:`core.verdicts`) : sa
propre table, son propre chaînage, les primitives d'audit partagées. Même patron ici.

**Ce qui n'entre pas.** Ni le jeton, ni ses revendications brutes, ni l'adresse de
l'appelant. Le sujet est l'identifiant opaque de l'émetteur (`sub`), et les groupes
sont enregistrés **hachés** : ils portent souvent des noms d'équipe ou de service qui
disent l'organigramme du client (`CLAUDE.md` §4.10). Ce qu'un évaluateur a besoin de
lire, c'est *quel rôle a été attribué, à quel sujet, quand, et sur la foi de quel
ensemble de groupes* — l'empreinte suffit à prouver que l'ensemble a changé.

**Une ligne par changement, pas une par requête.** Un jeton fédéré est présenté à
chaque appel ; écrire à chaque fois noierait le journal sous ce qui ne s'est pas
produit — le même défaut que le rang 9 a écarté pour la détection de fuite de prompt.
:func:`record_assignment` ne s'exécute que lorsque le couple (rôle, groupes) diffère
du dernier enregistré pour ce sujet.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from core import audit
from core.schemas import Role

if TYPE_CHECKING:  # pragma: no cover - psycopg n'est qu'un type ici
    import psycopg

#: Le seul type d'événement écrit aujourd'hui. Fermé pour la même raison que le reste
#: des vocabulaires du dépôt : une valeur libre finirait par désigner deux choses.
ROLE_ASSIGNED = "role_assigned"


def groups_digest(groups: list[str]) -> str:
    """Empreinte stable de l'ensemble des groupes — jamais leurs noms.

    Triée et dédoublonnée : l'ordre dans lequel un IdP rend ses groupes n'est pas
    stable, et un simple réordonnancement ne doit pas se lire comme un changement
    d'appartenance.
    """
    canonical = json.dumps(sorted(set(groups)), separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def entry_digest(*, subject: str, role: str, groups_hash: str, at: datetime) -> str:
    """L'empreinte canonique de l'événement — ce qui entre dans la chaîne.

    Mêmes règles de sérialisation que la charge d'audit et que les reçus tiers
    (`sort_keys`, séparateurs compacts, `canonical_ts`). Une seconde convention de
    sérialisation dans le produit finirait par diverger de la première, et la chaîne
    déjà écrite deviendrait invérifiable sans qu'aucun test le voie (`FR-163`).
    """
    canonical = json.dumps(
        {
            "event": ROLE_ASSIGNED,
            "subject": subject,
            "role": role,
            "groups_hash": groups_hash,
            "at": audit.canonical_ts(at),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def last_assignment(
    conn: psycopg.Connection, *, tenant_id: str, subject: str
) -> tuple[str, str] | None:
    """Le dernier couple (rôle, empreinte de groupes) enregistré pour ce sujet."""
    row = conn.execute(
        "select role, groups_hash from control_plane_events "
        "where tenant_id = %s and subject = %s and event = %s "
        "order by id desc limit 1",
        (tenant_id, subject, ROLE_ASSIGNED),
    ).fetchone()
    return (row[0], row[1]) if row else None


def record_assignment(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    subject: str,
    role: Role,
    groups: list[str],
) -> str | None:
    """Enregistrer une attribution de rôle si elle diffère de la dernière connue.

    Retourne l'`entry_hash` écrit, ou ``None`` quand rien n'a changé — c'est le cas
    ordinaire, une fois le sujet connu, et l'absence d'écriture est le comportement
    voulu, pas un échec silencieux.
    """
    empreinte = groups_digest(groups)
    if last_assignment(conn, tenant_id=tenant_id, subject=subject) == (role.value, empreinte):
        return None

    at = datetime.now(UTC)
    digest = entry_digest(subject=subject, role=role.value, groups_hash=empreinte, at=at)
    with conn.transaction():
        # Même verrou consultatif que le journal d'audit : deux événements qui
        # partageraient un `prev_hash` casseraient la chaîne sans que personne l'ait
        # modifiée.
        conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"control_plane:{tenant_id}",))
        prev_row = conn.execute(
            "select entry_hash from control_plane_events where tenant_id = %s "
            "order by id desc limit 1",
            (tenant_id,),
        ).fetchone()
        prev_hash = prev_row[0] if prev_row else audit.GENESIS
        entry_hash = audit.compute_entry_hash(prev_hash, digest)
        conn.execute(
            "insert into control_plane_events "
            " (tenant_id, event, subject, role, groups_hash, at, entry_digest, "
            "  prev_hash, entry_hash) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                tenant_id,
                ROLE_ASSIGNED,
                subject[: audit.MAX_FIELD],
                role.value,
                empreinte,
                at,
                digest,
                prev_hash,
                entry_hash,
            ),
        )
    return entry_hash


def verify_chain(conn: psycopg.Connection, tenant_id: str) -> audit.ChainResult:
    """Recalculer la chaîne des événements de plan de contrôle de ce tenant.

    Une chaîne qu'aucun vérificateur ne parcourt n'est pas une chaîne, seulement des
    colonnes qui portent des empreintes.
    """
    return _walk(
        conn.execute(
            "select id, entry_digest, prev_hash, entry_hash from control_plane_events "
            "where tenant_id = %s order by id",
            (tenant_id,),
        ).fetchall()
    )


def _walk(rows: list[Any]) -> audit.ChainResult:
    """Recalculer une suite de maillons déjà lue. Une seule copie de la marche.

    `AD-37` : la logique partagée par deux lecteurs vit à un seul endroit. Deux
    marches de chaîne finiraient par répondre différemment à « intacte ».
    """
    prev = audit.GENESIS
    for row_id, digest, stored_prev, stored_hash in rows:
        if stored_prev != prev or audit.compute_entry_hash(prev, digest) != stored_hash:
            return audit.ChainResult(ok=False, broken_id=row_id, count=len(rows))
        prev = stored_hash
    return audit.ChainResult(ok=True, count=len(rows))


def assignments_section(conn: psycopg.Connection) -> dict[str, Any]:
    """Le bloc que l'Evidence Pack publie pour la fédération d'identité.

    Prend la connexion seule, comme les sections voisines : elle est déjà cadrée au
    tenant par RLS, et refiltrer ici ferait diverger cette section des autres.

    Publie des comptes et l'état de la chaîne, jamais un nom de groupe : la question
    à laquelle un évaluateur a besoin d'une réponse est « les attributions de rôle
    sont-elles tracées et intactes ? », pas « qui est dans quelle équipe ».
    """
    rows = conn.execute(
        "select role, count(distinct subject) from control_plane_events "
        "where event = %s group by role order by role",
        (ROLE_ASSIGNED,),
    ).fetchall()
    lignes = conn.execute(
        "select id, entry_digest, prev_hash, entry_hash from control_plane_events order by id"
    ).fetchall()
    chain = _walk(lignes)
    return {
        "federated": bool(rows),
        "subjects_by_role": dict(rows),
        "events": chain.count,
        "chain_intact": chain.ok,
        "basis": (
            "Chaque attribution de rôle déduite des groupes de l'émetteur est écrite "
            "dans un journal chaîné distinct du journal d'audit. Les noms de groupes "
            "n'y entrent jamais : seule l'empreinte de l'ensemble, qui suffit à "
            "prouver qu'il a changé."
        ),
    }

"""L'histoire des paliers d'un tenant, chaînée.

« Depuis quand, par qui, et pourquoi ? » est la question d'un litige de facturation
— le ticket le plus cher du support, et le seul auquel `tenants.plan_since` ne
répond pas : il est **écrasé** à chaque mouvement. Un client rétrogradé pour un
impayé qu'il conteste ne trouve, dans la base, qu'un palier `free` et une date.

Même patron que :mod:`core.control_plane`, :mod:`core.verdicts` et
:mod:`core.approval_chain` : sa propre table, son propre chaînage, les primitives
d'audit partagées. Et la même règle de sérialisation, parce qu'une seconde
convention finirait par diverger de la première (`FR-163`).

**`reason` est un vocabulaire fermé, et c'est ce qui vaut la table.** « dunning, le
3 mars, acteur `billing` » se répond en une requête et un mot ; un champ libre
donnerait autant de formulations que d'opérateurs, et la question resterait sans
réponse mécanique.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any

from core import audit

if TYPE_CHECKING:  # pragma: no cover - psycopg n'est qu'un type ici
    import psycopg


class Raison(StrEnum):
    """Pourquoi le palier a bougé. Fermé côté application **et** côté schéma."""

    signup = "signup"
    checkout = "checkout"
    downgrade = "downgrade"
    dunning = "dunning"
    admin = "admin"
    scheduled = "scheduled"


def entry_digest(
    *, from_tier: str | None, to_tier: str, reason: str, actor: str | None, at: datetime
) -> str:
    """L'empreinte canonique du mouvement — ce qui entre dans la chaîne."""
    canonical = json.dumps(
        {
            "from_tier": from_tier,
            "to_tier": to_tier,
            "reason": reason,
            "actor": actor,
            "at": audit.canonical_ts(at),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def record(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    from_tier: str | None,
    to_tier: str,
    reason: Raison,
    actor: str | None = None,
) -> str:
    """Inscrire un mouvement de palier. Rend l'`entry_hash`.

    N'applique **pas** le changement : l'appelant met `tenants.plan` à jour dans la
    même transaction. Séparer les deux gestes serait le moyen le plus simple de se
    retrouver avec une histoire qui ne décrit pas l'état.
    """
    at = datetime.now(UTC)
    digest = entry_digest(
        from_tier=from_tier, to_tier=to_tier, reason=reason.value, actor=actor, at=at
    )
    with conn.transaction():
        conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"plan:{tenant_id}",))
        prev_row = conn.execute(
            "select entry_hash from tenant_plan_changes where tenant_id = %s "
            "order by id desc limit 1",
            (tenant_id,),
        ).fetchone()
        prev_hash = prev_row[0] if prev_row else audit.GENESIS
        entry_hash = audit.compute_entry_hash(prev_hash, digest)
        conn.execute(
            "insert into tenant_plan_changes "
            " (tenant_id, from_tier, to_tier, reason, actor, at, entry_digest, prev_hash, "
            "  entry_hash) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                tenant_id,
                from_tier,
                to_tier,
                reason.value,
                actor[: audit.MAX_FIELD] if actor else None,
                at,
                digest,
                prev_hash,
                entry_hash,
            ),
        )
    return entry_hash


def _walk(rows: list[Any]) -> audit.ChainResult:
    prev = audit.GENESIS
    for row_id, digest, stored_prev, stored_hash in rows:
        if stored_prev != prev or audit.compute_entry_hash(prev, digest) != stored_hash:
            return audit.ChainResult(ok=False, broken_id=row_id, count=len(rows))
        prev = stored_hash
    return audit.ChainResult(ok=True, count=len(rows))


def verify_chain(conn: psycopg.Connection, tenant_id: str) -> audit.ChainResult:
    """Recalculer la chaîne des mouvements de palier de ce tenant."""
    return _walk(
        conn.execute(
            "select id, entry_digest, prev_hash, entry_hash from tenant_plan_changes "
            "where tenant_id = %s order by id",
            (tenant_id,),
        ).fetchall()
    )


def history(conn: psycopg.Connection, tenant_id: str) -> list[dict[str, Any]]:
    """L'histoire lisible, du plus récent au plus ancien. Jamais les empreintes.

    Ce que le support et le client ont besoin de lire est « quand, vers quoi,
    pourquoi » : les colonnes de chaînage n'aident personne à trancher un litige, et
    les publier invite à les confondre avec la preuve, qui est `verify_chain`.
    """
    return [
        {
            "from_tier": r[0],
            "to_tier": r[1],
            "reason": r[2],
            "actor": r[3],
            "at": r[4].isoformat(),
        }
        for r in conn.execute(
            "select from_tier, to_tier, reason, actor, at from tenant_plan_changes "
            "where tenant_id = %s order by id desc",
            (tenant_id,),
        ).fetchall()
    ]

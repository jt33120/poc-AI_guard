"""L'acte humain d'approbation, chaîné, écrit au moment où il est pris.

`api/approvals.py` appelait `approvals.decide(...)` et rendait la vue. Aucun audit,
aucune chaîne. La ligne `hitl_approved` du journal n'est écrite que **plus tard**,
quand un *poll* de l'agent consomme l'approbation (`gateway/server.py`,
`core/decision.py`) — donc si l'agent abandonne, plante, ou change d'avis et ne
repolle jamais, l'approbation humaine d'une action irréversible n'existe que dans la
table `approvals`, qu'un `update` suffit à réécrire.

C'est exactement la confusion que :func:`core.compliance.verification_independence`
s'interdit ailleurs : l'export article 14 attestait « approuvé » depuis une table
mutable, sans pouvoir attester « par qui, et à quel quorum ».

**Pourquoi une chaîne à part.** Même raisonnement que :mod:`core.control_plane` et
:mod:`core.verdicts`. :class:`core.audit.Ingress` est un vocabulaire fermé de trois
**portes d'appel d'outil**, et `AD-28` en fait la clé des revendications de couverture.
Un clic d'approbation dans une console n'arrive par aucune de ces trois portes ; lui en
inventer une quatrième rendrait la carte de couverture fausse pour économiser une
table. Et `control_plane_events` porte un `role` `not null` contraint à trois valeurs :
ce n'est pas la forme d'une décision d'approbation.

**Ce qui entre.** L'identifiant opaque de l'approbateur (`sub`), jamais son e-mail
(§4.10). Le quorum atteint et le quorum requis, parce que `human_dual` doit pouvoir se
**prouver** et pas seulement se déclarer. Ni les arguments, ni le dry-run : ils vivent
déjà, hachés, sur la ligne d'audit.

**Ce qui n'entre pas non plus : une seconde convention de sérialisation.** Les règles
de :func:`entry_digest` sont copiées de la charge d'audit et des reçus tiers
(`sort_keys`, séparateurs compacts, `canonical_ts`). Deux conventions finiraient par
diverger, et la chaîne déjà écrite deviendrait invérifiable sans qu'aucun test le voie
(`FR-163`).
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from core import audit

if TYPE_CHECKING:  # pragma: no cover - psycopg n'est qu'un type ici
    import psycopg

#: Le vocabulaire fermé des décisions humaines. Fermé côté application ET côté schéma
#: (`check (event in (...))`), parce qu'une valeur libre finit par désigner deux choses.
APPROVED = "approved"
DENIED = "denied"

#: `expired` n'est **pas** ici, et c'est délibéré : personne ne l'a décidé. Un délai
#: dépassé est déjà écrit dans `audit_log` par la voie qui le constate ; l'inscrire ici
#: ferait passer une absence de décision humaine pour une décision humaine, dans la
#: table même qui existe pour attester le contraire.
EVENTS = (APPROVED, DENIED)


def entry_digest(
    *,
    approval_id: str,
    event: str,
    tool_name: str,
    action_class: str | None,
    subject: str,
    approved_count: int,
    required_count: int,
    at: datetime,
) -> str:
    """L'empreinte canonique de la décision — ce qui entre dans la chaîne."""
    canonical = json.dumps(
        {
            "approval_id": approval_id,
            "event": event,
            "tool_name": tool_name,
            "action_class": action_class,
            "subject": subject,
            "approved_count": approved_count,
            "required_count": required_count,
            "at": audit.canonical_ts(at),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def record_decision(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    approval_id: str,
    event: str,
    tool_name: str,
    action_class: str | None,
    subject: str,
    approved_count: int,
    required_count: int,
) -> str:
    """Écrire la décision humaine dans sa chaîne. Rend l'`entry_hash`.

    Appelée dans la **même connexion** que `approvals.decide`, et sans `try` autour :
    une décision qu'on n'a pas pu inscrire ne doit pas être rendue à l'appelant comme
    prise. C'est l'inverse du best-effort qui vaut pour les lignes d'observation — ici
    la ligne *est* la preuve.

    Raises:
        ValueError: si l'événement n'est pas dans le vocabulaire fermé.
    """
    if event not in EVENTS:
        raise ValueError(f"unknown approval event: {event!r}")

    at = datetime.now(UTC)
    digest = entry_digest(
        approval_id=approval_id,
        event=event,
        tool_name=tool_name,
        action_class=action_class,
        subject=subject,
        approved_count=approved_count,
        required_count=required_count,
        at=at,
    )
    with conn.transaction():
        # Même verrou consultatif que le journal d'audit : deux décisions concurrentes
        # sur le même tenant — le cas normal d'un `human_dual` — partageraient sinon un
        # `prev_hash` et casseraient la chaîne sans que personne l'ait modifiée.
        conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"approval:{tenant_id}",))
        prev_row = conn.execute(
            "select entry_hash from approval_decision_events where tenant_id = %s "
            "order by id desc limit 1",
            (tenant_id,),
        ).fetchone()
        prev_hash = prev_row[0] if prev_row else audit.GENESIS
        entry_hash = audit.compute_entry_hash(prev_hash, digest)
        conn.execute(
            "insert into approval_decision_events "
            " (tenant_id, approval_id, event, tool_name, action_class, subject, "
            "  approved_count, required_count, at, entry_digest, prev_hash, entry_hash) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                tenant_id,
                approval_id,
                event,
                tool_name[: audit.MAX_FIELD],
                action_class,
                subject[: audit.MAX_FIELD],
                approved_count,
                required_count,
                at,
                digest,
                prev_hash,
                entry_hash,
            ),
        )
    return entry_hash


def _walk(rows: list[Any]) -> audit.ChainResult:
    """Recalculer une suite de maillons déjà lue. Une seule copie de la marche."""
    prev = audit.GENESIS
    for row_id, digest, stored_prev, stored_hash in rows:
        if stored_prev != prev or audit.compute_entry_hash(prev, digest) != stored_hash:
            return audit.ChainResult(ok=False, broken_id=row_id, count=len(rows))
        prev = stored_hash
    return audit.ChainResult(ok=True, count=len(rows))


def verify_chain(conn: psycopg.Connection, tenant_id: str) -> audit.ChainResult:
    """Recalculer la chaîne des décisions humaines de ce tenant.

    Une chaîne qu'aucun vérificateur ne parcourt n'est pas une chaîne, seulement des
    colonnes qui portent des empreintes.
    """
    return _walk(
        conn.execute(
            "select id, entry_digest, prev_hash, entry_hash from approval_decision_events "
            "where tenant_id = %s order by id",
            (tenant_id,),
        ).fetchall()
    )


def decisions_section(conn: psycopg.Connection) -> dict[str, Any]:
    """Le bloc que l'Evidence Pack publie pour la supervision humaine (art. 14).

    Prend la connexion seule, comme les sections voisines : elle est déjà cadrée au
    tenant par RLS, et refiltrer ici ferait diverger cette section des autres.

    Publie des comptes, l'état de la chaîne, et le nombre d'approbateurs **distincts** —
    jamais leurs identifiants. La question d'un évaluateur est « les décisions humaines
    sont-elles tracées, intactes, et prises par plus d'une personne quand le quorum
    l'exige », pas « qui a cliqué ».
    """
    rows = conn.execute(
        "select event, count(*), count(distinct subject) from approval_decision_events "
        "group by event order by event"
    ).fetchall()
    quorum = conn.execute(
        "select count(*) from approval_decision_events "
        "where event = %s and approved_count < required_count",
        (APPROVED,),
    ).fetchone()
    lignes = conn.execute(
        "select id, entry_digest, prev_hash, entry_hash from approval_decision_events order by id"
    ).fetchall()
    chain = _walk(lignes)
    return {
        "events": chain.count,
        "chain_intact": chain.ok,
        "by_event": {event: {"count": n, "subjects": s} for event, n, s in rows},
        # Doit valoir 0. Une approbation inscrite sous son quorum requis serait un
        # `human_dual` levé par une seule personne — publié plutôt que supposé absent.
        "below_quorum": int(quorum[0]) if quorum else 0,
        "basis": (
            "Chaque décision humaine d'approbation est écrite dans un journal chaîné "
            "distinct, au moment où elle est prise, et non lorsque l'agent vient la "
            "chercher. La table des approbations reste mutable par conception ; "
            "celle-ci ne l'est pas."
        ),
    }

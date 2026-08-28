"""Provenance déclarée des corpus et bases vectorielles (`FR-184`, `M-03`).

Mode **`A` — Attesté**, et le mot est le périmètre : nous ne vérifions pas d'où
viennent les données d'un client, nous rendons sa déclaration auditable et datée.
Revendiquer un contrôle sur l'empoisonnement de données serait faux, et `FR-175`
interdit d'écrire « nous bloquons » sur une ligne publiée `Attesté`.

Ce qui sépare une attestation d'un formulaire, c'est la **fraîcheur**. Une déclaration
faite une fois et jamais revue ne dit presque rien : le corpus a changé, la source a
changé, le responsable est parti. La revue est donc obligatoire et son âge est publié.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import psycopg

#: Au-delà, une déclaration est *périmée* : elle reste une déclaration, elle cesse
#: d'être une preuve. Un an est l'horizon usuel d'une revue de conformité, et le
#: nombre vit ici plutôt que dans un réglage — un plafond que le client choisit
#: lui-même n'atteste rien.
REVIEW_HORIZON_DAYS = 365

_KINDS = frozenset({"dataset", "vector_store"})
_COLUMNS = "id, name, kind, source, steward, declared_at, declared_by, last_reviewed_at"


class CorpusError(ValueError):
    """Déclaration refusée."""


@dataclass(frozen=True)
class Corpus:
    id: int
    name: str
    kind: str
    source: str
    steward: str
    declared_at: datetime
    declared_by: str | None
    last_reviewed_at: datetime

    @property
    def review_age_days(self) -> int:
        return (datetime.now(UTC) - self.last_reviewed_at).days

    @property
    def stale(self) -> bool:
        return self.review_age_days > REVIEW_HORIZON_DAYS


def _row(row: tuple[Any, ...]) -> Corpus:
    return Corpus(
        id=row[0],
        name=row[1],
        kind=row[2],
        source=row[3],
        steward=row[4],
        declared_at=row[5],
        declared_by=row[6],
        last_reviewed_at=row[7],
    )


def declare(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    name: str,
    kind: str,
    source: str,
    steward: str,
    last_reviewed_at: datetime,
    declared_by: str | None = None,
) -> Corpus:
    """Déclarer un corpus, ou remplacer la déclaration portant le même nom.

    Re-déclarer **remplace** plutôt que d'empiler : « quelle est la provenance de ce
    corpus » doit avoir une réponse, pas un historique dont il faudrait déduire la
    dernière. Le journal d'audit porte l'historique ; ceci porte l'état.
    """
    if kind not in _KINDS:
        raise CorpusError(f"type inconnu {kind!r}. Connus : {', '.join(sorted(_KINDS))}.")
    if last_reviewed_at > datetime.now(UTC):
        # Une revue datée dans le futur n'est pas une revue. Le refuser au bord évite
        # qu'une déclaration périmée se rajeunisse d'une frappe.
        raise CorpusError("la date de revue ne peut pas être dans le futur")
    row = conn.execute(
        "insert into corpora (tenant_id, name, kind, source, steward, last_reviewed_at, "
        "declared_by) values (%s, %s, %s, %s, %s, %s, %s) "
        "on conflict (tenant_id, name) do update set "
        "kind = excluded.kind, source = excluded.source, steward = excluded.steward, "
        "last_reviewed_at = excluded.last_reviewed_at, declared_by = excluded.declared_by, "
        f"declared_at = now() returning {_COLUMNS}",
        (tenant_id, name, kind, source, steward, last_reviewed_at, declared_by),
    ).fetchone()
    if row is None:  # pragma: no cover - `returning` rend une ligne sur un upsert réussi
        raise CorpusError("la déclaration n'a pas pu être enregistrée")
    return _row(row)


def list_corpora(conn: psycopg.Connection) -> list[Corpus]:
    """Les corpus visibles pour cette connexion (scopés par RLS)."""
    rows = conn.execute(f"select {_COLUMNS} from corpora order by name").fetchall()
    return [_row(r) for r in rows]


def provenance_section(conn: psycopg.Connection) -> dict[str, Any]:
    """Le bloc que l'Evidence Pack publie (`FR-184`).

    Il porte le compte **et** la péremption. Publier « 12 corpus déclarés » sans dire
    que sept n'ont pas été revus depuis deux ans transformerait une attestation en
    argument, ce qui est exactement l'inverse de son usage.
    """
    corpora = list_corpora(conn)
    stale = [c for c in corpora if c.stale]
    return {
        "declared": len(corpora),
        "review_horizon_days": REVIEW_HORIZON_DAYS,
        "stale": len(stale),
        "stale_names": sorted(c.name for c in stale),
        "by_kind": {
            k: sum(1 for c in corpora if c.kind == k)
            for k in sorted(_KINDS)
            if any(c.kind == k for c in corpora)
        },
        # Dit au lecteur ce que ce bloc *n'est pas*, dans le bloc lui-même : une
        # phrase qui voyage avec la donnée ne peut pas être perdue en la citant.
        "basis": (
            "Déclaration de l'exploitant, horodatée et datée de revue. xSOM ne vérifie "
            "pas la provenance des données : il rend la déclaration auditable."
        ),
    }

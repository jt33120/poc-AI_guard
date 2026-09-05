"""Captures du diagnostic public de profil (`QO-7`).

La seule table du produit qui porte de la **donnée personnelle sans tenant** : un
prospect n'appartient à personne. Ce module existe donc autant pour ce qu'il refuse
que pour ce qu'il fait.

* **Minimisation** — e-mail, profils cochés, horodatage. Rien d'autre n'est collecté :
  ce qui n'est pas collecté n'a pas à être protégé.
* **Rétention bornée** — une donnée personnelle sans durée de conservation n'a pas de
  base légale, et le produit est vendu sur la gouvernance des données.
* **Jamais dans les journaux** — `CLAUDE.md` §4.10. Une ligne d'audit porte l'empreinte
  de l'adresse, jamais l'adresse. Les détecteurs du produit (`core/dlp.py`)
  reconnaissent d'ailleurs un e-mail : tout chemin qui journaliserait la charge serait
  signalé par nos propres gardes, ce qui est cohérent et vaut confirmation.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import psycopg

#: Durée de conservation. Écrite ici et non dans un réglage : c'est un engagement pris
#: devant la personne concernée, pas un paramètre d'exploitation.
RETENTION_DAYS = 365

#: La finalité, telle qu'elle doit être affichée avant la collecte. Elle voyage avec le
#: code qui collecte, pour qu'un changement de l'un rende l'autre visible en revue.
PURPOSE = (
    "Votre adresse sert à vous recontacter au sujet de ce diagnostic et n'est ni "
    "revendue ni transmise à un tiers. Base légale : intérêt légitime (prospection "
    f"B2B). Conservation : {RETENTION_DAYS} jours. Vous pouvez demander sa suppression "
    "à tout moment."
)


class LeadError(ValueError):
    """Capture refusée."""


@dataclass(frozen=True, slots=True)
class Lead:
    id: int
    email_sha256: str
    profiles: tuple[str, ...]
    created_at: datetime


def email_fingerprint(email: str) -> str:
    """L'empreinte qu'un journal a le droit de porter, là où l'adresse ne l'a pas."""
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()


def capture(conn: psycopg.Connection, *, email: str, profiles: list[str]) -> Lead:
    """Enregistrer une capture. Rend le *lead sans son adresse* — volontairement.

    L'appelant n'a aucun usage de l'adresse après l'écriture, et la lui rendre serait
    l'inviter à la journaliser ou à la renvoyer. Ce qu'il obtient est l'empreinte, qui
    suffit à corréler et ne réidentifie personne à elle seule.
    """
    adresse = email.strip()
    if not adresse or "@" not in adresse:
        raise LeadError("adresse e-mail invalide")
    if not profiles:
        raise LeadError("au moins un profil doit être coché")
    row = conn.execute(
        "insert into triage_leads (email, profiles) values (%s, %s) returning id, created_at",
        (adresse, profiles),
    ).fetchone()
    if row is None:  # pragma: no cover - `returning` rend une ligne sur un insert réussi
        raise LeadError("la capture n'a pas pu être enregistrée")
    return Lead(
        id=row[0],
        email_sha256=email_fingerprint(adresse),
        profiles=tuple(profiles),
        created_at=row[1],
    )


def purge_expired(conn: psycopg.Connection, *, days: int = RETENTION_DAYS) -> int:
    """Supprimer les captures au-delà de la durée de conservation. Rend le compte.

    Distinct de `core.compliance.enforce_retention_purge`, qui protège la piste d'audit
    par un **plancher** : là, conserver trop peu affaiblit une preuve ; ici, conserver
    trop longtemps est le manquement. Les deux sont des rétentions, elles ne bornent pas
    du même côté — et les confondre donnerait un plancher là où il faut un plafond.
    """
    if days < 1:
        raise LeadError("la durée de conservation doit être d'au moins un jour")
    limite = datetime.now(UTC) - timedelta(days=days)
    cur = conn.execute("delete from triage_leads where created_at < %s", (limite,))
    return cur.rowcount

"""FR-172 — le diagnostic de profil : ce qui concerne *ce* client, et ce qu'on en fait.

L'énoncé que ce module produit est celui de `THREAT-COVERAGE` §2.5, et il doit être
**calculé devant le client plutôt qu'asséné** :

> « Sur les N menaces que le marché vous présente, M vous concernent réellement
> compte tenu de votre usage. Sur ces M, nous en bloquons K nativement, chez vous,
> aujourd'hui — et voici les preuves. Les autres, nous vous disons qui les porte. »

Un RSSI accorde davantage de crédit à ce compte-là qu'à quinze cases cochées, parce
qu'il sait qu'aucun produit ne les coche. Ce qui fait tenir la phrase, ce n'est donc
pas sa rédaction, c'est d'où viennent les nombres :

* l'applicabilité vient du registre, dont le chargeur refuse une ligne qui
  contredit ses facettes ;
* le mode vient de la carte **publiée** — `coverage/map.json`, produite depuis les
  scénarios qui passent — jamais de la revendication brute. Un diagnostic qui
  citerait `rows.yaml` promettrait ce que le registre espère plutôt que ce que la
  suite prouve ;
* le plafond de profil s'applique après, si bien qu'un client uniquement équipé
  d'IA embarquée SaaS ne peut pas s'entendre dire « bloqué » (`FR-174`).

Absence de carte publiée = pas de diagnostic. Un client à qui on ne peut rien
prouver n'est pas un client à qui on peut tout promettre (`CLAUDE.md` §9).
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from core.profiles import Family, Profile, capped_mode, ceiling

__all__ = ["Diagnostic", "ThreatLine", "diagnose", "parse_profiles"]

_MODE_LABEL = {
    "B": "Bloqué",
    "D": "Détecté",
    "O": "Orchestré",
    "A": "Attesté",
    "X": "Hors périmètre",
    "NA": "non asserté",
}


class MapUnavailable(RuntimeError):
    """The published map is missing or unreadable, so nothing may be claimed."""


@dataclass(frozen=True, slots=True)
class ThreatLine:
    """One threat row as it stands for this client."""

    id: str
    titre: str
    applicable: bool
    family: Family
    #: published mode per facet, already capped by the profile ceiling
    facets: tuple[tuple[str, str], ...]
    #: the profiles that would make this line the client's, if it is not yet
    activates_at: tuple[Profile, ...] = ()

    @property
    def blocked(self) -> bool:
        return any(mode == "B" for _, mode in self.facets)

    @property
    def owner(self) -> str:
        """Who carries this line — and, if it is a switch, what would flip it.

        "Notre terrain" printed over a line the client does not have is the answer
        to a question nobody asked. What they need to hear about the three switches
        of §2.3 is the condition: the poisoning line becomes theirs the day they
        stand up a vector database, not the day they buy a product.
        """
        if self.applicable or self.family is not Family.usage_ia:
            return self.family.label
        if not self.activates_at:
            return self.family.label
        conditions = ", ".join(f"{p.value} ({p.label})" for p in self.activates_at)
        return f"pas encore la vôtre — le devient en {conditions}"


@dataclass(frozen=True, slots=True)
class Diagnostic:
    """The answer to "what of this actually concerns us, and what do you do about it"."""

    profiles: frozenset[Profile]
    cap: str | None
    lines: tuple[ThreatLine, ...]

    @property
    def applicable(self) -> tuple[ThreatLine, ...]:
        return tuple(line for line in self.lines if line.applicable)

    @property
    def not_applicable(self) -> tuple[ThreatLine, ...]:
        return tuple(line for line in self.lines if not line.applicable)

    @property
    def blocked(self) -> tuple[ThreatLine, ...]:
        return tuple(line for line in self.applicable if line.blocked)

    @property
    def ours(self) -> tuple[ThreatLine, ...]:
        """Les lignes applicables qui relèvent de **notre** terrain (`Family.usage_ia`).

        Défini ici et pas chez l'appelant : « sur notre terrain » est la notion que le
        discours commercial répète, et deux lecteurs du même registre qui la calculent
        chacun de leur côté finissent par en donner deux chiffres.
        """
        return tuple(line for line in self.applicable if line.family is Family.usage_ia)

    @property
    def owners(self) -> dict[str, int]:
        """Who carries the lines that are not this client's — counted, and named."""
        return dict(Counter(line.owner for line in self.not_applicable))

    def statement(self) -> str:
        """§2.5, with every number coming from the two sources above."""
        total, applicable, blocked = len(self.lines), len(self.applicable), len(self.blocked)
        # Our line count, not "the 15 the market shows you": prompt injection splits
        # into two vectors here (§3) and the market's number is not ours to compute.
        # A constant nothing checks is a constant that drifts.
        text = (
            f"Sur les {total} lignes de la matrice de menaces, {applicable} vous "
            f"concernent réellement compte tenu de votre usage. Sur ces {applicable}, "
            f"nous en bloquons {blocked} nativement, chez vous, aujourd'hui."
        )
        if self.cap is not None:
            text += (
                f" Votre usage est plafonné à « {_MODE_LABEL[self.cap]} » : devant une IA "
                "embarquée dans une suite SaaS, il n'y a aucune frontière d'outils où nous "
                "interposer. Nous ne bloquons rien de ce périmètre et nous le disons avant "
                "que vous ne le découvriez."
            )
        return text


def parse_profiles(raw: str) -> frozenset[Profile]:
    """Parse `P1a,P3` into profiles, refusing anything not in the vocabulary."""
    values = [part.strip() for part in raw.split(",") if part.strip()]
    if not values:
        raise ValueError("give at least one profile, e.g. P1a,P2,P3")
    out = set()
    for value in values:
        try:
            out.add(Profile(value))
        except ValueError:
            known = ", ".join(f"{p.value} ({p.label})" for p in Profile)
            raise ValueError(f"unknown profile {value!r}. Known: {known}") from None
    return frozenset(out)


def diagnose(published_map: Path, held: frozenset[Profile]) -> Diagnostic:
    """Position a client and derive their applicable subset from the published map."""
    if not published_map.exists():
        raise MapUnavailable(
            f"{published_map} absent — lancez `uv run pytest && uv run python "
            "scripts/gen_coverage.py`. Sans carte publiée, rien n'est prouvé, donc "
            "rien ne peut être annoncé."
        )
    facets = json.loads(published_map.read_text(encoding="utf-8"))["facettes"]
    cap = ceiling(held)
    held_values = {p.value for p in held}

    by_row: dict[str, list[dict[str, str]]] = {}
    for facet in facets:
        by_row.setdefault(facet["menace"], []).append(facet)

    lines = []
    for row_id, row_facets in by_row.items():
        mine = [f for f in row_facets if held_values & set(f["profils"])]
        # A row's family is the one its *applicable* facets carry: of phishing we keep
        # the agent-as-sender facet, so a client running agents is told it is theirs,
        # and one who is not is told it belongs to their mail gateway.
        relevant = mine or row_facets
        families = [Family(f["famille"]) for f in relevant]
        family = (
            Family.usage_ia if Family.usage_ia in families else max(families, key=families.count)
        )
        activates = sorted(
            {Profile(v) for f in row_facets for v in f["profils"]} - held,
            key=lambda p: p.value,
        )
        lines.append(
            ThreatLine(
                id=row_id,
                titre=row_facets[0]["titre"],
                applicable=bool(mine),
                family=family,
                activates_at=tuple(activates),
                facets=tuple(
                    (f["libelle"], capped_mode(f["mode_publie"], cap))
                    for f in sorted(mine, key=lambda f: f["facette"])
                    if f["mode_publie"] != "NA"
                )
                + tuple((f["libelle"], "NA") for f in mine if f["mode_publie"] == "NA"),
            )
        )
    return Diagnostic(profiles=held, cap=cap, lines=tuple(sorted(lines, key=lambda x: x.id)))

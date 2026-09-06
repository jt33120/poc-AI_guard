"""L'unité **ligne** de la carte publiée, définie à un seul endroit.

`coverage/map.json` est une liste de **facettes** : 25 facettes pour 16 lignes de
menace. Une facette est le grain auquel une revendication se prouve — « le garde
d'exécution bloque » et « l'attestation de présence du garde » sont deux phrases
différentes sur la même menace, et `gen_coverage.py` les gate séparément.

Une page qui présente des menaces parle en **lignes**. La conversion d'unité est donc
inévitable, et c'est précisément là qu'on se trompe : sur le profil `P1a`, la carte
compte **3 facettes** bloquées et **2 lignes** bloquées. Les deux nombres sont vrais,
ils ne répondent pas à la même question, et celui qu'on affiche à côté du mot « ligne »
est 2.

Ce module existe pour que cette conversion n'ait qu'une implémentation. `core.triage`
la faisait en interne ; le front en aurait fait une seconde, en TypeScript, et deux
lecteurs du même registre qui comptent chacun de leur côté finissent par en donner deux
chiffres — ce que la docstring de `Diagnostic.ours` dit déjà de « notre terrain ».

Ce que ce module ne fait **pas** : appliquer un profil. L'applicabilité, le plafond et
la famille retenue dépendent du client et vivent dans `core.triage`. Ici, tout est
indépendant du visiteur, donc publiable tel quel dans un artefact statique.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from core.profiles import Family, Profile

__all__ = [
    "MapUnavailable",
    "PublishedFacet",
    "PublishedRow",
    "published_rows",
]


class MapUnavailable(RuntimeError):
    """La carte publiée est absente ou illisible, donc rien ne peut être revendiqué."""


@dataclass(frozen=True, slots=True)
class PublishedFacet:
    """Une facette telle que la carte la publie, jamais telle que le registre la revendique.

    `mode` est le mode **publié** : `gen_coverage.py` l'a déjà rabattu sur ce que les
    scénarios prouvent et sur les chemins d'ingestion réellement assertés (`AD-28`).
    Le mode revendiqué n'est pas repris ici — l'exposer inviterait à l'afficher.
    """

    cle: str
    libelle: str
    mode: str
    famille: Family
    profils: frozenset[Profile]
    ingress_prouve: tuple[str, ...]
    ingress_non_asserte: tuple[str, ...]
    scenarios: tuple[str, ...]
    ecarts: tuple[str, ...]
    #: pourquoi cette facette n'est pas couverte, quand elle ne l'est pas (`FR-144`)
    raison: str | None


@dataclass(frozen=True, slots=True)
class PublishedRow:
    """Une ligne de menace : l'unité dont parle une page, et dont parle un RSSI."""

    id: str
    titre: str
    facettes: tuple[PublishedFacet, ...]

    @property
    def profils(self) -> frozenset[Profile]:
        """Les profils qu'au moins une facette concerne."""
        return frozenset().union(*(f.profils for f in self.facettes))

    @property
    def bloquee(self) -> bool:
        """Vrai dès qu'**une** facette est publiée `Bloqué`.

        C'est l'unité ligne, et elle n'est pas la somme des facettes : une ligne dont
        deux facettes bloquent compte pour une.
        """
        return any(f.mode == "B" for f in self.facettes)

    @property
    def rejouable(self) -> bool:
        """La ligne a-t-elle de quoi être **montrée** plutôt qu'affirmée.

        Dérivé, jamais listé à la main. `gen_coverage.py` n'accorde `Bloqué` qu'à une
        facette portant ses deux moitiés — un scénario qui bloque **et** un scénario
        qui laisse passer un appel légitime. C'est exactement ce qu'il faut pour
        filmer une séquence : un blocage sans son contrôle négatif est un écran où
        rien ne se passe, qu'un plantage produirait à l'identique.

        Les huit lignes rejouables tombent donc de la carte, et suivront ce qu'elle
        publie sans qu'aucune liste n'ait à être tenue à jour.
        """
        return self.bloquee


def _facet(raw: dict[str, Any]) -> PublishedFacet:
    return PublishedFacet(
        cle=str(raw["facette"]),
        libelle=str(raw["libelle"]),
        mode=str(raw["mode_publie"]),
        famille=Family(raw["famille"]),
        profils=frozenset(Profile(p) for p in raw["profils"]),
        ingress_prouve=tuple(raw.get("ingress_prouve") or []),
        ingress_non_asserte=tuple(raw.get("ingress_non_asserte") or []),
        scenarios=tuple(raw.get("scenarios") or []),
        ecarts=tuple(raw.get("ecarts") or []),
        raison=raw.get("raison") or None,
    )


def published_rows(carte: Path) -> tuple[PublishedRow, ...]:
    """Regrouper la carte publiée en lignes, triées par identifiant.

    Fail-closed : sans carte, on lève plutôt que de rendre une liste vide. Une liste
    vide se présente comme « aucune menace », ce qui est la pire des réponses fausses.
    """
    if not carte.exists():
        raise MapUnavailable(
            f"{carte} absent — lancez `uv run pytest && uv run python "
            "scripts/gen_coverage.py`. Sans carte publiée, rien n'est prouvé, donc "
            "rien ne peut être annoncé."
        )
    try:
        facettes = json.loads(carte.read_text(encoding="utf-8"))["facettes"]
    except (json.JSONDecodeError, KeyError, OSError) as exc:
        raise MapUnavailable(f"{carte} illisible : {exc}") from None

    par_ligne: dict[str, list[dict[str, Any]]] = {}
    for facette in facettes:
        par_ligne.setdefault(facette["menace"], []).append(facette)

    return tuple(
        sorted(
            (
                PublishedRow(
                    id=row_id,
                    titre=str(brutes[0]["titre"]),
                    # Triées par clé : l'ordre d'une liste affichée ne doit pas
                    # dépendre de l'ordre d'écriture du générateur.
                    facettes=tuple(_facet(f) for f in sorted(brutes, key=lambda f: f["facette"])),
                )
                for row_id, brutes in par_ligne.items()
            ),
            key=lambda ligne: ligne.id,
        )
    )

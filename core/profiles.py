"""FR-172 / FR-174 — l'axe d'applicabilité : quelles menaces concernent *ce* client.

La couverture dit ce que nous savons faire. Elle ne dit pas si la menace concerne
le client en face. C'est le second axe, et c'est celui qui porte le premier pilier
du produit : faire comprendre les vrais enjeux derrière les mots-clés.

Le tri fondateur (`THREAT-COVERAGE` §2.1) : les attaques qui visent un **éditeur de
modèle** ne sont pas celles qui visent un **grand compte qui utilise l'IA**. La
matrice du marché mélange les deux populations sans le dire, parce que tout le
monde a intérêt à vendre les quinze lignes. Dire à voix haute que six d'entre elles
ne sont pas le sujet du client est un argument de crédibilité, pas une concession.

Trois notions, et elles sont distinctes :

* le **profil** dit ce que le client fait de l'IA, et chaque profil ajoute aux
  précédents (§2.2) ;
* la **famille** dit à qui le problème appartient (§2.1) ;
* le **plafond** dit jusqu'où nous pouvons aller *sur ce profil* — et c'est là que
  `FR-174` vit : devant une IA embarquée dans une suite SaaS il n'y a aucune
  frontière d'outils à instrumenter, donc `Bloqué` est structurellement hors
  d'atteinte. Ce n'est pas une prudence de rédaction, c'est une propriété du
  déploiement, et elle est calculée plutôt qu'écrite pour qu'aucune formulation ne
  puisse la contourner.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any

import yaml

__all__ = [
    "Family",
    "Profile",
    "Referentiel",
    "Row",
    "RowFacet",
    "Taxonomie",
    "applicable_rows",
    "capped_mode",
    "ceiling",
    "load_rows",
]

# Coverage modes, tightest first. The order *is* the comparison: a ceiling caps a
# claim by taking whichever of the two is weaker.
_MODE_STRENGTH: dict[str, int] = {"B": 4, "D": 3, "O": 2, "A": 1, "X": 0}


class Profile(StrEnum):
    """Where the client sits in the value chain (§2.2). Each profile adds to the last."""

    p1a = "P1a"  # consumes a hyperscaler API (Azure OpenAI and the like)
    p1b = "P1b"  # SaaS-embedded AI (Copilot and the like)
    p2 = "P2"  # internal RAG over its own documents
    p3 = "P3"  # tooled agents: the AI acts — sends, writes, pays, deploys
    p4 = "P4"  # self-hosted open weights
    p5 = "P5"  # trains or fine-tunes

    @property
    def label(self) -> str:
        return _PROFILE_LABEL[self]


class Family(StrEnum):
    """Whose problem this is (§2.1)."""

    fournisseur = "fournisseur"  # the outfit that trains and serves the model
    cyber_classique = "cyber_classique"  # real, but it is their SOC, mail gateway, EDR
    usage_ia = "usage_ia"  # the client's, and our ground

    @property
    def label(self) -> str:
        return _FAMILY_LABEL[self]


_PROFILE_LABEL: dict[Profile, str] = {
    Profile.p1a: "API hyperscaler",
    Profile.p1b: "IA embarquée SaaS",
    Profile.p2: "RAG interne",
    Profile.p3: "Agents outillés",
    Profile.p4: "Poids ouverts hébergés",
    Profile.p5: "Entraînement / fine-tuning",
}

_FAMILY_LABEL: dict[Family, str] = {
    Family.fournisseur: "l'éditeur du modèle",
    Family.cyber_classique: "le SOC du client (cyber classique)",
    Family.usage_ia: "le client — notre terrain",
}


#: Interposition ceilings (`FR-174`). A profile absent from this table has no
#: ceiling: what we can prove, we may claim.
#:
#: `P1b` is the declared blind spot. Microsoft Copilot and its kind are embedded in
#: the suite: the assistant's actions run inside the tenant and no MCP gateway
#: interposes. Detection and log attestation are reachable; blocking is not. A
#: vendor claiming to supervise Copilot through a proxy is lying or has not
#: understood the product — so this cap exists to make *us* unable to say it.
_CEILING: dict[Profile, str] = {Profile.p1b: "D"}


class Souverainete(StrEnum):
    """Comment un substitut satisfait le critère de `QO-3`.

    Le critère est la **dépendance opérationnelle**, pas la nationalité de l'éditeur :
    `ruff` et `mypy` sont américains et ne percent aucune chaîne parce qu'ils
    s'exécutent chez l'exploitant. Ce qui perce la chaîne, c'est un service appelé en
    ligne, qui voit les données, et dont la décision dépend.
    """

    #: s'exécute dans le périmètre de l'exploitant, sans rappel réseau
    local = "local"
    #: service en ligne, mais sous juridiction de l'Union
    ue = "ue"


class Taxonomie(StrEnum):
    """Les référentiels auxquels une ligne de menace peut se rattacher (`FR-194`).

    **Fermée, et c'est là toute la règle.** `AR-1` / `EXH-7` tracent la frontière
    entre une taxonomie *technique* — s'y aligner est descriptif — et un référentiel
    de *management* (ISO 42001, SOC 2, NIST AI RMF, NIS2, DORA, ANSSI), dont la
    correspondance engage le jugement d'un assesseur en exercice. La revue le dit
    sans détour : « une correspondance qu'un auditeur rejette est pire que pas de
    correspondance ».

    Un champ libre laisserait écrire `ISO 42001` sans que personne ne le voie passer.
    L'énumération oblige à modifier ce fichier, donc à le défendre en revue.
    """

    owasp_llm = "owasp_llm"
    mitre_atlas = "mitre_atlas"


@dataclass(frozen=True, slots=True)
class Referentiel:
    """Une correspondance vers une taxonomie technique, **millésimée**.

    La version n'est pas décorative : `LLM01` seul n'identifie rien, OWASP ayant
    renuméroté entre 2023 et 2025 — `LLM10` y est passé de « Model Theft » à
    « Unbounded Consumption ». Une correspondance sans millésime est précisément
    celle qu'un auditeur rejette.
    """

    taxonomie: Taxonomie
    version: str
    identifiant: str


@dataclass(frozen=True, slots=True)
class Substitut:
    """Le contrôle tiers qu'une ligne `Orchestré` pilote réellement (`FR-178`)."""

    nom: str
    justification: Souverainete


@dataclass(frozen=True, slots=True)
class RowFacet:
    """One facet of a threat row, with the applicability it inherits or overrides."""

    cle: str
    libelle: str
    mode: str
    family: Family
    profiles: frozenset[Profile]
    ingress: tuple[str, ...] = ()
    gaps: tuple[str, ...] = ()
    #: le substitut souverain, obligatoire pour publier `Orchestré` (`FR-178`)
    substitut: Substitut | None = None
    #: `Orchestré` revendiqué, mais sans substitut : publié `Hors périmètre`
    declasse: bool = False
    #: la section d'Evidence Pack qui porte une facette `Attesté` (chemin
    #: `article.section`, vérifié contre `core.compliance.EVIDENCE_SECTIONS`)
    section: str | None = None
    #: pourquoi une facette `Hors périmètre` ne l'est pas — la doctrine exige que la
    #: ligne non couverte soit publiée *avec sa raison* (`FR-144`)
    raison: str | None = None
    #: les taxonomies techniques auxquelles cette facette se rattache (`FR-194`)
    referentiels: tuple[Referentiel, ...] = ()


@dataclass(frozen=True, slots=True)
class Row:
    """A threat row: what it is, whose problem it is, and who it activates for."""

    id: str
    titre: str
    family: Family
    profiles: frozenset[Profile]
    facets: tuple[RowFacet, ...]

    def applies_to(self, held: frozenset[Profile]) -> bool:
        return bool(self.profiles & held)


def ceiling(profiles: frozenset[Profile]) -> str | None:
    """The strongest mode reachable across these profiles, or None if uncapped.

    A client is capped only when **every** profile they hold is capped. Someone
    running Copilot *and* tooled agents is not blind: the agents are interposable,
    so the ceiling of the SaaS assistant does not bound what we do elsewhere.
    """
    if not profiles:
        return None
    caps = [_CEILING.get(p) for p in profiles]
    if any(cap is None for cap in caps):
        return None
    return max((cap for cap in caps if cap), key=lambda m: _MODE_STRENGTH[m])


def capped_mode(mode: str, cap: str | None) -> str:
    """The claim that survives the ceiling — whichever of the two is weaker."""
    if cap is None:
        return mode
    return mode if _MODE_STRENGTH[mode] <= _MODE_STRENGTH[cap] else cap


def applicable_rows(rows: list[Row], held: frozenset[Profile]) -> list[Row]:
    """The subset of the matrix that concerns a client holding these profiles."""
    return [row for row in rows if row.applies_to(held)]


def _profiles(raw: Any, where: str) -> frozenset[Profile]:
    if not isinstance(raw, list) or not raw:
        raise ValueError(f"{where}: `profils` must be a non-empty list")
    out = set()
    for value in raw:
        try:
            out.add(Profile(value))
        except ValueError:
            known = ", ".join(p.value for p in Profile)
            raise ValueError(f"{where}: unknown profile {value!r} (known: {known})") from None
    return frozenset(out)


def _family(raw: Any, where: str) -> Family:
    try:
        return Family(raw)
    except ValueError:
        known = ", ".join(f.value for f in Family)
        raise ValueError(f"{where}: unknown family {raw!r} (known: {known})") from None


def _substitut(raw: Any, where: str) -> Substitut | None:
    """Parse a facet's sovereign substitute, fail-closed on an unknown justification.

    Nommer un substitut ne le rend pas souverain : la justification dit *pourquoi* il
    satisfait `QO-3`. Un vocabulaire fermé oblige à l'écrire — inscrire un SaaS
    américain demande alors de déclarer `ue`, ce qu'un relecteur voit, là où un champ
    libre laisserait passer un nom sans propriété.
    """
    if raw is None:
        return None
    if not isinstance(raw, dict) or "nom" not in raw or "justification" not in raw:
        raise ValueError(f"{where}: `substitut` demande `nom` et `justification`.")
    try:
        justification = Souverainete(raw["justification"])
    except ValueError:
        connues = ", ".join(sorted(j.value for j in Souverainete))
        raise ValueError(
            f"{where}: justification de substitut inconnue "
            f"{raw['justification']!r}. Connues : {connues}."
        ) from None
    return Substitut(nom=str(raw["nom"]), justification=justification)


#: La raison qu'une facette `Orchestré` sans substitut publie d'elle-même (`FR-178`).
_RAISON_SANS_SUBSTITUT = (
    "Revendiqué « Orchestré » sans substitut souverain nommé : piloter un contrôle "
    "tiers en fait une dépendance, et une dépendance qu'on ne peut pas nommer ne peut "
    "pas être revendiquée (`FR-178`)."
)


def _referentiels(raw: Any, where: str) -> tuple[Referentiel, ...]:
    """Parse les correspondances de taxonomie, fail-closed sur tout ce qui n'est pas su.

    Trois refus, et chacun ferme une façon différente de publier une correspondance
    qu'un auditeur rejetterait : une taxonomie hors de l'énumération (donc un
    référentiel de management déguisé), un millésime absent, un identifiant vide.
    """
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ValueError(f"{where}: `referentiels` doit être une liste.")
    out: list[Referentiel] = []
    for entree in raw:
        if not isinstance(entree, dict):
            raise ValueError(f"{where}: chaque référentiel est un dict.")
        manquants = [k for k in ("taxonomie", "version", "id") if not entree.get(k)]
        if manquants:
            raise ValueError(
                f"{where}: référentiel incomplet, il manque {', '.join(manquants)}. "
                "Le millésime est obligatoire : `LLM01` sans version n'identifie rien."
            )
        try:
            taxonomie = Taxonomie(entree["taxonomie"])
        except ValueError:
            connues = ", ".join(sorted(t.value for t in Taxonomie))
            raise ValueError(
                f"{where}: taxonomie inconnue {entree['taxonomie']!r}. Connues : "
                f"{connues}. Les référentiels de management (ISO 42001, SOC 2, NIS2, "
                "DORA, ANSSI) sont délibérément hors de cette liste — leur "
                "correspondance demande le jugement d'un assesseur (`AR-1`)."
            ) from None
        out.append(
            Referentiel(
                taxonomie=taxonomie,
                version=str(entree["version"]),
                identifiant=str(entree["id"]),
            )
        )
    return tuple(out)


def _section(raw: Any, where: str) -> str | None:
    """La section d'Evidence Pack d'une facette `Attesté`, en chemin `article.section`.

    Validée ici sur la forme seulement. L'existence de la section est vérifiée par le
    générateur de carte, qui la confronte à `core.compliance.EVIDENCE_SECTIONS` — le
    parseur ne doit pas importer le module de conformité, qui parle à la base.
    """
    if raw is None:
        return None
    texte = str(raw)
    if texte.count(".") != 1 or not all(texte.split(".")):
        raise ValueError(
            f"{where}: `section` doit être un chemin `article.section` (reçu {texte!r})."
        )
    return texte


def load_rows(registry: Path) -> list[Row]:
    """Parse the coverage registry into rows carrying their applicability.

    Applicability is declared on the row and may be **overridden per facet**,
    because on several rows it genuinely differs: of "hyper-personalised phishing"
    we keep only the AI facet — the agent as *sender* — and leave reception to the
    mail gateway. A single row-level answer there would either claim the mail
    gateway or disown the sender.
    """
    doc = yaml.safe_load(registry.read_text(encoding="utf-8"))
    rows: list[Row] = []
    for raw_row in doc["rows"]:
        where = raw_row["id"]
        row_family = _family(raw_row["famille"], where)
        row_profiles = _profiles(raw_row["profils"], where)
        # `FR-194` : la correspondance de taxonomie est une propriété de la **ligne**
        # de menace — « M-01 ≡ LLM01 » parle de la menace, pas de l'une de ses
        # facettes. Elle s'hérite donc comme `famille` et `profils`, et se surcharge
        # au même endroit quand une facette diverge réellement.
        row_referentiels = _referentiels(raw_row.get("referentiels"), where)
        facets = []
        for raw in raw_row["facettes"]:
            facet_where = f"{where}/{raw['cle']}"
            substitut = _substitut(raw.get("substitut"), facet_where)
            # FR-178. `Orchestré` dit : nous pilotons un contrôle tiers qui le fait.
            # Le tiers devient alors une dépendance, et la doctrine de souveraineté
            # s'applique à lui. Sans substitut nommé, la ligne **reste** `Hors
            # périmètre` plutôt que d'être revendiquée par un chemin qui contredit le
            # discours -- la déclassification se fait ici, au parse, pour que la carte,
            # le diagnostic de profil et les tests lisent tous la même chose.
            declasse = raw["mode"] == "O" and substitut is None
            facets.append(
                RowFacet(
                    cle=raw["cle"],
                    libelle=raw["libelle"],
                    mode="X" if declasse else raw["mode"],
                    family=(
                        _family(raw["famille"], facet_where) if "famille" in raw else row_family
                    ),
                    profiles=(
                        _profiles(raw["profils"], facet_where) if "profils" in raw else row_profiles
                    ),
                    ingress=tuple(raw.get("ingress") or []),
                    gaps=tuple(raw.get("gaps") or []),
                    substitut=substitut,
                    declasse=declasse,
                    section=_section(raw.get("section"), facet_where),
                    # Le déclassement de `FR-178` porte sa propre raison : il la
                    # connaît, et la faire écrire à la main dupliquerait ce que le
                    # code sait déjà — deux textes qui finiraient par diverger.
                    referentiels=(
                        _referentiels(raw["referentiels"], facet_where)
                        if "referentiels" in raw
                        else row_referentiels
                    ),
                    raison=(
                        str(raw["raison"])
                        if raw.get("raison")
                        else (_RAISON_SANS_SUBSTITUT if declasse else None)
                    ),
                )
            )
        # The row's declared applicability must equal what its facets add up to.
        # Redundancy that is checked is documentation -- a reader sees the row's
        # answer without adding up five facets. Redundancy that is *not* checked is
        # a contradiction waiting to be published, and this one would publish as
        # "this threat does not concern you" over a facet that does.
        union = frozenset().union(*(f.profiles for f in facets))
        if union != row_profiles:
            raise ValueError(
                f"{where}: `profils` {sorted(row_profiles)} is not the union of its "
                f"facets' {sorted(union)}. Fix whichever is wrong -- the row line is "
                "the one a reader trusts."
            )
        rows.append(
            Row(
                id=where,
                titre=raw_row["titre"],
                family=row_family,
                profiles=row_profiles,
                facets=tuple(facets),
            )
        )
    return rows

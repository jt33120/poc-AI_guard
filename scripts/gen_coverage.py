#!/usr/bin/env python3
"""Generate the coverage map from the scenarios that passed (AD-30, CM-7).

The map is **derived, never authored**. `coverage/rows.yaml` says what is
*claimed*; `coverage/.scenarios.json`, written by the pytest run, says what is
*proven*. This script confronts the two.

Two rules carry the whole thing:

1. **A facet claimed `Bloqué` with no passing scenario fails the build.** That is
   `CM-7` with a target of zero. A claim no test asserts is not a shade of wording,
   it is a false statement about a security control.
2. **A facet is published `Bloqué` only on the ingress paths actually proven.** A
   claim true on MCP reads as true everywhere unless the map says otherwise
   (`AD-28`). Unproven ingress paths render as `non asserté`, never as `Bloqué`.
3. **A `Bloqué` facet needs both halves: a scenario that blocks, and one that lets a
   legitimate call through.** A guard that refuses everything is not a control, it is
   an outage -- and a blocking-only scenario stays green on a gateway that blocks
   blindly. This is the mechanically checkable form of "every scenario carries its
   negative control".

Usage:
    uv run pytest                          # writes coverage/.scenarios.json
    uv run python scripts/gen_coverage.py  # gates, then writes the map
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO))

from core.profiles import (  # noqa: E402 -- needs _REPO on the path first
    Family,
    Profile,
    Substitut,
    capped_mode,
    ceiling,
    load_rows,
)

_REGISTRY = _REPO / "coverage" / "rows.yaml"
_SCENARIOS = _REPO / "coverage" / ".scenarios.json"
_OUT_JSON = _REPO / "coverage" / "map.json"
_OUT_MD = _REPO / "coverage" / "COVERAGE-MAP.md"


@dataclass
class Facet:
    row_id: str
    row_titre: str
    cle: str
    libelle: str
    mode_revendique: str
    ingress_revendique: list[str]
    gaps: list[str]
    #: whose problem this facet is (AD-28's sibling axis: applicability)
    family: Family = Family.usage_ia
    #: the profiles at which this facet is on the client's radar at all
    profiles: frozenset[Profile] = field(default_factory=frozenset)
    #: ingress path -> node ids of the tests that passed for it
    prouve: dict[str, list[str]] = field(default_factory=dict)
    #: which halves of the claim are proven: "bloque" and/or "laisse_passer"
    sens_prouves: set[str] = field(default_factory=set)
    #: the sovereign substitute an `Orchestré` facet pilots (`FR-178`)
    substitut: Substitut | None = None
    #: claimed `Orchestré`, demoted to `Hors périmètre` for want of a substitute
    declasse: bool = False

    @property
    def exige_scenario(self) -> bool:
        return self.mode_revendique == "B"

    @property
    def sens_manquants(self) -> list[str]:
        if not self.exige_scenario:
            return []
        return [s for s in _SENS_REQUIS if s not in self.sens_prouves]

    @property
    def mode_publie(self) -> str:
        """The mode we may actually publish. `Bloqué` survives only if fully proven."""
        if not self.exige_scenario:
            return self.mode_revendique
        return "B" if self.prouve and not self.sens_manquants else "NA"

    @property
    def ingress_manquants(self) -> list[str]:
        return [i for i in self.ingress_revendique if i not in self.prouve]


def _load_facets() -> list[Facet]:
    """Flatten the registry into facets, applicability included.

    Parsing goes through `core.profiles.load_rows` rather than a second YAML reader
    here, so the generator inherits its checks -- an unknown profile, or a row whose
    line contradicts its facets, stops the map instead of being published.
    """
    facets = []
    for row in load_rows(_REGISTRY):
        for f in row.facets:
            facets.append(
                Facet(
                    row_id=row.id,
                    row_titre=row.titre,
                    cle=f.cle,
                    libelle=f.libelle,
                    mode_revendique=f.mode,
                    ingress_revendique=list(f.ingress),
                    gaps=list(f.gaps),
                    family=f.family,
                    profiles=f.profiles,
                    substitut=f.substitut,
                    declasse=f.declasse,
                )
            )
    return facets


def _attach_scenarios(facets: list[Facet]) -> list[str]:
    """Fold passing scenarios into the facets. Returns errors for unknown markers."""
    if not _SCENARIOS.exists():
        return [
            f"{_SCENARIOS.relative_to(_REPO)} absent — lancez `uv run pytest` d'abord. "
            "Sans rapport de scénarios, rien n'est prouvé (fail-closed)."
        ]
    by_key = {(f.row_id, f.cle): f for f in facets}
    errors = []
    for entry in json.loads(_SCENARIOS.read_text(encoding="utf-8")):
        key = (entry["row"], entry["facet"])
        facet = by_key.get(key)
        if facet is None:
            errors.append(
                f"marqueur inconnu {key[0]}/{key[1]} sur {entry['test']} — "
                "aucune facette de ce nom dans coverage/rows.yaml"
            )
            continue
        if entry["outcome"] != "passed":
            continue  # a test that did not pass proves nothing
        ingress = entry.get("ingress") or "?"
        if facet.ingress_revendique and ingress not in facet.ingress_revendique:
            errors.append(
                f"{key[0]}/{key[1]}: {entry['test']} déclare l'ingress '{ingress}', "
                f"absent de la revendication {facet.ingress_revendique}"
            )
            continue
        facet.prouve.setdefault(ingress, []).append(entry["test"])
        if entry.get("sens"):
            facet.sens_prouves.add(entry["sens"])
    return errors


# --- FR-175: only `Bloqué` licenses the verb ------------------------------------

#: Where commercial language lives. A file added here is a file the gate reads;
#: a support that is not listed is a support nobody checks, which is why the list
#: is in the repo rather than in someone's head.
_CLAIM_SOURCES: tuple[str, ...] = (
    "README.md",
    "blueprint/**/*.md",
    "blueprint/**/*.yaml",
    "docs/product/THREAT-COVERAGE.md",
    "coverage/COVERAGE-MAP.md",
)

_BLOCKING_VERB = re.compile(
    r"\b(bloqu(?:er|ons|ez|ent|e|es|ée?s?|és?)|block(?:s|ed|ing)?)\b", re.IGNORECASE
)

#: The mode name, exactly as the vocabulary spells it. `Bloqué` is a *noun* here --
#: the public page's own heading is "cinq modes, et un seul autorise le verbe
#: « bloquer » ", and the coverage map is a table of them. A gate that failed on the
#: word used to state the rule is a gate someone switches off within a week.
#:
#: The blind spot this buys, stated rather than discovered later: a sentence that
#: *opens* with the participle ("Bloqué par la policy, l'appel …") reads as the mode
#: name and is not judged. Every other form is -- lowercase, and every agreement.
_MODE_NAME = "Bloqué"


def _claims_blocking(sentence: str) -> bool:
    """Whether this sentence uses the verb, as opposed to naming the mode."""
    return any(m.group(0) != _MODE_NAME for m in _BLOCKING_VERB.finditer(sentence))


_ROW_REF = re.compile(r"\bM-\d{2}\b")
_SENTENCE = re.compile(r"(?<=[.!?;:])\s+|\n")


def _check_claims(facets: list[Facet]) -> tuple[list[str], int]:
    """Refuse the verb "bloquer" on a row nothing publishes as `Bloqué` (`FR-175`).

    A support that says "we block M-13" when M-13 publishes `Détecté` is the same
    defect as a `Bloqué` claim with no scenario -- one release further downstream,
    in front of a customer, where it costs the most.

    **What this gate does not see**, said plainly rather than implied: it judges a
    sentence that names a row. A blocking verb with no row reference is generic
    prose about the mechanism, and no regular expression can tell an honest one
    from an overreach. Their count is returned so the number is at least visible.
    """
    blocked = {f.row_id for f in facets if f.mode_publie == "B"}
    known = {f.row_id for f in facets}
    errors: list[str] = []
    unattributed = 0

    for pattern in _CLAIM_SOURCES:
        for path in sorted(_REPO.glob(pattern)):
            for sentence in _SENTENCE.split(path.read_text(encoding="utf-8")):
                if not _claims_blocking(sentence):
                    continue
                rows = sorted(set(_ROW_REF.findall(sentence)))
                if not rows:
                    unattributed += 1
                    continue
                for row in rows:
                    if row not in known:
                        errors.append(
                            f"{path.relative_to(_REPO)} : « bloquer » attribué à {row}, "
                            "qui n'existe pas dans coverage/rows.yaml"
                        )
                    elif row not in blocked:
                        errors.append(
                            f"{path.relative_to(_REPO)} : « bloquer » attribué à {row}, "
                            f"qu'aucune facette ne publie « Bloqué »\n"
                            f"      → {sentence.strip()[:120]}"
                        )
    return errors, unattributed


def _commit() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],  # noqa: S607
            cwd=_REPO,
            capture_output=True,
            text=True,
            check=True,
        )
        return out.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):  # pragma: no cover
        return "inconnu"


#: Why a missing half matters, said in the error rather than left to be inferred.
#: The three parts a `Bloqué` claim is made of, in the order they are reported.
_SENS_REQUIS = ("bloque", "laisse_passer", "controle_negatif")

_POURQUOI_SENS = {
    "bloque": "aucun scénario ne prouve que l'action est refusée",
    "laisse_passer": (
        "aucun scénario ne prouve qu'un appel légitime passe encore — "
        "une garde qui refuse tout est une panne, pas un contrôle"
    ),
    "controle_negatif": (
        "aucun contrôle négatif : rien ne prouve que la garde désactivée, *cette* "
        "action atteindrait l'aval (AD-30.3). Sans lui, un `bloque` vert prouve "
        "seulement qu'il ne s'est rien passé — un plantage, un aval injoignable ou "
        "un nom d'outil mal orthographié satisfont « la défense a tenu »"
    ),
}

_MODE_LABEL = {
    "B": "Bloqué",
    "D": "Détecté",
    "O": "Orchestré",
    "A": "Attesté",
    "X": "Hors périmètre",
    "NA": "**non asserté**",
}


_PUBLISHED_ORDER = ("B", "D", "O", "A", "NA", "X")


def _render_applicability(facets: list[Facet]) -> list[str]:
    """The second axis (`FR-173`): what this map is worth *to a given client*.

    A single mode column reads as though every line mattered equally to everyone,
    which is the catalogue the product exists to argue against. Crossed with the
    usage profile, the same registry says something a prospect can act on: how much
    of what actually concerns them we actually stop.

    Rows nobody's profile activates are not dropped -- an absent line reads as an
    oversight, a line marked inapplicable reads as an answer.
    """
    lines = [
        "## Applicabilité × couverture",
        "",
        "Le mode dit ce que nous savons faire ; le profil dit si la ligne concerne ce",
        "client. Les deux ensemble donnent le seul chiffre qui vaut quelque chose en",
        "réunion. Une facette plafonnée par le profil est comptée **au plafond**, pas à",
        "sa revendication.",
        "",
        "| Profil | Lignes | Facettes | "
        + " | ".join(_MODE_LABEL[m].replace("**", "") for m in _PUBLISHED_ORDER)
        + " |",
        "|---" * (3 + len(_PUBLISHED_ORDER)) + "|",
    ]
    capped_profiles = []
    for profile in Profile:
        held = frozenset({profile})
        cap = ceiling(held)
        if cap is not None:
            capped_profiles.append((profile, cap))
        applicable = [f for f in facets if f.profiles & held]
        tally = dict.fromkeys(_PUBLISHED_ORDER, 0)
        for f in applicable:
            tally[capped_mode(f.mode_publie, cap) if f.mode_publie != "NA" else "NA"] += 1
        cells = " | ".join(str(tally[m]) for m in _PUBLISHED_ORDER)
        marker = " ⛔" if cap is not None else ""
        # Rows are what a prospect counts ("15 menaces"); facets are what we prove.
        # Publishing only one of the two invites the other to be inferred wrongly.
        lines.append(
            f"| **{profile.value}** — {profile.label}{marker} "
            f"| {len({f.row_id for f in applicable})} | {len(applicable)} | {cells} |"
        )

    ours = [f for f in facets if f.family is Family.usage_ia]
    lines += [
        "",
        f"Sur {len({f.row_id for f in facets})} lignes de menace, "
        f"{len({f.row_id for f in ours})} relèvent de notre terrain ; les autres, nous "
        "disons qui les porte plutôt que de les retirer de la carte.",
    ]
    for profile, cap in capped_profiles:
        lines += [
            "",
            f"⛔ **{profile.value} — {profile.label}** est plafonné à "
            f"« {_MODE_LABEL[cap]} ». Il n'y a aucune frontière d'outils à instrumenter "
            "devant un assistant encastré dans une suite : ses actions s'exécutent dans le "
            "tenant et aucun gateway ne s'intercale. La colonne « Bloqué » y est "
            "structurellement à zéro, et c'est le générateur qui l'impose — pas une "
            "précaution de rédaction (`FR-174`).",
        ]
    return lines


def _render_souverainete(facets: list[Facet]) -> list[str]:
    """`FR-178` : ce qu'une ligne `Orchestré` pilote, et ce que ça coûte quand rien n'existe.

    Une ligne `Orchestré` dit : nous ne le bloquons pas nous-mêmes, nous pilotons un
    contrôle tiers qui le fait. Le tiers devient une dépendance, donc la doctrine de
    souveraineté s'applique à lui. Publier la déclassification plutôt que de la taire
    est la moitié qui compte : un lecteur voit ce que la doctrine coûte, au lieu de
    voir une ligne manquante et de supposer un oubli.
    """
    orchestres: list[tuple[Facet, Substitut]] = [
        (f, sub) for f in facets if (sub := f.substitut) is not None
    ]
    declasses = [f for f in facets if f.declasse]
    if not orchestres and not declasses:
        return []

    lines = [
        "## Contrôles orchestrés et substituts souverains",
        "",
        "Le critère est la **dépendance opérationnelle** (`QO-3`) : `local` s'exécute dans",
        "le périmètre sans rappel réseau ; `ue` est un service en ligne sous juridiction de",
        "l'Union. Une facette `Orchestré` sans substitut nommé est publiée",
        "« Hors périmètre » — le générateur l'impose (`FR-178`).",
        "",
        "| Menace | Facette | Substitut | Critère |",
        "|---|---|---|---|",
    ]
    for f, sub in orchestres:
        lines.append(f"| **{f.row_id}** | {f.libelle} | {sub.nom} | `{sub.justification.value}` |")
    for f in declasses:
        lines.append(
            f"| **{f.row_id}** | {f.libelle} | *aucun substitut souverain* "
            "| ⛔ déclassé en « Hors périmètre » |"
        )
    if declasses:
        lines += [
            "",
            f"⛔ **{len(declasses)} facette(s) déclassée(s).** C'est ce que la doctrine coûte "
            "appliquée honnêtement : la revendication est retirée plutôt que tenue par un "
            "chemin qui contredit le discours.",
        ]
    return lines


def _render_md(facets: list[Facet], commit: str, stamp: str) -> str:
    lines = [
        "# Carte de couverture — générée",
        "",
        "> **Ne pas éditer.** Produit par `scripts/gen_coverage.py` depuis les scénarios",
        "> qui passent (`AD-30`). Toute correction se fait sur `coverage/rows.yaml` ou",
        "> sur le test qui prouve la ligne.",
        "",
        f"Commit `{commit}` · {stamp}",
        "",
        *_render_applicability(facets),
        "",
        *_render_souverainete(facets),
        "",
        "## Le détail, facette par facette",
        "",
        "| Menace | Facette | Qui la porte | Profils | Mode publié "
        "| Ingestion prouvée | Scén. | Écarts |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for f in facets:
        prouve = ", ".join(f"`{i}`" for i in sorted(f.prouve)) or "—"
        manquants = ", ".join(f"~~`{i}`~~" for i in f.ingress_manquants)
        if manquants:
            reserve = f"non asserté : {manquants}"
            prouve = f"{prouve} · {reserve}" if f.prouve else reserve
        n = sum(len(v) for v in f.prouve.values())
        profils = ", ".join(p.value for p in sorted(f.profiles, key=lambda x: x.value))
        lines.append(
            f"| **{f.row_id}** {f.row_titre} | {f.libelle} | {f.family.label} | {profils} "
            f"| {_MODE_LABEL[f.mode_publie]} | {prouve} | {n or '—'} "
            f"| {', '.join(f'`{g}`' for g in f.gaps) or '—'} |"
        )
    bloques = [f for f in facets if f.mode_publie == "B"]
    lines += [
        "",
        f"**{len(bloques)} facettes publiées `Bloqué`**, chacune adossée à au moins un scénario "
        "qui passe. Une facette revendiquée `Bloqué` sans scénario ne franchit pas le build.",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="gate only: ne rien écrire, sortir non-zéro si une revendication n'est pas prouvée",
    )
    args = parser.parse_args()

    facets = _load_facets()
    errors = _attach_scenarios(facets)

    # Rule 1 -- CM-7. A `Bloqué` claim with no passing scenario is a false statement.
    unproven = [f for f in facets if f.exige_scenario and not f.prouve]
    for f in unproven:
        errors.append(
            f"{f.row_id}/{f.cle} revendique « Bloqué » et aucun scénario ne l'asserte ({f.libelle})"
        )

    # Rule 3. Blocking-only proves the guard refuses, not that it discriminates.
    for f in facets:
        if not f.prouve:
            continue
        for manque in f.sens_manquants:
            errors.append(f"{f.row_id}/{f.cle} : {_POURQUOI_SENS[manque]}")

    # FR-175. Same family as CM-7, one release further downstream: a support that
    # says "we block M-13" is a false claim about a control, made to a customer.
    claim_errors, unattributed = _check_claims(facets)
    errors.extend(claim_errors)

    if errors:
        print("CM-7 — la carte ne peut pas être publiée :\n", file=sys.stderr)
        for e in errors:
            print(f"  ✗ {e}", file=sys.stderr)
        print(
            "\nSoit le scénario manque et il faut l'écrire, soit la revendication est "
            "trop forte et il faut la baisser dans coverage/rows.yaml. Pour une phrase "
            "refusée : réécrivez-la au mode que la ligne publie réellement — c'est plus "
            "vite fait que de le défendre devant un client.",
            file=sys.stderr,
        )
        return 1

    partiels = [f for f in facets if f.ingress_manquants]
    for f in partiels:
        print(
            f"  ~ {f.row_id}/{f.cle} : publié Bloqué sur {sorted(f.prouve)}, "
            f"non asserté sur {f.ingress_manquants} (AD-28)",
            file=sys.stderr,
        )

    if args.check:
        # La carte commitée est servie à l'exécution par le diagnostic de profil :
        # périmée, elle montre une revendication périmée à un prospect. La garde
        # remplace le `.gitignore` comme tenue d'`AD-30`.
        if (stale := _stale_map(facets)) is not None:
            print(f"  ✗ {stale}", file=sys.stderr)
            return 1
        n = sum(1 for f in facets if f.mode_publie == "B")
        print(f"CM-7 = 0 — {n} facettes Bloqué prouvées")
        print(
            f"FR-175 = 0 — aucun « bloquer » attribué à une ligne non Bloquée "
            f"({unattributed} occurrences génériques, hors de portée de ce garde)"
        )
        # FR-178 ne peut pas « échouer » : la règle s'applique au parse, donc une
        # facette sans substitut est déjà publiée `Hors périmètre` quand on arrive
        # ici. Ce qui doit rester visible, c'est le compte -- une déclassification
        # silencieuse serait une revendication retirée que personne ne relit.
        orchestres = sum(1 for f in facets if f.substitut is not None)
        declasses = [f"{f.row_id}/{f.cle}" for f in facets if f.declasse]
        print(
            f"FR-178 — {orchestres} facettes Orchestré avec substitut souverain nommé ; "
            f"{len(declasses)} déclassée(s) faute de substitut"
            + (f" : {', '.join(declasses)}" if declasses else "")
        )
        return 0

    commit = _commit()
    stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    payload = _payload(facets, commit, stamp)
    _OUT_JSON.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    _OUT_MD.write_text(_render_md(facets, commit, stamp), encoding="utf-8")
    print(f"carte écrite : {_OUT_MD.relative_to(_REPO)} · {_OUT_JSON.relative_to(_REPO)}")
    return 0


def _stale_map(facets: list[Facet]) -> str | None:
    """La carte commitée diffère-t-elle de ce que la génération produit aujourd'hui ?

    `coverage/map.json` est **commitée** depuis que le diagnostic de profil la sert à
    l'exécution : un artefact publié qui n'existe pas dans l'image déployée n'est pas
    publié. Ce qu'`AD-30` garantit — la carte est dérivée, jamais rédigée — est donc
    tenu par cette comparaison plutôt que par le `.gitignore`.

    Seul `facettes` est comparé. `commit` et `genere_le` changent à chaque exécution
    et ne disent rien du contenu ; les inclure ferait échouer la garde à chaque fois,
    et une garde qui échoue toujours s'apprend à être contournée.
    """
    if not _OUT_JSON.exists():
        return f"{_OUT_JSON.relative_to(_REPO)} absente — lancez `make coverage-map`."
    try:
        commitee = json.loads(_OUT_JSON.read_text(encoding="utf-8")).get("facettes")
    except (OSError, ValueError):
        return f"{_OUT_JSON.relative_to(_REPO)} illisible — régénérez-la."
    if commitee != _payload(facets, "", "")["facettes"]:
        return (
            f"{_OUT_JSON.relative_to(_REPO)} ne correspond plus au registre ni aux "
            "scénarios. Lancez `make coverage-map` et commitez le résultat — la carte "
            "est servie à l'exécution, donc une carte périmée est une revendication "
            "périmée montrée à un prospect."
        )
    return None


def _payload(facets: list[Facet], commit: str, stamp: str) -> dict[str, Any]:
    """The machine-readable map. `facettes` is the substance; the rest is provenance."""
    return {
        "commit": commit,
        "genere_le": stamp,
        "facettes": [
            {
                "menace": f.row_id,
                "titre": f.row_titre,
                "facette": f.cle,
                "libelle": f.libelle,
                "mode_revendique": f.mode_revendique,
                "mode_publie": f.mode_publie,
                "substitut": (
                    {"nom": f.substitut.nom, "justification": f.substitut.justification.value}
                    if f.substitut
                    else None
                ),
                "declasse_faute_de_substitut": f.declasse,
                # The applicability axis travels with the machine-readable map, so a
                # downstream reader (the client diagnostic, a published fragment)
                # never has to re-derive it -- or derive it differently.
                "famille": f.family.value,
                "profils": sorted(p.value for p in f.profiles),
                "ingress_prouve": sorted(f.prouve),
                "ingress_non_asserte": f.ingress_manquants,
                "sens_prouves": sorted(f.sens_prouves),
                "scenarios": sorted(t for v in f.prouve.values() for t in v),
                "ecarts": f.gaps,
            }
            for f in facets
        ],
    }


if __name__ == "__main__":
    raise SystemExit(main())

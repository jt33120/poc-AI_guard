#!/usr/bin/env python3
"""Le gate marketing : aucun chiffre publié sur la page qui ne vienne du moteur (`L4`).

Même famille que `CM-7` et `FR-175`, une surface plus loin — et la plus exposée. `CM-7`
refuse une revendication `Bloqué` sans scénario. `FR-175` refuse le verbe « bloquer »
attribué à une ligne qu'aucune facette ne publie `Bloqué`, dans le README, le blueprint
et les documents de couverture. Ce script étend la même règle à la **copie du front**,
et en ajoute une qui lui est propre.

**La règle propre à la page : un chiffre de couverture ne s'écrit pas, il s'interpole.**
Toute chaîne qui mêle un mot de couverture et un nombre doit passer par un
`{placeholder}` que ce script alimente depuis `coverage/map.json` et `core.triage`. Une
page qui écrit « 8 menaces bloquées » a raison le jour où on l'écrit et ment le jour où
la carte change — c'est exactement le défaut que `L0` a dû retirer de la page en ligne,
dont un « < 1 s » que `perf/overhead.json` refuse explicitement de publier.

L'ordre du chantier n'est pas un détail : ce gate est écrit **avant** la page, pas
après. Écrit après, il aurait été taillé pour laisser passer ce qui était déjà là.

Ce que ce gate ne voit pas, dit plutôt que découvert plus tard :

* un nombre **interpolé** depuis du code n'est pas jugé — et c'est voulu : il vient de
  `/api/threats`, donc du moteur, ce qui est précisément la propriété recherchée ;
* une phrase qui affirme une couverture **sans aucun mot de couverture** n'est pas vue.
  Aucune expression régulière ne distingue une prose honnête d'une exagération ;
* le verbe « bloquer » **sans ligne nommée** est de la prose générique sur le mécanisme.
  `FR-175` fait déjà ce constat et compte les occurrences plutôt que de les refuser ;
  ici aussi, le compte est affiché.

Usage :
    uv run python scripts/gen_marketing.py           # écrit les faits
    uv run python scripts/gen_marketing.py --check   # gate CI
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO))

from core.profiles import Profile  # noqa: E402
from core.threat_map import MapUnavailable, published_rows  # noqa: E402
from core.triage import diagnose  # noqa: E402

_MAP = _REPO / "coverage" / "map.json"
_OUT = _REPO / "frontend" / "lib" / "generated" / "marketing-facts.json"

#: Le dictionnaire du front : le seul domicile déclaré de la copie. Un texte visible
#: écrit ailleurs est déjà un défaut — il ne serait pas traduit.
_COPIE = _REPO / "frontend" / "lib" / "strings.ts"

#: Les pages, pour les chiffres écrits en dur dans le balisage plutôt que dans le
#: dictionnaire. On ne lit que les **nœuds de texte** : un attribut Tailwind est plein
#: de chiffres (`h-16`, `max-w-6xl`) et n'affirme rien.
_PAGES: tuple[str, ...] = ("frontend/app/**/*.tsx", "frontend/components/**/*.tsx")

#: Les variables d'exécution que le dictionnaire interpole déjà, hors couverture.
#: Une allowlist plutôt qu'une heuristique : un `{placeholder}` inconnu laisse ses
#: accolades sur la page, ce qu'aucun test de rendu n'attrape aujourd'hui.
_RUNTIME_VARS = frozenset({"date", "n", "name", "v"})

_CHAINE = re.compile(r'\b(en|fr): "((?:[^"\\]|\\.)*)"')
_PLACEHOLDER = re.compile(r"\{(\w+)\}")

#: Un mot qui fait d'un nombre une revendication de couverture.
_MOT_COUVERTURE = re.compile(
    r"menace|ligne|facette|couvert|couvre|matrice|bloqu|threat|row|facet|cover|block",
    re.IGNORECASE,
)

#: Les nombres, chiffres **et** lettres. Sans les lettres, « huit menaces sur seize »
#: passerait, et c'est la première reformulation que quiconque essaie devant un gate
#: qui ne compte que les chiffres. Bornée à vingt : au-delà, personne n'écrit en toutes
#: lettres, et la liste deviendrait un catalogue que personne ne relit.
#:
#: **`un`, `une` et `one` en sont exclus**, et ce n'est pas un oubli. En français ce
#: sont d'abord des articles : la première version de ce garde a refusé « une liste de
#: menaces IA » et « un contrôle des opérations réelles », soit dix faux positifs sur
#: dix. Un gate à ce taux-là est débranché dans la semaine — `gen_coverage.py` fait le
#: même constat sur le mot `Bloqué` employé comme nom de mode. Le trou consenti est
#: étroit : « nous bloquons une menace » n'est une phrase que personne n'écrit.
#:
#: Les composés d'abord : une alternance de regex prend la première branche qui
#: correspond, et « dix » placé avant « dix-sept » ne ferait jamais correspondre le
#: second en entier.
_NOMBRES_ECRITS = [
    "dix-sept",
    "dix-huit",
    "dix-neuf",
    "deux",
    "trois",
    "quatre",
    "cinq",
    "sept",
    "huit",
    "neuf",
    "dix",
    "onze",
    "douze",
    "treize",
    "quatorze",
    "quinze",
    "seize",
    "vingt",
    "seventeen",
    "eighteen",
    "nineteen",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "twenty",
]
_NOMBRE = re.compile(r"\b(?:\d+|" + "|".join(_NOMBRES_ECRITS) + r")\b", re.IGNORECASE)

#: `FR-175`, repris mot pour mot depuis `gen_coverage.py` : deux motifs qui
#: divergeraient jugeraient deux surfaces selon deux règles.
_VERBE_BLOQUER = re.compile(
    r"\b(bloqu(?:er|ons|ez|ent|e|es|ée?s?|és?)|block(?:s|ed|ing)?)\b", re.IGNORECASE
)
_MODE_NOM = "Bloqué"
_REF_LIGNE = re.compile(r"\bM-\d{2}\b")

#: Le texte entre deux balises, sans accolade : `>16 lignes<` est jugé, `>{n} lignes<`
#: ne l'est pas — ce dernier vient du moteur, ce qui est le but.
_TEXTE_JSX = re.compile(r">([^<>{}]*[^\s<>{}][^<>{}]*)<")


def facts() -> dict[str, int]:
    """Les faits publiables, tous dérivés, aucun écrit.

    « Au maximum » n'est pas une précaution de rédaction : sur un profil donné, les
    comptes sont plus bas, et ils viennent alors de `/api/threats`. Ce que la page peut
    dire sans connaître son visiteur, c'est la borne.
    """
    lignes = published_rows(_MAP)
    plein = diagnose(_MAP, frozenset(Profile))
    return {
        "lignes": len(lignes),
        "facettes": sum(len(ligne.facettes) for ligne in lignes),
        "rejouables": sum(1 for ligne in lignes if ligne.rejouable),
        "profils": len(Profile),
        "bloquees_max": len(plein.blocked),
        "notre_terrain_max": len(plein.ours),
        "ecarts": len({e for ligne in lignes for f in ligne.facettes for e in f.ecarts}),
    }


def _payload() -> dict[str, Any]:
    carte = json.loads(_MAP.read_text(encoding="utf-8"))
    return {"commit": carte["commit"], "genere_le": carte["genere_le"], "faits": facts()}


def _render(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def _copie() -> list[tuple[str, str]]:
    """Les chaînes traduites, avec leur langue."""
    texte = _COPIE.read_text(encoding="utf-8")
    return [(m.group(1), m.group(2)) for m in _CHAINE.finditer(texte)]


def _revendique_le_verbe(phrase: str) -> bool:
    """Le verbe employé, par opposition au **nom** du mode (`FR-175`)."""
    return any(m.group(0) != _MODE_NOM for m in _VERBE_BLOQUER.finditer(phrase))


def _check_chiffres(connus: frozenset[str]) -> list[str]:
    """Un chiffre de couverture doit être interpolé, jamais écrit."""
    erreurs: list[str] = []
    for lang, texte in _copie():
        if not _MOT_COUVERTURE.search(texte):
            continue
        # Les nombres déjà interpolés ne comptent pas : c'est la forme demandée. Les
        # références de ligne non plus — le `13` de `M-13` n'est pas un compte, et le
        # signaler comme tel enverrait le lecteur chercher un chiffre qui n'existe pas
        # (le vrai reproche sur cette phrase est celui du verbe, plus bas).
        nu = _REF_LIGNE.sub("", _PLACEHOLDER.sub("", texte))
        for nombre in _NOMBRE.findall(nu):
            erreurs.append(
                f"lib/strings.ts [{lang}] : « {nombre} » écrit dans une phrase de "
                f"couverture. Employez un placeholder alimenté par ce script "
                f"({', '.join(sorted(connus))}).\n      → {texte.strip()[:120]}"
            )
    for motif in _PAGES:
        for chemin in sorted(_REPO.glob(motif)):
            for fragment in _TEXTE_JSX.findall(chemin.read_text(encoding="utf-8")):
                if _MOT_COUVERTURE.search(fragment) and _NOMBRE.search(fragment):
                    erreurs.append(
                        f"{chemin.relative_to(_REPO)} : chiffre de couverture écrit "
                        f"dans le balisage.\n      → {fragment.strip()[:120]}"
                    )
    return erreurs


def _check_verbe() -> tuple[list[str], int]:
    """`FR-175` étendu à la copie : « bloquer » attribué à une ligne non `Bloqué`."""
    lignes = published_rows(_MAP)
    bloquees = {ligne.id for ligne in lignes if ligne.bloquee}
    connues = {ligne.id for ligne in lignes}
    erreurs: list[str] = []
    sans_attribution = 0

    for lang, texte in _copie():
        if not _revendique_le_verbe(texte):
            continue
        citees = sorted(set(_REF_LIGNE.findall(texte)))
        if not citees:
            sans_attribution += 1
            continue
        for ligne in citees:
            if ligne not in connues:
                erreurs.append(
                    f"lib/strings.ts [{lang}] : « bloquer » attribué à {ligne}, "
                    "qui n'existe pas dans la carte"
                )
            elif ligne not in bloquees:
                erreurs.append(
                    f"lib/strings.ts [{lang}] : « bloquer » attribué à {ligne}, "
                    f"qu'aucune facette ne publie « Bloqué »\n"
                    f"      → {texte.strip()[:120]}"
                )
    return erreurs, sans_attribution


def _check_placeholders(connus: frozenset[str]) -> list[str]:
    """Un `{placeholder}` inconnu laisse ses accolades sur la page, en clair.

    `translate` ne remplace que ce qu'on lui donne. Un nom mal orthographié n'échoue
    donc pas : il s'affiche. Aucun test de rendu n'attrape ça aujourd'hui.
    """
    autorises = connus | _RUNTIME_VARS
    return [
        f"lib/strings.ts [{lang}] : placeholder inconnu « {{{nom}}} ». Connus : "
        f"{', '.join(sorted(autorises))}.\n      → {texte.strip()[:120]}"
        for lang, texte in _copie()
        for nom in _PLACEHOLDER.findall(texte)
        if nom not in autorises
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="gate seul : ne rien écrire, sortir non-zéro si la page affirme sans preuve",
    )
    args = parser.parse_args()

    try:
        payload = _payload()
    except MapUnavailable as exc:
        print(f"  ✗ {exc}", file=sys.stderr)
        return 1
    rendu = _render(payload)
    connus = frozenset(payload["faits"])

    if not args.check:
        _OUT.parent.mkdir(parents=True, exist_ok=True)
        _OUT.write_text(rendu, encoding="utf-8")
        print(f">> {_OUT.relative_to(_REPO)}")
        return 0

    erreurs: list[str] = []
    actuel = _OUT.read_text(encoding="utf-8") if _OUT.exists() else None
    if actuel != rendu:
        manquant = "absent" if actuel is None else "périmé"
        erreurs.append(f"{_OUT.relative_to(_REPO)} {manquant} — lancez `make marketing-facts`.")
    erreurs.extend(_check_chiffres(connus))
    erreurs.extend(_check_placeholders(connus))
    erreurs_verbe, sans_attribution = _check_verbe()
    erreurs.extend(erreurs_verbe)

    if erreurs:
        print("L4 — la page affirme plus que la carte :\n", file=sys.stderr)
        for e in erreurs:
            print(f"  ✗ {e}", file=sys.stderr)
        print(
            "\nUn chiffre de couverture s'interpole depuis "
            "`frontend/lib/generated/marketing-facts.json`, il ne s'écrit pas. Ce qui "
            "est écrit a raison le jour où on l'écrit, et ment le jour où la carte "
            "change.",
            file=sys.stderr,
        )
        return 1

    faits = ", ".join(f"{k}={v}" for k, v in sorted(payload["faits"].items()))
    print(f"L4 = 0 — copie adossée à la carte ({faits})")
    print(
        f"       {sans_attribution} emplois génériques de « bloquer » sans ligne "
        "nommée, hors de portée de ce garde"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

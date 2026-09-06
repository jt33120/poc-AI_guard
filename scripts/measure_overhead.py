#!/usr/bin/env python3
"""Publier ce que la passerelle coûte par appel — en entiers, pas en millisecondes.

`EXH-9` : *« An inline gateway with no published p95 overhead number will be rejected
on that basis alone. »* Le constat est juste. La réponse évidente serait un p95, et ce
script n'en produit pas — délibérément.

**Pourquoi pas une milliseconde.** Un chiffre de latence n'engage que si les conditions
qui l'ont produit ressemblent à celles du client. Les nôtres n'y ressemblent pas : le
cluster de test tourne `fsync=off`, `synchronous_commit=off`, `full_page_writes=off`
(`tests/pgcluster.py`), donc tout commit chronométré ici est plus rapide qu'aucun
commit ne le sera en production ; et un exécuteur CI partagé n'a pas de p95
reproductible. Publier ce nombre en l'appelant « notre surcoût » serait la classe
d'affirmation que ce dépôt retire — la même que la sonde de readiness verte sur un
émetteur illisible (`FR-195`).

**Ce qui est publié.** Le nombre de connexions PostgreSQL et d'allers-retours SQL que
la chaîne de gardes exige par appel, chemin par chemin. Ce sont des entiers, ils ne
dépendent d'aucune machine, et ils répondent mieux à la question de l'acheteur :
`core/db.py` ouvre **une connexion neuve par opération** — il n'y a pas de pool — donc
« trois connexions par appel coopératif » dit son coût dans n'importe quel centre de
données, une fois multiplié par la latence d'établissement que l'exploitant connaît.

**Ce que le gate attrape.** Une garde nouvelle qui ajoute un aller-retour sur le chemin
de décision devient visible au build suivant. C'est la régression qu'`EXH-9` redoute
(« roughly nine guards on an inline hot path »), et un gate d'entiers ne flotte pas —
là où un seuil de millisecondes sur un exécuteur partagé finirait désarmé, et un gate
désarmé ne protège rien.

Usage :
    uv run pytest                                # écrit perf/.counts.json
    uv run python scripts/measure_overhead.py    # écrit perf/overhead.json
    uv run python scripts/measure_overhead.py --check   # gate : échoue sur dérive
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parent.parent
_COUNTS = _REPO / "perf" / ".counts.json"
_REGISTRE = _REPO / "perf" / "overhead.json"

#: Ce que le registre **ne** mesure pas, nommé pour que personne ne lise le silence
#: comme un zéro. Trois gardes sont éteintes par défaut (`core/policy.py`) : un client
#: qui les active sort des chiffres publiés, et doit remesurer.
NON_MESURE = (
    "intégrité des outils (`integrity_enabled`, éteinte par défaut) — ajoute 1 connexion",
    "bandes de risque (`risk_bands`, non définies par défaut) — ajoute 1 connexion",
    "taint d'injection indirecte (`taint_policy: off` par défaut) — ajoute 1 à 2 connexions",
    "le relais vers l'outil aval, qui n'est pas notre coût : le client le paie avec ou sans nous",
)

#: Ce que chaque chemin désigne, en clair. Un registre dont les clés demandent d'ouvrir
#: le code pour être comprises n'est pas publiable.
CHEMINS: dict[str, str] = {
    "mcp.autorise": "passerelle MCP (obligatoire) — appel autorisé, relayé, audité",
    "mcp.refuse": "passerelle MCP — appel refusé par la policy, jamais relayé",
    "mcp.premiere_attente": (
        "passerelle MCP — irréversible mis en attente pour la **première** fois "
        "(une reprise d'approbation coûte moins)"
    ),
    "http.autorise": "`POST /v1/authorize` (coopératif) — verdict d'autorisation, audité",
    "http.refuse": "`POST /v1/authorize` — verdict de refus, audité",
}


def _lire_comptes() -> dict[str, dict[str, int]]:
    """Les comptes mesurés par la suite. Fail-closed si la mesure n'a pas eu lieu."""
    if not _COUNTS.exists():
        sys.exit(
            f"{_COUNTS.relative_to(_REPO)} absent — lancez `uv run pytest` d'abord. "
            "Le registre est mesuré par la suite, jamais écrit à la main."
        )
    data: dict[str, dict[str, int]] = json.loads(_COUNTS.read_text(encoding="utf-8"))
    manquants = set(CHEMINS) - set(data)
    if manquants:
        sys.exit(
            f"chemins non mesurés : {', '.join(sorted(manquants))}. "
            "Un registre partiel publié comme complet serait pire que pas de registre."
        )
    return data


def rendre(comptes: dict[str, dict[str, int]]) -> dict[str, Any]:
    """L'artefact publié : les entiers, ce qu'ils désignent, et ce qu'ils ne disent pas."""
    return {
        "unite": "par appel d'outil",
        "chemins": {
            cle: {
                "designe": CHEMINS[cle],
                "connexions_postgres": comptes[cle]["connexions"],
                "allers_retours_sql": comptes[cle]["instructions_sql"],
            }
            for cle in sorted(CHEMINS)
        },
        "non_mesure": list(NON_MESURE),
        "ce_que_ce_chiffre_n_est_pas": (
            "Ce n'est pas une latence, et il n'y a pas de p95 publié ici. Le cluster de "
            "mesure tourne fsync=off et un exécuteur CI partagé n'a pas de p95 "
            "reproductible : un tel nombre dirait plus que ce qu'il prouve. Ce registre "
            "dit combien d'allers-retours la chaîne de gardes exige ; multipliez-les par "
            "la latence d'établissement de connexion de VOTRE base pour obtenir le "
            "surcoût chez vous. Il n'y a pas de pool : `core/db.py` ouvre une connexion "
            "neuve par opération."
        ),
    }


def _comparer(publie: dict[str, Any], mesure: dict[str, Any]) -> list[str]:
    """Les écarts entre l'artefact commité et ce que la suite vient de mesurer."""
    ecarts: list[str] = []
    for cle in sorted(CHEMINS):
        a = publie.get("chemins", {}).get(cle, {})
        b = mesure["chemins"][cle]
        for champ in ("connexions_postgres", "allers_retours_sql"):
            if a.get(champ) != b[champ]:
                ecarts.append(f"{cle}.{champ} : publié {a.get(champ)}, mesuré {b[champ]}")
    return ecarts


def main() -> int:
    parseur = argparse.ArgumentParser(description=__doc__)
    parseur.add_argument(
        "--check",
        action="store_true",
        help="échouer si l'artefact commité diverge de la mesure, sans rien réécrire",
    )
    args = parseur.parse_args()

    mesure = rendre(_lire_comptes())

    if args.check:
        if not _REGISTRE.exists():
            sys.exit(f"{_REGISTRE.relative_to(_REPO)} absent — lancez ce script sans --check.")
        publie = json.loads(_REGISTRE.read_text(encoding="utf-8"))
        ecarts = _comparer(publie, mesure)
        if ecarts:
            print("Le surcoût par appel a changé et le registre publié ne le dit pas :")
            for e in ecarts:
                print(f"  - {e}")
            print(
                "\nSi le changement est voulu, régénérez le registre "
                "(`make overhead`) et relisez `docs/product/POSITIONNEMENT.md` §5 : "
                "un aller-retour de plus sur le chemin de décision est une décision "
                "produit, pas un détail d'implémentation."
            )
            return 1
        total = sum(v["connexions_postgres"] for v in mesure["chemins"].values())
        print(f"surcoût : registre inchangé — {len(CHEMINS)} chemins, {total} connexions au total")
        return 0

    _REGISTRE.parent.mkdir(parents=True, exist_ok=True)
    _REGISTRE.write_text(json.dumps(mesure, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"registre écrit : {_REGISTRE.relative_to(_REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Publier la carte au front, dans l'unité **ligne** (`L3`).

`coverage/map.json` est une liste de 25 facettes. Une page qui présente des menaces
parle de 16 lignes. Ce script fait la conversion, une fois, en Python, avec le module
que le produit utilise déjà — plutôt que de laisser le front la refaire en TypeScript
et compter les facettes là où il croit compter des lignes. Sur `P1a`, l'écart entre les
deux vaut 3 contre 2, et c'est le genre d'erreur qui coûte une réunion.

Ce que l'artefact porte : ce qui **ne dépend d'aucun visiteur**. L'applicabilité, le
plafond de profil et la famille retenue en dépendent, restent dans `core.triage`, et se
demandent à `GET /v1/threats`. Un artefact statique qui les porterait serait un second
moteur endormi dans un fichier.

Il porte aussi le `commit` et l'horodatage de `map.json`, non par décor : un artefact
généré qui ne dit pas de quelle carte il vient ne peut pas être confronté à elle.

Usage :
    uv run python scripts/gen_threat_rows.py           # écrit l'artefact
    uv run python scripts/gen_threat_rows.py --check   # gate CI : périmé = non-zéro
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO))

from core.threat_map import MapUnavailable, PublishedRow, published_rows  # noqa: E402

_MAP = _REPO / "coverage" / "map.json"
_OUT = _REPO / "frontend" / "lib" / "generated" / "threat-rows.json"


def _row(row: PublishedRow) -> dict[str, Any]:
    return {
        "id": row.id,
        "titre": row.titre,
        # Dérivé de la carte, jamais listé : une ligne est rejouable quand une facette
        # y est publiée `Bloqué`, ce que `gen_coverage.py` n'accorde qu'avec les deux
        # moitiés de la preuve — le blocage **et** son contrôle négatif.
        "rejouable": row.rejouable,
        "profils": sorted(p.value for p in row.profils),
        "facettes": [
            {
                "cle": f.cle,
                "libelle": f.libelle,
                "mode": f.mode,
                "famille": f.famille.value,
                "profils": sorted(p.value for p in f.profils),
                "ingress_prouve": list(f.ingress_prouve),
                "ingress_non_asserte": list(f.ingress_non_asserte),
                "scenarios": list(f.scenarios),
                "ecarts": list(f.ecarts),
                "raison": f.raison,
            }
            for f in row.facettes
        ],
    }


def _payload() -> dict[str, Any]:
    carte = json.loads(_MAP.read_text(encoding="utf-8"))
    return {
        "commit": carte["commit"],
        "genere_le": carte["genere_le"],
        "lignes": [_row(row) for row in published_rows(_MAP)],
    }


def _render(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="gate seul : ne rien écrire, sortir non-zéro si l'artefact est périmé",
    )
    args = parser.parse_args()

    try:
        rendu = _render(_payload())
    except MapUnavailable as exc:
        print(f"  ✗ {exc}", file=sys.stderr)
        return 1

    if args.check:
        # L'artefact est **servi à un prospect**. Périmé, il lui montre une couverture
        # que la suite ne prouve plus — la même faute qu'`AD-30` ferme sur la carte,
        # une surface plus loin.
        actuel = _OUT.read_text(encoding="utf-8") if _OUT.exists() else None
        if actuel != rendu:
            manquant = "absent" if actuel is None else "périmé"
            print(
                f"  ✗ {_OUT.relative_to(_REPO)} {manquant} — lancez "
                "`make threat-rows` après avoir régénéré la carte.",
                file=sys.stderr,
            )
            return 1
        nb = len(json.loads(rendu)["lignes"])
        rejouables = sum(1 for row in json.loads(rendu)["lignes"] if row["rejouable"])
        print(f"relevé à jour — {nb} lignes, dont {rejouables} rejouables")
        return 0

    _OUT.parent.mkdir(parents=True, exist_ok=True)
    _OUT.write_text(rendu, encoding="utf-8")
    print(f">> {_OUT.relative_to(_REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

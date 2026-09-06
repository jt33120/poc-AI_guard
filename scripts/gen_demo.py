#!/usr/bin/env python3
"""L'instantané de démonstration, publié depuis une lecture réelle (`L8`).

`/executive-preview` affichait des chiffres **écrits à la main** —
`{governed: 8, allow: 124, review: 37, block: 9}`. Le tenant de démonstration réel en
compte 5 gouvernés et 93 autorisations : les chiffres inventés **flattaient**, et
c'est ce que fait toujours un chiffre inventé, sans qu'on l'ait décidé.

Ce que publie ce script vient de `tests/test_demo_snapshot.py`, qui sème
`demo/seed.yaml` dans une base neuve pendant la suite, vérifie la chaîne, puis relit.
La fixture est committée, relisible et entièrement fabriquée, et un garde de CI vérifie
avec les détecteurs du produit qu'elle ne porte aucune forme de PII réelle (`AD-31`) :
publier ce qu'elle produit est sûr par construction, et vérifiable en lisant un diff.

**Deux écrans, pas quatre**, et la raison est dans le sujet plutôt que dans l'effort.
La table `approvals` est vide — la fixture n'écrit aucune demande — et il ne faut pas en
fabriquer : dans un instantané figé et daté, une approbation « en attente » se lit
« personne n'a jamais répondu », soit l'inverse du mécanisme qu'on veut montrer. Une
file d'approbation est vivante ou n'est pas. La synthèse dirigeant et l'explorateur
d'audit, eux, sont nativement de forme instantané.

Usage :
    uv run pytest                            # capture l'instantané
    uv run python scripts/gen_demo.py        # le publie
    uv run python scripts/gen_demo.py --check
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO))

_CAPTURE = _REPO / "coverage" / ".demo_snapshot.json"
_MAP = _REPO / "coverage" / "map.json"
_OUT = _REPO / "frontend" / "lib" / "generated" / "demo-snapshot.json"

#: Les seuls champs qu'une entrée publiée peut porter. Une colonne qui apparaîtrait
#: sans passer par cette liste serait publiée sans que personne l'ait décidé.
_CHAMPS = frozenset({"jours", "outil", "classe", "decision", "regle", "raison"})


def _payload() -> dict[str, Any]:
    if not _CAPTURE.exists():
        raise FileNotFoundError(
            f"{_CAPTURE.name} absent — lancez `uv run pytest` d'abord. L'instantané est "
            "une lecture du tenant de démonstration, pas une saisie."
        )
    capture = json.loads(_CAPTURE.read_text(encoding="utf-8"))
    carte = json.loads(_MAP.read_text(encoding="utf-8"))

    inconnus = {c for e in capture["journal"] for c in e} - _CHAMPS
    if inconnus:
        raise ValueError(
            f"champs non déclarés dans l'instantané : {sorted(inconnus)}. Ajoutez-les à "
            "`_CHAMPS` après avoir vérifié qu'ils sont publiables."
        )
    return {"commit": carte["commit"], "genere_le": carte["genere_le"], **capture}


def _render(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="gate seul : ne rien écrire, sortir non-zéro si l'instantané est périmé",
    )
    args = parser.parse_args()

    try:
        payload = _payload()
    except (FileNotFoundError, ValueError) as exc:
        print(f"  ✗ {exc}", file=sys.stderr)
        return 1

    if not payload["chainee"]:
        # Un instantané dont la chaîne ne se vérifie pas serait une preuve cassée
        # montrée en guise de preuve.
        print("  ✗ la chaîne du tenant de démonstration ne se vérifie pas", file=sys.stderr)
        return 1

    rendu = _render(payload)

    if args.check:
        actuel = _OUT.read_text(encoding="utf-8") if _OUT.exists() else None
        if actuel != rendu:
            manquant = "absent" if actuel is None else "périmé"
            print(
                f"  ✗ {_OUT.relative_to(_REPO)} {manquant} — lancez "
                "`uv run pytest && make demo-snapshot`.",
                file=sys.stderr,
            )
            return 1
        print(
            f"L8 = 0 — instantané à jour : {payload['entrees']} entrées sur "
            f"{payload['jours_couverts']} jours, {payload['outils']} outils gouvernés, "
            "chaîne vérifiée"
        )
        return 0

    _OUT.parent.mkdir(parents=True, exist_ok=True)
    _OUT.write_text(rendu, encoding="utf-8")
    print(f">> {_OUT.relative_to(_REPO)} — {payload['entrees']} entrées")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

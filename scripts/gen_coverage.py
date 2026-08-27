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

Usage:
    uv run pytest                          # writes coverage/.scenarios.json
    uv run python scripts/gen_coverage.py  # gates, then writes the map
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

_REPO = Path(__file__).resolve().parent.parent
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
    #: ingress path -> node ids of the tests that passed for it
    prouve: dict[str, list[str]] = field(default_factory=dict)

    @property
    def exige_scenario(self) -> bool:
        return self.mode_revendique == "B"

    @property
    def mode_publie(self) -> str:
        """The mode we may actually publish. `Bloqué` survives only if proven."""
        if not self.exige_scenario:
            return self.mode_revendique
        return "B" if self.prouve else "NA"

    @property
    def ingress_manquants(self) -> list[str]:
        return [i for i in self.ingress_revendique if i not in self.prouve]


def _load_facets() -> list[Facet]:
    doc = yaml.safe_load(_REGISTRY.read_text(encoding="utf-8"))
    facets = []
    for row in doc["rows"]:
        for f in row["facettes"]:
            facets.append(
                Facet(
                    row_id=row["id"],
                    row_titre=row["titre"],
                    cle=f["cle"],
                    libelle=f["libelle"],
                    mode_revendique=f["mode"],
                    ingress_revendique=list(f.get("ingress") or []),
                    gaps=list(f.get("gaps") or []),
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
    return errors


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


_MODE_LABEL = {
    "B": "Bloqué",
    "D": "Détecté",
    "O": "Orchestré",
    "A": "Attesté",
    "X": "Hors périmètre",
    "NA": "**non asserté**",
}


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
        "| Menace | Facette | Mode publié | Chemin d'ingestion prouvé | Scénarios | Écarts |",
        "|---|---|---|---|---|---|",
    ]
    for f in facets:
        prouve = ", ".join(f"`{i}`" for i in sorted(f.prouve)) or "—"
        manquants = ", ".join(f"~~`{i}`~~" for i in f.ingress_manquants)
        if manquants:
            reserve = f"non asserté : {manquants}"
            prouve = f"{prouve} · {reserve}" if f.prouve else reserve
        n = sum(len(v) for v in f.prouve.values())
        lines.append(
            f"| **{f.row_id}** {f.row_titre} | {f.libelle} | {_MODE_LABEL[f.mode_publie]} "
            f"| {prouve} | {n or '—'} | {', '.join(f'`{g}`' for g in f.gaps) or '—'} |"
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

    if errors:
        print("CM-7 — la carte ne peut pas être publiée :\n", file=sys.stderr)
        for e in errors:
            print(f"  ✗ {e}", file=sys.stderr)
        print(
            "\nSoit le scénario manque et il faut l'écrire, soit la revendication est "
            "trop forte et il faut la baisser dans coverage/rows.yaml.",
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
        n = sum(1 for f in facets if f.mode_publie == "B")
        print(f"CM-7 = 0 — {n} facettes Bloqué prouvées")
        return 0

    commit = _commit()
    stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    payload: dict[str, Any] = {
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
                "ingress_prouve": sorted(f.prouve),
                "ingress_non_asserte": f.ingress_manquants,
                "scenarios": sorted(t for v in f.prouve.values() for t in v),
                "ecarts": f.gaps,
            }
            for f in facets
        ],
    }
    _OUT_JSON.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    _OUT_MD.write_text(_render_md(facets, commit, stamp), encoding="utf-8")
    print(f"carte écrite : {_OUT_MD.relative_to(_REPO)} · {_OUT_JSON.relative_to(_REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

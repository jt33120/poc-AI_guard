#!/usr/bin/env python3
"""Enregistre `make demo` en capture animée — et refuse d'en produire une si la
démonstration échoue.

`AD-26` fixe ce qu'est une vidéo dans ce produit : *l'enregistrement d'une
exécution qui passe, jamais son substitut*. Une animation fabriquée à la
ressemblance d'un succès est précisément ce que la règle interdit, parce qu'elle
est indiscernable du vrai à l'écran et qu'elle survit ensuite à la régression
qu'elle est censée démontrer.

La règle est donc tenue par un mécanisme et non par une consigne : ce script
lance `scripts/demo.py`, et **n'écrit le SVG que si le processus sort en zéro**.
Le jour où un contrôle casse, la démonstration sort en non-zéro, aucun fichier
n'est produit, et la page perd son ouverture au lieu de mentir. C'est le même
arbitrage que `verify_chain` : mieux vaut un trou visible qu'une preuve fausse.

Le rendu est un SVG autonome, sans JavaScript ni dépendance : les lignes
apparaissent par `animation-delay`, calés sur les temps réellement mesurés. Sous
`prefers-reduced-motion`, les animations sont neutralisées et la capture se lit
comme une transcription complète — la même règle que le reste de la charte.

    uv run python scripts/record_demo.py            # enregistre et écrit le SVG
    uv run python scripts/record_demo.py --check    # vérifie sans réécrire
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape

_REPO = Path(__file__).resolve().parent.parent
_DEMO = _REPO / "scripts" / "demo.py"
_SORTIE = _REPO / "frontend" / "public" / "demo-replay.svg"
#: La même exécution, en texte. Le SVG l'annonce dans son `aria-label` : une
#: capture animée n'est pas lisible par un lecteur d'écran, et promettre la
#: transcription sans la livrer serait pire que ne rien promettre.
_TRANSCRIPTION = _REPO / "frontend" / "public" / "demo-replay.txt"

#: `rich`, tiré par le SDK MCP, colore sa sortie quand il croit parler à un
#: terminal. On la capture par un tube, donc il ne devrait pas — mais une
#: version future pourrait, et une séquence d'échappement dans un `<text>` SVG
#: s'afficherait telle quelle.
_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

#: Marqueur que la démonstration imprime en dernier. Sa présence est vérifiée en
#: plus du code de sortie : un processus tué par un signal peut sortir en zéro
#: sur certaines plateformes, et la capture serait alors tronquée sans le dire.
_MARQUEUR_FINAL = "DEMO PASSED"

# Grille monospace du rendu. Le pas horizontal vaut 0,6 em, ratio des chasses
# fixes usuelles ; il n'a pas besoin d'être exact, seulement stable, puisque le
# SVG porte sa propre police générique et ne dépend pas de celle de la page.
_TAILLE = 12.5
_PAS_X = _TAILLE * 0.6
_PAS_Y = _TAILLE * 1.62
_MARGE = 22.0
_HAUT = 34.0  # bandeau de fenêtre

# Jetons repris de `frontend/app/globals.css`, eux-mêmes portés de `xsom.fr`.
# Aucune valeur n'est choisie à l'œil : le SVG est servi en `<img>`, donc isolé
# du document, et ne peut pas lire les variables CSS de la page.
_FOND = "#050b14"  # --ink-950
_PANNEAU = "#0a1628"  # --ink-900
_BORDURE = "#16304f"  # --ink-700
_TEXTE = "#eef2f8"  # --title-ink, 15.8:1 sur --ink-900
_ATONE = "#8c919a"  # --text-faint résolu, 4.93:1
_CUIVRE = "#f7a077"  # --copper-sheen, 8.85:1


@dataclass(frozen=True)
class Ligne:
    """Une ligne de sortie et l'instant où elle est apparue."""

    seconde: float
    texte: str


def _capture() -> list[Ligne]:
    """Lance la démonstration et rend ses lignes horodatées.

    Lève `RuntimeError` si elle échoue : l'appelant n'écrit alors rien.
    """
    debut = time.monotonic()
    processus = subprocess.Popen(  # noqa: S603 - chemin fixe, aucun argument externe
        [sys.executable, str(_DEMO)],
        cwd=_REPO,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    lignes: list[Ligne] = []
    if processus.stdout is None:  # pragma: no cover - stdout=PIPE le garantit
        raise RuntimeError("flux de sortie indisponible : impossible d'enregistrer.")
    for brute in processus.stdout:
        texte = _ANSI.sub("", brute.rstrip("\n")).rstrip()
        lignes.append(Ligne(time.monotonic() - debut, texte))
    code = processus.wait()

    if code != 0:
        raise RuntimeError(
            f"la démonstration a échoué (sortie {code}) — aucune capture n'est écrite.\n"
            "  AD-26 : une vidéo est l'enregistrement d'une exécution qui passe.\n"
            "  fix : réparez le contrôle que `scripts/demo.py` signale, puis relancez."
        )
    if not any(_MARQUEUR_FINAL in ligne.texte for ligne in lignes):
        raise RuntimeError(
            f"sortie zéro mais {_MARQUEUR_FINAL!r} absent : capture tronquée, rien n'est écrit."
        )
    return lignes


def _couleur(texte: str) -> str:
    """Teinte d'une ligne, d'après ce qu'elle dit — jamais d'après son rang."""
    if "[OK]" in texte or _MARQUEUR_FINAL in texte:
        return _CUIVRE
    if texte.startswith("[") or texte.startswith("=="):
        return _TEXTE
    if "INFO" in texte or texte.startswith(" " * 10):
        return _ATONE
    return _TEXTE


def _svg(lignes: list[Ligne]) -> str:
    """Compose le SVG autonome à partir des lignes horodatées."""
    largeur_car = max((len(ligne.texte) for ligne in lignes), default=40)
    largeur = _MARGE * 2 + largeur_car * _PAS_X
    hauteur = _HAUT + _MARGE + len(lignes) * _PAS_Y + _MARGE
    duree = max((ligne.seconde for ligne in lignes), default=1.0) or 1.0

    corps: list[str] = []
    regles: list[str] = []
    for rang, ligne in enumerate(lignes):
        y = _HAUT + _MARGE + rang * _PAS_Y
        corps.append(
            f'<text class="l l{rang}" x="{_MARGE:.1f}" y="{y:.1f}" '
            f'fill="{_couleur(ligne.texte)}">{escape(ligne.texte)}</text>'
        )
        regles.append(f".l{rang}{{animation-delay:{ligne.seconde:.2f}s}}")

    # `visibility` plutôt qu'`opacity` : sous `prefers-reduced-motion` la ligne
    # doit être lisible immédiatement, et une opacité animée laisserait un état
    # initial invisible si l'animation n'est jamais jouée.
    style = (
        f"text{{font-family:ui-monospace,'JetBrains Mono',Menlo,'DejaVu Sans Mono',monospace;"
        f"font-size:{_TAILLE}px;white-space:pre}}"
        ".l{visibility:hidden;animation:v 1ms linear forwards}"
        "@keyframes v{to{visibility:visible}}"
        + "".join(regles)
        + "@media(prefers-reduced-motion:reduce){"
        ".l{visibility:visible;animation:none}}"
    )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {largeur:.0f} {hauteur:.0f}" '
        f'width="{largeur:.0f}" height="{hauteur:.0f}" role="img" '
        f'aria-label="Enregistrement de make demo : la sortie complete est fournie en texte '
        f'sous la capture.">'
        f"<style>{style}</style>"
        f'<rect width="{largeur:.0f}" height="{hauteur:.0f}" rx="6" fill="{_FOND}"/>'
        f'<rect x="1" y="1" width="{largeur - 2:.0f}" height="{hauteur - 2:.0f}" rx="6" '
        f'fill="{_PANNEAU}" stroke="{_BORDURE}"/>'
        f'<circle cx="20" cy="18" r="4.5" fill="{_BORDURE}"/>'
        f'<circle cx="36" cy="18" r="4.5" fill="{_BORDURE}"/>'
        f'<circle cx="52" cy="18" r="4.5" fill="{_BORDURE}"/>'
        f'<text x="70" y="22" fill="{_ATONE}" font-size="11">make demo — '
        f"{duree:.1f}s</text>" + "".join(corps) + "</svg>"
    )


def principal() -> int:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument(
        "--check",
        action="store_true",
        help="rejoue la démonstration et vérifie la capture sans la réécrire",
    )
    arguments = analyseur.parse_args()

    try:
        lignes = _capture()
    except RuntimeError as erreur:
        print(f"record_demo: {erreur}", file=sys.stderr)
        return 1

    rendu = _svg(lignes)
    if arguments.check:
        if not _SORTIE.exists():
            print(f"record_demo: {_SORTIE.name} manquant — lancez sans --check.", file=sys.stderr)
            return 1
        print(f"record_demo --check: démonstration verte, {len(lignes)} lignes capturées.")
        return 0

    _SORTIE.parent.mkdir(parents=True, exist_ok=True)
    _SORTIE.write_text(rendu, encoding="utf-8")
    _TRANSCRIPTION.write_text("\n".join(ligne.texte for ligne in lignes) + "\n", encoding="utf-8")
    print(
        f"record_demo: {_SORTIE.relative_to(_REPO)} et "
        f"{_TRANSCRIPTION.relative_to(_REPO)} écrits ({len(lignes)} lignes)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(principal())

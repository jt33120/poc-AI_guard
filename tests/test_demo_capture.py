"""La capture d'ouverture est l'enregistrement d'une exécution qui passe.

`AD-26` : *une vidéo est l'enregistrement d'une exécution réellement passante,
jamais une animation fabriquée à sa ressemblance.* La règle est facile à énoncer
et impossible à vérifier à l'œil : à l'écran, une animation fabriquée montrant
`DEMO PASSED` est **indiscernable** d'un vrai enregistrement. Elle survivrait
donc à la régression qu'elle est censée démontrer, et c'est exactement ce que ce
fichier existe pour empêcher.

Deux propriétés, et la seconde est celle qui compte :

1. l'artefact commité porte les marques d'une exécution verte, et son texte
   correspond à sa capture — les deux sortent du même run ;
2. le générateur **refuse d'écrire** quand la démonstration échoue.

La seconde est éprouvée sans PostgreSQL, en substituant à `scripts/demo.py` un
script qui sort en non-zéro : ce qu'on veut tenir n'est pas que la démonstration
passe ici, mais que le générateur ne mente pas quand elle ne passe pas.
"""

from __future__ import annotations

import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parent.parent
_SVG = _REPO / "frontend" / "public" / "demo-replay.svg"
_TXT = _REPO / "frontend" / "public" / "demo-replay.txt"
_PAGE = _REPO / "frontend" / "components" / "Fonctionnement.tsx"
_RECORD = _REPO / "scripts" / "record_demo.py"

#: Ce que `scripts/demo.py` imprime en dernier quand tous les invariants tiennent.
_MARQUEUR = "DEMO PASSED"


@pytest.fixture(scope="module")
def svg() -> str:
    return _SVG.read_text(encoding="utf-8")


def test_the_capture_records_a_run_that_passed(svg: str) -> None:
    """Sans ce marqueur, la capture montre une exécution qui a échoué."""
    assert _MARQUEUR in svg, (
        f"{_SVG.name} ne contient pas {_MARQUEUR!r} : la capture publiée ne montre pas "
        "une exécution verte. Relancez `make record-demo`."
    )


def test_the_transcript_and_the_capture_come_from_the_same_run(svg: str) -> None:
    """Deux artefacts, une seule exécution.

    Les publier séparément laisserait la page montrer la capture d'un run et le
    texte d'un autre — un écart que personne ne verrait, puisque les deux
    diraient « passed ».
    """
    manquantes = [
        ligne
        for ligne in _TXT.read_text(encoding="utf-8").splitlines()
        if ligne.strip() and _echappe(ligne.strip()) not in svg
    ]
    assert not manquantes, (
        "ces lignes de la transcription ne figurent pas dans la capture — les deux "
        f"artefacts ne viennent pas du même run : {manquantes[:3]}"
    )


def _echappe(texte: str) -> str:
    """La même échappe XML que celle du générateur, pour comparer à l'identique."""
    return texte.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def test_the_capture_is_well_formed_and_standalone(svg: str) -> None:
    """Servie en `<img>`, elle n'a droit ni à du script ni à une requête externe."""
    ET.fromstring(svg)  # noqa: S314 - artefact du dépôt, pas une entrée
    assert "<script" not in svg, "un SVG servi en <img> n'exécute pas de script : retirez-le"
    assert "http://" not in svg.replace("http://www.w3.org/2000/svg", ""), (
        "référence externe dans la capture : elle doit être autonome"
    )


def test_the_capture_stops_moving_under_reduced_motion(svg: str) -> None:
    """La même règle absolue que le reste de la charte, et elle doit rester lisible.

    Un `animation:none` seul ne suffirait pas : les lignes démarrent masquées, et
    sans forcer leur visibilité la capture se réduirait à un cadre vide pour qui
    a demandé moins d'animations.
    """
    assert "prefers-reduced-motion" in svg, "la capture n'a pas de neutralisation du mouvement"
    bloc = svg.split("prefers-reduced-motion", 1)[1]
    assert "visible" in bloc.split("}", 2)[0] + bloc.split("}", 2)[1], (
        "sous reduced-motion la capture doit rendre les lignes visibles, pas seulement "
        "arrêter l'animation"
    )


def test_the_page_serves_both_the_capture_and_its_transcript() -> None:
    """Une capture animée n'est pas lisible par un lecteur d'écran.

    Le SVG annonce la transcription dans son `aria-label` ; ne pas la livrer
    rendrait cette annonce fausse, ce qui est pire que de ne rien annoncer.
    """
    page = _PAGE.read_text(encoding="utf-8")
    assert "demo-replay.svg" in page, "la page n'ouvre pas sur la capture"
    assert "demo-replay.txt" in page, "la page ne sert pas la transcription promise par l'alt"


def test_the_recorder_writes_nothing_when_the_demo_fails(tmp_path: Path) -> None:
    """Le cœur d'`AD-26`, tenu par un mécanisme et non par une consigne.

    On substitue à la démonstration un script qui sort en non-zéro. Le générateur
    doit sortir en erreur **et** laisser l'artefact intact : c'est ce qui garantit
    qu'un contrôle cassé retire la capture au lieu de la fabriquer.
    """
    faux_demo = tmp_path / "demo_qui_echoue.py"
    faux_demo.write_text(
        'print("== xSOM AI Guard — demo ==")\nprint("== DEMO FAILED ==")\nraise SystemExit(1)\n',
        encoding="utf-8",
    )
    avant = _SVG.read_bytes()

    lance = subprocess.run(
        [sys.executable, "-c", _PILOTE, str(faux_demo)],
        cwd=_REPO,
        capture_output=True,
        text=True,
        timeout=120,
    )

    assert lance.returncode != 0, (
        "le générateur a rendu zéro sur une démonstration en échec : il produirait "
        "une capture montrant un succès qui n'a pas eu lieu"
    )
    assert "AD-26" in lance.stderr, "l'erreur doit nommer la règle qu'elle fait respecter"
    assert _SVG.read_bytes() == avant, (
        "l'artefact a été réécrit alors que la démonstration a échoué"
    )


#: Charge le générateur, repointe sa démonstration sur le script en échec, et
#: appelle son entrée. Passer par `-c` plutôt que par un import dans le test
#: garde le sous-processus isolé : `principal()` écrit sur disque, et on ne veut
#: pas qu'un défaut de ce chemin puisse toucher l'artefact depuis le processus
#: de test lui-même.
#:
#: `sys.modules['rec'] = m` avant `exec_module` est indispensable et non
#: cosmétique : `@dataclass` résout ses annotations par
#: `sys.modules.get(cls.__module__).__dict__`, et un module chargé à la main sans
#: y être enregistré fait échouer la décoration sur un `AttributeError` obscur.
#: `sys.argv` est réécrit parce que `principal()` lit ses options avec argparse,
#: qui refuserait le chemin passé en argument.
_PILOTE = (
    "import importlib.util,sys,pathlib;"
    f"s=importlib.util.spec_from_file_location('rec', {str(_RECORD)!r});"
    "m=importlib.util.module_from_spec(s);sys.modules['rec']=m;"
    "s.loader.exec_module(m);"
    "m._DEMO=pathlib.Path(sys.argv[1]);sys.argv=[sys.argv[0]];"
    "sys.exit(m.principal())"
)

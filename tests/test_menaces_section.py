"""La section publique des menaces ne peut pas diverger de la carte de couverture.

Une seule section (`components/ThreatLedger.tsx`) porte désormais deux choses qui
ne se prouvent pas de la même façon, et c'est cette frontière que ce fichier tient :

* **ce qui est prouvé** vient de `coverage/map.json` par `lib/generated/threat-rows.json`,
  généré depuis les scénarios qui passent et gaté en CI. Modes, chemins d'entrée,
  scénarios, écarts : rien de tout cela n'est rédigé ;
* **ce qui est expliqué et classé** vient de `lib/menaces.ts` et du dictionnaire.
  Rang, étape d'entrée, phrase en clair : c'est éditorial, et cela ne revendique
  aucune couverture.

Le risque n'est pas qu'une phrase soit fausse : c'est qu'une menace **disparaisse**
du classement sans que personne ne le voie, ou qu'elle y soit nommée autrement que
sur la carte qui la prouve. La page afficherait alors une menace sous un nom que ses
propres scénarios ne connaissent pas.

Ce fichier tient donc :

1. le classement est un **sur-ensemble** du relevé : les seize lignes y sont toutes ;
2. leur titre français y est **mot pour mot** celui de l'artefact généré. Le titre
   affiché passe par le dictionnaire, parce que l'artefact n'est qu'en français ;
   ce contrôle est ce qui rend ce détour sûr ;
3. le classement est complet : rangs de 1 à N, sans trou ni doublon, chacun avec sa
   phrase en clair dans les deux langues.

Les sept menaces sans identifiant de relevé sont l'inverse du problème : elles
existent dans le classement et **pas** sur la carte, ce que la rangée dit en toutes
lettres (« pas encore évaluée »). Le jour où l'une d'elles entre dans
`coverage/rows.yaml`, il suffit de lui donner son identifiant ici, et le contrôle 2
se met à vérifier son titre.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

_RACINE = Path(__file__).resolve().parent.parent
_FRONT = _RACINE / "frontend"
_MENACES = _FRONT / "lib" / "menaces.ts"
_STRINGS = _FRONT / "lib" / "strings.ts"
_ARTEFACT = _FRONT / "lib" / "generated" / "threat-rows.json"
_PAGE = _FRONT / "app" / "page.tsx"
_LEDGER = _FRONT / "components" / "ThreatLedger.tsx"

#: Une entrée de `MENACES`. Le champ `releve` vaut `null` ou `"M-xx"`.
_LIGNE = re.compile(
    r"\{\s*rang:\s*(\d+),\s*releve:\s*(?:null|\"([^\"]+)\"),\s*"
    r"etape:\s*\"([a-z]+)\",\s*critique:\s*(true|false)\s*\}"
)

#: Les étapes déclarées, dans l'ordre : la pastille allume le point de ce rang, donc
#: l'ordre est porteur et pas seulement l'appartenance.
_ETAPES = re.compile(r"export const ETAPES = \[([^\]]+)\]")


def _menaces() -> list[dict[str, object]]:
    """Les lignes du paysage, telles que le front les rend."""
    texte = _MENACES.read_text(encoding="utf-8")
    return [
        {
            "rang": int(m.group(1)),
            "releve": m.group(2),
            "etape": m.group(3),
            "critique": m.group(4) == "true",
        }
        for m in _LIGNE.finditer(texte)
    ]


def _dictionnaire() -> dict[str, dict[str, str]]:
    """Les entrées `land.menace.*`, par clé puis par langue."""
    texte = _STRINGS.read_text(encoding="utf-8")
    trouve: dict[str, dict[str, str]] = {}
    for bloc in re.finditer(r'"(land\.menace\.[a-z0-9.]+)":\s*\{(.*?)\}', texte, flags=re.DOTALL):
        langues = dict(re.findall(r'\b(en|fr): "((?:[^"\\]|\\.)*)"', bloc.group(2)))
        trouve[bloc.group(1)] = langues
    return trouve


def _lignes_du_releve() -> dict[str, str]:
    """Identifiant vers titre, depuis l'artefact généré et gaté en CI."""
    donnees = json.loads(_ARTEFACT.read_text(encoding="utf-8"))
    return {ligne["id"]: ligne["titre"] for ligne in donnees["lignes"]}


def test_the_landscape_covers_every_ledger_line() -> None:
    """Aucune menace prouvée ne peut sortir de la page en silence."""
    cites = {m["releve"] for m in _menaces() if m["releve"]}
    manquantes = sorted(set(_lignes_du_releve()) - cites)
    assert not manquantes, (
        "ces lignes du relevé n'apparaissent plus dans le paysage des menaces : "
        f"{manquantes}\n"
        "  le relevé les publie comme couvertes, la page ne les nomme plus. Ajoutez-les "
        "à `MENACES` dans `frontend/lib/menaces.ts`, avec leur rang et leur phrase."
    )


def test_no_line_claims_a_ledger_id_that_does_not_exist() -> None:
    """L'inverse : un identifiant inventé ferait croire à une preuve absente."""
    connus = set(_lignes_du_releve())
    inventes = sorted({m["releve"] for m in _menaces() if m["releve"]} - connus)
    assert not inventes, (
        f"identifiants de relevé inconnus de la carte de couverture : {inventes}\n"
        "  un numéro `M-xx` affiché renvoie le lecteur au relevé ; s'il n'y est pas, "
        "la page promet une preuve qui n'existe pas."
    )


def test_the_public_title_is_the_map_title_word_for_word() -> None:
    """Deux noms pour une même menace se lisent comme deux menaces."""
    titres = _lignes_du_releve()
    dico = _dictionnaire()
    ecarts = []
    for m in _menaces():
        if not m["releve"]:
            continue
        cle = f"land.menace.{int(m['rang']):02d}.t"
        publie = dico.get(cle, {}).get("fr")
        attendu = titres[str(m["releve"])]
        if publie != attendu:
            ecarts.append(f"{m['releve']} : page {publie!r}, carte {attendu!r}")
    assert not ecarts, (
        "le titre français publié diffère de celui de la carte de couverture :\n  "
        + "\n  ".join(ecarts)
        + "\n\n  fix : recopiez le titre de `lib/generated/threat-rows.json`. C'est "
        "l'artefact qui fait foi, il est régénéré depuis les scénarios."
    )


def test_the_ranking_is_complete_and_has_no_ties() -> None:
    """Un classement à trou n'est plus un classement."""
    rangs = sorted(int(m["rang"]) for m in _menaces())
    assert rangs == list(range(1, len(rangs) + 1)), (
        f"les rangs doivent aller de 1 à {len(rangs)} sans trou ni doublon, trouvé : {rangs}"
    )


def test_every_rank_has_its_copy_in_both_languages() -> None:
    """Une rangée sans phrase en clair est une rangée qui n'explique rien."""
    dico = _dictionnaire()
    manques = []
    for m in _menaces():
        for suffixe in ("t", "b"):
            cle = f"land.menace.{int(m['rang']):02d}.{suffixe}"
            langues = dico.get(cle, {})
            for lang in ("en", "fr"):
                if not langues.get(lang, "").strip():
                    manques.append(f"{cle} ({lang})")
    assert not manques, "copie manquante dans le dictionnaire :\n  " + "\n  ".join(manques)


def test_no_orphan_copy_survives_the_list() -> None:
    """Une clé qui ne sert plus reste traduite, relue et payée pour rien."""
    rangs = {int(m["rang"]) for m in _menaces()}
    orphelines = sorted(
        cle
        for cle in _dictionnaire()
        if (m := re.fullmatch(r"land\.menace\.(\d+)\.[tb]", cle)) and int(m.group(1)) not in rangs
    )
    assert not orphelines, (
        f"ces entrées ne correspondent à aucune menace listée : {orphelines}\n"
        "  fix : supprimez-les, ou rendez-leur un rang."
    )


def test_every_stage_is_declared_and_labelled() -> None:
    """Une étape sans libellé rendrait une pastille muette."""
    texte = _MENACES.read_text(encoding="utf-8")
    bloc = _ETAPES.search(texte)
    assert bloc, "`ETAPES` introuvable dans `lib/menaces.ts`"
    declarees = re.findall(r'"([a-z]+)"', bloc.group(1))
    dico = _dictionnaire()

    inconnues = sorted({str(m["etape"]) for m in _menaces()} - set(declarees))
    assert not inconnues, f"étapes employées mais non déclarées dans `ETAPES` : {inconnues}"

    sans_libelle = [e for e in declarees if not dico.get(f"land.menace.et.{e}", {}).get("fr")]
    assert not sans_libelle, f"étapes déclarées sans libellé : {sans_libelle}"


def test_the_replaced_section_left_nothing_behind() -> None:
    """Les sections remplacées emportent leur copie, sinon elle revient par un `t()` oublié.

    Deux remplacements successifs sont passés par ici : les cartes de fonctionnalités
    d'abord, puis le classement autonome, fondu dans le relevé. Chacun a laissé du
    code mort la première fois.
    """
    residus = re.findall(r"land\.feat\.[a-z0-9.]+", _STRINGS.read_text(encoding="utf-8"))
    assert not residus, (
        f"la copie des anciennes cartes de fonctionnalités survit dans le dictionnaire : "
        f"{sorted(set(residus))}"
    )
    page = _PAGE.read_text(encoding="utf-8")
    assert "land.feat." not in page, "la page appelle encore la copie retirée"
    assert "MENACES" not in page, (
        "la page rend encore un classement à elle : le relevé le porte désormais, et "
        "deux sections qui nomment les mêmes menaces se lisent comme une répétition"
    )


def test_the_ledger_is_the_one_place_the_ranking_is_rendered() -> None:
    """Non-vacuité de la fusion : la section doit vraiment être dans le relevé.

    Sans ce contrôle, supprimer la section de la page suffirait à faire passer le
    test au-dessus, classement disparu compris.
    """
    ledger = _LEDGER.read_text(encoding="utf-8")
    for attendu in ("MENACES", "cleTitre", "cleClair", "cleEtape", "ledger.horscarte"):
        assert attendu in ledger, (
            f"`{attendu}` absent de `components/ThreatLedger.tsx` : le relevé ne rend "
            "plus le classement fusionné"
        )


def test_the_guard_reads_files_that_are_really_there() -> None:
    """Contrôle de non-vacuité : un garde qui ne lit rien passe toujours.

    Les trois regex ci-dessus lisent du TypeScript. Un changement de forme du fichier
    les ferait rendre zéro ligne, et **tous** les contrôles passeraient alors sans
    rien vérifier. C'est le mode de panne le plus probable de ce fichier.
    """
    menaces = _menaces()
    assert len(menaces) >= 16, f"paysage anormalement court ({len(menaces)} lignes)"
    assert len(_lignes_du_releve()) >= 16, "artefact de relevé anormalement court"
    assert any(m["releve"] for m in menaces), "aucune ligne ne porte d'identifiant de relevé"
    assert any(not m["releve"] for m in menaces), "aucune ligne hors relevé"
    assert any(m["critique"] for m in menaces), "aucune ligne marquée critique"
    assert len(_dictionnaire()) >= 2 * len(menaces), "dictionnaire des menaces incomplet"

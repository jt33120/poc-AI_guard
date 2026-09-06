#!/usr/bin/env python3
"""Le rejeu : la même action jouée deux fois, garde retiré puis garde actif (`L6`).

C'est la « vidéo » que le brief demandait, et ce n'en est pas une. `AD-26` pose la
règle : *une vidéo est l'enregistrement d'une exécution qui passe, jamais un
substitut.* Une animation dessinée à la main montrerait ce qu'on veut montrer ; une
séquence capturée pendant la suite de tests montre ce qui s'est passé.

**Pourquoi deux séquences et pas une.** Filmer un blocage seul, c'est filmer un écran
où rien ne se passe — et un plantage, un aval injoignable ou un nom d'outil mal
orthographié produisent exactement la même image. C'est le constat que `tests/conftest.py`
écrit déjà pour justifier le sens `controle_negatif`. Le rejeu met donc les deux côte à
côte : garde retiré, l'action arrive ; garde actif, elle est refusée. La différence entre
les deux colonnes **est** le produit.

**La règle d'appariement, et elle est stricte.** Les deux scénarios doivent exercer les
mêmes outils. Sans cette contrainte, on afficherait deux exécutions différentes sous le
titre « la même action jouée deux fois », ce qui serait faux — et invisible, puisque les
deux colonnes seraient également plausibles. Une ligne dont l'appariement échoue n'a pas
de rejeu, et le gate le dit plutôt que de le maquiller.

**Ce que la séquence porte, et ce qu'elle ne porte pas.** Les colonnes viennent
d'`audit_log`, qui ne journalise que des métadonnées et des empreintes (`CLAUDE.md`
§4.10). `entry_hash` et `prev_hash` en sont absents : `payload_v1` hache `ts`,
`tenant_id`, `request_id` et `latency_ms`, tous variables d'une exécution à l'autre, si
bien qu'un artefact committé qui les porterait ne pourrait jamais passer un gate
d'égalité. Ce qui est publié à leur place, c'est **la propriété vérifiée** : la chaîne a
été confrontée par `core.audit.verify_chain` au moment de la capture.

Usage :
    uv run pytest                              # capture les séquences
    uv run python scripts/gen_replays.py       # écrit les rejeux
    uv run python scripts/gen_replays.py --check
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO))

from core.threat_map import MapUnavailable, published_rows  # noqa: E402

_MAP = _REPO / "coverage" / "map.json"
_SCENARIOS = _REPO / "coverage" / ".scenarios.json"
_SEQUENCES = _REPO / "coverage" / ".sequences.json"
_OUT = _REPO / "frontend" / "lib" / "generated" / "replays.json"

#: Les lignes qu'on **sait** ne pas pouvoir rejouer, et la raison, publiée telle
#: quelle sur la page. Déclarée plutôt que devinée : sans cette table, une ligne qui
#: perdrait son rejeu par régression serait indiscernable d'une ligne qui n'en a
#: jamais eu, et le gate se tairait dans les deux cas.
#:
#: `M-14/secrets` est le cas de fond, et il n'est pas un manque : sa preuve est qu'un
#: argument secret **n'atteint pas** le journal. Les deux exécutions décident donc
#: légitimement `allow`, et ce qui diffère est le contenu relayé — que `audit_log` ne
#: consigne pas, par construction (`CLAUDE.md` §4.10). Il n'y a rien à mettre côte à
#: côte parce que la différence *est* une absence. La montrer en deux colonnes
#: identiques serait exactement l'écran où rien ne se passe que ce lot refuse.
_SANS_REJEU: dict[str, str] = {
    # Rédigée pour être **affichée telle quelle** : ni gras Markdown, ni accent grave,
    # ni tiret cadratin. La page n'est pas un rendu Markdown, et la première version de
    # cette phrase montrait ses astérisques au lecteur.
    "M-14": (
        "Sur cette ligne, la preuve est une absence : l'argument secret n'atteint "
        "jamais le journal d'audit. Les deux exécutions autorisent donc l'appel, et ce "
        "qui les sépare est ce qui a été relayé, que le journal ne consigne pas. C'est "
        "voulu : ne rien consigner du contenu est précisément la propriété démontrée. "
        "Deux colonnes identiques ne montreraient rien."
    ),
}


def _outils(entrees: list[dict[str, Any]]) -> tuple[str, ...]:
    """Les outils qu'une séquence a réellement appelés, dans l'ordre.

    Les entrées sans outil sont des verdicts du garde (`taint_marked` et sa famille) :
    elles décrivent une décision, pas un appel, et les compter ferait échouer
    l'appariement précisément sur les lignes où le garde a le plus à montrer.
    """
    vus: list[str] = []
    for e in entrees:
        outil = e.get("tool_name")
        if outil and (not vus or vus[-1] != outil):
            vus.append(str(outil))
    return tuple(vus)


def _divergence(sans: list[dict[str, Any]], avec: list[dict[str, Any]]) -> int | None:
    """Le rang de la **première** entrée où les deux colonnes cessent de coïncider.

    Dérivé, et c'est ce qui le rend durable. La tentation était de colorer les
    décisions selon un vocabulaire — `deny` en cuivre, `allow` en neutre — mais ce
    vocabulaire est ouvert (`allow`, `deny`, `denied`, `hitl_pending`, `hitl_denied`,
    `taint_marked`, `tainted_action`, `notify`, `streamed_uninspected`, et le reste à
    venir). Une table de correspondance écrite ici vieillirait en silence, et la page
    afficherait un jour un refus en gris.

    Le point de divergence, lui, ne se périme pas : il ne suppose rien du sens des
    mots, il constate où les deux exécutions cessent d'être la même. C'est exactement
    ce que le lecteur doit regarder, et c'est le produit.
    """
    for rang in range(max(len(sans), len(avec))):
        a = sans[rang] if rang < len(sans) else None
        b = avec[rang] if rang < len(avec) else None
        if a is None or b is None:
            return rang
        if (a["tool_name"], a["decision"]) != (b["tool_name"], b["decision"]):
            return rang
    return None


def _apparier(
    scenarios: list[dict[str, Any]], sequences: dict[str, dict[str, Any]], row_id: str
) -> tuple[dict[str, Any] | None, str | None]:
    """Trouver, pour une ligne, le couple (garde retiré, garde actif) qui se compare.

    Renvoie le rejeu, ou `None` accompagné de la raison — jamais un couple approximatif.
    """
    des_lignes = [s for s in scenarios if s["row"] == row_id and s["outcome"] == "passed"]
    negatifs = [s for s in des_lignes if s["sens"] == "controle_negatif"]
    if not negatifs:
        return None, "aucun contrôle négatif : il n'y a rien à comparer au blocage"

    for negatif in sorted(negatifs, key=lambda s: s["test"]):
        sans = sequences.get(negatif["test"])
        if not sans or not sans["entrees"]:
            continue
        outils_attendus = _outils(sans["entrees"])
        candidats = [
            s
            for s in des_lignes
            if s["sens"] == "bloque"
            and s["facet"] == negatif["facet"]
            and s["ingress"] == negatif["ingress"]
        ]
        for bloque in sorted(candidats, key=lambda s: s["test"]):
            avec = sequences.get(bloque["test"])
            if not avec or not avec["entrees"]:
                continue
            if _outils(avec["entrees"]) != outils_attendus:
                continue
            if _divergence(sans["entrees"], avec["entrees"]) is None:
                # Deux traces identiques sous « le même appel, une seule différence »
                # affirmeraient une différence qu'on ne montre pas. On continue de
                # chercher un couple qui diverge plutôt que de publier celui-là.
                continue
            return (
                {
                    "facette": negatif["facet"],
                    "ingress": negatif["ingress"],
                    "outils": list(outils_attendus),
                    "divergence": _divergence(sans["entrees"], avec["entrees"]),
                    "sans_garde": {
                        "test": negatif["test"],
                        "chainee": sans["chainee"],
                        "entrees": sans["entrees"],
                    },
                    "avec_garde": {
                        "test": bloque["test"],
                        "chainee": avec["chainee"],
                        "entrees": avec["entrees"],
                    },
                },
                None,
            )
    return None, (
        "aucun scénario « bloque » n'exerce les mêmes outils que le contrôle négatif "
        "sur la même facette et le même chemin d'entrée, **et** n'en diverge"
    )


def _payload() -> tuple[dict[str, Any], list[str]]:
    """Construire les rejeux, et rapporter les lignes qui n'en ont pas."""
    if not _SCENARIOS.exists() or not _SEQUENCES.exists():
        raise MapUnavailable(
            f"{_SCENARIOS.name} ou {_SEQUENCES.name} absent — lancez `uv run pytest` "
            "d'abord. Le rejeu est l'enregistrement d'une exécution, pas une "
            "reconstitution (`AD-26`)."
        )
    scenarios = json.loads(_SCENARIOS.read_text(encoding="utf-8"))
    sequences = json.loads(_SEQUENCES.read_text(encoding="utf-8"))
    carte = json.loads(_MAP.read_text(encoding="utf-8"))

    rejeux: dict[str, Any] = {}
    manquants: list[str] = []
    for ligne in published_rows(_MAP):
        if not ligne.rejouable:
            continue
        rejeu, raison = _apparier(scenarios, sequences, ligne.id)
        if rejeu is not None:
            rejeux[ligne.id] = rejeu
        elif ligne.id not in _SANS_REJEU:
            # Non déclarée : c'est une régression, ou un scénario à écrire. Le gate
            # refuse plutôt que de laisser la page ouvrir sur du vide.
            manquants.append(f"{ligne.id} ({ligne.titre}) : {raison}")

    # Une ligne déclarée sans rejeu qui en aurait retrouvé un est aussi une dérive :
    # la table mentirait, et sa raison s'afficherait à côté d'une séquence.
    for row_id in _SANS_REJEU:
        if row_id in rejeux:
            manquants.append(
                f"{row_id} : déclarée sans rejeu, mais un couple valide existe "
                "désormais. Retirez-la de `_SANS_REJEU`."
            )

    payload = {
        "commit": carte["commit"],
        "genere_le": carte["genere_le"],
        "rejeux": rejeux,
        # Publiées avec leur raison : une ligne sans rejeu doit dire pourquoi, comme
        # une facette non couverte publie la sienne (`FR-144`).
        "sans_rejeu": {
            row_id: raison
            for row_id, raison in _SANS_REJEU.items()
            if any(ligne.id == row_id and ligne.rejouable for ligne in published_rows(_MAP))
        },
    }
    return payload, manquants


def _render(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="gate seul : ne rien écrire, sortir non-zéro si un rejeu manque ou a dérivé",
    )
    args = parser.parse_args()

    try:
        payload, manquants = _payload()
    except MapUnavailable as exc:
        print(f"  ✗ {exc}", file=sys.stderr)
        return 1

    rendu = _render(payload)
    attendus = [ligne.id for ligne in published_rows(_MAP) if ligne.rejouable]

    if manquants:
        # Une ligne que la page annonce « voir le blocage » sans avoir de séquence
        # afficherait un cadre vide. Le gate refuse plutôt que de laisser publier.
        print("L6 — une ligne rejouable est sans rejeu :\n", file=sys.stderr)
        for m in manquants:
            print(f"  ✗ {m}", file=sys.stderr)
        print(
            "\nSoit le scénario manque et il faut l'écrire, soit la ligne ne devrait "
            "pas être publiée `Bloqué`. Le relevé annonce un rejeu sur chaque ligne "
            "bloquée : une ligne sans séquence y ouvrirait sur du vide.",
            file=sys.stderr,
        )
        return 1

    if args.check:
        actuel = _OUT.read_text(encoding="utf-8") if _OUT.exists() else None
        if actuel != rendu:
            manquant = "absent" if actuel is None else "périmé"
            print(
                f"  ✗ {_OUT.relative_to(_REPO)} {manquant} — lancez "
                "`uv run pytest && make replays`.",
                file=sys.stderr,
            )
            return 1
        chainees = sum(
            1
            for r in payload["rejeux"].values()
            if r["sans_garde"]["chainee"] and r["avec_garde"]["chainee"]
        )
        print(
            f"L6 = 0 — {len(payload['rejeux'])}/{len(attendus)} lignes rejouables ont "
            f"leur séquence, {chainees} avec les deux chaînes vérifiées"
        )
        for row_id in payload["sans_rejeu"]:
            print(f"       {row_id} : sans rejeu, déclarée et publiée avec sa raison")
        return 0

    _OUT.parent.mkdir(parents=True, exist_ok=True)
    _OUT.write_text(rendu, encoding="utf-8")
    print(
        f">> {_OUT.relative_to(_REPO)} — {len(payload['rejeux'])}/{len(attendus)} rejeux, "
        f"{len(payload['sans_rejeu'])} déclarée(s) sans rejeu"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

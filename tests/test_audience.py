"""`L7` — « Pour qui » : les bascules, et le profil sur lequel nous perdons.

La section ajoute au relevé de `L5` ce qu'il ne disait pas : non pas ce qui concerne le
visiteur, mais ce qui le **concernerait**, et à quelle condition. « Le piratage d'agents
autonomes devient votre ligne le jour où vous outillez vos agents » est une date dans une
feuille de route ; c'est ce qui fait qu'un lecteur se sent concerné, et c'est
`core.triage` qui le calcule.

Ce fichier tient deux choses que la page ne doit pas pouvoir contredire : les profils
qu'elle propose sont ceux du moteur, et le plafond qu'elle publie est celui que
`FR-174` calcule.
"""

from __future__ import annotations

import re
from pathlib import Path

from core.profiles import Profile, ceiling
from core.threat_map import published_rows
from core.triage import diagnose

_RACINE = Path(__file__).resolve().parent.parent
_CARTE = _RACINE / "coverage" / "map.json"
_CONTEXTE = _RACINE / "frontend" / "components" / "ProfilContext.tsx"


def _profils_proposes() -> list[str]:
    """Les profils que la page propose au visiteur, lus dans la source du contexte."""
    texte = _CONTEXTE.read_text(encoding="utf-8")
    bloc = texte[texte.index("export const PROFILS") : texte.index("interface Etat")]
    return re.findall(r'id:\s*"([^"]+)"', bloc)


def test_the_page_offers_exactly_the_engine_s_profiles() -> None:
    """Un profil de plus ou de moins, et le diagnostic ne répond plus à ce qu'on demande.

    Le vocabulaire est fermé dans `core.profiles.Profile`, et le refuser côté route est
    déjà tenu (`tests/test_threats_api.py`). Ici on ferme l'autre bout : la page ne peut
    pas proposer un profil que le moteur ne connaît pas, ni taire un profil qu'il
    connaît — le second cas est le plus discret, et le plus coûteux.
    """
    assert _profils_proposes() == [p.value for p in Profile]


def test_the_published_ceiling_is_the_one_the_engine_computes() -> None:
    """`FR-174` est calculé, pas rédigé, et la page ne peut pas en publier un autre.

    Le plafond dit jusqu'où le déploiement permet d'aller. Devant une IA embarquée dans
    une suite SaaS il n'y a aucune frontière d'outils où s'interposer, donc « Bloqué »
    est structurellement hors d'atteinte. Ce plafond existe pour nous rendre incapables
    de dire le contraire ; une liste écrite côté page le contournerait.
    """
    plafonnes = {p.value for p in Profile if ceiling(frozenset({p})) is not None}
    assert plafonnes == {"P1b"}, (
        f"les profils plafonnés sont {sorted(plafonnes)}. La page publie le plafond "
        "depuis la réponse du moteur : si cet ensemble change, elle suivra, mais le "
        "texte qui l'explique parle de l'IA embarquée SaaS et devra être relu."
    )


def test_every_unheld_row_names_the_profiles_that_would_switch_it_on() -> None:
    """Une bascule sans condition nommée serait une menace brandie sans porte de sortie.

    Le visiteur doit pouvoir lire la condition, pas la deviner. Une ligne qui ne
    s'active nulle part n'est pas une bascule : elle n'appartient à personne dans ce
    vocabulaire de profils, et la section ne l'affiche pas.
    """
    rapport = diagnose(_CARTE, frozenset({Profile.p1a}))
    bascules = [ligne for ligne in rapport.not_applicable if ligne.activates_at]
    assert bascules, "P1a doit laisser des bascules, sinon ce test ne dit rien"
    connus = {p.value for p in Profile}
    for ligne in bascules:
        assert ligne.activates_at, f"{ligne.id} sans condition"
        assert {p.value for p in ligne.activates_at} <= connus
        # Et la condition ne comprend jamais un profil déjà tenu : « devient la vôtre
        # avec P1a » serait absurde pour un lecteur qui a coché P1a.
        assert Profile.p1a not in ligne.activates_at, f"{ligne.id} bascule sur un profil déjà tenu"


def test_the_switches_shown_are_rows_the_visitor_does_not_hold() -> None:
    """Ce qui est déjà le vôtre n'est pas une bascule, et l'inverse non plus."""
    rapport = diagnose(_CARTE, frozenset({Profile.p1a}))
    applicables = {ligne.id for ligne in rapport.applicable}
    bascules = {ligne.id for ligne in rapport.not_applicable if ligne.activates_at}
    assert not (applicables & bascules)
    # Et l'union reste bornée par la matrice : la section ne peut pas inventer de ligne.
    connues = {ligne.id for ligne in published_rows(_CARTE)}
    assert (applicables | bascules) <= connues


def test_holding_every_profile_leaves_nothing_to_switch_on() -> None:
    """Le cas limite que la page annonce : « plus rien à faire basculer ».

    Sans ce test, la branche qui affiche cette phrase ne serait jamais atteinte par
    quoi que ce soit de vérifié, et pourrait mentir sans qu'on le sache.
    """
    rapport = diagnose(_CARTE, frozenset(Profile))
    assert not [ligne for ligne in rapport.not_applicable if ligne.activates_at]

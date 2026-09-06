"""Le proxy de la console ne relaie que ce que la console demande.

`§1.5` du plan : *« Le proxy front relaie n'importe quelle méthode vers n'importe quel
chemin de l'API avec le jeton de session, sans allowlist. Le rôle du compte devient
l'unique contrôle de sécurité. »* Vérifié, et corrigé par `lib/controlRoutes.ts`.

Le danger d'une liste blanche est qu'elle se périme dans les deux sens :

- **trop étroite**, elle casse la console — et pas au build, à l'exécution, sur un écran
  qu'on n'a pas rouvert ;
- **trop large**, elle ne protège plus rien, et personne ne s'en aperçoit puisque tout
  marche.

Ce fichier tient les deux bouts en confrontant la table aux **appels réels** du code de
la console plutôt qu'à elle-même. Un appel ajouté sans sa règle échoue ici, en CI,
plutôt que sur un écran en production.
"""

from __future__ import annotations

import re
from pathlib import Path

_RACINE = Path(__file__).resolve().parent.parent
_FRONT = _RACINE / "frontend"
_TABLE = _FRONT / "lib" / "controlRoutes.ts"
_PROXY = _FRONT / "app" / "api" / "control" / "[...path]" / "route.ts"

#: Les fonctions de `lib/client.ts` par lesquelles passe *tout* appel à l'API.
_VERBE_IMPLICITE = {"apiGet": "GET", "apiDelete": "DELETE"}
_VERBE_EXPLICITE = ("apiSend", "apiSendVoid")

#: Une interpolation **précédée d'une barre** est un segment : `v1/clients/${id}`.
_SEGMENT_INTERPOLE = re.compile(r"(?<=/)\$\{[^}]*\}")
#: Une interpolation **collée au chemin** n'en fait pas partie : `v1/audit${suffix}`,
#: où `clientSuffix` rend `""` ou `?client_id=…`. La distinction est structurelle, et
#: c'est la seule lecture statique qui ne se trompe pas sur les deux formes employées.
_SUFFIXE_INTERPOLE = re.compile(r"(?<![/])\$\{[^}]*\}")


def _sources() -> list[Path]:
    """Le code de la console, hors artefacts de build."""
    return [
        chemin
        for chemin in (*_FRONT.rglob("*.ts"), *_FRONT.rglob("*.tsx"))
        if ".next" not in chemin.parts and "node_modules" not in chemin.parts
    ]


def _appels() -> set[tuple[str, str]]:
    """Les couples (méthode, chemin) que la console demande réellement.

    On lit les appels, pas la table : c'est la seule lecture qui puisse constater un
    écart entre ce que le code fait et ce que la liste blanche autorise.
    """
    trouves: set[tuple[str, str]] = set()
    for chemin in _sources():
        texte = chemin.read_text(encoding="utf-8")
        for nom, verbe in _VERBE_IMPLICITE.items():
            for brut in re.findall(rf'\b{nom}(?:<[^>]*>)?\(\s*[`"]([^`"]+)[`"]', texte):
                trouves.add((verbe, brut))
        for nom in _VERBE_EXPLICITE:
            motif = rf'\b{nom}(?:<[^>]*>)?\(\s*[`"]([^`"]+)[`"]\s*,\s*"([A-Z]+)"'
            for brut, verbe in re.findall(motif, texte):
                trouves.add((verbe, brut))
        # `exportUrl` construit son adresse à la main plutôt que par le client.
        # On écarte le gabarit de `lib/client.ts` lui-même (`/api/control/${path}`) :
        # c'est la définition de l'enveloppe, pas un appel.
        for brut in re.findall(r"`/api/control/([^`?]+)", texte):
            if not brut.startswith("${"):
                trouves.add(("GET", brut))
    return trouves


def _normalise(brut: str) -> str:
    """Le chemin tel qu'il parvient au proxy, sans requête ni interpolation.

    Next range la requête dans `nextUrl.search` : `params.path` ne porte que les
    segments. Un suffixe interpolé collé au chemin n'en fait donc pas partie.
    """
    sans_suffixe = _SUFFIXE_INTERPOLE.sub("", brut)
    sans_requete = sans_suffixe.split("?", 1)[0]
    return _SEGMENT_INTERPOLE.sub("id", sans_requete).rstrip("/")


def _regles() -> list[tuple[re.Pattern[str], set[str]]]:
    """La table, relue depuis le TypeScript."""
    texte = _TABLE.read_text(encoding="utf-8")
    seg = re.search(r'const SEG = "([^"]+)"', texte)
    assert seg, "SEG n'est plus déclaré : la table a changé de forme"

    regles: list[tuple[re.Pattern[str], set[str]]] = []
    for motif, verbes in re.findall(
        r'pattern:\s*new RegExp\([`"]([^`"]+)[`"]\),\s*methods:\s*\[([^\]]*)\]', texte
    ):
        concret = motif.replace("${SEG}", seg.group(1))
        regles.append((re.compile(concret), set(re.findall(r'"([A-Z]+)"', verbes))))
    assert regles, "aucune règle relue — le format de la table a changé"
    return regles


def _autorise(verbe: str, chemin: str) -> bool:
    return any(m.fullmatch(chemin) and verbe in v for m, v in _regles())


def test_every_call_the_console_makes_is_allowed_by_the_table() -> None:
    """Une liste blanche trop étroite ne casse rien au build : elle casse un écran.

    Le test lit les appels du code, donc un appel ajouté sans sa règle échoue ici.
    """
    manquants = sorted(
        (verbe, brut) for verbe, brut in _appels() if not _autorise(verbe, _normalise(brut))
    )
    assert not manquants, (
        f"la console appelle {manquants}, que la table refuse. Ces écrans renverraient "
        "404 en production sans que rien ne le signale au build."
    )


def test_the_console_really_does_call_something() -> None:
    """Sinon le test précédent passe en ne vérifiant rien.

    Un motif d'extraction cassé rendrait l'ensemble vide, et un ensemble vide satisfait
    n'importe quelle liste blanche.
    """
    appels = _appels()
    assert len(appels) >= 15, f"seulement {len(appels)} appels relevés — l'extraction a cassé"
    assert ("POST", "v1/clients/assign") in appels, (
        "l'appel le moins devinable de la console n'est plus relevé : l'extraction ne "
        "voit plus ce qu'elle est censée voir"
    )


def test_the_table_grants_nothing_the_console_does_not_ask_for() -> None:
    """Trop large, une liste blanche ne protège plus rien — et tout marche encore.

    Chaque règle doit servir un appel réel. Une règle qui n'en sert aucun est une porte
    ouverte que personne ne referme, parce que rien ne la signale.
    """
    demandes = {(verbe, _normalise(brut)) for verbe, brut in _appels()}
    inutiles = [
        (motif.pattern, sorted(verbes))
        for motif, verbes in _regles()
        if not any(motif.fullmatch(c) and v in verbes for v, c in demandes)
    ]
    assert not inutiles, f"règles que rien n'appelle : {inutiles}"


def test_paths_the_console_never_calls_are_refused() -> None:
    """L'écart qu'on ferme : l'API sert davantage que ce que la console demande."""
    for verbe, chemin in (
        ("GET", "v1/compliance/export"),
        ("GET", "v1/usage/detail"),
        ("DELETE", "v1/policy"),
        ("POST", "v1/agents"),
        ("GET", "v1/integrity"),
        ("GET", "openapi.json"),
    ):
        assert not _autorise(verbe, chemin), f"{verbe} {chemin} passe encore"


def test_traversal_segments_cannot_reach_the_pattern_test() -> None:
    """`..` doit être refusé par la forme du segment, avant toute comparaison.

    Next décode les segments : `%2e%2e` arrive sous la forme `..`, donc c'est bien la
    valeur décodée qu'il faut refuser.
    """
    seg = re.search(r'const SEG = "([^"]+)"', _TABLE.read_text(encoding="utf-8"))
    assert seg
    for mauvais in ("..", ".", "", "a/b", "a%2fb", "a.b", "a b"):
        assert not re.fullmatch(seg.group(1), mauvais), f"{mauvais!r} est accepté comme segment"


def test_the_proxy_refuses_before_attaching_the_token() -> None:
    """L'ordre est le propos : refuser après avoir relayé ne refuse rien.

    Le contrôle doit précéder la construction de l'adresse amont, donc le `fetch` qui
    porte le jeton de la session.
    """
    texte = _PROXY.read_text(encoding="utf-8")
    assert "routeAllowed" in texte, "le proxy n'appelle plus la liste blanche"
    assert texte.index("routeAllowed") < texte.index("const target"), (
        "le contrôle passe après la construction de l'adresse amont"
    )

"""AD-25 — la souveraineté est une propriété de CI, pas une promesse (`FR-176`).

`AD-25` pose la règle : *le pli se referme sans sortie réseau. Un test échoue si un
module atteignable depuis le calcul du verdict effectue, ou **peut** effectuer, un
appel sortant.* Le « peut » est délibéré : la garantie vendue n'est pas « nous
n'appelons pas », c'est « rien ne nous en donne le moyen ». C'est donc une analyse
statique du graphe d'imports, pas une observation à l'exécution — une branche jamais
prise sur le jeu de tests reste une dépendance.

Le découpage suit celui de l'architecture, et il n'est pas négociable au fil de l'eau :

* Les **adaptateurs** (`_ADAPTATEURS`) sont les racines. Ils *agissent* — relayer
  l'appel, retourner la réponse du fournisseur — donc ils sortent par construction.
  Ce qu'on vérifie d'eux, c'est ce dont ils dépendent pour **décider**.
* Les modules **hors pli** (`_HORS_PLI`) sont les seuls de cette dépendance à pouvoir
  sortir, chacun avec la raison pour laquelle il n'est pas requis pour un verdict.
  La liste est fermée : un quatrième module qui gagnerait une sortie fait échouer le
  build, ce qui est exactement le défaut qu'`AD-25` dit prévenir.
* Tout le reste — le pli — doit être réseau-muet, **sans exemption**.

La métrique associée est `SM-15` : *appels sortants hors UE requis sur le chemin de
décision : 0*.
"""

from __future__ import annotations

import ast
import sys
from dataclasses import dataclass
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent

#: Paquets de premier rang. Le graphe ne sort jamais d'ici : une bibliothèque tierce
#: n'est pas parcourue, elle est jugée sur son nom (`_RESEAU`).
_PREMIER_RANG = ("core", "api", "gateway", "cli")

#: Les adaptateurs d'ingestion (AD-28). Racines du parcours, et exemptés eux-mêmes :
#: le proxy LLM relaie vers le fournisseur, le gateway relaie vers l'outil en aval.
#: C'est leur fonction, après la décision et jamais avant.
_ADAPTATEURS = ("core.decision", "gateway.server", "api.llm_proxy")

#: Les seuls modules du pli autorisés à joindre le réseau, et pourquoi chacun n'est
#: pas requis pour qu'un verdict soit rendu. Une entrée ici est une revendication de
#: revue, pas un silence : elle est relue à chaque fois qu'on la modifie.
_HORS_PLI: dict[str, str] = {
    "core.judge": (
        "Enrichisseur de classification, jamais décideur (AD-25). Il produit un "
        "`action_class` avant le pli et ne rend aucun palier. Absent ou hors budget, "
        "AD-34 le rend plus strict — le pli décide sans lui."
    ),
    "core.notify": (
        "Notification d'approbation, hors bande et après la décision de tenir. Son "
        "échec laisse l'action **en attente** (`core/decision.py` `_notify`) : elle ne "
        "peut relâcher aucune action, donc aucun verdict n'en dépend."
    ),
    "gateway.downstream": (
        "Le relais vers le serveur d'outils en aval — l'action elle-même, exécutée "
        "seulement après un verdict `allow`. Le schéma d'`ARCHI-SOUVERAINE` §2 le dit "
        "ainsi : « relais après décision, jamais avant »."
    ),
    "core.prompt_guard": (
        "Le garde-prompt tiers (`FR-193`). Cinquième entrée de cette liste fermée, "
        "donc à défendre : ce module appelle un service en ligne — Mistral, juridiction "
        "de l'Union, déjà imposé par la stack pour le juge, donc zéro fournisseur "
        "nouveau (`QO-3`). Ce qui l'autorise ici n'est pas cette souveraineté mais le "
        "fait qu'il n'est **sur le chemin d'aucune décision** : son verdict est observé "
        "et chaîné, jamais lu par un garde. `M-01/garde_prompt` est publiée "
        "`Orchestré` et non `Bloqué`, et un scénario prouve qu'un prompt signalé est "
        "quand même relayé — le jour où ce verdict retiendrait une action, ce module "
        "devrait rentrer dans le pli et cette entrée disparaître."
    ),
    "core.egress": (
        "La garde d'egress (AD-24). Elle résout un nom pour en refuser les plages "
        "interdites — à l'enregistrement d'un serveur en aval et à la connexion, jamais "
        "pendant qu'un verdict se calcule. Elle empêche de joindre plutôt qu'elle ne "
        "joint, mais `socket` la rend réseau-capable au sens de cette analyse, et une "
        "capacité réelle se nomme au lieu de se traiter à part."
    ),
}

#: Un import qui donne le moyen de sortir. La liste est volontairement large : une
#: dépendance réseau qu'on n'aurait pas nommée passerait sans bruit, et c'est
#: précisément le mode d'échec qu'`AD-25` vise.
_RESEAU = frozenset(
    {
        "aiohttp",
        "ftplib",
        "http.client",
        "httpcore",
        "httpx",
        "litellm",
        "mcp.client",
        "requests",
        "smtplib",
        "socket",
        "telnetlib",
        "urllib.request",
        "urllib3",
        "websockets",
        "xmlrpc.client",
    }
)


@dataclass(frozen=True, slots=True)
class Violation:
    """Un module du pli qui peut sortir — l'unité de `SM-15`."""

    module: str
    reseau: tuple[str, ...]
    #: comment on est arrivé jusqu'à lui depuis un adaptateur, pour que l'échec soit
    #: réparable sans relire tout le graphe
    chemin: tuple[str, ...]


def _module_name(path: Path) -> str:
    return ".".join(path.relative_to(_REPO).with_suffix("").parts)


def _sources() -> dict[str, Path]:
    """Tous les modules de premier rang, par nom pointé."""
    out: dict[str, Path] = {}
    for pkg in _PREMIER_RANG:
        for path in sorted((_REPO / pkg).rglob("*.py")):
            name = _module_name(path)
            out[name.removesuffix(".__init__")] = path
    return out


def _imports(path: Path) -> set[str]:
    """Les modules importés par ce fichier, imports différés compris.

    `ast.walk` plutôt que les seuls noeuds de tête : un `import httpx` dans le corps
    d'une fonction sort autant qu'un import de module, et se cacherait d'un contrôle
    qui ne regarde que l'en-tête (`gateway/server.py:551` importe ainsi le juge).
    """
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            found.add(node.module)
            # `from core import audit, db` : chaque nom est peut-être un module.
            found.update(f"{node.module}.{alias.name}" for alias in node.names)
    return found


def _opaques(path: Path) -> tuple[str, ...]:
    """Les constructions que cette analyse ne peut pas suivre.

    Une garde statique n'est vraie que si le graphe qu'elle parcourt est complet. Un
    import relatif n'est pas résolu ici, et un import calculé (`importlib.import_module`,
    `__import__`) ne l'est par personne avant l'exécution : dans les deux cas la garde
    continuerait d'afficher `SM-15 = 0` en ayant cessé de regarder.

    Le dépôt n'en contient aucun aujourd'hui. Les refuser maintenant coûte donc zéro et
    ferme le trou, là où le documenter l'aurait laissé ouvert avec une note à côté.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    trouves: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level > 0:
            trouves.append(f"import relatif ligne {node.lineno} — non résolu par cette analyse")
        elif isinstance(node, ast.Call):
            cible = node.func
            nom = (
                f"{cible.value.id}.{cible.attr}"
                if isinstance(cible, ast.Attribute) and isinstance(cible.value, ast.Name)
                else cible.id
                if isinstance(cible, ast.Name)
                else ""
            )
            if nom in ("importlib.import_module", "__import__"):
                trouves.append(
                    f"import calculé `{nom}` ligne {node.lineno} — illisible statiquement"
                )
    return tuple(trouves)


def _reseau(importes: set[str]) -> tuple[str, ...]:
    """Les imports de ce module qui donnent le moyen de sortir.

    Un import est retenu s'il *est* un module réseau ou s'il en est un sous-module :
    `urllib.request.urlopen` compte, `urllib.parse` non.
    """
    hits = {m for m in importes for net in _RESEAU if m == net or m.startswith(f"{net}.")}
    return tuple(sorted(hits))


def _closure(sources: dict[str, Path]) -> tuple[list[Violation], set[str], list[str]]:
    """Parcourt le pli depuis les adaptateurs. Rend les violations et les modules vus.

    Le parcours ne traverse **pas** les modules hors pli : ce qu'ils importent leur
    appartient, pas au pli. Traverser reviendrait à compter comme chemin de décision
    tout ce que le relais tire derrière lui.
    """
    vus: set[str] = set()
    violations: list[Violation] = []
    opaques: list[str] = []
    # file = (module, chemin depuis l'adaptateur)
    file: list[tuple[str, tuple[str, ...]]] = [(a, (a,)) for a in _ADAPTATEURS if a in sources]

    while file:
        nom, chemin = file.pop(0)
        if nom in vus:
            continue
        vus.add(nom)

        importes = _imports(sources[nom])

        # L'adaptateur agit : il sort par construction, on ne le juge pas là-dessus.
        juge = nom not in _ADAPTATEURS and nom not in _HORS_PLI
        if juge and (hits := _reseau(importes)):
            violations.append(Violation(module=nom, reseau=hits, chemin=chemin))
        if nom not in _HORS_PLI:
            opaques += [f"{nom} : {r}" for r in _opaques(sources[nom])]

        if nom in _HORS_PLI:
            continue  # hors pli : ce qu'il tire derrière lui n'est pas le chemin de décision

        for imp in sorted(importes):
            if imp in sources and imp not in vus:
                file.append((imp, (*chemin, imp)))

    return violations, vus, opaques


def audit() -> tuple[list[Violation], list[str]]:
    """Rend les violations `SM-15` et les erreurs de déclaration."""
    sources = _sources()
    erreurs = [f"adaptateur déclaré introuvable : {a}" for a in _ADAPTATEURS if a not in sources]
    erreurs += [f"module hors-pli déclaré introuvable : {m}" for m in _HORS_PLI if m not in sources]

    violations, vus, opaques = _closure(sources)
    erreurs += opaques

    # Une exemption qui ne s'applique plus est une exemption qui protège un défaut
    # futur : elle doit être retirée le jour où le module quitte le chemin, pas le
    # jour où quelqu'un s'en aperçoit.
    erreurs += [
        f"exemption périmée : {m} n'est plus atteignable depuis un adaptateur — retirez-la"
        for m in _HORS_PLI
        if m in sources and m not in vus
    ]
    return violations, erreurs


def main() -> int:
    violations, erreurs = audit()

    for e in erreurs:
        print(f"  ✗ {e}", file=sys.stderr)
    for v in violations:
        print(
            f"  ✗ {v.module} peut sortir ({', '.join(v.reseau)})\n"
            f"    chemin : {' → '.join(v.chemin)}",
            file=sys.stderr,
        )

    if violations or erreurs:
        print(
            f"\nSM-15 = {len(violations)} — le chemin de décision n'est pas hors ligne "
            "(AD-25, FR-176).\nUn contrôle du pli qui peut joindre le réseau rend la "
            "revendication de souveraineté fausse : soit le module s'en passe, soit il "
            "sort du pli et se déclare dans `_HORS_PLI` avec sa raison.",
            file=sys.stderr,
        )
        return 1

    _, vus, _ = _closure(_sources())
    print(f"SM-15 = 0 — {len(vus) - len(_HORS_PLI)} modules du pli, aucun ne peut sortir")
    print(f"  hors pli, déclarés et justifiés : {', '.join(sorted(_HORS_PLI))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

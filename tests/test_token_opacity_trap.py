"""Une opacité posée sur une couleur à jeton n'émet aucune règle CSS.

Le piège, en une phrase : `bg-brand/15` **ne produit rien**. Tailwind sait
appliquer une opacité à une couleur qu'il connaît, pas à une couleur qui vaut
`var(--copper)` — il ne peut pas décomposer un `var()` en canaux. La classe est
donc silencieusement inerte.

Silencieusement est le mot. Rien n'échoue : ni le build, ni `tsc`, ni ESLint. Le
`grep` ne trouve rien non plus, puisque le source contient bien une classe qui a
l'air juste. Le défaut ne se voit qu'à l'écran, et seulement si on sait quoi
chercher.

Il a déjà produit trois défauts distincts dans ce dépôt :

- `bg-navy/90` sur `.site-header` — l'en-tête était **entièrement transparent**.
  Invisible tant que la page restait sombre ; illisible dès la première bande
  claire ;
- `ring-brand/30` sur les pastilles de fonctionnalités — `ring-1` retombe alors
  sur la couleur par défaut de Tailwind, `rgba(59,130,246,.5)`, c'est-à-dire du
  **bleu** au milieu d'une charte cuivre. C'est ce que voyait l'opérateur ;
- `border-brand/60`, `bg-brand/15`, `border-brand/50` dans le relevé de menaces.

Les trois ont survécu à leur revue, parce que rien ne signale une règle absente.

Ce garde est un **cliquet**, pas une interdiction : cinquante occurrences
existent déjà, et les corriger toutes changerait le rendu de dix-neuf fichiers
d'un coup — un arbitrage qui revient à l'opérateur, pas à un lot de correctifs.
L'inventaire ci-dessous est donc gelé : il peut décroître, jamais croître.

Le correctif de fond, lui, est ailleurs : donner aux jetons une forme en canaux
(`--copper-c: 226 96 58`) et écrire `rgb(var(--copper-c) / <alpha-value>)` dans
`tailwind.config.ts`. Les cinquante-deux se mettraient alors à fonctionner comme
leurs auteurs le croyaient. Le jour où c'est fait, `test_the_trap_still_exists`
échoue et dit de supprimer ce fichier — un garde qui interdit un idiome devenu
valide est pire qu'inutile.
"""

from __future__ import annotations

import re
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent
_FRONT = _REPO / "frontend"

#: Les familles de couleurs que `tailwind.config.ts` fait pointer sur un `var()`.
#: Une opacité sur l'une d'elles n'émet rien ; sur `white` ou `black`, si.
_MOTIF = re.compile(
    r"\b(?:bg|text|border|ring|from|to|via|divide|outline|shadow)"
    r"-(?:brand|navy|ink|paper|accent)[a-z-]*/\d+"
)

#: Inventaire gelé, relevé sur `ae57cb4`. Une entrée peut baisser — le test dira
#: alors de la mettre à jour — mais aucune ne peut monter, et aucun fichier
#: absent d'ici ne peut en introduire.
_CONNU: dict[str, int] = {
    "app/(app)/admin/page.tsx": 1,
    "app/(app)/approvals/page.tsx": 2,
    "app/(app)/costs/page.tsx": 2,
    "app/(app)/home/page.tsx": 2,
    "app/(app)/onboarding/page.tsx": 8,
    "app/auth/reset/page.tsx": 2,
    "app/executive-preview/page.tsx": 3,
    "app/forgot-password/page.tsx": 2,
    "components/ApiKeys.tsx": 3,
    "components/AppShell.tsx": 2,
    "components/ClientScope.tsx": 3,
    "components/ClientsManager.tsx": 1,
    "components/DlpSettings.tsx": 1,
    "components/ExecutiveSummary.tsx": 6,
    "components/Loader.tsx": 3,
    "components/ProviderCredentials.tsx": 1,
    "components/ReadTokens.tsx": 3,
    "components/ThreatLedger.tsx": 2,
}


def _releve() -> dict[str, int]:
    """Occurrences par fichier, dans l'ordre des chemins."""
    trouve: dict[str, int] = {}
    for dossier in ("app", "components", "lib"):
        for fichier in sorted((_FRONT / dossier).rglob("*")):
            if fichier.suffix not in (".tsx", ".ts"):
                continue
            nombre = len(_MOTIF.findall(fichier.read_text(encoding="utf-8")))
            if nombre:
                trouve[str(fichier.relative_to(_FRONT))] = nombre
    return trouve


def test_the_trap_does_not_spread() -> None:
    """Le cliquet : aucune occurrence nouvelle, dans aucun fichier."""
    releve = _releve()
    aggravations = [
        f"{chemin} : {nombre} (connu : {_CONNU.get(chemin, 0)})"
        for chemin, nombre in sorted(releve.items())
        if nombre > _CONNU.get(chemin, 0)
    ]
    assert not aggravations, (
        "une opacité posée sur une couleur à jeton n'émet AUCUNE règle CSS — la "
        "classe ci-dessous est inerte, et pour un `ring-*` le repli est le bleu par "
        "défaut de Tailwind :\n  " + "\n  ".join(aggravations) + "\n\n"
        "  fix : écrivez la valeur explicitement, p. ex. "
        "`bg-[color:var(--copper-wash)]` ou `ring-[color:var(--copper-line)]`, "
        "en prenant un jeton qui porte déjà l'alpha voulu."
    )


def test_the_inventory_shrinks_honestly() -> None:
    """L'inverse du cliquet : une correction doit être enregistrée.

    Sans quoi l'inventaire garderait de la marge pour réintroduire en silence ce
    qu'un lot précédent avait retiré.
    """
    releve = _releve()
    perimes = [
        f"{chemin} : {_CONNU[chemin]} attendu, {releve.get(chemin, 0)} trouvé"
        for chemin in _CONNU
        if releve.get(chemin, 0) < _CONNU[chemin]
    ]
    assert not perimes, (
        "des occurrences ont été corrigées — mettez l'inventaire à jour pour que le "
        "cliquet garde sa prise :\n  " + "\n  ".join(perimes)
    )


def test_the_guard_reads_files_that_are_really_there() -> None:
    """Contrôle de non-vacuité : un garde qui ne lit rien passe toujours."""
    fichiers = [f for d in ("app", "components") for f in (_FRONT / d).rglob("*.tsx")]
    assert len(fichiers) > 20, f"arborescence front introuvable ({len(fichiers)} fichiers)"
    assert _MOTIF.search("bg-brand/15"), "le motif ne reconnaît plus le piège qu'il traque"
    assert not _MOTIF.search("bg-white/15"), (
        "le motif attrape `white`, qui n'est pas un jeton : Tailwind sait le décomposer "
        "et la règle est bien émise"
    )


def test_the_trap_still_exists() -> None:
    """Le jour où l'opacité fonctionne, ce fichier doit disparaître.

    Un garde qui interdit un idiome redevenu valide est pire qu'inutile : il
    pousse à écrire du verbeux là où le simple marcherait.
    """
    config = (_FRONT / "tailwind.config.ts").read_text(encoding="utf-8")
    assert "<alpha-value>" not in config, (
        "`tailwind.config.ts` déclare désormais `<alpha-value>` : les couleurs à jeton "
        "acceptent l'opacité, le piège n'existe plus.\n"
        "  fix : corrigez les occurrences restantes si besoin, puis SUPPRIMEZ "
        "`tests/test_token_opacity_trap.py` — il interdirait un idiome valide."
    )

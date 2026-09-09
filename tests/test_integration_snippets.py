"""`L9` — la page publique enseigne exactement ce que le client reçoit.

La section « comment ça marche » montre les extraits d'intégration à un visiteur qui n'a pas encore
de compte. L'assistant d'intégration montre les mêmes à un client qui vient de créer
son jeton. **Ce sont les mêmes**, et ce fichier tient cette propriété.

Pourquoi elle compte plus qu'il n'y paraît : une page publique qui divergerait de ce
qu'on remet réellement au client n'est pas seulement inexacte, elle **apprend à faire
ce qui ne marchera pas**. Le commentaire du bloc MCP le dit déjà pour une autre raison
— la passerelle stdio ne lit que deux variables, et en émettre une autre livre un
extrait inopérant. Deux copies de ce bloc, et l'une des deux finira par nommer une
variable que le runtime ignore.

Le garde est **structurel** plutôt que comportemental : il vérifie qu'il n'existe
qu'une définition, pas que deux définitions rendent la même chose. C'est le contrôle
le plus fort des deux, parce qu'il ferme la possibilité au lieu de constater son
absence à un instant donné.
"""

from __future__ import annotations

import re
from pathlib import Path

_RACINE = Path(__file__).resolve().parent.parent
_FRONT = _RACINE / "frontend"
_PARTAGE = _FRONT / "lib" / "integration.ts"
_PUBLIQUE = _FRONT / "components" / "Fonctionnement.tsx"
_ASSISTANT = _FRONT / "app" / "(app)" / "onboarding" / "page.tsx"

#: Les fonctions qui produisent un extrait collé par un humain dans sa configuration.
_PRODUCTEURS = ("mcpConfig", "snippet", "proxyBase")
#: Les tables dont ces fonctions se servent. Une copie divergente d'`OPENAI_STYLE` livre
#: un extrait qui nomme la mauvaise variable d'environnement, exactement comme une copie
#: divergente de `mcpConfig` — la donnée compte autant que le code qui la met en forme.
_TABLES = ("STACKS", "OPENAI_STYLE")

#: Le spécificateur du module partagé, **exact**. Une première version de ce garde
#: cherchait la sous-chaîne `@/lib/integration`, que `@/lib/integration-copie` satisfait
#: aussi : le garde passait au vert sur une page qui importait d'ailleurs. Un test qui
#: cherche une sous-chaîne teste l'orthographe, pas la propriété.
_MODULE = "@/lib/integration"


def _definitions(chemin: Path, nom: str) -> int:
    """Combien de fois ce fichier **définit** ce symbole (pas l'importe)."""
    texte = chemin.read_text(encoding="utf-8")
    motif = rf"^\s*(?:export\s+)?(?:function\s+{nom}\s*\(|const\s+{nom}\b)"
    return len(re.findall(motif, texte, re.MULTILINE))


def _liaisons_partagees(chemin: Path) -> set[str]:
    """Les symboles que ce fichier importe du module partagé, et de lui seul.

    On lit la liaison plutôt que la présence du chemin : c'est la seule lecture qui
    distingue « importe du module partagé » de « mentionne son nom ».
    """
    texte = chemin.read_text(encoding="utf-8")
    blocs = re.findall(rf'import\s*\{{([^}}]*)\}}\s*from\s*"{re.escape(_MODULE)}"\s*;', texte)
    return {
        nom.split(" as ")[-1].strip()
        for bloc in blocs
        for nom in bloc.replace("type ", "").split(",")
        if nom.strip()
    }


def _corps(chemin: Path) -> str:
    """Le fichier sans ses imports ni ses commentaires : ce qu'il *fait*."""
    brut = chemin.read_text(encoding="utf-8")
    texte = re.sub(r'import\s*\{[^}]*\}\s*from\s*"[^"]+"\s*;', "", brut)
    texte = re.sub(r"/\*.*?\*/", "", texte, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", texte)


def test_each_snippet_producer_is_defined_exactly_once_in_the_repo() -> None:
    """Une seule définition, dans le module partagé. Deux copies finiraient par diverger."""
    for nom in _PRODUCTEURS + _TABLES:
        ailleurs = [
            chemin.name for chemin in (_PUBLIQUE, _ASSISTANT) if _definitions(chemin, nom) > 0
        ]
        assert not ailleurs, f"{nom} redéfini hors du module partagé : {ailleurs}"
        assert _definitions(_PARTAGE, nom) == 1, f"{nom} n'est pas défini une fois dans le partagé"


def test_both_surfaces_take_every_producer_they_use_from_the_shared_module() -> None:
    """Importer, et non recopier : c'est ce qui rend la divergence impossible.

    Le garde ne cherche pas le chemin du module dans le fichier — sa première version le
    faisait, et passait au vert sur un import venu de `@/lib/integration-copie`, dont le
    chemin *contient* celui du module partagé. Il lit la liaison : tout producteur que la
    surface **emploie** doit venir de là, et de là seulement.
    """
    for chemin in (_PUBLIQUE, _ASSISTANT):
        liees = _liaisons_partagees(chemin)
        corps = _corps(chemin)
        employes = {nom for nom in _PRODUCTEURS + _TABLES if re.search(rf"\b{nom}\b", corps)}
        assert employes, f"{chemin.name} n'emploie aucun producteur — la surface a-t-elle bougé ?"
        orphelins = employes - liees
        assert not orphelins, (
            f"{chemin.name} emploie {sorted(orphelins)} sans les tenir de {_MODULE}"
        )


def test_the_mcp_block_names_only_the_variables_the_runtime_reads() -> None:
    """La passerelle stdio ne lit que `XSOM_TENANT_TOKEN` et `DATABASE_URL`.

    En émettre une autre livre un extrait qui ne peut pas fonctionner — et le lecteur
    n'a aucun moyen de s'en apercevoir avant que son premier appel échoue. Le
    commentaire du module le dit ; ce test l'empêche.
    """
    partage = _PARTAGE.read_text(encoding="utf-8")
    bloc = partage[partage.index("function mcpConfig") : partage.index("function snippet")]
    variables = set(re.findall(r"^\s+([A-Z][A-Z0-9_]+):", bloc, re.MULTILINE))
    assert variables == {"XSOM_TENANT_TOKEN", "DATABASE_URL"}, (
        f"le bloc MCP nomme {sorted(variables)}. La passerelle en lit deux, et un nom "
        "de plus livre un extrait inopérant."
    )

    # Et le nom que le runtime lit vraiment, vérifié contre la source du runtime plutôt
    # que contre lui-même : c'est la seule confrontation qui vaille.
    serveur = (_RACINE / "gateway" / "server.py").read_text(encoding="utf-8")
    assert "XSOM_TENANT_TOKEN" in serveur, "le runtime ne lit plus la variable que l'extrait émet"


def test_the_public_page_uses_a_placeholder_that_reads_as_one() -> None:
    """Un paramètre fictif qui ressemble à un vrai jeton finit collé tel quel.

    Le premier appel échoue alors sans que personne comprenne pourquoi, et l'extrait
    d'une page publique doit se lire comme un modèle, pas comme un secret oublié.
    """
    texte = _PUBLIQUE.read_text(encoding="utf-8")
    jetons = re.findall(r'const JETON_FICTIF = "([^"]+)"', texte)
    assert jetons, "la page ne déclare pas de jeton fictif"
    for jeton in jetons:
        assert jeton.startswith("<") and jeton.endswith(">"), (
            f"{jeton!r} ne se lit pas comme un paramètre à remplacer"
        )


def test_the_three_paths_are_presented_in_decreasing_order_of_guarantee() -> None:
    """L'ordre **est** le propos, et une page qui le perdrait vendrait la voie
    coopérative au prix de la contraignante.

    La passerelle exécute ou n'exécute pas. `/v1/authorize` rend un verdict que l'agent
    décide d'honorer. Les présenter comme équivalentes serait exactement le genre
    d'affirmation que ce produit existe pour refuser.
    """
    texte = _PUBLIQUE.read_text(encoding="utf-8")
    ordre = [texte.index(f'titre={{t("mise.{voie}.t")}}') for voie in ("mcp", "http", "proxy")]
    assert ordre == sorted(ordre), "les trois voies ne sont plus dans l'ordre de garantie"

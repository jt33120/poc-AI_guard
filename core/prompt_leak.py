"""`FR-190` — voir quand un modèle recrache son propre prompt système, verbatim.

Ce module est **pur et déterministe** : aucun import réseau, aucun appel de modèle,
donc il reste dans le pli de `scripts/audit_sovereignty.py`. C'est délibéré — il n'y
avait pas de raison d'introduire une dépendance en ligne pour une comparaison de
chaînes.

**Ce que la facette a le droit de revendiquer, et pourquoi elle est étroite.**
`M-14/prompt` est publiée `Détecté`, et son libellé dit **verbatim** parce que c'est
tout ce que ce détecteur voit. Une paraphrase lui échappe, et un client qui lirait
« détection de fuite du prompt » comprendrait beaucoup plus que ce que nous tenons.
Le mode était le bon ; c'est la phrase qu'il fallait resserrer. Un détecteur
défaisable en une reformulation reste utile — la régurgitation littérale est le mode
d'échec le plus courant, et celui qu'un modèle produit sans qu'on l'attaque — mais il
ne se vend pas pour ce qu'il n'est pas.

**Pourquoi pas `Bloqué`, et pourquoi ce n'est pas un pare-feu de prompts.** Nous
observons et nous enregistrons ; nous n'interrompons rien et nous ne réécrivons rien.
Censurer le texte d'une complétion serait de la modération de sortie, ce que le
produit n'est pas. Inspecter du contenu ne l'est pas : la DLP d'egress lit déjà le
corps sortant et peut le refuser, et le garde de taint lit déjà les résultats
d'outils. Ce que `gateway/taint.py` interdit dans sa propre docstring, c'est d'agir
sur du contenu — « it watches *actions* » — et ici rien n'agit.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

#: Longueur, en mots, d'une suite contiguë commune à partir de laquelle on parle de
#: régurgitation. Vingt-quatre mots : assez long pour qu'une citation fortuite soit
#: improbable, assez court pour attraper un paragraphe de consigne recopié.
#:
#: Un seuil plus bas produirait des signalements sur du contexte injecté (RAG,
#: extraits de documents, gabarits) qu'un modèle a parfaitement le droit de citer —
#: et `core/dlp.py` énonce déjà la règle du dépôt : un contrôle qui signale du trafic
#: légitime finit désactivé, donc ne protège plus rien.
MIN_WORDS = 24

#: La décision inscrite dans la chaîne. Un seul mot : il n'y a pas de « pas de fuite »
#: à enregistrer — l'absence d'une ligne n'atteste de rien, et une ligne par réponse
#: propre noierait le journal sous ce qui ne s'est pas produit.
DECISION = "prompt_leak_verbatim"

#: Bornes de taille sur les deux entrées. La comparaison est quadratique dans le pire
#: cas ; un prompt système de plusieurs mégaoctets ne doit pas devenir un levier de
#: latence entre les mains de la partie contrôlée.
MAX_WORDS = 4000

_WORD = re.compile(r"\w+", re.UNICODE)


def system_prompt(body: bytes) -> str | None:
    """Le prompt système de cette requête, ou ``None`` s'il n'y en a pas.

    Les deux styles, parce que les deux portes existent : `messages[]` de rôle
    `system` ou `developer` côté OpenAI, champ `system` de premier niveau côté
    Anthropic (chaîne ou liste de blocs).

    Un corps illisible rend ``None`` et non une chaîne vide : sans référence il n'y a
    pas de verdict à rendre, et inventer « rien n'a fuité » serait exactement le
    genre d'affirmation que ce lot supprime.
    """
    try:
        data: Any = json.loads(body)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None

    morceaux: list[str] = []
    for message in data.get("messages") or []:
        if not isinstance(message, dict) or message.get("role") not in ("system", "developer"):
            continue
        morceaux += _texts(message.get("content"))
    morceaux += _texts(data.get("system"))
    joint = "\n".join(m for m in morceaux if m)
    return joint or None


def completion_text(data: dict[str, Any]) -> str:
    """Le texte que le modèle a rendu, les deux styles confondus.

    Seul le texte : les appels d'outils sont le domaine de `_inspect`, qui les gate
    comme des actions. Ici on ne regarde que ce qui se lit.
    """
    morceaux: list[str] = []
    for choice in data.get("choices") or []:
        if isinstance(choice, dict):
            message = choice.get("message")
            if isinstance(message, dict):
                morceaux += _texts(message.get("content"))
    morceaux += _texts(data.get("content"))
    return "\n".join(m for m in morceaux if m)


def _texts(value: Any) -> list[str]:
    """Les chaînes portées par un `content`, qu'il soit texte ou liste de blocs."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [b["text"] for b in value if isinstance(b, dict) and isinstance(b.get("text"), str)]
    return []


def leaked_span(prompt: str, output: str, *, min_words: int = MIN_WORDS) -> int | None:
    """La longueur de la plus longue suite **contiguë** de mots commune, si elle compte.

    Contiguë, et non un recouvrement d'ensembles : deux textes du même domaine
    partagent beaucoup de mots sans que l'un cite l'autre. C'est la contiguïté qui
    distingue « le modèle parle du même sujet » de « le modèle recopie ses
    consignes », et c'est elle qui rend le détecteur utilisable plutôt que bruyant.

    La comparaison est insensible à la casse et aux espaces — recopier en changeant
    une majuscule reste recopier — mais pas à l'ordre des mots, qui *est* le signal.
    """
    a = _WORD.findall(prompt.lower())[:MAX_WORDS]
    b = _WORD.findall(output.lower())[:MAX_WORDS]
    if len(a) < min_words or len(b) < min_words:
        return None

    # Plus longue sous-suite contiguë commune, en O(n·m) espace-linéaire.
    precedent = [0] * (len(b) + 1)
    meilleur = 0
    for mot_a in a:
        courant = [0] * (len(b) + 1)
        for j, mot_b in enumerate(b, start=1):
            if mot_a == mot_b:
                courant[j] = precedent[j - 1] + 1
                meilleur = max(meilleur, courant[j])
        precedent = courant
    return meilleur if meilleur >= min_words else None


def prompt_digest(prompt: str) -> str:
    """L'empreinte du prompt système — ce qui va dans la chaîne, jamais le texte (§4.10)."""
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()

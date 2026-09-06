"""`FR-197` — le positionnement publié ne peut pas mentir plus longtemps que la carte.

`docs/product/POSITIONNEMENT.md` fonde sa proposition à deux étages sur un chiffre :
sept des neuf facettes publiées `Bloqué` ne sont prouvées que sur `mcp`. C'est
précisément le genre d'affirmation qui vieillit mal — une facette gagne un chemin
d'ingestion, le tableau du document reste, et l'argumentaire devient faux sans que
personne l'ait touché.

Ce test relie donc le document à l'artefact généré. Il n'invente aucune vérité : il
exige seulement que le document répète celle que `coverage/map.json` contient déjà.
Le jour où la répartition change, il rougit — et c'est le moment exact où la question
« la proposition à deux étages dit-elle encore la vérité ? » doit se poser.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

_RACINE = Path(__file__).resolve().parent.parent
_CARTE = _RACINE / "coverage" / "map.json"
_DOC = _RACINE / "docs" / "product" / "POSITIONNEMENT.md"


def _repartition() -> Counter[tuple[str, ...]]:
    """Les facettes publiées `Bloqué`, comptées par combinaison de chemins prouvés."""
    carte = json.loads(_CARTE.read_text(encoding="utf-8"))
    return Counter(
        tuple(sorted(f.get("ingress_prouve") or []))
        for f in carte["facettes"]
        if f["mode_publie"] == "B"
    )


def _entier_apres(motif: str, texte: str) -> int:
    """Le premier entier d'une ligne de tableau dont la première cellule vaut `motif`."""
    ligne = re.search(rf"^\|\s*{motif}\s*\|([^|]*)\|", texte, re.MULTILINE)
    assert ligne is not None, f"ligne absente du tableau : {motif}"
    nombres = re.findall(r"\d+", ligne.group(1))
    assert nombres, f"aucun chiffre sur la ligne {motif}"
    return int(nombres[0])


def test_the_two_tier_table_matches_the_generated_map() -> None:
    """Le tableau du §1 est une lecture de la carte, pas une affirmation parallèle."""
    doc = _DOC.read_text(encoding="utf-8")
    repartition = _repartition()

    assert _entier_apres(r"`mcp` seul", doc) == repartition[("mcp",)]
    assert _entier_apres(r"`http` \+ `mcp`", doc) == repartition[("http", "mcp")]
    assert _entier_apres(r"`llm_proxy` seul", doc) == repartition[("llm_proxy",)]


def test_the_prose_figure_matches_the_table() -> None:
    """« Sept sur neuf » est écrit en toutes lettres : ce chiffre-là aussi vieillit."""
    doc = _DOC.read_text(encoding="utf-8")
    repartition = _repartition()
    mcp_seul = repartition[("mcp",)]
    total = sum(repartition.values())

    mots = {
        1: "Une",
        2: "Deux",
        3: "Trois",
        4: "Quatre",
        5: "Cinq",
        6: "Six",
        7: "Sept",
        8: "Huit",
        9: "Neuf",
        10: "Dix",
    }
    attendu = f"{mots[mcp_seul]} revendications de blocage sur {mots[total].lower()}"
    assert attendu in doc, (
        f"la phrase du §1 ne dit plus ce que la carte contient ; attendu : {attendu!r}"
    )


def test_every_named_alternative_family_carries_both_columns() -> None:
    """`EXH-9` demandait où nous gagnons **et** où nous perdons.

    Une table d'alternatives dont une ligne ne dit que le mal qu'on en pense est un
    argumentaire, pas un positionnement — et c'est ce que la revue reprochait au plan.
    """
    doc = _DOC.read_text(encoding="utf-8")
    section = doc.split("## 3. Les alternatives, nommées")[1].split("## 4.")[0]
    lignes = [
        ligne
        for ligne in section.splitlines()
        if ligne.startswith("| **") and ligne.count("|") >= 4
    ]
    assert len(lignes) == 5, "les cinq familles d'alternatives de `EXH-9` doivent être nommées"
    for ligne in lignes:
        cellules = [c.strip() for c in ligne.strip("|").split("|")]
        assert cellules[1], f"aucun « ce qu'elle fait mieux » sur : {cellules[0]}"
        assert cellules[2], f"aucun « ce qu'elle ne fait pas » sur : {cellules[0]}"


def test_the_published_cost_table_matches_the_measured_registry() -> None:
    """Le chiffre de surcoût est une lecture de `perf/overhead.json`, pas une phrase.

    Ce test remplace celui qui tenait l'abstention tant qu'aucun banc n'existait. Le
    banc existe maintenant, donc l'obligation change de nature : il ne s'agit plus de
    déclarer l'écart, mais d'empêcher le chiffre publié de vieillir en silence. Même
    règle que le tableau du §1, pour la même raison.
    """
    doc = _DOC.read_text(encoding="utf-8")
    registre = json.loads((_RACINE / "perf" / "overhead.json").read_text(encoding="utf-8"))

    libelles = {
        "MCP — appel autorisé": "mcp.autorise",
        "MCP — appel refusé": "mcp.refuse",
        "MCP — première mise en attente": "mcp.premiere_attente",
        r"`POST /v1/authorize` — autorisé": "http.autorise",
        r"`POST /v1/authorize` — refusé": "http.refuse",
    }
    for libelle, cle in libelles.items():
        ligne = re.search(rf"^\|\s*{re.escape(libelle)}\s*\|([^|]*)\|([^|]*)\|", doc, re.MULTILINE)
        assert ligne is not None, f"ligne absente du tableau de coût : {libelle}"
        attendu = registre["chemins"][cle]
        assert int(ligne.group(1).strip()) == attendu["connexions_postgres"], libelle
        assert int(ligne.group(2).strip()) == attendu["allers_retours_sql"], libelle


def test_no_latency_figure_is_published() -> None:
    """La règle qui a produit tout le reste : ne pas dire plus que ce qu'on prouve.

    Le registre est en entiers parce qu'un p95 mesuré sur un exécuteur partagé avec
    `fsync=off` n'est pas un engagement. Le document doit continuer à le dire — le
    jour où quelqu'un y écrit une milliseconde, c'est cette phrase qui doit tomber
    d'abord, consciemment.
    """
    doc = _DOC.read_text(encoding="utf-8")
    assert "n'en publie pas" in doc, (
        "le §5 doit continuer à dire pourquoi il ne publie pas de latence"
    )
    assert "fsync=off" in doc, "la raison doit rester lisible, pas seulement l'abstention"

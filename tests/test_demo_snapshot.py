"""`L8` — l'instantané du tenant de démonstration, capturé plutôt qu'inventé.

`/executive-preview` affiche aujourd'hui des chiffres **écrits à la main** :
`{governed: 8, allow: 124, review: 37, block: 9}`. C'est exactement le défaut que
`L0` a retiré du héros et que `L4` interdit désormais dans la copie — sur une page
publique, une KPI inventée est une affirmation sans preuve, quel que soit son air de
plausibilité.

Ce fichier capture, pendant la suite, la lecture **réelle** du tenant de démonstration
semé depuis `demo/seed.yaml` : une fixture committée, relisible, entièrement fabriquée,
et dont un garde de CI vérifie avec les détecteurs du produit qu'elle ne contient aucune
forme de PII réelle (`AD-31`). Publier ce qu'elle produit est donc sûr **par
construction**, et vérifiable en lisant un diff.

**Deux écrans, pas quatre.** Le plan en annonçait quatre. Mesure faite, la fixture n'en
alimente que deux honnêtement :

* la table `approvals` est **vide** — `seed_demo.py` n'écrit aucune demande
  d'approbation, les `hitl_pending` de la fixture sont des entrées d'audit. Et il y a
  une raison de fond de ne pas en fabriquer : dans un instantané figé et daté, une
  approbation « en attente » se lit « personne n'a jamais répondu », ce qui décrit
  l'inverse du mécanisme qu'on veut montrer. Une file est vivante ou n'est pas ;
* `usage_events` est vide, donc aucune dépense à afficher ;
* l'inspecteur montrerait les mêmes appels que l'explorateur d'audit.

La synthèse dirigeant et l'explorateur d'audit, eux, sont *nativement* de forme
instantané : ce sont des lectures d'un état à une date.

**Les horodatages sont publiés en jours relatifs.** `payload_v1` date chaque entrée à
l'exécution, si bien qu'un artefact portant des dates absolues changerait à chaque
capture et ne pourrait jamais passer un gate d'égalité. La même contrainte qu'en `L6`,
et la même réponse : publier ce qui est stable.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg
import yaml

from core import audit
from scripts import seed_demo
from tests.conftest import DBHandle

_REPO = Path(__file__).resolve().parents[1]
_SORTIE = _REPO / "coverage" / ".demo_snapshot.json"
_FIXTURE = _REPO / "demo" / "seed.yaml"


def _outils_declares() -> int:
    """Les outils que la policy de démonstration gouverne.

    C'est le chiffre que la console appelle « actions sous gouvernance » : elle le tire
    de `GET /v1/tools`, qui liste la policy. Le lire ici depuis la même policy évite
    d'en inventer un second.
    """
    fixture = yaml.safe_load(_FIXTURE.read_text(encoding="utf-8"))
    policy = yaml.safe_load(fixture["policy"])
    return len(policy["tools"])


def _lignes_audit(conn: psycopg.Connection, tenant_id: str) -> list[dict[str, Any]]:
    """Le journal du tenant, en jours relatifs et sans ce qui ne se publie pas.

    Écartés : `tenant_id` et `user_id` (identités), `latency_ms` (que
    `perf/overhead.json` refuse de publier), `prev_hash` et `entry_hash` (qui changent
    à chaque capture, `payload_v1` hachant l'horodatage).
    """
    maintenant = datetime.now(UTC)
    rows = conn.execute(
        "select ts, tool_name, action_class, decision, policy_rule_id, error "
        "from audit_log where tenant_id = %s order by ts, id",
        (tenant_id,),
    ).fetchall()
    return [
        {
            # Jours **relatifs** : stable d'une capture à l'autre, et c'est la seule
            # information que le lecteur utilise réellement — « il y a huit jours »,
            # pas une date qui serait celle du dernier passage de la CI.
            "jours": (maintenant - r[0]).days,
            "outil": r[1],
            "classe": r[2],
            "decision": r[3],
            "regle": r[4],
            "raison": r[5],
        }
        for r in rows
    ]


def test_capture_the_demonstration_tenant_snapshot(db: DBHandle) -> None:
    """Semer, relire, écrire l'instantané. C'est une capture, pas une assertion.

    Les propriétés du tenant lui-même sont tenues par `tests/test_demo_seed.py` : ici
    on vérifie seulement que ce qu'on s'apprête à publier est cohérent, puis on l'écrit.
    """
    ecrit = seed_demo.seed(db.url, env="dev")
    tenant_id = str(ecrit["tenant_id"])

    # La chaîne d'abord : publier un instantané d'un journal qui ne se vérifie pas
    # reviendrait à montrer une preuve cassée en guise de preuve.
    chaine = audit.verify_chain(db.conn, tenant_id)
    assert chaine.ok, "la chaîne du tenant de démonstration ne se vérifie pas"

    lignes = _lignes_audit(db.conn, tenant_id)
    assert len(lignes) == ecrit["events"], "toutes les entrées ne sont pas relues"
    assert lignes, "instantané vide"

    fixture = yaml.safe_load(_FIXTURE.read_text(encoding="utf-8"))
    instantane = {
        "tenant": fixture["tenant"]["name"],
        "outils": _outils_declares(),
        "entrees": len(lignes),
        "chainee": chaine.ok,
        "jours_couverts": max(e["jours"] for e in lignes) + 1,
        "decisions": dict(sorted(Counter(e["decision"] for e in lignes).items())),
        "classes": dict(sorted(Counter(e["classe"] for e in lignes).items())),
        "journal": lignes,
    }
    _SORTIE.parent.mkdir(parents=True, exist_ok=True)
    _SORTIE.write_text(
        json.dumps(instantane, indent=2, ensure_ascii=False, sort_keys=True), encoding="utf-8"
    )


def test_the_snapshot_never_carries_an_identity_or_a_latency(db: DBHandle) -> None:
    """Ce que la capture ne doit jamais emporter vers une page publique.

    La fixture est fabriquée et gardée contre les formes de PII réelles (`AD-31`), donc
    son contenu est publiable. Ce test ferme l'autre moitié : les colonnes qui ne
    doivent pas sortir, quelle que soit la fixture.
    """
    ecrit = seed_demo.seed(db.url, env="dev")
    lignes = _lignes_audit(db.conn, str(ecrit["tenant_id"]))
    champs = set().union(*(set(e) for e in lignes))
    assert champs == {"jours", "outil", "classe", "decision", "regle", "raison"}
    for interdit in ("tenant_id", "user_id", "latency_ms", "entry_hash", "prev_hash", "ts"):
        assert interdit not in champs

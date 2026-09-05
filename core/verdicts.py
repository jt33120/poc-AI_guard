"""`FR-191` — recevoir le verdict d'un analyseur tiers, et le rendre inaltérable.

Le produit ne lance pas l'analyseur et ne rejuge pas sa sortie. Il en reçoit le reçu,
le date, en calcule l'empreinte canonique et la chaîne. C'est la totalité de ce que le
mode `Orchestré` promet — « un contrôle tiers fait le travail ; xSOM collecte son
verdict et le chaîne » — et c'est la limite à ne pas franchir : écrire notre propre
analyseur reviendrait à construire le contrôle, ce que le produit n'est pas.

Ce qui est attesté n'est donc pas « le code est sain ». C'est « ce reçu-là nous est
parvenu à cet instant-là, et il n'a pas changé depuis ».

**Pourquoi une seconde chaîne plutôt qu'une ligne dans `audit_log`.** Le journal
d'audit est la chaîne du plan de données : une décision par appel d'outil, une charge
figée à douze clés (`FR-171`), une porte d'ingestion parmi trois — un verdict de CI
n'est aucune de ces choses. `FR-163` vient précisément d'établir qu'on n'y range pas ce
qui n'y appartient pas, et l'y ranger un commit plus tard aurait été incohérent. Ce qui
est partagé, c'est la **primitive** (`audit.compute_entry_hash`, `audit.ChainResult`),
parce que deux implémentations du même hachage finissent par diverger — et deux formes
de résultat pour la même question produiraient deux lectures de « intacte ».
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import psycopg

from core import audit

#: Au-delà, le reçu n'est plus un reçu. La borne vaut pour les champs libres qui
#: viennent du client, dans le même esprit que `audit.MAX_FIELD`.
MAX_FIELD = 200

#: L'horizon au-delà duquel un verdict cesse de dire quelque chose d'utile. Même
#: raisonnement que `corpora.REVIEW_HORIZON_DAYS` : une analyse passée une fois puis
#: jamais rejouée atteste d'un état du code qui n'existe plus.
STALE_AFTER_DAYS = 90


class DuplicateReceipt(Exception):
    """Ce reçu a déjà été ingéré.

    Une erreur plutôt qu'un `on conflict do nothing` : sur une table append-only,
    « déjà reçu » et « reçu deux fois » ne sont pas la même chose pour qui relit la
    chaîne, et avaler le conflit rendrait un `entry_hash` calculé pour une ligne qui
    n'a pas été écrite.
    """


@dataclass(frozen=True, slots=True)
class Receipt:
    """Le reçu d'un analyseur, tel que le client le déclare."""

    analyzer: str
    analyzer_version: str
    ruleset: str
    repository: str
    commit_sha: str
    verdict: str
    findings: dict[str, int]
    ran_at: datetime


def receipt_digest(receipt: Receipt) -> str:
    """L'empreinte canonique du reçu — ce qui entre dans la chaîne.

    Mêmes règles de sérialisation que la charge d'audit (`sort_keys`, séparateurs
    compacts, horodatage `astimezone(UTC).isoformat()`), pour la même raison :
    l'empreinte doit être recalculable par quelqu'un qui n'a que le reçu et le
    document de format. Une seconde convention de sérialisation dans le produit
    finirait par diverger de la première.
    """
    canonical = json.dumps(
        {
            "analyzer": receipt.analyzer,
            "analyzer_version": receipt.analyzer_version,
            "ruleset": receipt.ruleset,
            "repository": receipt.repository,
            "commit_sha": receipt.commit_sha,
            "verdict": receipt.verdict,
            "findings": receipt.findings,
            "ran_at": audit.canonical_ts(receipt.ran_at),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def ingest(conn: psycopg.Connection, *, tenant_id: str, receipt: Receipt) -> str:
    """Enregistrer un reçu, chaîné à celui qui le précède. Retourne son `entry_hash`.

    Le chaînage est sérialisé par tenant avec le même verrou consultatif que le
    journal d'audit : deux reçus qui partageraient un `prev_hash` casseraient la
    chaîne sans que personne l'ait modifiée.
    """
    digest = receipt_digest(receipt)
    with conn.transaction():
        conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"verdicts:{tenant_id}",))
        prev_row = conn.execute(
            "select entry_hash from third_party_verdicts where tenant_id = %s "
            "order by id desc limit 1",
            (tenant_id,),
        ).fetchone()
        prev_hash = prev_row[0] if prev_row else audit.GENESIS
        entry_hash = audit.compute_entry_hash(prev_hash, digest)
        inserted = conn.execute(
            "insert into third_party_verdicts (tenant_id, analyzer, analyzer_version, ruleset, "
            " repository, commit_sha, verdict, findings, ran_at, receipt_digest, "
            " prev_hash, entry_hash) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "on conflict (tenant_id, analyzer, repository, commit_sha, ran_at) "
            "do nothing returning id",
            (
                tenant_id,
                _bounded(receipt.analyzer),
                _bounded(receipt.analyzer_version),
                _bounded(receipt.ruleset),
                _bounded(receipt.repository),
                _bounded(receipt.commit_sha),
                receipt.verdict,
                json.dumps(receipt.findings, sort_keys=True),
                receipt.ran_at,
                digest,
                prev_hash,
                entry_hash,
            ),
        ).fetchone()
        if inserted is None:
            raise DuplicateReceipt
    return entry_hash


def _bounded(value: str) -> str:
    """Borner un champ libre venu du client, comme `core.audit` borne les siens.

    La table est append-only : ce qui y entre ne se corrige pas, donc rien
    d'illimité ne doit pouvoir y entrer (`FR-163`, appliqué ici pour la même raison).
    """
    return value if len(value) <= MAX_FIELD else value[: MAX_FIELD - 1] + "\u2026"


def verify_chain(conn: psycopg.Connection, tenant_id: str) -> audit.ChainResult:
    """Recalculer la chaîne des reçus. Même contrat que `audit.verify_chain`.

    Réutiliser `ChainResult` n'est pas de l'économie : c'est ce qui garantit qu'un
    lecteur — console, Evidence Pack, vérificateur — interprète les deux chaînes de la
    même façon. Deux formes de résultat pour la même question produiraient deux
    lectures de « intacte ».
    """
    rows = conn.execute(
        "select id, receipt_digest, prev_hash, entry_hash from third_party_verdicts "
        "where tenant_id = %s order by id",
        (tenant_id,),
    ).fetchall()
    prev = audit.GENESIS
    for row_id, digest, stored_prev, stored_hash in rows:
        if stored_prev != prev or audit.compute_entry_hash(prev, digest) != stored_hash:
            return audit.ChainResult(ok=False, broken_id=row_id, count=len(rows))
        prev = stored_hash
    return audit.ChainResult(ok=True, count=len(rows))


def provenance_section(conn: psycopg.Connection) -> dict[str, Any]:
    """Le bloc que l'Evidence Pack publie pour les verdicts tiers.

    Il porte le compte **et** la péremption, pour la raison que `corpora` a établie :
    publier « 4 analyseurs ingérés » sans dire que trois n'ont pas tourné depuis six
    mois transformerait une attestation en argument.

    Il nomme aussi les analyseurs. Une facette `Attesté` adossée à cette section dit
    « la mesure existe chez vous » ; un lecteur doit pouvoir voir *laquelle*.
    """
    rows = conn.execute(
        "select analyzer, max(ran_at), count(*), "
        " count(*) filter (where verdict = 'fail') "
        "from third_party_verdicts group by analyzer order by analyzer"
    ).fetchall()
    now = datetime.now(UTC)
    par_analyseur = []
    stale = 0
    for analyzer, dernier, total, echecs in rows:
        age = (now - dernier).days
        perime = age > STALE_AFTER_DAYS
        stale += 1 if perime else 0
        par_analyseur.append(
            {
                "analyzer": analyzer,
                "last_run_days_ago": age,
                "stale": perime,
                "receipts": int(total),
                "failing": int(echecs),
            }
        )
    return {
        "analyzers": len(par_analyseur),
        "stale_horizon_days": STALE_AFTER_DAYS,
        "stale": stale,
        "by_analyzer": par_analyseur,
        # Ce que ce bloc n'est pas, dit dans le bloc : une phrase qui voyage avec la
        # donnée ne peut pas être perdue en la citant.
        "basis": (
            "Verdicts produits par les analyseurs du client, reçus et horodatés par "
            "xSOM, dont l'empreinte est chaînée dans le journal inaltérable. xSOM "
            "n'exécute pas ces analyseurs et ne rejuge pas leurs conclusions."
        ),
    }

"""`FR-189` — dériver l'inventaire du Shadow AI, sans jamais devenir le SOC du client.

C'est le FR du lot qui passe le plus près d'un non-objectif, et la frontière mérite
d'être écrite avant le code.

**« Elle ne traite pas les menaces du plan endpoint, mail et poste de travail. Elles
appartiennent au SOC du client » (PRD §4).** Un journal d'egress *est* un artefact du
SOC. Ce qui nous en sépare : xSOM ne collecte pas, ne branche aucun capteur, n'écoute
aucun réseau, ne va rien chercher. Il **reçoit** un extrait déjà produit, déposé
explicitement, sur une fenêtre datée, et en dérive une déclaration.

Le franchissement se reconnaîtrait à trois signes, et le découpage les ferme tous les
trois : un connecteur vers un proxy web ou un pare-feu, une tâche périodique de
récupération, ou une route qui accepte le fichier brut. Ici le parsing vit **côté
client** (la commande CLI lit le fichier sur son poste) et seul l'**inventaire dérivé**
— des comptes par service, sans une ligne de journal — traverse le réseau. Le jour où
l'un de ces trois signes apparaît, nous sommes devenus le CASB que `FR-178` a refusé,
et la ligne devrait *redescendre*, pas monter.

**« Elle ne devient pas un produit DLP » (PRD §4).** Corollaire dur et testable : rien
de ce qui entre ne porte de contenu. Hôte, volume, période, acteur haché — jamais
d'URL, de query string ni d'identifiant en clair. Une ligne qui en porte est
**rejetée**, pas tronquée : tronquer, c'est accepter d'avoir lu.

**« anomaly detection ML » (`CLAUDE.md` §2, HORS).** Le tri est déterministe, contre un
catalogue fermé. Aucun score, aucun modèle, aucun seuil appris.

Le mode publié est `Attesté`, et c'est `QO-3` qui l'a tranché : sans substitut souverain
crédible — le marché CASB est intégralement hors UE et ce sont des services qui voient
tout le trafic — la règle de `FR-178` s'applique et la ligne descend d'`Orchestré` à
`Attesté`. Nous n'orchestrons personne ; nous rendons une déclaration auditable.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - le module reste pur ; psycopg n'est qu'un type
    import psycopg

#: Suffixe d'hôte -> nom du service. Table **fermée et dans le module**, pas un réglage.
#:
#: Un catalogue que le client édite n'atteste rien : il attesterait de ce que le client
#: a bien voulu y mettre. Même raisonnement que `REVIEW_HORIZON_DAYS` dans
#: `core/corpora.py` — la valeur qui donne son sens à une déclaration ne peut pas être
#: choisie par celui qui déclare.
KNOWN_AI_HOSTS: dict[str, str] = {
    "api.openai.com": "OpenAI",
    "chat.openai.com": "ChatGPT",
    "chatgpt.com": "ChatGPT",
    "api.anthropic.com": "Anthropic",
    "claude.ai": "Claude",
    "generativelanguage.googleapis.com": "Google Gemini",
    "gemini.google.com": "Google Gemini",
    "api.mistral.ai": "Mistral",
    "chat.mistral.ai": "Mistral",
    "api.cohere.ai": "Cohere",
    "api.together.xyz": "Together",
    "openrouter.ai": "OpenRouter",
    "api.perplexity.ai": "Perplexity",
    "api.groq.com": "Groq",
    "api.deepseek.com": "DeepSeek",
    "huggingface.co": "Hugging Face",
    "api-inference.huggingface.co": "Hugging Face",
    "copilot.microsoft.com": "Microsoft Copilot",
    "githubcopilot.com": "GitHub Copilot",
}

#: Un hôte, et rien d'autre. Ce motif est la frontière DLP tenue **à l'entrée** : il ne
#: reconnaît ni chemin, ni query string, ni port, ni identifiant.
_HOST = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$")

#: Une empreinte d'acteur, telle que le client la produit. Jamais un identifiant en
#: clair : l'inventaire dit « combien de postes », pas « lesquels ».
_HASH = re.compile(r"^[0-9a-f]{16,64}$")


@dataclass(frozen=True, slots=True)
class Observation:
    """Une ligne d'extrait, déjà normalisée par le client."""

    host: str
    requests: int
    actor_hash: str


@dataclass(frozen=True, slots=True)
class Inventory:
    """L'inventaire dérivé — ce qui traverse le réseau, et rien d'autre."""

    #: service reconnu -> nombre d'acteurs distincts, pour les hôtes supervisés
    supervised: dict[str, int]
    #: idem, pour les usages d'IA que rien ne supervise
    shadow: dict[str, int]
    #: hôtes que le catalogue ne connaît pas : **comptés**, jamais devinés
    unclassified: int
    #: lignes refusées à l'entrée, comptées elles aussi
    rejected: int

    @property
    def shadow_actors(self) -> int:
        return sum(self.shadow.values())


def parse_observations(lines: list[str]) -> tuple[list[Observation], int]:
    """Lire un extrait `host,requests,actor_hash`. Rend les lignes lues et les rejets.

    Les rejets sont **comptés et rendus**, jamais silencieux : un inventaire dérivé
    d'un extrait à moitié illisible, présenté comme complet, serait pire que pas
    d'inventaire. Même règle que `core/otlp_genai.py`.

    Une ligne portant autre chose qu'un hôte — un chemin, une query string, un
    identifiant en clair — est **rejetée et non tronquée**. Tronquer supposerait de
    l'avoir lue, et la frontière DLP se tient à l'entrée.
    """
    observations: list[Observation] = []
    rejets = 0
    for ligne in lines:
        champs = [c.strip() for c in ligne.split(",")]
        if len(champs) != 3:
            rejets += 1
            continue
        host, brut, actor = champs
        if not _HOST.match(host.lower()) or not _HASH.match(actor.lower()):
            rejets += 1
            continue
        try:
            requests = int(brut)
        except ValueError:
            rejets += 1
            continue
        if requests < 0:
            rejets += 1
            continue
        observations.append(
            Observation(host=host.lower(), requests=requests, actor_hash=actor.lower())
        )
    return observations, rejets


def service_for(host: str) -> str | None:
    """Le service d'IA connu derrière cet hôte, ou ``None``.

    Comparaison par suffixe de **label**, pas par sous-chaîne : `notopenai.com` ne doit
    pas passer pour OpenAI, et `eu.api.openai.com` doit y passer.
    """
    host = host.lower()
    for suffixe, nom in KNOWN_AI_HOSTS.items():
        if host == suffixe or host.endswith("." + suffixe):
            return nom
    return None


def classify(
    observations: list[Observation], *, supervised_hosts: frozenset[str], rejected: int = 0
) -> Inventory:
    """Trier les observations en supervisé / shadow / non classé.

    **Fail-closed** : un service d'IA reconnu dont on ne peut pas établir la
    supervision tombe en `shadow`, jamais en `supervise`. Se tromper dans ce sens fait
    apparaître un usage qui était peut-être déjà couvert ; se tromper dans l'autre
    ferait disparaître de l'inventaire exactement ce qu'il existe pour montrer.

    Les hôtes que le catalogue ne connaît pas sont **comptés à part**. Les ranger en
    « pas de l'IA » serait une affirmation que rien n'appuie ; les compter dit au
    lecteur ce que l'inventaire n'a pas su lire.
    """
    supervise: dict[str, set[str]] = {}
    shadow: dict[str, set[str]] = {}
    inconnus: set[str] = set()
    for obs in observations:
        service = service_for(obs.host)
        if service is None:
            inconnus.add(obs.host)
            continue
        seau = supervise if obs.host in supervised_hosts else shadow
        seau.setdefault(service, set()).add(obs.actor_hash)
    return Inventory(
        supervised={k: len(v) for k, v in sorted(supervise.items())},
        shadow={k: len(v) for k, v in sorted(shadow.items())},
        unclassified=len(inconnus),
        rejected=rejected,
    )


def declare(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    window_start: datetime,
    window_end: datetime,
    inventory: Inventory,
    declared_by: str | None = None,
) -> None:
    """Enregistrer l'inventaire dérivé de ce tenant, en remplaçant le précédent.

    `PUT` et non `POST` : la ressource est « l'inventaire courant de ce tenant », et
    elle a une valeur, pas un historique. L'historique appartient au journal d'audit —
    même découpage que `corpora`.
    """
    conn.execute(
        "insert into shadow_ai_inventory "
        " (tenant_id, window_start, window_end, inventory, declared_by) "
        "values (%s, %s, %s, %s, %s) "
        "on conflict (tenant_id) do update set "
        " window_start = excluded.window_start, window_end = excluded.window_end, "
        " inventory = excluded.inventory, declared_at = now(), "
        " declared_by = excluded.declared_by",
        (
            tenant_id,
            window_start,
            window_end,
            json.dumps(
                {
                    "supervised": inventory.supervised,
                    "shadow": inventory.shadow,
                    "unclassified": inventory.unclassified,
                    "rejected": inventory.rejected,
                },
                sort_keys=True,
            ),
            declared_by,
        ),
    )


def current(conn: psycopg.Connection) -> tuple[Inventory, str] | None:
    """L'inventaire courant et sa fenêtre, ou ``None`` si rien n'a été déposé."""
    row = conn.execute(
        "select inventory, window_start, window_end from shadow_ai_inventory"
    ).fetchone()
    if row is None:
        return None
    data = row[0]
    inventory = Inventory(
        supervised=dict(data.get("supervised") or {}),
        shadow=dict(data.get("shadow") or {}),
        unclassified=int(data.get("unclassified") or 0),
        rejected=int(data.get("rejected") or 0),
    )
    return inventory, f"{row[1].date().isoformat()} → {row[2].date().isoformat()}"


def attestation_section(
    inventory: Inventory | None, *, window: str | None = None
) -> dict[str, Any]:
    """Le bloc que l'Evidence Pack publie (`M-10/decouverte`, mode `Attesté`).

    Un inventaire absent est publié comme absent : `declared: false`. Le silence
    ressemblerait à « aucun Shadow AI », ce qui est la lecture inverse de la vérité.
    """
    if inventory is None:
        return {
            "declared": False,
            "basis": (
                "Aucun inventaire déposé. L'absence de déclaration n'est pas une "
                "absence de Shadow AI."
            ),
        }
    return {
        "declared": True,
        "window": window,
        "supervised_services": inventory.supervised,
        "shadow_services": inventory.shadow,
        "shadow_actors": inventory.shadow_actors,
        "unclassified_hosts": inventory.unclassified,
        "rejected_lines": inventory.rejected,
        "basis": (
            "Dérivé d'un extrait de journaux d'egress fourni par l'exploitant et "
            "classé contre un catalogue fermé. xSOM ne collecte aucun trafic, ne "
            "branche aucun capteur, et ne reçoit aucune ligne de journal : seul cet "
            "inventaire agrégé lui parvient."
        ),
    }

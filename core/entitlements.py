"""La gamme libre-service : ce qu'un palier accorde, et ce qu'il plafonne.

Trois paliers fermés — `free`, `pro`, `entreprise` — et **aucun second moteur de
policy**. Le contrôle commercial s'applique *après* le verdict de sécurité, comme
filtre de durcissement : il peut refuser une fonctionnalité ou resserrer une
autorisation, jamais en accorder une. C'est ce qui permet de le brancher sans
rouvrir `core/policy.py`.

**Une capacité est une ligne présente.** Pas de colonne `enabled` qu'on puisse
laisser à `false` en croyant avoir accordé, ni passer à `true` par un accident de
seed : l'absence est le refus (§4.4). Et la clé étrangère vers `capability_catalog`
ferme la faute de frappe **à l'écriture** — `('pro','judgee')` serait sinon accepté
par la base, et produirait un 402 permanent sur une fonctionnalité vendue, découvert
par un appel client.

**Ce que la gamme ne fait jamais.** `mcp_gateway_enabled` (`0027`) reste hors de tout
palier : la passerelle demande une installation chez le client, elle ne se vend pas
au clic. Et `authorize`, `audit_chain`, `hitl_single`, `policy_edit` sont dans les
**trois** paliers — §4.1 et §4.2 ne se vendent pas non plus. `PLANCHER` grave cette
ligne rouge, et un test la fait respecter : le jour où quelqu'un proposera de mettre
le HITL en `pro` « parce que ça fera vendre », l'architecture ne dira pas non toute
seule.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import StrEnum
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - psycopg n'est qu'un type ici
    import psycopg


class Capability(StrEnum):
    """Miroir de `capability_catalog`. `tests/test_entitlements.py` les confronte."""

    authorize = "authorize"
    audit_chain = "audit_chain"
    audit_export_raw = "audit_export_raw"
    llm_proxy = "llm_proxy"
    hitl_single = "hitl_single"
    policy_edit = "policy_edit"
    judge = "judge"
    policy_assistant = "policy_assistant"
    dlp = "dlp"
    prompt_guard = "prompt_guard"
    risk_bands = "risk_bands"
    hitl_dual = "hitl_dual"
    taint_guard = "taint_guard"
    integrity = "integrity"
    monitor_windows = "monitor_windows"
    clients = "clients"
    read_tokens = "read_tokens"
    promotion = "promotion"
    compliance_pack = "compliance_pack"
    notify = "notify"
    sso_federation = "sso_federation"
    shadow_ai = "shadow_ai"
    corpora = "corpora"
    third_party_verdicts = "third_party_verdicts"
    fria = "fria"
    quota_override = "quota_override"
    control_plane_export = "control_plane_export"
    usage_billing = "usage_billing"
    credentials = "credentials"
    agents_inventory = "agents_inventory"
    triage = "triage"
    profiles = "profiles"
    verdicts_ingest = "verdicts_ingest"
    dlp_config = "dlp_config"
    ai_summary = "ai_summary"
    monitor_admin = "monitor_admin"
    integrity_admin = "integrity_admin"


class Metric(StrEnum):
    """Miroir de `metric_catalog`."""

    decisions = "decisions"
    proxy_calls = "proxy_calls"
    judge_calls = "judge_calls"
    export_jobs = "export_jobs"
    agents = "agents"
    seats = "seats"
    clients = "clients"
    downstream_servers = "downstream_servers"
    authorize_rpm = "authorize_rpm"
    proxy_rpm = "proxy_rpm"


class Meter(StrEnum):
    """L'état d'une métrique face à son plafond.

    `unknown` est un état à part entière et **pas** un `ok` par défaut : ne pas
    pouvoir lire un compteur n'est pas la même chose que de le savoir sous le
    plafond. L'appelant décide de la direction d'échec pour la classe d'action qu'il
    a en main, ce qu'il ne pourrait pas faire depuis ici.
    """

    ok = "ok"
    grace = "grace"
    capped = "capped"
    unknown = "unknown"


#: Les capacités que **tous** les paliers portent, y compris `free`.
#:
#: §4.1 (HITL garanti) et §4.2 (le journal prouve) ne sont pas des options
#: commerciales. Un produit qui vend le contrôle des actions ne peut pas facturer le
#: fait de tenir un humain dans la boucle, ni celui d'écrire ce qu'il a fait — ce
#: serait vendre la garantie et livrer le risque.
#:
#: Cette constante existe pour être **exécutée** par un test, pas pour être lue :
#: c'est la seule forme d'une ligne rouge qui survive à la pression commerciale.
PLANCHER: frozenset[Capability] = frozenset(
    {
        Capability.authorize,
        Capability.audit_chain,
        Capability.hitl_single,
        Capability.policy_edit,
    }
)


@dataclass(frozen=True)
class Limite:
    """Un plafond, et la tolérance au-dessus avant de resserrer."""

    valeur: int
    grace_pct: int = 0

    @property
    def plafond_avec_grace(self) -> int:
        return self.valeur + (self.valeur * self.grace_pct) // 100


@dataclass(frozen=True)
class Entitlement:
    """Ce qu'un tenant a le droit de faire, et jusqu'où."""

    plan: str
    capabilities: frozenset[Capability]
    limites: dict[Metric, Limite]

    def allows(self, capability: Capability) -> bool:
        return capability in self.capabilities

    def limite(self, metric: Metric) -> Limite | None:
        return self.limites.get(metric)


#: Le repli, et il n'est **pas** `free`.
#:
#: C'est le point délicat de tout ce module. Un tenant dont on ne sait rien n'est pas
#: un tenant en découverte : retomber sur `free` accorderait neuf capacités sur la foi
#: d'une lecture ratée, d'un identifiant inconnu ou d'un palier vidé par erreur. Un
#: palier inconnu n'accorde rien, et le nom `unknown` le dit à qui lit la trace.
AUCUNE = Entitlement(plan="unknown", capabilities=frozenset(), limites={})


def load_entitlement(conn: psycopg.Connection, tenant_id: str) -> Entitlement:
    """Charger le droit d'un tenant. Ne lève pas : un doute rend `AUCUNE`.

    Le `left join` des overrides **part de `plan_limits`** et non l'inverse : un
    override sur une métrique que le palier ne définit pas reste invisible — sinon un
    quota négocié pourrait faire apparaître une métrique que le produit ne connaît pas
    dans ce palier —, et un override **expiré** retombe sur le chiffre du palier
    plutôt que sur celui qu'il portait.
    """
    row = conn.execute("select plan from tenants where id::text = %s", (tenant_id,)).fetchone()
    if row is None or not row[0]:
        return AUCUNE
    plan = str(row[0])

    caps = {
        Capability(c[0])
        for c in conn.execute(
            "select capability from plan_capabilities where plan = %s", (plan,)
        ).fetchall()
        if c[0] in _CAPS_CONNUES
    }
    if not caps:
        # Un palier sans aucune capacité est un palier que la base ne connaît pas —
        # ou dont le seed a échoué. Le traiter comme `free` reviendrait à deviner.
        return AUCUNE

    limites: dict[Metric, Limite] = {}
    for metric, valeur, grace, override in conn.execute(
        "select l.metric, l.limit_value, l.grace_pct, o.limit_value "
        "from plan_limits l "
        "left join tenant_quota_overrides o "
        "  on o.metric = l.metric and o.tenant_id::text = %s "
        " and (o.expires_at is null or o.expires_at > now()) "
        "where l.plan = %s",
        (tenant_id, plan),
    ).fetchall():
        if metric not in _METRIQUES_CONNUES:
            continue
        limites[Metric(metric)] = Limite(
            valeur=int(override if override is not None else valeur), grace_pct=int(grace)
        )
    return Entitlement(plan=plan, capabilities=frozenset(caps), limites=limites)


_CAPS_CONNUES = {c.value for c in Capability}
_METRIQUES_CONNUES = {m.value for m in Metric}


def periode(jour: date | None = None) -> date:
    """Le début du mois calendaire courant — la clé de remise à zéro d'un `flux`.

    Une nouvelle période est une **nouvelle ligne**, jamais une remise à zéro en
    place : un compteur qu'on écrase perd l'historique de consommation au moment même
    où un litige de facturation le demande.
    """
    reference = jour or date.today()
    return reference.replace(day=1)


def stock_allows(droit: Entitlement, metric: Metric, *, actuel: int) -> bool:
    """Peut-on créer un objet de plus ? Un plafond illisible refuse.

    Les `stock` n'ont pas de tolérance : ils sont comptés à la création, l'utilisateur
    voit immédiatement le refus, et un dépassement toléré sur un stock ne se rattrape
    pas — il faudrait supprimer quelque chose que le client a créé.
    """
    limite = droit.limite(metric)
    if limite is None:
        return False
    return actuel < limite.valeur


def meter(droit: Entitlement, metric: Metric, *, consomme: int | None) -> Meter:
    """Où en est une métrique de flux face à son plafond.

    `consomme is None` veut dire « le compteur n'a pas pu être lu », et rend
    `Meter.unknown` — pas `ok`. C'est la distinction qui manque le plus souvent dans
    ce genre de code : une lecture ratée qui se lit comme « rien de consommé » offre
    exactement la fenêtre qu'un abus cherche.
    """
    limite = droit.limite(metric)
    if limite is None:
        return Meter.unknown
    if consomme is None:
        return Meter.unknown
    if consomme < limite.valeur:
        return Meter.ok
    if consomme < limite.plafond_avec_grace:
        return Meter.grace
    return Meter.capped


def lire_compteur(conn: psycopg.Connection, tenant_id: str, metric: Metric) -> int | None:
    """La consommation du mois courant, ou ``None`` si elle n'a pas pu être lue.

    `None` et `0` sont deux réponses différentes, et les confondre est le défaut que
    `Meter.unknown` existe pour rendre impossible.
    """
    try:
        row = conn.execute(
            "select used from plan_usage_counters "
            "where tenant_id::text = %s and metric = %s and period_start = %s",
            (tenant_id, metric.value, periode()),
        ).fetchone()
    except Exception:
        return None
    return int(row[0]) if row else 0

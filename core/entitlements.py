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

import logging
from dataclasses import dataclass, field, replace
from datetime import date
from enum import StrEnum
from typing import TYPE_CHECKING

from core.policy import (
    CLASSES_RISQUEES,
    Approval,
    Policy,
    PolicyOutcome,
    raise_to,
    service_down_verdict,
)

if TYPE_CHECKING:  # pragma: no cover - psycopg n'est qu'un type ici
    import psycopg

logger = logging.getLogger("xsom.entitlements")


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
    """Ce qu'un tenant a le droit de faire, jusqu'où, et où il en est.

    La consommation voyage avec le droit parce qu'elle se lit dans la **même**
    requête : `plan_usage_counters` se joint aux plafonds sur la métrique, et
    séparer les deux lectures coûtait un aller-retour SQL de plus sur le chemin que
    l'agent emprunte à chaque appel d'outil.
    """

    plan: str
    capabilities: frozenset[Capability]
    limites: dict[Metric, Limite]
    #: Le consommé du mois courant, par métrique. Une métrique absente vaut zéro —
    #: aucune ligne de compteur veut dire « rien consommé cette période », et c'est
    #: différent de « pas pu lire », qui est l'échec de la requête entière et rend
    #: `AUCUNE`.
    consommation: dict[Metric, int] = field(default_factory=dict)

    def allows(self, capability: Capability) -> bool:
        return capability in self.capabilities

    def limite(self, metric: Metric) -> Limite | None:
        return self.limites.get(metric)

    def consomme(self, metric: Metric) -> int:
        return self.consommation.get(metric, 0)


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
    rows = conn.execute(
        # **Une seule requête, et c'est un choix de chemin chaud.** Trois lectures
        # séparées — palier, capacités, plafonds — plus une quatrième pour le
        # compteur, faisaient passer `/v1/authorize` de six à onze allers-retours
        # SQL par appel : presque le double, sur la route que l'agent emprunte à
        # chaque outil. `scripts/measure_overhead.py` l'a chiffré, et le dépôt en
        # publie le résultat, donc le coût se décide, il ne se subit pas.
        #
        # Les capacités passent par `array_agg` dans une sous-requête scalaire
        # plutôt que par une jointure : jointes, elles multiplieraient chaque
        # plafond par chaque capacité — trente-sept fois dix lignes pour en lire
        # quarante-sept.
        "with t as (select plan from tenants where id::text = %(tid)s) "
        "select t.plan, "
        "       (select array_agg(capability) from plan_capabilities where plan = t.plan), "
        "       l.metric, l.limit_value, l.grace_pct, o.limit_value, u.used "
        "from t "
        "left join plan_limits l on l.plan = t.plan "
        "left join tenant_quota_overrides o "
        "       on o.metric = l.metric and o.tenant_id::text = %(tid)s "
        "      and (o.expires_at is null or o.expires_at > now()) "
        "left join plan_usage_counters u "
        "       on u.tenant_id::text = %(tid)s and u.metric = l.metric "
        "      and u.period_start = %(periode)s",
        {"tid": tenant_id, "periode": periode()},
    ).fetchall()
    if not rows or not rows[0][0]:
        return AUCUNE
    plan = str(rows[0][0])

    caps = {Capability(c) for c in (rows[0][1] or []) if c in _CAPS_CONNUES}
    if not caps:
        # Un palier sans aucune capacité est un palier que la base ne connaît pas —
        # ou dont le seed a échoué. Le traiter comme `free` reviendrait à deviner.
        return AUCUNE

    limites: dict[Metric, Limite] = {}
    consommation: dict[Metric, int] = {}
    for _plan, _caps, metric, valeur, grace, override, consomme in rows:
        if metric is None or metric not in _METRIQUES_CONNUES:
            continue
        limites[Metric(metric)] = Limite(
            valeur=int(override if override is not None else valeur), grace_pct=int(grace)
        )
        consommation[Metric(metric)] = int(consomme or 0)
    return Entitlement(
        plan=plan,
        capabilities=frozenset(caps),
        limites=limites,
        consommation=consommation,
    )


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


def consume(conn: psycopg.Connection, tenant_id: str, metric: Metric, n: int = 1) -> int | None:
    """Débiter ``n`` sur la métrique du mois courant, et rendre le total après débit.

    **Une seule instruction, pas de lecture puis écriture.** Le verrou de ligne
    Postgres suffit : deux appels concurrents s'appliquent l'un après l'autre sur la
    seule ligne du tenant, et aucun ne peut écraser l'autre. Une lecture-puis-écriture
    demanderait un verrou de plus, sur un chemin qui en tient déjà un — donc un ordre
    de verrouillage de plus, donc une classe d'interblocage de plus.

    **Le débit est enveloppé dans un point de sauvegarde.** Cette fonction est appelée
    dans la transaction qui écrit l'entrée d'audit : sans le `conn.transaction()`
    interne, une erreur ici empoisonnerait la transaction et ferait perdre la ligne de
    **preuve**. §4.2 l'interdit, et c'est la raison pour laquelle
    `plan_usage_counters` ne porte aucun trigger. Un compteur peut sous-compter ; il
    ne peut jamais faire perdre une preuve.

    Rend ``None`` quand le débit n'a pas pu se faire — distinct de ``0``, et lu comme
    `Meter.unknown` par l'appelant.
    """
    try:
        with conn.transaction():
            row = conn.execute(
                "insert into plan_usage_counters (tenant_id, metric, period_start, used) "
                "values (%s, %s, %s, %s) "
                "on conflict (tenant_id, metric, period_start) do update "
                "set used = plan_usage_counters.used + excluded.used, updated_at = now() "
                "returning used",
                (tenant_id, metric.value, periode(), n),
            ).fetchone()
    except Exception:
        logger.warning(
            "usage_counter_failed", extra={"tenant_id": tenant_id, "metric": metric.value}
        )
        return None
    return int(row[0]) if row else None


def tighten(outcome: PolicyOutcome, policy: Policy, *, reason: Meter) -> PolicyOutcome:
    """Resserrer un verdict parce que le plan est au plafond. **Jamais l'inverse.**

    C'est l'invariant central de toute la gamme, et il n'est pas une politesse : si un
    plafond pouvait relâcher un verdict, la facturation deviendrait un moteur de
    policy — un `deny` de règle transformé en `auto` par un état de compteur. Le pli
    passe donc par :func:`core.policy.raise_to`, la fonction qui porte déjà cette
    garantie pour tous les autres gardes du produit (`FR-170`, `AD-21.1`) : une
    seconde table de sévérité finirait par diverger de la première.

    Le plancher est celui de `service_down_verdict` — le **même verdict**, déjà écrit,
    déjà testé, déjà audité, que celui appliqué quand le service d'approbation est
    injoignable (`AD-37`). Les deux situations disent la même chose à l'agent : nous
    ne pouvons pas garantir ce que nous garantissons d'habitude, donc les classes
    dangereuses se ferment et les légères continuent.

    `Meter.unknown` resserre **comme** `Meter.capped`, et c'est délibéré. Le traiter
    comme `grace` s'appuierait sur `AD-34`, qui ne couvre que `classify: ambiguous` :
    une règle `approval: auto` sur un `write` non ambigu continuerait de passer sans
    aucun plafond. Un hoquet du compteur ne doit pas ouvrir ce qu'il ne sait pas
    mesurer.
    """
    if outcome.decision in _DEJA_TENU_PAR_UN_HUMAIN:
        # **La comptabilité ne passe jamais devant un humain** (§4.1).
        #
        # Sans cette sortie, un tenant au plafond dont un opérateur vient de cliquer
        # « approuvé » verrait ce verdict transformé en refus au ré-appel — l'action
        # approuvée n'aurait jamais lieu, et le geste le plus lourd du produit serait
        # annulé par un compteur. Une attente serait de même refusée avant d'avoir
        # atteint qui que ce soit.
        #
        # Et rien ne s'ouvre : `human_in_the_loop` et `human_dual` sont déjà plus
        # stricts que tout ce que ce plancher pourrait imposer, sauf `deny` — et
        # refuser d'office ce qu'un humain allait trancher n'est pas resserrer, c'est
        # retirer la boucle.
        return outcome
    if outcome.action_class not in CLASSES_RISQUEES:
        # **Un plafond commercial ne coupe pas la production.**
        #
        # Le plancher partagé est `service_down_verdict`, et pour les classes
        # risquées il rend toujours `deny` — c'est le même verdict, déjà écrit, déjà
        # testé, déjà audité (`AD-37`). Mais pour les classes légères il rend le
        # réglage `on_approval_service_down` du tenant, qui vaut `deny` par défaut :
        # l'appliquer ici couperait les **lectures** d'un client qui a dépassé son
        # quota de décisions, c'est-à-dire transformerait un incident de paiement en
        # incident de production. C'est ce qui fait perdre le client, pas ce qui le
        # fait monter de palier.
        #
        # Le dépassement ferme donc ce qui coûte et ce qui ne se défait pas, et laisse
        # tourner le reste. La bande de tolérance et l'alerte font le reste du travail
        # commercial ; une panne ne le fait jamais.
        return outcome
    plancher = service_down_verdict(policy, outcome.action_class)
    serre = raise_to(outcome.decision, plancher)
    if serre is outcome.decision:
        return outcome
    return replace(outcome, decision=serre, reason=f"plan_{reason.value}")


#: Les verdicts qu'un plafond de plan ne touche pas : ceux qui tiennent déjà un humain.
_DEJA_TENU_PAR_UN_HUMAIN = frozenset({Approval.human_in_the_loop, Approval.human_dual})

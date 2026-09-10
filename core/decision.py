"""Cooperative authorization for non-MCP agents — the gateway's decision cycle
(SPEC §5.2) exposed over HTTP, without execution.

An agent calls :func:`authorize` *before* a risky action and honours the verdict:
``allow`` → proceed, ``deny`` → abort, ``hold`` → poll the returned
``approval_id`` until it resolves. Holds surface in the existing approval queue,
and every decision is written to the same hash-chained audit log. Unlike the MCP
gateway, xSOM does not execute the action here — enforcement is **cooperative**
(the agent must call this and obey it). Fail-closed everywhere.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import psycopg

from core import approvals, audit, db, entitlements, risk, trust
from core.entitlements import Capability, Meter, Metric
from core.judge import Judge, resolve_ambiguous
from core.notify import Notifier
from core.policy import Approval, Policy, PolicyOutcome, evaluate, service_down_verdict

logger = logging.getLogger("xsom.decision")

# Approval terminal status -> (audit decision, verdict returned to the agent).
_TERMINAL: dict[str, tuple[str, str]] = {
    "approved": ("hitl_approved", "allow"),
    "denied": ("hitl_denied", "deny"),
    "expired": ("expired", "deny"),
}


def _class(outcome: PolicyOutcome) -> str | None:
    return outcome.action_class.value if outcome.action_class else None


def _audit(
    database_url: str,
    *,
    tenant_id: str,
    decision: str,
    tool: str,
    request_id: str,
    action_class: str | None,
    # Qui a levé le HITL. Absent de cette signature jusqu'ici, donc `audit_log.user_id`
    # était NULL sur la voie coopérative — alors que la colonne entre dans la charge
    # hachée, si bien que la chaîne attestait une approbation sans approbateur.
    user_id: str | None = None,
    policy_rule_id: str | None = None,
    judge_used: bool = False,
    args_hash: str | None = None,
    gateway_token_id: str | None = None,
    client_request_id: str | None = None,
    constraint_reason: str | None = None,
    usage_metric: str | None = None,
) -> bool:
    """Écrit la ligne. Rend `False` si elle n'a pas pu l'être.

    **La porte coopérative doit elle aussi prouver avant d'autoriser.** Le lot 2 l'a
    fait sur la passerelle ; ici l'échec d'écriture remontait en `OperationalError`,
    donc en HTTP 500 — une **erreur**, pas un verdict, sur un contrat dont toute la
    prémisse est que l'agent honore le verdict. Et un agent qui reçoit une erreur
    devine, dans le sens qui l'arrange.

    Le retour est ce qui permet à l'appelant de refuser plutôt que d'autoriser sans
    preuve.
    """
    try:
        _ecrire(
            database_url,
            tenant_id=tenant_id,
            decision=decision,
            user_id=user_id,
            request_id=request_id,
            tool_name=tool,
            action_class=action_class,
            policy_rule_id=policy_rule_id,
            judge_used=judge_used,
            args_hash=args_hash,
            gateway_token_id=gateway_token_id,
            client_request_id=client_request_id,
            constraint_reason=constraint_reason,
            usage_metric=usage_metric,
        )
    except Exception:
        logger.warning("audit_write_failed", extra={"tool": tool, "decision": decision})
        return False
    return True


def _ecrire(database_url: str, **champs: Any) -> None:
    """L'écriture nue. Séparée pour que `_audit` n'ait qu'un seul chemin d'échec."""
    with db.connection(database_url) as conn:
        audit.log_event(
            conn,
            # The cooperative door. Fixed here, not passed in: an adapter states
            # what it is, it does not accept being told (FR-160).
            origin=audit.Origin.authorize_api(),
            **champs,
        )
        conn.commit()


def _notify(notifier: Notifier | None, approval_id: str, summary: str, expires_at: str) -> None:
    if notifier is None:
        return
    try:
        notifier.notify_approval(approval_id=approval_id, summary=summary, expires_at=expires_at)
    except Exception:  # best-effort; a missed notification leaves the action pending (safe)
        logger.warning("approval_notify_failed", extra={"approval_id": approval_id})


def authorize(
    *,
    database_url: str,
    policy: Policy,
    tenant_id: str,
    tool: str,
    arguments: dict[str, Any],
    judge: Judge | None = None,
    requested_by: str | None = None,
    timeout_seconds: int = 3600,
    notifier: Notifier | None = None,
    gateway_token_id: str | None = None,
    client_request_id: str | None = None,
) -> dict[str, Any]:
    """Decide whether the agent may perform ``tool`` with ``arguments``.

    ``client_request_id`` is whatever the agent called this request. It is stored
    beside the decision so the agent can line its own trace up with ours, and it
    is stored as a *declared* value: nothing verifies it, so it never becomes the
    audit entry's identity (FR-161).
    """
    outcome = evaluate(policy, tool, arguments)

    # **Le droit du tenant, lu une fois, jamais mis en cache.** Il décide de deux
    # choses ici : si le juge a le droit de tourner, et si le verdict doit être
    # resserré parce que le plan est au plafond. Les deux sont des **durcissements** :
    # rien de ce qui suit ne peut rendre un verdict plus permissif que la policy.
    # `try` et non `with` nu : une base injoignable ici doit devenir un **verdict**,
    # pas une erreur HTTP 500 — c'est la garantie que ce module énonce trente lignes
    # plus bas pour le service d'approbation, et elle ne peut pas dépendre de l'ordre
    # dans lequel les lectures sont écrites. Le repli est fail-closed des deux côtés :
    # aucun droit, donc pas de juge, et un compteur illisible qui resserre.
    droit = entitlements.AUCUNE
    juge_permis = False
    droit_lu = False
    etat_compteur = Meter.unknown
    try:
        with db.connection(database_url) as conn:
            droit = entitlements.load_entitlement(conn, tenant_id)
            # Le juge est un enrichissement payant, et son absence **durcit**
            # (`AD-34`) : couper le juge plafonne les outils ambigus à `irreversible`,
            # donc à une approbation humaine. Un palier sans juge est plus strict,
            # jamais plus laxiste — c'est ce qui permet de le vendre sans rouvrir le
            # moteur de policy.
            juge_permis = droit.allows(Capability.judge) and outcome.ambiguous
            if juge_permis:
                juge_permis = (
                    entitlements.meter(
                        droit,
                        Metric.judge_calls,
                        consomme=entitlements.consume(conn, tenant_id, Metric.judge_calls),
                    )
                    is not Meter.capped
                )
                conn.commit()
            # Le consommé vient de la **même requête** que le droit : le garde de
            # surcoût a chiffré ce que coûtait la version naïve — deux connexions et
            # cinq allers-retours SQL de plus par appel d'autorisation, sur le chemin
            # que l'agent emprunte à chaque outil. Une connexion, c'est un aller-retour
            # réseau, un handshake TLS et une place dans le pooler ; un aller-retour,
            # c'est la latence de la base multipliée par tout le trafic de la flotte.
            etat_compteur = entitlements.meter(
                droit, Metric.decisions, consomme=droit.consomme(Metric.decisions)
            )
            droit_lu = True
    except Exception:
        logger.warning("entitlement_unreadable", extra={"tenant": tenant_id})

    # Ambiguous tools: classify, then floor for that class. Same shared step as the
    # MCP path — an absent judge floors to irreversible rather than letting the
    # rule's declared approval stand (AD-34).
    outcome = resolve_ambiguous(outcome, judge if juge_permis else None, tool, arguments)

    # Graduated autonomy (M11): risk-score an `auto` outcome and tighten it (opt-in).
    if policy.defaults.risk_bands is not None and outcome.decision is Approval.auto:
        # **Une lecture de confiance injoignable ne doit pas devenir une erreur HTTP.**
        #
        # `db.connection` vivait hors de tout `try` : une base momentanément absente
        # remontait en 500, c'est-à-dire en *erreur* et non en *verdict*, sur un contrat
        # dont toute la prémisse est que l'agent honore le verdict — la faute que le
        # `except` d'`_hold_for_humans` corrige trente lignes plus bas. Et elle ne se
        # produisait que chez les tenants ayant activé l'autonomie graduée, si bien que
        # les trois tests de panne du fichier, tous écrits sur des policies sans
        # `risk_bands`, ne pouvaient pas la voir.
        #
        # Le repli est l'entrée la plus stricte que `escalate_by_risk` accepte :
        # `seen_before=False` ajoute les 10 points de nouveauté, `clean_streak=0`
        # n'accorde aucune remise. Ne pas savoir si un agent a mérité la confiance se
        # lit donc comme « il ne l'a pas méritée » (`AD-10`).
        try:
            with db.connection(database_url) as conn:
                seen, streak = trust.observed(conn, tenant_id=tenant_id, tool=tool)
        except Exception:
            logger.warning("trust_lookup_failed", extra={"tool": tool, "tenant_id": tenant_id})
            seen, streak = False, 0
        tier = risk.escalate_by_risk(
            outcome.decision,
            outcome.action_class,
            arguments,
            policy.defaults.risk_bands,
            seen_before=seen,
            clean_streak=streak,
        )
        if tier is not outcome.decision:
            outcome = replace(outcome, decision=tier, reason="risk")

    # **Le plafond de décisions, appliqué APRÈS la policy et jamais contre elle.**
    #
    # Le compteur est lu ici et débité plus bas, dans la transaction qui écrit la
    # preuve. Lire d'abord permet de resserrer *ce* verdict-ci ; débiter dans la
    # transaction d'audit garantit que ce qui est compté est ce qui a été écrit.
    # **`Meter.unknown` resserre — mais seulement si le droit, lui, a été lu.**
    #
    # La nuance est fine et elle compte. Un compteur illisible sur un droit connu est
    # bien l'état que `tighten` doit fermer : on sait ce que ce tenant a acheté, on ne
    # sait pas où il en est. Mais quand **rien** n'est lisible — base entière absente
    # —, ce n'est plus une question de plan, et parler de plafond ici volerait la
    # parole aux gardes plus profonds, qui disent la même chose en plus précis :
    # « service d'approbation indisponible », « audit indisponible ». Ils rendent le
    # même verdict sur les classes risquées (`service_down_verdict`), donc rien ne
    # s'ouvre — seul le motif change, et il devient utile à qui lit l'incident.
    etat = etat_compteur if droit_lu else Meter.ok
    if etat in (Meter.capped, Meter.unknown):
        outcome = entitlements.tighten(outcome, policy, reason=etat)
    contrainte = f"plan_{etat.value}" if etat in (Meter.capped, Meter.unknown) else None

    ah = approvals.args_hash(arguments)

    if outcome.decision is Approval.auto:
        request_id = uuid4().hex
        ecrit = _audit(
            database_url,
            tenant_id=tenant_id,
            decision="allow",
            tool=tool,
            request_id=request_id,
            action_class=_class(outcome),
            policy_rule_id=outcome.rule_name,
            judge_used=outcome.judge_used,
            args_hash=ah,
            gateway_token_id=gateway_token_id,
            client_request_id=client_request_id,
            constraint_reason=contrainte,
            usage_metric=Metric.decisions.value,
        )
        if not ecrit:
            # **Prouver avant d'autoriser, ici aussi.** Le lot 2 l'a fait sur la
            # passerelle ; cette porte-ci rendait `allow` quand l'écriture échouait —
            # ou, pire, une erreur HTTP 500, qu'un agent interprète dans le sens qui
            # l'arrange. Une autorisation qu'on ne peut pas prouver n'est pas une
            # autorisation (§4.2, §4.4).
            return {
                "decision": "deny",
                "action_class": _class(outcome),
                "reason": "audit_unavailable",
            }
        return {"decision": "allow", "action_class": _class(outcome), "reason": outcome.reason}

    if outcome.decision is Approval.notify:
        # Notify-and-proceed (M11): the agent may act, but the action is recorded
        # distinctly ("notify") so ops can watch it — no human gate.
        request_id = uuid4().hex
        ecrit = _audit(
            database_url,
            tenant_id=tenant_id,
            decision="notify",
            tool=tool,
            request_id=request_id,
            action_class=_class(outcome),
            policy_rule_id=outcome.rule_name,
            judge_used=outcome.judge_used,
            args_hash=ah,
            gateway_token_id=gateway_token_id,
            client_request_id=client_request_id,
            constraint_reason=contrainte,
            usage_metric=Metric.decisions.value,
        )
        if not ecrit:
            return {
                "decision": "deny",
                "action_class": _class(outcome),
                "reason": "audit_unavailable",
            }
        return {
            "decision": "allow",
            "action_class": _class(outcome),
            "reason": outcome.reason,
            "notified": True,
        }

    if outcome.decision is Approval.deny:
        request_id = uuid4().hex
        _audit(
            database_url,
            tenant_id=tenant_id,
            decision="deny",
            tool=tool,
            request_id=request_id,
            action_class=_class(outcome),
            policy_rule_id=outcome.rule_name,
            judge_used=outcome.judge_used,
            args_hash=ah,
            gateway_token_id=gateway_token_id,
            client_request_id=client_request_id,
            constraint_reason=contrainte,
            usage_metric=None,
        )
        return {"decision": "deny", "action_class": _class(outcome), "reason": outcome.reason}

    # human_in_the_loop / human_dual
    required = 2 if outcome.decision is Approval.human_dual else 1
    try:
        return _hold_for_humans(
            database_url=database_url,
            tenant_id=tenant_id,
            tool=tool,
            arguments=arguments,
            outcome=outcome,
            ah=ah,
            required=required,
            requested_by=requested_by,
            timeout_seconds=timeout_seconds,
            notifier=notifier,
            gateway_token_id=gateway_token_id,
            client_request_id=client_request_id,
        )
    except Exception:
        # Approval service unavailable. The cooperative contract is that the agent
        # honours the verdict -- so it must get one. Raising here surfaced as an HTTP
        # 500, which is an error, not a decision, and left the agent to guess
        # (CLAUDE.md 4.4).
        logger.exception("approval_service_error", extra={"tool": tool})
        verdict = service_down_verdict(policy, outcome.action_class)
        reason = "approval_service_unavailable"
        try:
            _audit(
                database_url,
                tenant_id=tenant_id,
                decision="deny" if verdict is not Approval.auto else "allow",
                tool=tool,
                request_id=uuid4().hex,
                action_class=_class(outcome),
                policy_rule_id=outcome.rule_name,
                judge_used=outcome.judge_used,
                args_hash=ah,
                gateway_token_id=gateway_token_id,
                client_request_id=client_request_id,
            )
        except Exception:  # the audit store may be the thing that is down
            logger.warning("audit_write_failed", extra={"tool": tool})
        # `is not auto`, comme sur la passerelle : les deux portes se réclament du
        # même `AD-37`, elles doivent tomber du même côté sur une valeur inattendue.
        if verdict is not Approval.auto:
            return {"decision": "deny", "action_class": _class(outcome), "reason": reason}
        return {"decision": "allow", "action_class": _class(outcome), "reason": reason}


def _hold_for_humans(
    *,
    database_url: str,
    tenant_id: str,
    tool: str,
    arguments: dict[str, Any],
    outcome: PolicyOutcome,
    ah: str,
    required: int,
    requested_by: str | None,
    timeout_seconds: int,
    notifier: Notifier | None,
    gateway_token_id: str | None,
    client_request_id: str | None = None,
) -> dict[str, Any]:
    """Create or resume the approval for a held action. Raises if the store is down."""
    with db.connection(database_url) as conn:
        record = approvals.find_active(conn, tenant_id, tool, ah)
        if record is not None:
            record = approvals.expire_if_needed(conn, record)
            conn.commit()

        if record is None:
            action_class = _class(outcome)
            dry_run = approvals.build_dry_run(tool, action_class, arguments)
            expires_at = datetime.now(UTC) + timedelta(seconds=timeout_seconds)
            record = approvals.create(
                conn,
                tenant_id=tenant_id,
                request_id=uuid4().hex,
                tool_name=tool,
                action_class=action_class,
                ah=ah,
                arguments_summary=approvals.redact(arguments),
                dry_run=dry_run,
                required_count=required,
                expires_at=expires_at,
                requested_by=requested_by,
            )
            conn.commit()
            summary = str(record.dry_run.get("summary", ""))
            _audit(
                database_url,
                tenant_id=tenant_id,
                decision="hitl_pending",
                tool=tool,
                request_id=record.id,
                action_class=action_class,
                policy_rule_id=outcome.rule_name,
                judge_used=outcome.judge_used,
                args_hash=ah,
                gateway_token_id=gateway_token_id,
                client_request_id=client_request_id,
            )
            _notify(notifier, record.id, summary, record.expires_at.isoformat())
            return _hold(record.id, record.action_class, summary)

        if record.status == "pending":
            return _hold(record.id, record.action_class, str(record.dry_run.get("summary", "")))

        return _resolve_terminal(database_url, conn, tenant_id, record, gateway_token_id)


def poll(
    *,
    database_url: str,
    tenant_id: str,
    approval_id: str,
    gateway_token_id: str | None = None,
) -> dict[str, Any] | None:
    """Current verdict for a held action; None if the approval is unknown to the tenant."""
    with db.connection(database_url) as conn:
        record = approvals.get(conn, tenant_id, approval_id)
        if record is None:
            return None
        record = approvals.expire_if_needed(conn, record)
        conn.commit()
        if record.status == "pending":
            return _hold(record.id, record.action_class, str(record.dry_run.get("summary", "")))
        return _resolve_terminal(database_url, conn, tenant_id, record, gateway_token_id)


def _hold(approval_id: str, action_class: str | None, summary: str) -> dict[str, Any]:
    return {
        "decision": "hold",
        "status": "pending",
        "approval_id": approval_id,
        "action_class": action_class,
        "reason": "requires_approval",
        "summary": summary,
    }


def _resolve_terminal(
    database_url: str,
    conn: psycopg.Connection,
    tenant_id: str,
    record: approvals.ApprovalRecord,
    gateway_token_id: str | None = None,
) -> dict[str, Any]:
    audit_decision, verdict = _TERMINAL[record.status]
    # No `client_request_id` here, deliberately: this row is written when a *poll*
    # resolves a held approval, and the poller's declared id is not the requester's.
    # Carrying the original one would mean storing it on the approval record; leaving
    # the poller's would be a small lie in the column whose whole point is provenance.
    # Record the terminal decision once (the first consumer), then it is spent.
    if approvals.consume(conn, record.id):
        conn.commit()
        _audit(
            database_url,
            tenant_id=tenant_id,
            decision=audit_decision,
            tool=record.tool_name,
            request_id=record.id,
            action_class=record.action_class,
            # L'approbateur, pas le demandeur. La colonne était NULL ici et portait
            # `requested_by` côté passerelle : deux façons différentes d'être faux
            # sur le seul champ qui dit qui a autorisé une action irréversible.
            user_id=record.decided_by,
            gateway_token_id=gateway_token_id,
        )
    else:
        conn.commit()
    return {
        "decision": verdict,
        "status": record.status,
        "approval_id": record.id,
        "action_class": record.action_class,
        "reason": record.status,
    }

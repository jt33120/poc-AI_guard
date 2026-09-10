"""MCP gateway server (SPEC §5).

The gateway is an MCP *server* to the agent and an MCP *client* to downstream
tool servers. Its tool list and call routing are provided by a pluggable
``ToolBackend``; the default exposes zero tools, and ``DownstreamProxy`` (M2)
aggregates/relays the tenant's downstream servers. Policy/HITL/audit wrap the
relay in later milestones (M3+).

The low-level ``Server`` is used on purpose: the tool list is dynamic.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from uuid import uuid4

import mcp.types as types
from mcp.server.lowlevel import Server

from core import (
    approvals,
    audit,
    db,
    integrity,
    monitor,
    risk,
    taint_store,
    tenant_tokens,
    trust,
)
from core.config import Settings
from core.judge import Judge, resolve_ambiguous
from core.logging import configure_logging
from core.notify import Notifier
from core.observability import init_observability
from core.policy import (
    CLASSES_RISQUEES,
    ActionClass,
    Approval,
    Policy,
    PolicyOutcome,
    evaluate,
    raise_to,
    service_down_verdict,
)
from core.tenant_tokens import authenticate_gateway_session
from gateway.downstream import DownstreamProxy, ServerSpec
from gateway.taint import exfiltration_target, taints_result

logger = logging.getLogger("xsom.gateway")

SERVER_NAME = "xsom-ai-guard"

#: Environment variable carrying the tenant-scoped gateway token (stdio sessions).
TENANT_TOKEN_ENV = "XSOM_TENANT_TOKEN"  # noqa: S105 - env var name, not a secret


class ToolBackend(Protocol):
    """What the gateway needs from whatever provides/relays tools."""

    async def list_tools(self) -> list[types.Tool]: ...

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> types.CallToolResult: ...


class EmptyBackend:
    """Default backend: no tools (used before any downstream server is wired)."""

    async def list_tools(self) -> list[types.Tool]:
        return []

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        raise ValueError(f"no such tool: {name}")


def _denied_result(message: str) -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=message)], isError=True
    )


def _result_text(result: types.CallToolResult) -> str:
    """Concatenate a tool result's text parts (for taint scanning only, never stored)."""
    parts = [item.text for item in result.content if isinstance(item, types.TextContent)]
    return "\n".join(parts)


#: Map a quarantine status to its audit decision string.
_INTEGRITY_DECISION: dict[integrity.ToolStatus, str] = {
    integrity.ToolStatus.drift: "tool_drift",
    integrity.ToolStatus.poison: "poison_suspected",
    integrity.ToolStatus.new: "tool_quarantined",
}


@dataclass
class ApprovalContext:
    """What the gateway needs to run the HITL flow for a tenant."""

    database_url: str
    tenant_id: str
    timeout_seconds: int = 3600
    notifier: Notifier | None = None
    requested_by: str | None = None
    #: The calling agent's client id, for per-tool RBAC (None = no client scope).
    client_id: str | None = None
    #: The calling agent itself, as the control plane names it. The persisted taint
    #: (`FR-154`) is keyed on this rather than on anything the agent declares.
    gateway_token_id: str | None = None


class PolicyBackend:
    """Enforces the policy over a downstream proxy: auto / deny / HITL.

    The agent-facing tool name may be bare; policy is always evaluated against the
    canonical ``server.tool`` name. ``auto`` relays; ``deny`` refuses; ``human_*``
    enters the approval flow (or, with no approval context, fails closed).
    """

    def __init__(
        self,
        policy: Policy,
        proxy: DownstreamProxy,
        approval_ctx: ApprovalContext | None = None,
        judge: Judge | None = None,
    ) -> None:
        self._policy = policy
        self._proxy = proxy
        self._approval_ctx = approval_ctx
        self._judge = judge
        # Tools quarantined by the integrity guard during the last list_tools.
        self._quarantined: set[str] = set()
        #: Reason from the last taint read, for the audit line that follows it.
        self._taint_reason: str | None = None
        self._exfil_target: str | None = None
        self._stop_reason: str | None = None
        # Indirect-injection taint is persisted, keyed on the agent (FR-154). It is
        # deliberately NOT held here: an object on this instance dies with the
        # connection, and a guard a reconnect defeats is not a guard.

    @property
    def _integrity_on(self) -> bool:
        return self._approval_ctx is not None and self._policy.defaults.integrity_enabled

    async def list_tools(self) -> list[types.Tool]:
        tools = await self._proxy.list_tools()
        if not self._integrity_on:
            return tools
        return await self._screen_tools(tools)

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        resolved = await self._proxy.resolve(name)
        canonical = f"{resolved[0]}.{resolved[1]}" if resolved else name

        # La quarantaine d'intégrité, déplacée APRÈS la résolution du nom canonique.
        #
        # Elle était le seul des cinq gardes du fichier à ne laisser aucune ligne
        # d'audit — RBAC, arrêt, taint et le filtrage de liste en écrivent une. Un
        # outil dont l'empreinte a changé était refusé en silence.
        #
        # L'ordre importe : auditer sous `name` réintroduirait le défaut déjà corrigé
        # plus bas, où la quarantaine disait « echo » et tout le reste « mock.echo »,
        # si bien qu'un export filtré par outil manquait les quarantaines.
        # `_integrity_blocks` continue de recevoir `name` : c'est la clé de son
        # ensemble mémoire.
        if self._integrity_on:
            blocked = await self._integrity_blocks(name)
            if blocked is not None:
                logger.info("tool_quarantined", extra={"tool": canonical, "reason": blocked})
                self._audit_gate(canonical, "tool_quarantined", blocked)
                return _denied_result(f"'{canonical}' quarantined by integrity guard: {blocked}")

        # Per-tool RBAC / confused-deputy guard: an agent outside a tool's client
        # allowlist can never invoke it, regardless of the action class (fail-closed).
        rbac = self._rbac_blocks(canonical)
        if rbac is not None:
            logger.info("tool_rbac_denied", extra={"tool": canonical, "reason": rbac})
            self._audit_gate(canonical, "rbac_denied", rbac)
            return _denied_result(f"'{canonical}' denied: agent not authorized ({rbac})")

        outcome = evaluate(self._policy, canonical, arguments)

        # Ambiguous tools: classify, then floor for that class. The judge only
        # classifies — never authorizes — and an absent judge floors to
        # irreversible rather than letting the rule's approval stand (AD-34).
        outcome = resolve_ambiguous(outcome, self._judge, canonical, arguments)

        # `FR-166` — l'ordre d'arrêt de l'opérateur, relu **par appel**.
        #
        # Placé ici et pas plus haut : la direction d'échec est conditionnée à la
        # classe (`AD-33`), donc le garde ne peut pas s'exprimer avant que la classe
        # soit connue. Placé avant le risque et le taint parce qu'un agent arrêté ne
        # doit pas voir sa demande *graduée* : elle n'a pas à être évaluée du tout.
        stopped = self._stop_blocks(outcome)
        if stopped is not None:
            logger.info("agent_stopped", extra={"tool": canonical, "reason": stopped})
            self._audit_gate(canonical, stopped, self._stop_reason)
            return _denied_result(f"'{canonical}' denied: {self._stop_reason}")

        # Graduated autonomy (M11): risk-score an `auto` outcome and tighten it.
        outcome = self._apply_risk(canonical, outcome, arguments)

        # Indirect-injection guard (M12): a risky action in a tainted session is
        # escalated to a human or denied, before anything runs.
        if self._taint_blocks(outcome, arguments):
            self._audit_gate(canonical, "tainted_action", self._taint_reason)
            if self._policy.defaults.taint_policy == "deny":
                logger.info("tainted_action_denied", extra={"tool": canonical})
                return _denied_result(
                    f"'{canonical}' denied: session tainted by a prior tool result"
                )
            # `FR-170` : le garde contribue un **minimum**, il n'écrase pas. Écraser
            # relâchait le verdict quand la policy était plus stricte que le palier
            # du taint — un `deny` de règle devenait une attente approuvable, et le
            # quorum d'un `human_dual` tombait de 2 à 1. Dans la session teintée,
            # précisément : l'injection réussie *ouvrait* la porte qu'elle visait.
            # `reason` reste posé inconditionnellement — `_observation_relaxes` en
            # dépend pour refuser de relâcher une escalade de taint.
            outcome = replace(
                outcome,
                decision=raise_to(outcome.decision, Approval.human_in_the_loop),
                reason="taint",
            )

        # Observation window (`AD-27`, `G-25`) — désormais sur les **deux** chemins
        # d'ingestion. Le proxy LLM la portait seul depuis le rang 4, donc un même
        # tenant obtenait deux comportements selon la porte empruntée ; `AD-28` dit
        # qu'une propriété vraie sur un chemin ne se lit pas comme vraie partout, et
        # ici la divergence n'était pas voulue, seulement pas encore refermée.
        if outcome.decision is not Approval.auto and self._observation_relaxes(outcome):
            # `AD-27.3` : la distinction vit dans `decision`, à l'intérieur de la
            # charge hachée — sinon « nous avons bloqué » et « nous aurions bloqué »
            # hachent à l'identique et le vérificateur autonome ne les sépare pas.
            recorded = f"monitor_{'deny' if outcome.decision is Approval.deny else 'hold'}"
            logger.info("monitor_observed", extra={"tool": canonical, "decision": recorded})
            start = time.monotonic()
            result = await self._proxy.call_tool(name, arguments)
            self._audit(
                recorded,
                canonical,
                outcome,
                arguments,
                latency_ms=int((time.monotonic() - start) * 1000),
                request_id=uuid4().hex,
                error="downstream_error" if result.isError else None,
            )
            # Le marquage de taint est un état post-appel, pas un palier : un résultat
            # porteur d'injection teinte la session que l'appel ait été observé ou non.
            self._mark_taint(canonical, result)
            return result

        if outcome.decision in (Approval.auto, Approval.notify):
            # notify-and-proceed (M11) relays like auto but is recorded distinctly.
            decision = "allow" if outcome.decision is Approval.auto else "notify"
            request_id = uuid4().hex

            # **Prouver avant d'agir, sur ce qui ne se défait pas.**
            #
            # L'ordre était : relayer, puis auditer — et `_audit` avalait l'échec
            # d'écriture (« audit is best-effort; never break the call path »). Une
            # base momentanément injoignable suffisait donc à ce qu'un virement
            # parte sans laisser la moindre ligne, et rien ne le disait. C'est la
            # revendication centrale du produit, fausse précisément dans le cas où
            # elle compte.
            #
            # Sur les classes risquées, la preuve s'écrit d'abord et son échec
            # refuse l'action (§4.2, §4.4). Le prix est `latency_ms`, qu'on ne peut
            # pas connaître avant l'appel : perdre une mesure coûte moins cher que
            # perdre la ligne. Les classes légères gardent l'ordre inverse et leur
            # mesure — un `read` qu'on n'a pas pu auditer ne vaut pas qu'on refuse
            # le service, et `CLASSES_RISQUEES` est la même liste que celle sur
            # laquelle `service_down_verdict` refuse déjà.
            if outcome.action_class in CLASSES_RISQUEES:
                if not self._audit(decision, canonical, outcome, arguments, request_id=request_id):
                    logger.warning(
                        "denied_audit_unavailable",
                        extra={"tool": canonical, "decision": decision},
                    )
                    return _denied_result(f"'{canonical}' denied: audit unavailable")
                result = await self._proxy.call_tool(name, arguments)
            else:
                start = time.monotonic()
                result = await self._proxy.call_tool(name, arguments)
                self._audit(
                    decision,
                    canonical,
                    outcome,
                    arguments,
                    latency_ms=int((time.monotonic() - start) * 1000),
                    request_id=request_id,
                    error="downstream_error" if result.isError else None,
                )
            self._mark_taint(canonical, result)
            return result
        if outcome.decision is Approval.deny:
            logger.info(
                "tool_denied",
                extra={"tool": canonical, "decision": "deny", "reason": outcome.reason},
            )
            self._audit("deny", canonical, outcome, arguments, request_id=uuid4().hex)
            return _denied_result(f"'{canonical}' not permitted by policy: deny ({outcome.reason})")
        return await self._handle_hitl(name, arguments, canonical, outcome)

    def _observation_relaxes(self, outcome: PolicyOutcome) -> bool:
        """Whether an open observation window may relay this refused call (`AD-27`).

        Le mode observation existe pour un client dont la policy n'est pas encore
        écrite : sans lui, passer l'enforcement à « actif » retire tous les appels et
        casse l'agent. Il relâche donc un **verdict de policy** — et rien d'autre.

        Quatre exclusions, chacune délibérée :

        * **RBAC et quarantaine d'intégrité** ne passent jamais par ici : ils
          retournent avant l'évaluation de policy. Une fenêtre qui laisserait un agent
          appeler un outil auquel il n'a pas droit, ou un outil empoisonné, ne serait
          pas une fenêtre d'observation.
        * **Une escalade de taint** (`reason == "taint"`) n'est pas une immaturité de
          policy, c'est un signal d'attaque en cours. La relâcher transformerait la
          défense contre l'injection indirecte en ligne de journal — or `M-02` porte un
          `Bloqué`. *Aujourd'hui cette clause ne tranche rien* : `_taint_blocks` ne
          s'applique qu'à `irreversible` et `external_send`, que `monitor.observes`
          refuse déjà. Elle est gardée parce que la coïncidence est un fait des deux
          listes et non une propriété : le jour où le taint couvrirait `write`, elle
          devient la seule chose qui empêche une fenêtre de relâcher une action
          teintée. `test_taint_escalation_is_never_relaxed` l'exerce directement, et
          `test_every_class_taint_escalates_is_a_class_no_window_observes` fait échouer
          le build si les deux listes se séparent.
        * **Les classes qu'`AD-27.2` refuse** — irréversible, envoi externe, classe
          inconnue. La décision appartient à `monitor.observes`, pas à ce site
          d'appel : la garantie voyage avec la fonction.
        * **Aucune identité, ou magasin injoignable** → on applique. `AD-10` : une
          panne resserre une garde, elle n'en relâche pas.
        """
        ctx = self._approval_ctx
        if ctx is None or ctx.gateway_token_id is None:
            return False
        if outcome.reason == "taint":
            return False
        if not monitor.observes(outcome.action_class):
            return False
        try:
            with db.connection(ctx.database_url) as conn:
                window = monitor.active_window(conn, ctx.tenant_id, ctx.gateway_token_id)
        except Exception:
            logger.warning("monitor_lookup_failed", extra={"tenant": ctx.tenant_id})
            return False
        return window is not None

    async def _screen_tools(self, tools: list[types.Tool]) -> list[types.Tool]:
        """Fingerprint each tool; expose only approved/unchanged ones, quarantine the rest."""
        ctx = self._approval_ctx
        if ctx is None:  # pragma: no cover - guaranteed non-None by _integrity_on
            return list(tools)
        exposed: list[types.Tool] = []
        # Clé : le nom **public**, celui que l'agent emploiera et que `_integrity_blocks`
        # consulte. Valeur : le statut, la raison, et le nom **canonique** pour l'audit.
        # Les deux sont nécessaires et ne se déduisent pas l'un de l'autre.
        quarantined: dict[str, tuple[integrity.ToolStatus, str | None, str]] = {}
        with db.connection(ctx.database_url) as conn:
            stored = integrity.get_fingerprints(conn, ctx.tenant_id)
            for tool in tools:
                resolved = await self._proxy.resolve(tool.name)
                server = resolved[0] if resolved else "?"
                fp = integrity.fingerprint(tool.name, tool.description, tool.inputSchema)
                poison = integrity.detect_poison(tool.description)
                status = integrity.evaluate_tool(fp, poison, stored.get((server, tool.name)))
                integrity.record_sighting(
                    conn, tenant_id=ctx.tenant_id, server=server, tool_name=tool.name, fp=fp
                )
                if status is integrity.ToolStatus.new and self._policy.defaults.auto_approve_tools:
                    integrity.approve(
                        conn, tenant_id=ctx.tenant_id, server=server, tool_name=tool.name
                    )
                    status = integrity.ToolStatus.ok
                if status is integrity.ToolStatus.ok:
                    exposed.append(tool)
                else:
                    # Le nom canonique, formé comme partout ailleurs (`server.outil`),
                    # avec le même repli sur le nom nu quand la résolution échoue.
                    canonique = f"{server}.{tool.name}" if resolved else tool.name
                    quarantined[tool.name] = (status, poison, canonique)
            conn.commit()
        self._quarantined = set(quarantined)
        # Le nom **canonique**, comme les quatre autres gardes. Ce site-ci journalisait
        # le nom nu : le même outil apparaissait donc dans `audit_log` sous « echo » à
        # la mise en quarantaine et sous « mock.echo » partout ailleurs, si bien qu'un
        # export filtré par nom d'outil manquait les mises en quarantaine. Trouvé en
        # appariant les deux colonnes du rejeu (`L6`), qui affichaient deux noms pour
        # le même appel.
        for _public, (status, reason, canonique) in quarantined.items():
            self._audit_gate(canonique, _INTEGRITY_DECISION[status], reason)
        return exposed

    def _stop_blocks(self, outcome: PolicyOutcome) -> str | None:
        """La décision d'audit si cet agent est arrêté, ou ``None`` s'il peut continuer.

        `FR-166`. Trois états de plan de contrôle sont gelés au démarrage du processus
        MCP — le jeton, la policy, la liste des serveurs — et aucun n'est relu ensuite.
        Un opérateur qui révoque le jeton d'un agent ne l'arrête donc pas tant qu'il ne
        se reconnecte pas, alors que `/v1/authorize` relit le même jeton à chaque
        requête. Ce n'était pas un choix : c'est une divergence d'ingestion (`AD-28`),
        et elle porte sur la porte obligatoire.

        Ce garde ne relit que le jeton — l'ordre d'arrêt qui existe déjà
        (`POST /v1/gateway-tokens/{id}/revoke`, `cli token revoke`, le bouton console).
        La policy et les serveurs restent gelés ; les dégeler demande de décider ce
        qu'une republication en cours de session doit faire d'un appel en vol, et ce
        n'est pas la question de ce FR.

        **Direction d'échec.** Un état d'arrêt illisible refuse tout sauf la lecture.
        C'est plus strict que les deux autres gardes qui plafonnent aux classes
        risquées (`service_down_verdict`, `_taint_blocks`), et délibérément : ceux-là
        arbitrent une heuristique ou une file d'attente, celui-ci exécute un ordre
        explicite d'un humain. Un arrêt d'urgence s'invoque pendant un incident,
        c'est-à-dire au moment précis où la base est dégradée — un arrêt qui cesse de
        valoir quand la base tousse n'est pas un arrêt.
        """
        ctx = self._approval_ctx
        if ctx is None or ctx.gateway_token_id is None:
            return None  # pas d'identité d'agent : les autres gardes tiennent ce cas
        try:
            with db.connection(ctx.database_url) as conn:
                if not tenant_tokens.revoked(conn, ctx.tenant_id, ctx.gateway_token_id):
                    return None
        except Exception:
            logger.warning("stop_state_unreadable", extra={"tenant_id": ctx.tenant_id})
            if outcome.action_class is ActionClass.read:
                return None
            self._stop_reason = "stop state unreadable"
            return "stop_state_unreadable"
        self._stop_reason = "agent stopped by an operator (token revoked)"
        return "agent_stopped"

    def _rbac_blocks(self, canonical: str) -> str | None:
        """Reason a call must be refused by per-tool RBAC, or None if allowed.

        A tool may pin ``constraints.allowed_clients`` to a set of client ids; only
        agents belonging to one of them may call it (confused-deputy guard).
        """
        rule = self._policy.rule_for(canonical)
        if rule is None:
            return None
        allowed = rule.constraints.get("allowed_clients")
        if isinstance(allowed, list) and allowed:
            client_id = self._approval_ctx.client_id if self._approval_ctx else None
            if client_id not in allowed:
                return "client_not_allowed"
        return None

    async def _integrity_blocks(self, name: str) -> str | None:
        """Reason a call must be refused by the integrity guard, or None if clear."""
        if name in self._quarantined:
            return "quarantined"
        ctx = self._approval_ctx
        if ctx is None:  # pragma: no cover - guaranteed non-None by _integrity_on
            return None
        resolved = await self._proxy.resolve(name)
        server = resolved[0] if resolved else "?"
        with db.connection(ctx.database_url) as conn:
            stored = integrity.get_fingerprints(conn, ctx.tenant_id).get((server, name))
        # Fail-closed: only an approved, unchanged baseline is callable.
        if stored is None or not stored.approved:
            return "unapproved"
        return None

    def _apply_risk(
        self, canonical: str, outcome: PolicyOutcome, arguments: dict[str, Any]
    ) -> PolicyOutcome:
        """Tighten an `auto` outcome by its deterministic risk score (opt-in)."""
        bands = self._policy.defaults.risk_bands
        ctx = self._approval_ctx
        if bands is None or ctx is None or outcome.decision is not Approval.auto:
            return outcome
        # Même repli que `core/decision.py` : ici l'exception ne devenait pas un 500
        # mais un résultat d'erreur MCP, ce qui revient au même pour l'agent — on lui
        # doit un verdict, pas une panne. `(False, 0)` est l'entrée la plus stricte.
        try:
            with db.connection(ctx.database_url) as conn:
                seen, streak = trust.observed(conn, tenant_id=ctx.tenant_id, tool=canonical)
        except Exception:
            logger.warning(
                "trust_lookup_failed", extra={"tool": canonical, "tenant_id": ctx.tenant_id}
            )
            seen, streak = False, 0
        tier = risk.escalate_by_risk(
            outcome.decision,
            outcome.action_class,
            arguments,
            bands,
            seen_before=seen,
            clean_streak=streak,
        )
        if tier is outcome.decision:
            return outcome
        return replace(outcome, decision=tier, reason="risk")

    def _taint_blocks(self, outcome: PolicyOutcome, arguments: dict[str, Any]) -> bool:
        """Whether a risky action is gated because this agent is tainted (M12).

        `AD-10`: a taint that cannot be read is not a clean one. Every failure path
        answers *tainted*, so an unreachable store gates the irreversible instead of
        waving it through.

        `FR-185` élargit le déclencheur : au-delà des deux classes risquées, **une
        cible en forme d'exfiltration dans les arguments** suffit. La DLP devient une
        entrée de la décision post-taint plutôt qu'un produit à part. Un `write` vers
        un webhook externe n'est pas gaté en temps normal — dans une session où une
        injection vient d'être détectée, il l'est.

        Le coût en faux positifs est borné par le taint lui-même : hors session
        teintée, rien de ceci ne s'applique.
        """
        defaults = self._policy.defaults
        if defaults.taint_policy == "off":
            return False
        risquee = outcome.action_class in (ActionClass.irreversible, ActionClass.external_send)
        cible = exfiltration_target(arguments)
        if not risquee and cible is None:
            return False
        self._exfil_target = cible
        ctx = self._approval_ctx
        if ctx is None or ctx.gateway_token_id is None:
            logger.warning("taint_unresolvable", extra={"reason": "no_agent_identity"})
            self._taint_reason = "taint_unresolvable"
            return True
        try:
            with db.connection(ctx.database_url) as conn:
                taint = taint_store.active(conn, ctx.tenant_id, ctx.gateway_token_id)
        except Exception:
            logger.warning("taint_store_unreadable", extra={"tenant_id": ctx.tenant_id})
            self._taint_reason = "taint_store_unreadable"
            return True
        if taint is None:
            self._taint_reason = None
            return False
        # La raison nomme les deux signaux quand les deux sont là : « teinté » seul ne
        # dirait pas à un opérateur *pourquoi cette action-ci* a été retenue alors
        # qu'une autre du même palier est passée.
        self._taint_reason = f"{taint.reason}+{cible}" if cible else taint.reason
        return True

    def _mark_taint(self, canonical: str, result: types.CallToolResult) -> None:
        """Taint this agent if a relayed tool result looks like an injection (M12)."""
        if self._policy.defaults.taint_policy == "off":
            return
        reason = taints_result(_result_text(result))
        if reason is None:
            return
        ctx = self._approval_ctx
        if ctx is None or ctx.gateway_token_id is None:  # pragma: no cover - guarded above
            logger.warning("taint_not_recorded", extra={"tool": canonical})
            return
        try:
            with db.connection(ctx.database_url) as conn:
                taint_store.mark(
                    conn,
                    tenant_id=ctx.tenant_id,
                    gateway_token_id=ctx.gateway_token_id,
                    window_seconds=self._policy.defaults.taint_window_seconds,
                    source_tool=canonical,
                    reason=reason,
                )
                conn.commit()
        except Exception:
            # The write failed, so the next call reads no taint. Say so loudly: this
            # is the one path where a store failure loses a guard rather than
            # tightening one.
            logger.warning("taint_write_failed", extra={"tool": canonical, "reason": reason})
        else:
            # Dans le `else`, jamais après le `try`. L'appel était inconditionnel :
            # sur un journal append-only qu'on ne peut pas corriger, la chaîne
            # attestait un garde qui n'avait pas eu lieu — et `core/export.py` le
            # range en `guard_recorded` pour un régulateur.
            self._audit_gate(canonical, "taint_marked", reason)

    def _audit_gate(self, tool_name: str, decision: str, reason: str | None) -> None:
        """Best-effort audit of a pre-policy gate decision (integrity / rbac)."""
        ctx = self._approval_ctx
        if ctx is None:  # pragma: no cover - gate audits only fire with a context
            return
        try:
            with db.connection(ctx.database_url) as conn:
                audit.log_event(
                    conn,
                    tenant_id=ctx.tenant_id,
                    decision=decision,
                    tool_name=tool_name,
                    error=reason,
                    # Qui a fait ça. Sans cette ligne, tout refus de garde sur la porte
                    # obligatoire est anonyme — voir la note de `_audit`.
                    gateway_token_id=ctx.gateway_token_id,
                    origin=audit.Origin.mcp_gateway(),
                )
        except Exception:  # audit is best-effort; never break the call path
            logger.warning("gate_audit_failed", extra={"tool": tool_name})

    def _audit(
        self,
        decision: str,
        canonical: str,
        outcome: PolicyOutcome,
        arguments: dict[str, Any],
        *,
        latency_ms: int | None = None,
        request_id: str | None = None,
        error: str | None = None,
    ) -> bool:
        """Écrit la ligne d'audit. Rend `False` si elle n'a pas pu l'être.

        Le retour est ce qui permet à l'appelant de refuser plutôt que de relayer :
        avant, l'échec était avalé ici même et l'appelant ne pouvait pas savoir.
        """
        ctx = self._approval_ctx
        if ctx is None:
            return False
        try:
            with db.connection(ctx.database_url) as conn:
                audit.log_event(
                    conn,
                    tenant_id=ctx.tenant_id,
                    decision=decision,
                    user_id=ctx.requested_by,
                    request_id=request_id,
                    tool_name=canonical,
                    action_class=outcome.action_class.value if outcome.action_class else None,
                    policy_rule_id=outcome.rule_name,
                    judge_used=outcome.judge_used,
                    args_hash=approvals.args_hash(arguments),
                    latency_ms=latency_ms,
                    error=error,
                    # **Qui** a fait ça. Le proxy LLM le passait (`api/llm_proxy.py`), le
                    # gateway non : toute ligne d'audit du chemin MCP était anonyme, et la
                    # colonne existe pourtant depuis `0006`. Deux fonctionnalités livrées
                    # s'en nourrissent et rendaient donc zéro sur la porte obligatoire —
                    # le compte d'actions par agent (`core/agents.py`) et par client
                    # (`core/clients.py`), plus le filtre `agent` de l'explorateur d'audit
                    # (`core/audit.py`). `scripts/seed_demo.py` l'écrit, lui : la
                    # démonstration affichait une attribution que le produit ne produisait
                    # pas.
                    gateway_token_id=ctx.gateway_token_id,
                    # The mandatory door: an agent speaking MCP cannot route around it.
                    origin=audit.Origin.mcp_gateway(),
                )
        except Exception:
            logger.warning("audit_write_failed", extra={"tool": canonical, "decision": decision})
            return False
        return True

    async def _handle_hitl(
        self, name: str, arguments: dict[str, Any], canonical: str, outcome: PolicyOutcome
    ) -> types.CallToolResult:
        ctx = self._approval_ctx
        if ctx is None:
            return _denied_result(
                f"'{canonical}' requires approval ({outcome.decision.value}); HITL not configured"
            )
        required = 2 if outcome.decision is Approval.human_dual else 1
        try:
            reponse = await self._run_approval_flow(
                ctx, name, arguments, canonical, outcome, required
            )
        except Exception:
            # Approval service unavailable. Same shared verdict as the cooperative
            # path (AD-37): deny on irreversible / external_send / unknown class,
            # otherwise the tenant's declared `on_approval_service_down`, which until
            # now nothing read (CLAUDE.md §4.4).
            logger.exception("approval_service_error", extra={"tool": canonical})
            verdict = service_down_verdict(self._policy, outcome.action_class)
            # Les deux branches laissent une ligne. Aucune n'en écrivait, alors que le
            # jumeau coopératif le fait et que les deux se réclament du même `AD-37` :
            # la décision la plus discutable du produit — relayer sans avoir pu tenir
            # l'humain — était la seule à ne pas être écrite.
            # `is not auto` et non `is deny` : toute valeur future ajoutée à l'enum
            # tombe du côté fermé. `on_approval_service_down` est désormais borné à
            # deux valeurs au parse, donc ce test est redondant aujourd'hui — et c'est
            # exactement la propriété qu'on veut garder le jour où la borne bouge.
            refus = verdict is not Approval.auto
            self._audit(
                "deny" if refus else "allow",
                canonical,
                outcome,
                arguments,
                request_id=uuid4().hex,
                error="approval_service_unavailable",
            )
            if refus:
                return _denied_result(f"'{canonical}' held: approval service unavailable")
            return await self._proxy.call_tool(name, arguments)

        # **L'exécution est ici, hors du `try`, et c'est tout l'objet du correctif.**
        #
        # Elle vivait à l'intérieur de `_run_approval_flow`, donc à l'intérieur du
        # bloc gardé ci-dessus, et **après** `consume()` + `commit()` + la ligne
        # `hitl_approved`. Une coupure vers le serveur aval survenue une fois l'outil
        # exécuté remontait alors dans le `except`, était diagnostiquée « service
        # d'approbation indisponible », et la dernière ligne **rappelait
        # `call_tool`** : l'action qu'un humain venait d'approuver s'exécutait une
        # seconde fois. Sur un virement, c'est deux virements.
        #
        # Le flux rend désormais une décision, pas un effet. `None` veut dire
        # « approuvé et consommé, à toi de relayer » — le seul cas où l'on agit.
        if reponse is not None:
            return reponse
        try:
            return await self._proxy.call_tool(name, arguments)
        except Exception:
            # Et l'échec aval devient une réponse, pas une exception qui remonte au
            # `except` d'à côté. L'approbation est consommée, l'outil a peut-être agi :
            # c'est ce que l'agent doit lire, plutôt qu'« indisponible » — le message
            # que l'ancien code servait après avoir exécuté l'action.
            logger.exception("downstream_failed_after_approval", extra={"tool": canonical})
            return _denied_result(
                f"'{canonical}' was approved and attempted, but the downstream server "
                "failed: the outcome is unknown. The approval is consumed — retrying "
                "requires a new one."
            )

    async def _run_approval_flow(
        self,
        ctx: ApprovalContext,
        name: str,
        arguments: dict[str, Any],
        canonical: str,
        outcome: PolicyOutcome,
        required: int,
    ) -> types.CallToolResult | None:
        """La décision d'approbation, **sans l'exécuter**.

        Rend `None` quand l'appel est approuvé et consommé : c'est à l'appelant de
        relayer, hors de tout bloc `try` qui pourrait le rejouer. Tout autre cas
        rend la réponse à servir telle quelle.
        """
        with db.connection(ctx.database_url) as conn:
            ah = approvals.args_hash(arguments)
            record = approvals.find_active(conn, ctx.tenant_id, canonical, ah)
            if record is not None:
                record = approvals.expire_if_needed(conn, record)
                conn.commit()

            if record is None:
                record = self._create_approval(
                    conn, ctx, canonical, outcome, arguments, ah, required
                )
                summary = record.dry_run.get("summary", "")
                _notify(ctx.notifier, record.id, summary, record.expires_at.isoformat())
                self._audit("hitl_pending", canonical, outcome, arguments, request_id=record.id)
                return _requires_approval_result(record.id, summary)

            if record.status == "pending":
                # Repeated poll while awaiting humans: no new audit entry.
                return _requires_approval_result(record.id, record.dry_run.get("summary", ""))
            if record.status == "approved":
                if approvals.consume(conn, record.id):
                    conn.commit()
                    self._audit(
                        "hitl_approved", canonical, outcome, arguments, request_id=record.id
                    )
                    # Approuvé et consommé. On ne relaie PAS ici : voir `_handle_hitl`.
                    return None
                conn.commit()
                return _denied_result(f"'{canonical}' approval already consumed")

            # Terminal (denied/expired): record once, then consume so a later
            # re-invocation asks afresh instead of re-logging.
            approvals.consume(conn, record.id)
            conn.commit()
            decision = "hitl_denied" if record.status == "denied" else "expired"
            self._audit(decision, canonical, outcome, arguments, request_id=record.id)
            return _denied_result(f"'{canonical}' approval {record.status}")

    def _create_approval(
        self,
        conn: Any,
        ctx: ApprovalContext,
        canonical: str,
        outcome: PolicyOutcome,
        arguments: dict[str, Any],
        ah: str,
        required: int,
    ) -> approvals.ApprovalRecord:
        action_class = outcome.action_class.value if outcome.action_class else None
        dry_run = approvals.build_dry_run(canonical, action_class, arguments)
        expires_at = datetime.now(UTC) + timedelta(seconds=ctx.timeout_seconds)
        record = approvals.create(
            conn,
            tenant_id=ctx.tenant_id,
            request_id=uuid4().hex,
            tool_name=canonical,
            action_class=action_class,
            ah=ah,
            arguments_summary=approvals.redact(arguments),
            dry_run=dry_run,
            required_count=required,
            expires_at=expires_at,
            requested_by=ctx.requested_by,
        )
        conn.commit()
        logger.info("approval_created", extra={"tool": canonical, "approval_id": record.id})
        return record


def _requires_approval_result(approval_id: str, summary: str) -> types.CallToolResult:
    return _denied_result(f"requires_approval approval_id={approval_id} :: {summary}")


def _notify(notifier: Notifier | None, approval_id: str, summary: str, expires_at: str) -> None:
    if notifier is None:
        return
    try:
        notifier.notify_approval(approval_id=approval_id, summary=summary, expires_at=expires_at)
    except Exception:  # best-effort; a missed notification leaves the action pending (safe)
        logger.warning("approval_notify_failed", extra={"approval_id": approval_id})


def authenticate_session(database_url: str, raw_token: str) -> tuple[str, str]:
    """Resolve ``(tenant_id, token_id)`` for an MCP session, or raise PermissionError.

    Fail-closed (CLAUDE.md §4.4): a missing/unknown/revoked token is refused. The
    token id travels with the tenant because it is the agent's identity, and the
    persisted taint is keyed on it (`FR-154`).
    """
    with db.connection(database_url) as conn:
        tenant_id, token_id = authenticate_gateway_session(conn, raw_token)
        conn.commit()
    return tenant_id, token_id


def build_server(backend: ToolBackend | None = None) -> Server:
    """Construct the MCP gateway server with its request handlers registered."""
    active_backend: ToolBackend = backend or EmptyBackend()
    server: Server = Server(SERVER_NAME)

    # The MCP SDK's decorator factories are not return-annotated upstream, so mypy
    # (strict) flags the call/decorator as untyped. warn_unused_ignores=true will
    # tell us to drop these if the SDK ever annotates them.
    @server.list_tools()  # type: ignore[no-untyped-call, untyped-decorator]
    async def _list_tools() -> list[types.Tool]:
        return await active_backend.list_tools()

    @server.call_tool()  # type: ignore[untyped-decorator]
    async def _call_tool(name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        return await active_backend.call_tool(name, arguments)

    return server


def _build_backend(
    database_url: str,
    tenant_id: str,
    client_id: str | None = None,
    gateway_token_id: str | None = None,
) -> PolicyBackend:  # pragma: no cover - I/O glue
    from core import policy_store, servers
    from core.config import get_settings
    from core.judge import build_judge
    from core.notify import build_notifier

    settings = get_settings()
    with db.connection(database_url) as conn:
        rows = servers.enabled_specs(conn, tenant_id)
        policy = policy_store.load_policy(conn, tenant_id)
    specs = [
        ServerSpec(name=name, transport=transport, config=config)
        for name, transport, config in rows
    ]
    ctx = ApprovalContext(
        database_url=database_url,
        tenant_id=tenant_id,
        timeout_seconds=policy.defaults.hitl_timeout_seconds,
        notifier=build_notifier(settings),
        client_id=client_id,
        gateway_token_id=gateway_token_id,
    )
    return PolicyBackend(policy, DownstreamProxy(specs), ctx, build_judge(settings))


def prepare_runtime(settings: Settings) -> None:
    """Installe les journaux et Sentry pour une session de passerelle.

    **Ce qui manquait, et ce que ça coûtait.** `run_stdio` n'appelait ni
    `configure_logging` ni `init_observability` — un `grep` du dépôt ne trouvait
    ces deux fonctions qu'à un seul endroit, `api/main.py`. Le résultat, mesuré :
    racine sans handler, niveau `WARNING`. Vingt des quarante points de
    journalisation du dépôt vivent ici, sur la seule voie **contraignante**, et
    aucun n'existait en production. Tous les `logger.info` du chemin d'exécution
    — outil mis en quarantaine, refus RBAC, agent stoppé, action teintée refusée,
    outil refusé, approbation créée — n'émettaient rien du tout. Les alarmes
    sortaient nues par `logging.lastResort` : `audit_write_failed` arrivait sans
    tenant, sans outil, sans date, non parsable. Et aucun plantage ne remontait.

    Extraite de `run_stdio` pour être testable : `run_stdio` ouvre un transport
    stdio réel et porte `# pragma: no cover`, si bien que tout ce qu'on y écrit
    échappe à la suite.
    """
    configure_logging(settings.log_level)
    init_observability(settings)


async def run_stdio() -> None:  # pragma: no cover - exercised via real MCP transport
    """Run the gateway over stdio (how an agent launches it).

    Refuses to start without a valid tenant token (fail-closed).
    """
    from mcp.server.stdio import stdio_server

    from core.config import get_settings

    settings = get_settings()
    prepare_runtime(settings)
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required to authenticate the gateway session")
    raw_token = os.environ.get(TENANT_TOKEN_ENV, "")
    tenant_id, token_id = authenticate_session(settings.database_url, raw_token)  # raises
    with db.connection(settings.database_url) as conn:
        client_id = tenant_tokens.resolve_client_id(conn, raw_token)

    server = build_server(_build_backend(settings.database_url, tenant_id, client_id, token_id))
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


def main() -> None:  # pragma: no cover - thin entrypoint
    import anyio

    anyio.run(run_stdio)


if __name__ == "__main__":  # pragma: no cover
    main()

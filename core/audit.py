"""Immutable, hash-chained audit log (SPEC §9, M5).

Per event: read the tenant's last entry_hash (or "GENESIS"), build a canonical
JSON payload, and chain entry_hash = sha256(prev_hash + payload). Writes are
serialized per tenant with an advisory lock so the chain has no races. Only
metadata + args_hash is ever stored — never argument values or PII (§4.10).
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

import psycopg

from core.export import is_summarised

logger = logging.getLogger("xsom.audit")

GENESIS = "GENESIS"

_INSERT_COLS = (
    "ts, tenant_id, user_id, request_id, tool_name, action_class, decision, "
    "policy_rule_id, judge_used, args_hash, latency_ms, error, prev_hash, entry_hash"
)


class Ingress(StrEnum):
    """The door a tool call came through. Three doors, three different guarantees.

    Not interchangeable, which is why the audit row has to say which one: the MCP
    gateway is *mandatory* (an agent cannot route around it), `/v1/authorize` is
    cooperative (an agent can simply not ask), and the LLM proxy removes a tool
    call from a response rather than standing between the agent and the act.
    `AD-28` requires a coverage claim to carry its ingress path; until the log
    carried it, the claim could not be evidenced from the log.
    """

    mcp_gateway = "mcp_gateway"
    authorize_api = "authorize_api"
    llm_proxy = "llm_proxy"


class EnforcementMode(StrEnum):
    """Whether an observation window was open on this agent at the time."""

    enforcing = "enforcing"
    observing = "observing"


@dataclass(frozen=True, slots=True)
class Origin:
    """Which door, and in what posture — derived, never declared (FR-160 / INV-2).

    Built by the ingestion adapter from what it knows about *itself* and from the
    control plane. There is deliberately no constructor taking a string: a value
    that cannot be built out of untrusted input cannot be smuggled in from a
    request body, which is the requirement rather than a nicety.

    `log_event` takes one of these and requires it, so a fourth adapter cannot
    reach the audit log without saying which door it is — mypy refuses the call.
    """

    ingress: Ingress
    enforcement_mode: EnforcementMode = EnforcementMode.enforcing

    @classmethod
    def mcp_gateway(cls) -> Origin:
        """The mandatory path: no observation window is consulted here."""
        return cls(Ingress.mcp_gateway)

    @classmethod
    def authorize_api(cls) -> Origin:
        """The cooperative path: no observation window is consulted here either."""
        return cls(Ingress.authorize_api)

    @classmethod
    def llm_proxy(cls, *, observing: bool) -> Origin:
        """The proxy path. `observing` comes from the control plane (`G-25`)."""
        mode = EnforcementMode.observing if observing else EnforcementMode.enforcing
        return cls(Ingress.llm_proxy, mode)


_CHAIN_COLS = (
    "id, ts, tenant_id, user_id, request_id, tool_name, action_class, decision, "
    "policy_rule_id, judge_used, args_hash, latency_ms, error, prev_hash, entry_hash"
)


@dataclass(frozen=True)
class ChainResult:
    ok: bool
    broken_id: int | None = None
    count: int = 0


#: Longueur maximale d'un champ de la charge hachée alimenté depuis l'extérieur.
#:
#: `FR-163`. `audit_log` est append-only jusque pour `service_role` et n'a aucun
#: chemin d'effacement : ce qui entre dans la charge y reste. Or deux des trois portes
#: laissaient passer une chaîne **choisie par un tiers** — un nom d'outil que la
#: résolution MCP n'a pas reconnu (donc choisi par l'agent), et le nom d'outil lu dans
#: la réponse du fournisseur LLM. La troisième, `AuthorizeRequest.tool`, posait déjà
#: cette borne exacte ; l'écart n'était pas qu'il fallait choisir une limite, c'est que
#: deux portes sur trois ne l'appliquaient pas (`AD-28`).
MAX_FIELD = 200


def _bounded(value: object | None) -> str | None:
    """Borner un champ **avant** qu'il n'entre dans le hachage.

    Tronquer, jamais lever : les six appelants enveloppent ``log_event`` dans un
    best-effort, donc lever ferait *disparaître* la ligne d'audit d'un appel refusé.
    Perdre la preuve est pire que la borner.

    La valeur tronquée est celle qui est hachée **et** celle qui est insérée.
    ``verify_chain`` recalcule depuis les colonnes stockées : borner d'un seul côté
    rendrait l'entrée définitivement invérifiable, sur une table qu'aucun UPDATE ne
    répare.

    La coercition en chaîne n'est pas de la défense en profondeur. Un amont qui
    renvoie ``name: {"a": 1}`` fait échouer l'insertion dans une colonne ``text``,
    donc emporte l'écriture d'audit avec elle : le nom d'outil malformé était une
    suppression de sa propre trace.
    """
    if value is None:
        return None
    text = value if isinstance(value, str) else str(value)
    return text if len(text) <= MAX_FIELD else text[: MAX_FIELD - 1] + "\u2026"


def canonical_ts(value: datetime) -> str:
    """La représentation canonique de l'horodatage dans la charge v1.

    Figée : ``datetime.astimezone(UTC).isoformat()``. Suffixe toujours ``+00:00``,
    jamais ``Z`` ; partie fractionnaire **absente** quand les microsecondes sont
    nulles. Toute autre forme change les octets hachés et rend invérifiable la chaîne
    déjà écrite — voir ``docs/AUDIT_FORMAT.md``, qui est le contrat.

    Cette fonction existe pour qu'il y ait **un** endroit à changer, et donc un seul
    à défendre : l'expression était répétée littéralement sur quatre sites, et une
    modification cohérente des quatre restait invisible pour toute la suite, qui
    écrit et vérifie dans le même processus.

    Un horodatage naïf est refusé plutôt que supposé UTC : supposer produit une entrée
    fausse *et* vérifiable, ce qui est le pire des deux mondes (`CLAUDE.md` §9).
    """
    if value.tzinfo is None:
        raise ValueError("audit ts must be timezone-aware")
    return value.astimezone(UTC).isoformat()


def payload_v1(
    *,
    ts_iso: str,
    tenant_id: str,
    user_id: str | None,
    request_id: str | None,
    tool_name: str | None,
    action_class: str | None,
    decision: str,
    policy_rule_id: str | None,
    judge_used: bool,
    args_hash: str | None,
    latency_ms: int | None,
    error: str | None,
) -> str:
    event = {
        "ts": ts_iso,
        "tenant_id": tenant_id,
        "user_id": user_id,
        "request_id": request_id,
        "tool_name": tool_name,
        "action_class": action_class,
        "decision": decision,
        "policy_rule_id": policy_rule_id,
        "judge_used": judge_used,
        "args_hash": args_hash,
        "latency_ms": latency_ms,
        "error": error,
    }
    return json.dumps(event, sort_keys=True, separators=(",", ":"))


# Public, and named for its version: `AD-1` freezes this shape, and the demo seeder
# (`scripts/seed_demo.py`) has to build the same bytes to lay down a chain that
# `verify_chain` accepts. Publishing the function is how the two stay identical --
# a second implementation of the payload would drift, and a drifted verifier is a
# verifier that passes a log it should reject. It grants nothing: the shape is in
# the source either way.


# The rule this module holds (FR-161 / INV-3): **only server-derived values enter
# `payload_v1`**. Anything a client or an upstream declared is an annex column. Two
# reasons, and the second is the one that bites: a declared value in the hashed
# payload lets whoever declares it choose part of what the chain attests, and an
# export reader cannot tell an attested fact from a repeated claim.


def compute_entry_hash(prev_hash: str, payload: str) -> str:
    return hashlib.sha256((prev_hash + payload).encode("utf-8")).hexdigest()


def log_event(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    decision: str,
    user_id: str | None = None,
    request_id: str | None = None,
    tool_name: str | None = None,
    action_class: str | None = None,
    policy_rule_id: str | None = None,
    judge_used: bool = False,
    args_hash: str | None = None,
    latency_ms: int | None = None,
    error: str | None = None,
    origin: Origin,
    gateway_token_id: str | None = None,
    client_request_id: str | None = None,
    upstream_request_id: str | None = None,
    #: Pourquoi la décision a été resserrée hors policy (`plan_quota_exhausted`…).
    #: Colonne ANNEXE : hors `payload_v1`, donc la chaîne déjà écrite reste
    #: vérifiable — même choix que `gateway_token_id` en `0006`.
    constraint_reason: str | None = None,
    #: La métrique de gamme à débiter, **dans cette transaction**. Le compteur est
    #: incrémenté sous le verrou consultatif déjà tenu ici : pas de verrou de plus,
    #: pas d'ordre de verrouillage de plus. Et le débit vit dans son propre point de
    #: sauvegarde, pour qu'une écriture de facturation ne puisse jamais faire perdre
    #: une écriture de preuve (§4.2).
    usage_metric: str | None = None,
) -> str:
    """Append one hash-chained audit entry for a decision. Returns its entry_hash.

    `request_id` must be server-derived; `client_request_id` (what the agent
    called it) and `upstream_request_id` (what the LLM provider called it) are
    declared values and are kept apart from it — see the note above `log_event`.
    """
    # **Une décision que le récit de conformité ne sait pas ranger s'annonce ici.**
    #
    # Elle n'est pas refusée : §4.2 dit que rien d'accessoire ne casse une écriture
    # d'audit, et `summarise` la compte déjà honnêtement en `unclassified`. Mais elle
    # cesse d'être silencieuse — et `tests/conftest.py` fait échouer tout test qui en
    # écrit une, ce qui rend le garde complet par construction : il voit toutes les
    # décisions réellement écrites, y compris celles qu'aucun scan du code ne
    # retrouve parce qu'elles sont calculées ou lues dans une table.
    if not is_summarised(decision):
        logger.warning("decision_not_summarised", extra={"decision": decision})
    ts = datetime.now(UTC)
    # `FR-163` : borner AVANT le hachage, et hacher exactement ce qui sera stocké.
    tool_name = _bounded(tool_name)
    policy_rule_id = _bounded(policy_rule_id)
    error = _bounded(error)
    with conn.transaction():
        # Serialize chain writes per tenant to avoid two entries sharing a prev_hash.
        conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (tenant_id,))
        prev_row = conn.execute(
            "select entry_hash from audit_log where tenant_id = %s order by id desc limit 1",
            (tenant_id,),
        ).fetchone()
        prev_hash = prev_row[0] if prev_row else GENESIS
        payload = payload_v1(
            ts_iso=canonical_ts(ts),
            tenant_id=tenant_id,
            user_id=user_id,
            request_id=request_id,
            tool_name=tool_name,
            action_class=action_class,
            decision=decision,
            policy_rule_id=policy_rule_id,
            judge_used=judge_used,
            args_hash=args_hash,
            latency_ms=latency_ms,
            error=error,
        )
        entry_hash = compute_entry_hash(prev_hash, payload)
        # ANNEX columns: agent attribution and the two declared identifiers. None of
        # them is part of `payload`/the hash chain, so existing entries keep verifying
        # (§4.2, AD-1) -- and none of them is attested by it either.
        conn.execute(
            "insert into audit_log "
            "(ts, tenant_id, user_id, request_id, tool_name, action_class, decision, "
            " policy_rule_id, judge_used, args_hash, latency_ms, error, gateway_token_id, "
            " client_request_id, upstream_request_id, ingress, enforcement_mode, "
            " prev_hash, entry_hash, constraint_reason) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
            "%s)",
            (
                ts,
                tenant_id,
                user_id,
                request_id,
                tool_name,
                action_class,
                decision,
                policy_rule_id,
                judge_used,
                args_hash,
                latency_ms,
                error,
                gateway_token_id,
                client_request_id,
                upstream_request_id,
                origin.ingress.value,
                origin.enforcement_mode.value,
                prev_hash,
                entry_hash,
                _bounded(constraint_reason),
            ),
        )
        if usage_metric is not None:
            # Après l'insertion, et sous point de sauvegarde : la preuve est déjà
            # écrite quand le compteur s'exécute, et son échec ne peut rien lui faire.
            _debiter(conn, tenant_id, usage_metric)
    return entry_hash


def _debiter(conn: psycopg.Connection, tenant_id: str, metric: str) -> None:
    """Débiter la métrique de gamme sans jamais compromettre l'entrée d'audit."""
    from core import entitlements  # importé ici : `entitlements` ne dépend pas d'`audit`

    try:
        entitlements.consume(conn, tenant_id, entitlements.Metric(metric))
    except Exception:  # pragma: no cover - `consume` avale déjà tout
        logger.warning("usage_debit_failed", extra={"tenant_id": tenant_id, "metric": metric})


def verify_chain(conn: psycopg.Connection, tenant_id: str | None = None) -> ChainResult:
    """Recompute the chain; report the first tampered/broken row id, if any."""
    if tenant_id is None:
        rows = conn.execute(f"select {_CHAIN_COLS} from audit_log order by id").fetchall()
    else:
        rows = conn.execute(
            f"select {_CHAIN_COLS} from audit_log where tenant_id = %s order by id",
            (tenant_id,),
        ).fetchall()

    last_hash_by_tenant: dict[str, str] = {}
    for r in rows:
        row_tenant = r[2]
        expected_prev = last_hash_by_tenant.get(row_tenant, GENESIS)
        stored_prev, stored_entry = r[13], r[14]
        if stored_prev != expected_prev:
            return ChainResult(ok=False, broken_id=r[0], count=len(rows))
        payload = payload_v1(
            ts_iso=canonical_ts(r[1]),
            tenant_id=row_tenant,
            user_id=r[3],
            request_id=r[4],
            tool_name=r[5],
            action_class=r[6],
            decision=r[7],
            policy_rule_id=r[8],
            judge_used=r[9],
            args_hash=r[10],
            latency_ms=r[11],
            error=r[12],
        )
        if compute_entry_hash(stored_prev, payload) != stored_entry:
            return ChainResult(ok=False, broken_id=r[0], count=len(rows))
        last_hash_by_tenant[row_tenant] = stored_entry
    return ChainResult(ok=True, broken_id=None, count=len(rows))


def distinct_tools(conn: psycopg.Connection, tenant_id: str) -> list[str]:
    """Distinct tool names a tenant's agents have actually invoked (observed catalogue)."""
    rows = conn.execute(
        "select distinct tool_name from audit_log "
        "where tenant_id = %s and tool_name is not null order by tool_name",
        (tenant_id,),
    ).fetchall()
    return [r[0] for r in rows]


def list_events(
    conn: psycopg.Connection,
    *,
    from_ts: str | None = None,
    to_ts: str | None = None,
    decision: str | None = None,
    tool: str | None = None,
    agent: str | None = None,
    client_id: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """Tenant-scoped (RLS) audit events with optional filters; metadata only."""
    clauses: list[str] = []
    params: list[Any] = []
    if from_ts:
        clauses.append("ts >= %s")
        params.append(from_ts)
    if to_ts:
        clauses.append("ts <= %s")
        params.append(to_ts)
    if decision:
        clauses.append("decision = %s")
        params.append(decision)
    if tool:
        clauses.append("tool_name = %s")
        params.append(tool)
    if agent:
        clauses.append("gateway_token_id = %s")
        params.append(agent)
    if client_id:
        clauses.append("gateway_token_id in (select id from gateway_tokens where client_id = %s)")
        params.append(client_id)
    where = (" where " + " and ".join(clauses)) if clauses else ""
    params.append(limit)
    rows = conn.execute(
        "select id, ts, tool_name, action_class, decision, policy_rule_id, judge_used, "
        "args_hash, latency_ms, error, user_id, request_id, gateway_token_id, "
        "client_request_id, upstream_request_id, ingress, enforcement_mode from audit_log"
        + where
        + " order by id desc limit %s",
        tuple(params),
    ).fetchall()
    return [
        {
            "id": r[0],
            "ts": canonical_ts(r[1]) if r[1] else None,
            "tool_name": r[2],
            "action_class": r[3],
            "decision": r[4],
            "policy_rule_id": r[5],
            "judge_used": r[6],
            "args_hash": r[7],
            "latency_ms": r[8],
            "error": r[9],
            "user_id": r[10],
            "request_id": r[11],
            "gateway_token_id": str(r[12]) if r[12] else None,
            # Everything above is derived by the server from something it verified.
            # Everything an agent or an upstream merely *said* lives in here, in one
            # labelled box, so a reader of the export cannot mistake a claim for a
            # fact by reading past a flag (FR-161 / INV-3).
            "ingress": r[15],
            "enforcement_mode": r[16],
            "declared": {"client_request_id": r[13], "upstream_request_id": r[14]},
        }
        for r in rows
    ]

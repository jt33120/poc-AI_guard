"""Shared Pydantic models and domain enums."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from core.egress import EgressRejected, Reach, check_url


class Role(StrEnum):
    """Tenant-scoped RBAC roles (mirrors the memberships.role check constraint)."""

    admin = "admin"
    operator = "operator"
    viewer = "viewer"


class SignupRequest(BaseModel):
    """Self-serve account signup: an org and an admin login."""

    model_config = {"extra": "forbid"}

    org: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=128, repr=False)

    @field_validator("email")
    @classmethod
    def _email_shape(cls, value: str) -> str:
        cleaned = value.strip().lower()
        local, _, domain = cleaned.partition("@")
        if not local or "." not in domain:
            raise ValueError("invalid email")
        return cleaned


class CurrentUser(BaseModel):
    """Authenticated principal resolved from a verified Supabase JWT."""

    user_id: str = Field(max_length=64)
    tenant_id: str | None = Field(default=None, max_length=64)
    role: Role | None = None


class Transport(StrEnum):
    """Downstream MCP transport kind."""

    stdio = "stdio"
    http = "http"


def _reject_bad_egress_url(value: Any) -> None:
    """Refuse a downstream URL at write time (FR-164), before any row exists.

    Text-only: a Pydantic validator must not do DNS, so the address a name
    resolves to is judged where the connection is actually made
    (`gateway.downstream.open_session`). This half stops the obvious ones from
    ever reaching the table.
    """
    if not isinstance(value, str):
        raise ValueError("config.url must be a string")
    try:
        check_url(value, reach=Reach.tenant_network)
    except EgressRejected as exc:
        raise ValueError(f"config.url {exc}") from None


class ServerCreate(BaseModel):
    """Payload to declare a downstream MCP server."""

    model_config = {"extra": "forbid"}

    name: str = Field(min_length=1, max_length=80)
    transport: Transport
    config: dict[str, Any]
    enabled: bool = True

    @model_validator(mode="after")
    def _check_transport_config(self) -> ServerCreate:
        if self.transport is Transport.stdio and not self.config.get("command"):
            raise ValueError("stdio transport requires config.command")
        if self.transport is Transport.http:
            if not self.config.get("url"):
                raise ValueError("http transport requires config.url")
            _reject_bad_egress_url(self.config["url"])
        return self


class ServerUpdate(BaseModel):
    """Partial update for a downstream server."""

    model_config = {"extra": "forbid"}

    name: str | None = Field(default=None, min_length=1, max_length=80)
    config: dict[str, Any] | None = None
    enabled: bool | None = None

    @model_validator(mode="after")
    def _check_config_url(self) -> ServerUpdate:
        """An update carrying a `url` is judged like a create carrying one.

        `transport` is immutable and therefore absent here, so the key itself is
        the signal: a `config` with a `url` is going to be fetched, whatever the
        row said before.
        """
        if self.config is not None and self.config.get("url"):
            _reject_bad_egress_url(self.config["url"])
        return self


class ServerOut(BaseModel):
    """A downstream server as returned by the API."""

    id: str
    name: str
    transport: Transport
    config: dict[str, Any]
    enabled: bool


class PolicyDocument(BaseModel):
    """A tenant's policy document and its version."""

    yaml: str
    version: int


class PolicyUpdate(BaseModel):
    """Payload to replace a tenant's policy YAML."""

    model_config = {"extra": "forbid"}

    yaml: str = Field(min_length=1, max_length=100_000)


class PolicyDraftRequest(BaseModel):
    """Natural-language description to draft a policy from (LLM assistant)."""

    model_config = {"extra": "forbid"}

    prompt: str = Field(min_length=1, max_length=2000)


class ToolView(BaseModel):
    """A tool exposed to the agent with its effective policy classification."""

    name: str
    canonical: str
    action_class: str | None
    decision: str


class ApprovalOut(BaseModel):
    """An approval request as shown in the approval queue."""

    id: str
    request_id: str
    tool_name: str
    action_class: str | None
    status: str
    dry_run: dict[str, Any]
    required_count: int
    approved_by: list[str]
    created_at: str | None
    expires_at: str | None
    decided_at: str | None
    decided_by: str | None


class TriageRequest(BaseModel):
    """Diagnostic public de profil (`QO-7`). Collecte de donnée personnelle : bornée."""

    model_config = ConfigDict(extra="forbid")

    profiles: list[Literal["P1a", "P1b", "P2", "P3", "P4", "P5"]] = Field(
        min_length=1, max_length=6
    )
    # `EmailStr` demanderait `email-validator` en dépendance ; la borne de longueur et
    # la validation au bord (`core/leads.capture`) suffisent, et n'ajoutent pas un
    # paquet hors de la liste imposée par CLAUDE.md §3.
    email: str = Field(min_length=3, max_length=254)


class CorpusRequest(BaseModel):
    """Déclarer la provenance d'un corpus ou d'une base vectorielle (`FR-184`)."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    kind: Literal["dataset", "vector_store"]
    source: str = Field(min_length=1, max_length=500)
    # Une attestation sans porteur n'engage personne : le champ est obligatoire, et
    # borné pour la même raison que les autres — Pydantic strict (CLAUDE.md §4.9).
    steward: str = Field(min_length=1, max_length=200)
    last_reviewed_at: datetime


class VerdictRequest(BaseModel):
    """Le reçu d'un analyseur tiers, tel que la CI du client le remet (`FR-191`).

    Les bornes ne sont pas décoratives : la table est append-only, donc rien
    d'illimité ne doit pouvoir y entrer (`FR-163`, même raison qu'`audit_log`).
    """

    model_config = ConfigDict(extra="forbid")

    analyzer: str = Field(min_length=1, max_length=200)
    # Version et jeu de règles obligatoires : un verdict sans eux ne se rejoue pas,
    # donc ne se vérifie pas — le même défaut que `LLM01` sans millésime (`FR-194`).
    analyzer_version: str = Field(min_length=1, max_length=200)
    ruleset: str = Field(min_length=1, max_length=200)
    repository: str = Field(min_length=1, max_length=200)
    commit_sha: str = Field(min_length=7, max_length=200)
    verdict: Literal["pass", "fail"]
    #: Le décompte par sévérité, tel que l'analyseur le rend. Des entiers, pas du
    #: texte : nous ne recopions pas ses messages, qui pourraient porter du code
    #: client — nous en gardons la forme.
    findings: dict[str, int] = Field(default_factory=dict)
    #: Quand l'analyse a tourné, **déclaré**. La date de réception est dérivée par le
    #: serveur et les deux sont stockées séparément (`FR-161`).
    ran_at: datetime


class ShadowAiRequest(BaseModel):
    """L'inventaire **dérivé** du Shadow AI (`FR-189`).

    Ce schéma *est* la frontière. Il n'y a aucun champ pour une ligne de journal, une
    URL ou un identifiant : la route ne peut donc pas recevoir de brut, même si
    quelqu'un le lui envoyait. Le parsing vit côté client (`python -m cli shadow-ai`),
    et seul ce résumé traverse le réseau — sans quoi nous serions le CASB que `QO-3` a
    refusé, et la ligne devrait redescendre plutôt que monter.
    """

    model_config = ConfigDict(extra="forbid")

    window_start: datetime
    window_end: datetime
    #: service reconnu -> nombre d'acteurs distincts. Des entiers, jamais des noms.
    supervised: dict[str, int] = Field(default_factory=dict)
    shadow: dict[str, int] = Field(default_factory=dict)
    #: hôtes que le catalogue n'a pas su classer, et lignes refusées : comptés, parce
    #: qu'un inventaire qui tait ce qu'il n'a pas lu se présente comme complet.
    unclassified: int = Field(default=0, ge=0)
    rejected: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _window_is_ordered(self) -> ShadowAiRequest:
        """Une fenêtre inversée est refusée **au bord**, pas par la base.

        La contrainte existe aussi en SQL, et c'est voulu — une garde qui ne vit que
        dans le schéma d'API laisse passer ce qui entre par une autre porte. Mais la
        laisser lever au niveau de la base rendait un 500 avec une trace, ce que
        `CLAUDE.md` §4.8 interdit : la validation stricte de Pydantic (§4.9) est
        l'endroit où une erreur de client se dit comme telle.
        """
        if self.window_end <= self.window_start:
            raise ValueError("`window_end` doit être postérieure à `window_start`")
        return self


class ShadowAiOut(BaseModel):
    declared: bool
    window: str | None = None
    shadow_actors: int = 0


class VerdictOut(BaseModel):
    """Ce que l'ingestion rend : de quoi retrouver le reçu et vérifier la chaîne."""

    entry_hash: str
    receipt_digest: str


class CorpusOut(BaseModel):
    id: int
    name: str
    kind: str
    source: str
    steward: str
    declared_at: datetime
    declared_by: str | None
    last_reviewed_at: datetime
    review_age_days: int
    stale: bool


class MonitorWindowRequest(BaseModel):
    """Open (or extend) an observation window on one agent (G-25, FR-179)."""

    model_config = ConfigDict(extra="forbid")

    gateway_token_id: str = Field(min_length=1, max_length=64)
    hours: int = Field(ge=1, le=720)


class MonitorWindowOut(BaseModel):
    id: int
    gateway_token_id: str
    opened_at: datetime
    expires_at: datetime
    closed_at: datetime | None
    opened_by: str | None
    closed_by: str | None
    active: bool


class PromotionToolLine(BaseModel):
    """One tool's share of what enforcement would have done."""

    tool: str
    held: int
    refused: int
    dominant_class: str | None = None


class PromotionReportOut(BaseModel):
    """What enforcement would have done over the observed period (FR-180).

    `has_data` exists so the console can tell "nothing was observed" from "nothing
    would have been held": rendering the second as `0` says the opposite of what
    the report means (`blueprint/04-ecrans/promotion.yaml`, état `partial`).
    """

    observations: int
    held: int
    refused: int
    tools: list[PromotionToolLine]
    windows: int
    period_from: str | None = None
    period_to: str | None = None
    window_still_open: bool
    has_data: bool
    statement: str
    never_observed: list[str]


class DecisionRequest(BaseModel):
    """Operator decision on a pending approval."""

    model_config = {"extra": "forbid"}

    decision: Literal["approve", "deny"]


class AuthorizeRequest(BaseModel):
    """An agent asking permission to perform an action (cooperative gating)."""

    model_config = {"extra": "forbid"}

    tool: str = Field(min_length=1, max_length=200)
    arguments: dict[str, Any] = Field(default_factory=dict)
    request_id: str | None = Field(default=None, max_length=128)


class AuthorizeResponse(BaseModel):
    """The verdict returned to the agent: allow / deny / hold (+ approval to poll)."""

    decision: Literal["allow", "deny", "hold"]
    status: str | None = None
    approval_id: str | None = None
    action_class: str | None = None
    reason: str | None = None
    summary: str | None = None


class GatewayTokenCreate(BaseModel):
    """Payload to mint a tenant gateway token."""

    model_config = {"extra": "forbid"}

    name: str = Field(min_length=1, max_length=80)


class GatewayTokenOut(BaseModel):
    """A gateway token's metadata (never the raw secret)."""

    id: str
    name: str
    created_at: str | None
    last_used_at: str | None
    revoked_at: str | None


class GatewayTokenCreated(GatewayTokenOut):
    """A freshly minted token — includes the raw secret, shown exactly once."""

    token: str


class DeclaredIdentifiers(BaseModel):
    """Identifiers an agent or an upstream *said*, which nothing verified (FR-161).

    Kept in their own object rather than beside the derived fields: an auditor
    reading an export must not have to remember which of two adjacent strings
    the server minted and which one the audited party chose.
    """

    client_request_id: str | None = None
    upstream_request_id: str | None = None


class AuditEntry(BaseModel):
    """An immutable audit-log entry (metadata only).

    Every field but `declared` is derived by the server from something it
    verified — a JWT, a gateway token, its own clock, its own decision.
    """

    id: int
    ts: str | None
    tool_name: str | None
    action_class: str | None
    decision: str | None
    policy_rule_id: str | None
    judge_used: bool
    args_hash: str | None
    latency_ms: int | None
    error: str | None
    user_id: str | None
    request_id: str | None
    gateway_token_id: str | None = None
    # Which door, and in what posture. Null on entries written before 0020.
    ingress: str | None = None
    enforcement_mode: str | None = None
    declared: DeclaredIdentifiers = Field(default_factory=DeclaredIdentifiers)


class AgentOut(BaseModel):
    """A monitored agent (gateway token) with its activity + spend rollup."""

    id: str
    name: str
    revoked: bool
    actions: int
    spend_usd: float
    tokens: int
    last_active: str | None
    created_at: str | None
    client_id: str | None = None
    client_name: str | None = None


class ClientCreate(BaseModel):
    """Create a monitored client/project."""

    model_config = {"extra": "forbid"}

    name: str = Field(min_length=1, max_length=80)
    website: str | None = Field(default=None, max_length=300)


class ClientUpdate(BaseModel):
    """Patch a client's name/website."""

    model_config = {"extra": "forbid"}

    name: str | None = Field(default=None, min_length=1, max_length=80)
    website: str | None = Field(default=None, max_length=300)


class ClientAssign(BaseModel):
    """Attach/detach an agent (gateway token) to a client."""

    model_config = {"extra": "forbid"}

    token_id: str = Field(max_length=64)
    client_id: str | None = Field(default=None, max_length=64)


class ClientOut(BaseModel):
    """A client/project with its per-client rollup."""

    id: str
    name: str
    website: str | None
    created_at: str | None
    agents: int = 0
    actions: int = 0
    est_cost_usd: float = 0.0
    billed_cost_usd: float = 0.0
    tokens: int = 0


class AgentsOverview(BaseModel):
    """The customer (tenant) and the agents it monitors."""

    customer: str | None
    agent_count: int
    agents: list[AgentOut]


class UsageBucket(BaseModel):
    """Spend/tokens grouped by one dimension (provider, model, or agent id)."""

    key: str
    cost_usd: float
    tokens: int
    calls: int


class UsageDaily(BaseModel):
    """One day's spend/tokens for the cost trend line."""

    date: str
    cost_usd: float
    tokens: int


class UsageSummary(BaseModel):
    """Aggregated LLM token usage + estimated cost for the cost dashboard."""

    total_cost_usd: float
    # Authoritative cost reported by providers (exact), 0 until a source feeds it.
    billed_cost_usd: float = 0.0
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    calls: int
    by_provider: list[UsageBucket]
    by_model: list[UsageBucket]
    by_agent: list[UsageBucket]
    daily: list[UsageDaily]


DlpAction = Literal["block", "redact", "flag", "off"]


class DlpConfigOut(BaseModel):
    """A tenant's egress-DLP config + the platform master-switch state (UI hint)."""

    enabled: bool
    secret_action: str
    pii_action: str
    entropy_action: str
    platform_enabled: bool = False


class DlpConfigUpdate(BaseModel):
    """Set a tenant's egress-DLP verdicts (admin)."""

    model_config = {"extra": "forbid"}

    enabled: bool
    secret_action: DlpAction = "block"  # noqa: S105 - action name, not a credential
    pii_action: DlpAction = "flag"
    entropy_action: Literal["flag", "off"] = "off"


class AiModelBucket(BaseModel):
    """LLM calls grouped by provider+model."""

    provider: str | None
    model: str | None
    calls: int
    tokens: int
    cost_usd: float


class AiUserBucket(BaseModel):
    """Spend grouped by end-user (hashed)."""

    user_hash: str
    calls: int
    cost_usd: float


class AiOperationStat(BaseModel):
    """Per-operation x route stats. Quality fields are null until wired (ADR-0001)."""

    operation: str | None
    route: str | None
    calls: int
    cost_usd: float
    tokens: int
    p75_latency_ms: float | None
    ttft_p75_ms: float | None
    error_rate: float | None
    anomaly: bool = False
    anomaly_score: float | None = None
    refusal_rate: float | None = None
    regen_rate: float | None = None
    thumbs_down_rate: float | None = None
    csat: float | None = None


class AiSeriesPoint(BaseModel):
    """One day of the AI cost/latency trend."""

    date: str
    calls: int
    cost_usd: float
    p75_latency_ms: float | None
    error_rate: float | None


class AiSummary(BaseModel):
    """AI-observability summary (mirrors mip-rum's RumSummary AI sub-object)."""

    window: str
    ai_calls: int
    ai_tokens: int
    ai_cost_usd: float
    ai_p75_latency_ms: float | None
    ai_error_rate: float | None
    ai_by_model: list[AiModelBucket]
    ai_top_users: list[AiUserBucket]
    ai_by_operation: list[AiOperationStat]
    ai_series: list[AiSeriesPoint]


class AiIngestResult(BaseModel):
    """Outcome of an OTLP gen_ai ingestion request."""

    ingested: int
    rejected: int


class AiOverviewKpis(BaseModel):
    calls: int
    tokens: int
    cost_usd: float
    p75_latency_ms: float | None
    error_rate: float | None


class AiRouteBucket(BaseModel):
    route: str | None
    calls: int
    cost_usd: float
    tokens: int
    p75_latency_ms: float | None
    error_rate: float | None


class AiCallRow(BaseModel):
    ts: str | None
    provider: str | None
    model: str | None
    operation: str | None
    route: str | None
    total_tokens: int | None
    cost_usd: float | None
    latency_ms: float | None
    status: str


class AiDetail(BaseModel):
    """The /ai detail view: KPIs + groupings + recent calls."""

    window: str
    overview: AiOverviewKpis
    by_model: list[AiModelBucket]
    by_route: list[AiRouteBucket]
    daily: list[AiSeriesPoint]
    recent: list[AiCallRow]


class AiCostRow(BaseModel):
    key: str
    calls: int
    cost_usd: float
    tokens: int


class AiCosts(BaseModel):
    """Spend grouped by user | model | route."""

    group_by: str
    rows: list[AiCostRow]


class ToolIntegrityRow(BaseModel):
    """A tenant's MCP tool fingerprint + derived integrity status (M10)."""

    server: str
    tool_name: str
    approved: bool
    status: str  # ok | new | drift
    first_seen: str | None
    last_seen: str | None


class ToolTrustRow(BaseModel):
    """A tool's earned-trust level for a tenant (M11): clean approvals so far."""

    tool: str
    seen_before: bool
    clean_streak: int
    trusted: bool


class ComplianceStatus(BaseModel):
    """EU AI Act readiness snapshot (M9): record-keeping + oversight + retention."""

    chain_ok: bool
    entries: int
    first_broken_id: int | None
    #: Journal vide alors qu'une autre table atteste l'activité du tenant — un
    #: effacement, pas un démarrage. `chain_ok` reste vrai : c'est bien la chaîne
    #: qui est cohérente, et c'est précisément ce qui rendait l'état invisible.
    journal_missing: bool
    oversight_gated: int
    oversight_auto_allowed: int
    oversight_coverage_ok: bool
    retention_floor_days: int
    oldest_entry_age_days: int | None
    retention_ok: bool
    ready: bool


CredentialProvider = Literal["openai", "anthropic", "mistral", "openrouter", "azure", "aws", "gcp"]


class CredentialCreate(BaseModel):
    """Connect a customer provider credential (used only to pull authoritative cost)."""

    model_config = {"extra": "forbid"}

    provider: CredentialProvider
    label: str = Field(min_length=1, max_length=80)
    # Never logged or echoed back; repr is suppressed for defense in depth.
    secret: str = Field(min_length=1, max_length=10_000, repr=False)


class CredentialOut(BaseModel):
    """A stored credential's metadata — never the secret."""

    id: str
    provider: str
    label: str
    created_at: str | None
    last_used_at: str | None
    revoked: bool

-- 0006_agent_usage.sql — agent attribution + LLM token-usage/cost metrics.
--
-- Two additions, both tenant-isolated by RLS (CLAUDE.md §4.3):
--
--   1. audit_log.gateway_token_id — which agent (gateway token) produced a
--      decision. Deliberately an ANNEX column: it is NOT part of the hash-chain
--      payload (core/audit.py `_payload`), so every existing entry keeps
--      verifying. Attribution is operational metadata; the immutable chain still
--      covers the decision itself (CLAUDE.md §4.2).
--
--   2. usage_events — per-completion LLM token usage + computed cost, captured by
--      the monitoring proxy. These are operational metrics, NOT the audit log:
--      they are queryable/aggregatable (cost dashboards) and carry no PII —
--      only token counts and a price (CLAUDE.md §4.10).

alter table audit_log
    add column if not exists gateway_token_id uuid references gateway_tokens (id);

create index if not exists idx_audit_agent
    on audit_log (tenant_id, gateway_token_id);

create table if not exists usage_events (
    id bigint generated always as identity primary key,
    ts timestamptz not null default now(),
    tenant_id uuid not null references tenants (id) on delete cascade,
    gateway_token_id uuid references gateway_tokens (id) on delete set null,
    provider text not null,
    model text,
    prompt_tokens int not null default 0,
    completion_tokens int not null default 0,
    total_tokens int not null default 0,
    cost_usd numeric(12, 6) not null default 0,
    request_id text
);

create index if not exists idx_usage_tenant_ts on usage_events (tenant_id, ts desc);
create index if not exists idx_usage_agent on usage_events (tenant_id, gateway_token_id);

alter table usage_events enable row level security;

-- Read own tenant only; the backend writes via service_role (bypasses RLS).
create policy usage_select_own on usage_events
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

grant select on usage_events to authenticated;

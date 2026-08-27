-- 0017_monitor_windows.sql — bounded observation windows — G-25, AD-27, FR-179.
--
-- Enforcement is the default and is NOT a request-level choice. Before this, the
-- LLM proxy read its mode from an `x-xsom-mode` request header, so the agent being
-- controlled decided whether it was controlled: one omitted header — by compromise
-- or by plain misconfiguration — dissolved the guard.
--
-- Observation is therefore a control-plane state: opened by an admin, scoped to one
-- agent (its gateway token), and bounded in time. `closed_at` is set on an explicit
-- stop; a window is also spent once `expires_at` passes. Rows are never deleted —
-- a period during which enforcement was relaxed is evidence, and evidence that can
-- be removed is not evidence.

create table if not exists monitor_windows (
    id bigint generated always as identity primary key,
    tenant_id uuid not null references tenants (id) on delete cascade,
    -- The agent, identified the way the gateway identifies it: by its token.
    gateway_token_id text not null,
    opened_at timestamptz not null default now(),
    expires_at timestamptz not null,
    closed_at timestamptz,
    opened_by text,
    closed_by text
);

-- One *active* window per agent: opening again extends the one that runs rather
-- than stacking a second, so "how long has this agent been unenforced" has one
-- answer. Partial index — historical rows may repeat freely.
create unique index if not exists idx_monitor_active_per_agent
    on monitor_windows (tenant_id, gateway_token_id)
    where closed_at is null;

create index if not exists idx_monitor_tenant on monitor_windows (tenant_id, opened_at desc);

alter table monitor_windows enable row level security;

-- Console users read their own tenant's windows; the control API writes via the
-- service_role connection, like the other machine-written tables.
--
-- `create policy` has no `if not exists` in Postgres, and this is the first
-- post-ledger migration to create one: a re-application (a restore, a partial
-- failure, a baseline adoption on a database that already ran it) would abort. The
-- drop-then-create makes the file safe to run twice.
drop policy if exists monitor_windows_select_own on monitor_windows;
create policy monitor_windows_select_own on monitor_windows
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

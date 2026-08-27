-- 0018_session_taint.sql — persisted indirect-injection taint — G-03, FR-154, AD-10.
--
-- The taint used to live on the `PolicyBackend` instance, so it lasted exactly as
-- long as one MCP connection. An agent carrying an injected payload only had to
-- reconnect to come back clean — the guard was defeated by a reconnect, not by an
-- attack. Worse, the window was counted in *calls within that connection*, a unit
-- that has no meaning once the connection is gone.
--
-- The taint is therefore keyed on the AGENT — its gateway token, the same identity
-- the rest of the control plane uses — and bounded in TIME, which is the only unit
-- that survives a reconnect. One row per agent: a fresh taint extends the deadline
-- rather than stacking.

create table if not exists session_taint (
    tenant_id uuid not null references tenants (id) on delete cascade,
    gateway_token_id text not null,
    tainted_at timestamptz not null default now(),
    expires_at timestamptz not null,
    source_tool text,
    reason text,
    primary key (tenant_id, gateway_token_id)
);

create index if not exists idx_session_taint_expiry on session_taint (expires_at);

alter table session_taint enable row level security;

-- Console users read their own tenant's taint; the gateway writes via the
-- service_role connection, like the other machine-written tables.
drop policy if exists session_taint_select_own on session_taint;
create policy session_taint_select_own on session_taint
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

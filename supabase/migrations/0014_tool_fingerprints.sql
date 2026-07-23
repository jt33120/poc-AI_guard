-- 0014_tool_fingerprints.sql — MCP tool supply-chain integrity — M10.
-- One row per (tenant, downstream server, tool). Stores only a content hash of
-- the tool definition (never the definition itself); drift/poison detection
-- compares live tools to the approved fingerprint and quarantines fail-closed.

create table if not exists tool_fingerprints (
    id bigint generated always as identity primary key,
    tenant_id uuid not null references tenants (id) on delete cascade,
    server text not null,
    tool_name text not null,
    fingerprint text not null,
    approved boolean not null default false,
    first_seen timestamptz not null default now(),
    last_seen timestamptz not null default now(),
    unique (tenant_id, server, tool_name)
);

alter table tool_fingerprints enable row level security;

-- Console users read their own tenant's fingerprints; the gateway writes via the
-- service_role connection (bypasses RLS), like the other machine-written tables.
create policy tool_fingerprints_select_own on tool_fingerprints
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

grant select on tool_fingerprints to authenticated;

-- 0002_downstream_servers.sql — downstream MCP tool servers declared per tenant (M2).
-- secrets in `config` are env references, never raw values (SPEC §4).

create table if not exists downstream_servers (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants (id) on delete cascade,
    name text not null,
    transport text not null check (transport in ('stdio', 'http')),
    config jsonb not null,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    unique (tenant_id, name)
);

alter table downstream_servers enable row level security;

create policy downstream_servers_select_own on downstream_servers
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

grant select on downstream_servers to authenticated;

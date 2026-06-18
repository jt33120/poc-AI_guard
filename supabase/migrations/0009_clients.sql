-- 0009_clients.sql — "client/project" entities monitored within a tenant.
--
-- A tenant (the xSOM customer account) monitors one or more clients/projects
-- (e.g. "UTI", "Client A"); each agent (gateway token) belongs to a client, so
-- cost/usage/audit roll up per client. RLS-scoped to the tenant.

create table if not exists clients (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants (id) on delete cascade,
    name text not null,
    website text,
    created_at timestamptz not null default now(),
    archived_at timestamptz
);

create index if not exists idx_clients_tenant on clients (tenant_id) where archived_at is null;

alter table clients enable row level security;

create policy clients_select_own on clients
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

grant select on clients to authenticated;

-- Each agent (gateway token) optionally belongs to a client/project.
alter table gateway_tokens add column if not exists client_id uuid references clients (id) on delete set null;
create index if not exists idx_gateway_tokens_client on gateway_tokens (client_id);

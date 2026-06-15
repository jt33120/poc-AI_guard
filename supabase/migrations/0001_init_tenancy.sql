-- 0001_init_tenancy.sql — tenants, memberships, gateway tokens (M1).
-- RLS is enabled on every tenant table (CLAUDE.md §4.3). Reads are scoped to the
-- caller's tenant via the Supabase JWT; backend writes go through service_role
-- (which bypasses RLS). On real Supabase the `auth` schema/roles already exist;
-- local tests provide a minimal shim (tests/fixtures/supabase_auth_shim.sql).

create extension if not exists pgcrypto;

create table if not exists tenants (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_at timestamptz not null default now()
);

create table if not exists memberships (
    user_id uuid not null references auth.users (id) on delete cascade,
    tenant_id uuid not null references tenants (id) on delete cascade,
    role text not null check (role in ('admin', 'operator', 'viewer')),
    created_at timestamptz not null default now(),
    primary key (user_id, tenant_id)
);

-- Gateway API keys: scoped to a tenant, stored hashed only (never the raw token).
create table if not exists gateway_tokens (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants (id) on delete cascade,
    name text not null,
    token_hash text not null unique,
    created_at timestamptz not null default now(),
    last_used_at timestamptz,
    revoked_at timestamptz
);

create index if not exists idx_gateway_tokens_active
    on gateway_tokens (token_hash) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table tenants enable row level security;
alter table memberships enable row level security;
alter table gateway_tokens enable row level security;

-- A member may read only their own tenant (tenant_id carried in the JWT).
create policy tenants_select_own on tenants
    for select to authenticated
    using (id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

create policy memberships_select_own on memberships
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

create policy gateway_tokens_select_own on gateway_tokens
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

grant usage on schema public to anon, authenticated;
grant select on tenants, memberships, gateway_tokens to authenticated;

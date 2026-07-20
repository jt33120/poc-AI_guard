-- 0013_ai_app_and_read_tokens.sql — app addressing + server-to-server read tokens.
--
-- Sens-2 enablement (ADR-0001): the mip-rum facade calls xSOM's /ai read API with
-- an app id (e.g. 'gip-plateforme') under one tenant. Two additions:
--   1. usage_events.app_id — the OTLP `mip.app_id` resource attribute, so /ai
--      endpoints can filter one app's calls within a tenant.
--   2. read_tokens — opaque, tenant-scoped, hash-only read credentials (like
--      gateway_tokens but read-only) for the facade's server-to-server calls.

alter table usage_events add column if not exists app_id text;
create index if not exists idx_usage_app on usage_events (tenant_id, app_id);

create table if not exists read_tokens (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants (id) on delete cascade,
    name text not null,
    token_hash text unique not null,   -- SHA-256 of the raw token; raw never stored
    created_at timestamptz not null default now(),
    last_used_at timestamptz,
    revoked_at timestamptz
);

create index if not exists idx_read_tokens_tenant
    on read_tokens (tenant_id) where revoked_at is null;

alter table read_tokens enable row level security;

-- Tenant members may list their tokens (metadata only); the backend (service_role)
-- resolves the hash on the S2S path, bypassing RLS.
create policy read_tokens_select_own on read_tokens
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

grant select on read_tokens to authenticated;

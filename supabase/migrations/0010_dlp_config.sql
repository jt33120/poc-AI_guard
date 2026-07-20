-- 0010_dlp_config.sql — per-tenant egress DLP configuration (front-configurable).
--
-- The DLP egress guard (core/dlp.py) is gated platform-wide by the DLP_ENABLED
-- env var (zero overhead when off). When the platform enables it, each tenant
-- tunes its own verdicts here from the console; absent a row, the env defaults
-- apply. One row per tenant. RLS-readable by the tenant; the backend
-- (service_role) writes. Holds only action names — never any scanned content.

create table if not exists dlp_config (
    tenant_id uuid primary key references tenants (id) on delete cascade,
    enabled boolean not null default false,
    secret_action text not null default 'block'
        check (secret_action in ('block', 'redact', 'flag', 'off')),
    pii_action text not null default 'flag'
        check (pii_action in ('block', 'redact', 'flag', 'off')),
    entropy_action text not null default 'off'
        check (entropy_action in ('flag', 'off')),
    updated_at timestamptz not null default now(),
    updated_by text
);

alter table dlp_config enable row level security;

create policy dlp_config_select_own on dlp_config
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

grant select on dlp_config to authenticated;

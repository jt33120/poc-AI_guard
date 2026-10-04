-- Device authorization: the credential is generated and retained by the extension.
-- The console sees only a short-lived confirmation code, never the credential.
alter table gateway_tokens add column purpose text not null default 'agent'
    check (purpose in ('agent', 'extension'));
alter table extension_devices add column member_label text not null default ''
    check (length(member_label) <= 100);
alter table extension_devices add column team text not null default ''
    check (length(team) <= 80);
alter table extension_devices add column enrolled_by uuid;
create table extension_pairings (
    code_hash text primary key,
    credential_hash text not null unique,
    installation_id uuid not null,
    platform text not null check (platform in ('darwin','win32','linux')),
    extension_version text not null,
    mode text not null check (mode in ('block','redact','observe')),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '10 minutes',
    approved_tenant_id uuid references tenants(id),
    gateway_token_id uuid references gateway_tokens(id)
);
create index extension_pairings_expiry on extension_pairings(expires_at);
alter table extension_pairings enable row level security;
-- No anon/authenticated policies: confirmation always goes through the control API.

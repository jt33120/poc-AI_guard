-- 0007_provider_credentials.sql — securely stored customer provider credentials
-- + authoritative billed-cost ledger.
--
-- provider_credentials holds third-party billing/admin keys (OpenAI/Anthropic/
-- Mistral/OpenRouter/cloud). They are stored ONLY as envelope-encrypted
-- ciphertext (core/secrets.py): a per-tenant data key encrypts the secret, and
-- the data key itself is wrapped by a KMS key whose root never touches the DB.
-- Unlike other tenant tables this one has NO authenticated RLS read policy: the
-- ciphertext is reachable by the backend (service_role) only, and the API
-- returns metadata exclusively (never the secret) — defense in depth (§4.7/§4.10).
--
-- billed_cost is the authoritative, provider-reported spend (source of truth),
-- kept separate from the estimated/attributed usage_events. RLS-readable.

create table if not exists provider_credentials (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants (id) on delete cascade,
    provider text not null,
    label text not null,
    key_id text not null,          -- KMS key id used to wrap the data key
    wrapped_dek text not null,     -- base64: data key wrapped by the KMS key
    nonce text not null,           -- base64: AES-GCM nonce
    ciphertext text not null,      -- base64: AES-GCM(secret) under the data key
    created_by text,
    created_at timestamptz not null default now(),
    last_used_at timestamptz,
    revoked_at timestamptz
);

create index if not exists idx_provider_credentials_tenant
    on provider_credentials (tenant_id) where revoked_at is null;

alter table provider_credentials enable row level security;
-- Intentionally NO "to authenticated" policy: only the backend (service_role,
-- which bypasses RLS) ever reads the ciphertext.

create table if not exists billed_cost (
    id bigint generated always as identity primary key,
    tenant_id uuid not null references tenants (id) on delete cascade,
    gateway_token_id uuid references gateway_tokens (id) on delete set null,
    provider text not null,
    source text not null,          -- e.g. 'openrouter_inline', 'openai_costs_api'
    model text,
    amount_usd numeric(14, 8) not null default 0,
    currency text not null default 'USD',
    external_id text,              -- provider generation/line id (dedupe)
    period_start timestamptz,
    period_end timestamptz,
    ts timestamptz not null default now()
);

create unique index if not exists uq_billed_cost_external
    on billed_cost (tenant_id, provider, source, external_id)
    where external_id is not null;
create index if not exists idx_billed_cost_tenant_ts on billed_cost (tenant_id, ts desc);
create index if not exists idx_billed_cost_agent on billed_cost (tenant_id, gateway_token_id);

alter table billed_cost enable row level security;

create policy billed_cost_select_own on billed_cost
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

grant select on billed_cost to authenticated;

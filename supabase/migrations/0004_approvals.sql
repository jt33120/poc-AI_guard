-- 0004_approvals.sql — human-in-the-loop approvals (M4).
-- arguments_summary/dry_run are redacted (no secrets/PII); matching uses args_hash.

create table if not exists approvals (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants (id) on delete cascade,
    request_id text not null,
    tool_name text not null,
    action_class text,
    args_hash text not null,
    arguments_summary jsonb not null,
    dry_run jsonb not null,
    status text not null default 'pending'
        check (status in ('pending', 'approved', 'denied', 'expired')),
    required_count int not null default 1,
    approved_by text[] not null default '{}',
    requested_by text,
    decided_by text,
    created_at timestamptz not null default now(),
    decided_at timestamptz,
    expires_at timestamptz not null,
    consumed_at timestamptz
);

alter table approvals enable row level security;

create policy approvals_select_own on approvals
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

grant select on approvals to authenticated;

create index if not exists idx_approvals_active
    on approvals (tenant_id, tool_name, args_hash) where consumed_at is null;

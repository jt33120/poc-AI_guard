-- 0003_tool_policies.sql — per-tenant authorization policy (YAML) — M3.
-- One active policy row per tenant; version is bumped on each update.

create table if not exists tool_policies (
    id bigint generated always as identity primary key,
    tenant_id uuid not null references tenants (id) on delete cascade,
    yaml text not null,
    version int not null default 1,
    updated_at timestamptz not null default now(),
    unique (tenant_id)
);

alter table tool_policies enable row level security;

create policy tool_policies_select_own on tool_policies
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

grant select on tool_policies to authenticated;

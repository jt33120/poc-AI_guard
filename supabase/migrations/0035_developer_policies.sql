-- Signed policy envelopes for Developer Guard. Private signing keys stay outside PostgreSQL.
create table developer_policies (
    tenant_id uuid not null references tenants(id),
    policy_id text not null check (policy_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$'),
    version integer not null check (version >= 1),
    policy jsonb not null,
    expires_at timestamptz not null,
    key_id text not null,
    public_key text not null,
    signature text not null,
    published_by text not null,
    published_at timestamptz not null default now(),
    revoked_at timestamptz,
    primary key (tenant_id, policy_id)
);
create table developer_policy_assignments (
    tenant_id uuid not null,
    device_id uuid not null,
    policy_id text not null,
    assigned_at timestamptz not null default now(),
    primary key (tenant_id, device_id),
    foreign key (tenant_id, device_id) references extension_devices(tenant_id, id),
    foreign key (tenant_id, policy_id) references developer_policies(tenant_id, policy_id)
);
alter table developer_policies enable row level security;
alter table developer_policy_assignments enable row level security;
create policy developer_policies_read on developer_policies for select to authenticated
    using (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);
create policy developer_policy_assignments_read on developer_policy_assignments for select to authenticated
    using (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);
grant select on developer_policies, developer_policy_assignments to authenticated;

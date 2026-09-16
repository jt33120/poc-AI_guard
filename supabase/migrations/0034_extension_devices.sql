-- Registered workstations and a separate evidence chain (not tool-call audit).
create table extension_devices (
    id uuid primary key,
    tenant_id uuid not null references tenants(id),
    gateway_token_id uuid not null unique references gateway_tokens(id),
    platform text not null check (platform in ('win32','darwin','linux')),
    extension_version text not null,
    mode text not null check (mode in ('block','redact','observe')),
    registered_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    unique (tenant_id,id)
);
create table extension_events (
    id bigserial primary key,
    tenant_id uuid not null references tenants(id),
    device_id uuid not null,
    event_id uuid not null,
    source text not null check (source in ('extension','gateway')),
    received_at timestamptz not null default now(),
    payload jsonb not null,
    prev_hash text not null,
    entry_hash text not null,
    foreign key (tenant_id,device_id) references extension_devices(tenant_id,id),
    unique (device_id,event_id)
);
create index extension_events_tenant on extension_events(tenant_id,id desc);
alter table extension_devices enable row level security;
alter table extension_events enable row level security;
create policy extension_devices_read on extension_devices for select to authenticated
    using (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);
create policy extension_events_read on extension_events for select to authenticated
    using (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);
grant select on extension_devices, extension_events to authenticated;
create function extension_events_immutable() returns trigger language plpgsql as $$
begin
    raise exception 'extension_events is append-only';
end; $$;
create trigger extension_events_no_update before update on extension_events
    for each row execute function extension_events_immutable();
create trigger extension_events_no_delete before delete on extension_events
    for each row execute function extension_events_immutable();
create trigger extension_events_no_truncate before truncate on extension_events
    for each statement execute function extension_events_immutable();

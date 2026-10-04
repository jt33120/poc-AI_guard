-- Commercial console access is explicit per product. It never grants gateway
-- execution or disables the local Secret Guard scanner.
create table tenant_product_access (
    tenant_id uuid not null references tenants(id),
    product text not null check (product in ('secret_guard', 'ai_guard')),
    status text not null check (status in ('active', 'trial', 'internal', 'not_subscribed', 'suspended')),
    edition text not null check (length(edition) between 1 and 80),
    seats integer check (seats > 0),
    ends_at timestamptz,
    updated_at timestamptz not null default now(),
    primary key (tenant_id, product)
);

alter table tenant_product_access enable row level security;
create policy tenant_product_access_read on tenant_product_access
    for select to authenticated
    using (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);
grant select on tenant_product_access to authenticated;
-- Provisioning is an operator action. No browser write policy or self-upgrade.
-- Preserve Agent Guard access already granted by a paid legacy plan. This is
-- a one-time migration of existing rights, never an inferred Dev Guard purchase.
insert into tenant_product_access (tenant_id, product, status, edition)
select id, 'ai_guard', 'active', case plan when 'pro' then 'Pro' else 'Entreprise' end
from tenants where plan in ('pro', 'entreprise');

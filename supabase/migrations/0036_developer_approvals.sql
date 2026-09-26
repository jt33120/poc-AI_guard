-- Developer Guard approvals are bound to one enrolled device, one policy
-- version and one opaque local action fingerprint. The server never receives
-- the prompt, command line, file content, or tool arguments.
alter table approvals
    add column if not exists developer_device_id uuid,
    add column if not exists developer_policy_id text,
    add column if not exists developer_policy_version integer,
    add column if not exists developer_action_binding text;

alter table approvals
    add constraint approvals_developer_device_fk
    foreign key (tenant_id, developer_device_id)
    references extension_devices(tenant_id, id);

alter table approvals
    add constraint approvals_developer_guard_complete check (
        (developer_device_id is null and developer_policy_id is null
         and developer_policy_version is null and developer_action_binding is null)
        or
        (developer_device_id is not null and developer_policy_id is not null
         and developer_policy_version is not null and developer_policy_version >= 1
         and developer_action_binding ~ '^[a-f0-9]{64}$')
    );

create unique index if not exists approvals_developer_request_once
    on approvals (tenant_id, developer_device_id, request_id)
    where developer_device_id is not null;

create index if not exists approvals_developer_action_active
    on approvals (tenant_id, developer_device_id, developer_action_binding)
    where developer_device_id is not null and consumed_at is null;

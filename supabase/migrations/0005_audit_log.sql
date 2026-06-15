-- 0005_audit_log.sql — immutable, hash-chained audit log (SPEC §9, M5).
-- Append-only: no UPDATE/DELETE policy, plus triggers that hard-block mutation
-- even for the service role (CLAUDE.md §4.2). Only metadata + args_hash is stored
-- (never argument values / PII, CLAUDE.md §4.10).

create table if not exists audit_log (
    id bigint generated always as identity primary key,
    ts timestamptz not null,
    tenant_id text not null,
    user_id text,
    request_id text,
    tool_name text,
    action_class text,
    decision text,
    policy_rule_id text,
    judge_used boolean not null default false,
    args_hash text,
    latency_ms int,
    error text,
    prev_hash text not null,
    entry_hash text not null
);

create index if not exists idx_audit_tenant_id on audit_log (tenant_id, id);

alter table audit_log enable row level security;

-- Read own tenant; no INSERT/UPDATE/DELETE policy for authenticated.
create policy audit_select_own on audit_log
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));

grant select on audit_log to authenticated;

-- Hard append-only: block UPDATE and DELETE for everyone (incl. service role).
create or replace function audit_log_block_mutation() returns trigger
    language plpgsql as $$
begin
    raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_update before update on audit_log
    for each row execute function audit_log_block_mutation();

create trigger audit_log_no_delete before delete on audit_log
    for each row execute function audit_log_block_mutation();

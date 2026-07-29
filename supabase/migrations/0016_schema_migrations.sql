-- 0016_schema_migrations.sql — the forward-only migration ledger (Epic 1, M1.6).
-- One row per applied migration file, written in the SAME transaction as the file
-- it records (core/migrate.py), so a failure leaves no partial state. The checksum
-- is the sha256 of the bytes that ran: editing a released migration is detectable
-- (PRD V-4). There are no down migrations, ever — forward only.
--
-- RLS (CLAUDE.md §4.3): this table has NO tenant dimension — the schema version is
-- a property of the deployment, not of a customer — so a `tenant_id = jwt tenant`
-- policy would have nothing to compare against and would be theatre. The invariant
-- is honoured by denial instead of by scoping: RLS is enabled with ZERO policies
-- (every non-owner, non-BYPASSRLS role therefore sees no row and can write none,
-- even if a hosted provider's default privileges later grant the table), and all
-- privileges are revoked from the tenant-facing roles. Ledger reads/writes are
-- service_role / owner only.

create table if not exists schema_migrations (
    filename text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
);

alter table schema_migrations enable row level security;
-- Deliberately no `create policy` here: RLS with no policy is deny-by-default.

revoke all privileges on table schema_migrations from anon, authenticated;

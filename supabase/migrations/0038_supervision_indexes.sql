-- 0038_supervision_indexes.sql — the supervision room reads by time window.
--
-- `core/supervision.py` aggregates a tenant's journal and approvals over the last
-- 24 hours, 7 days or 30 days. `audit_log` was indexed on (tenant_id, id) and
-- (tenant_id, gateway_token_id) only, and `approvals` on its active rows: a time
-- window scanned the tenant's whole history. These two indexes follow the reads.
--
-- Plain `create index` (not `concurrently`): each migration runs in one
-- transaction with its ledger row (`core/migrate.py`), and both tables are small
-- at this stage. Indexes change no row, so the append-only guarantees of
-- `audit_log` (0005, 0028) are untouched.

create index if not exists idx_audit_log_tenant_ts on audit_log (tenant_id, ts);
create index if not exists idx_approvals_tenant_created on approvals (tenant_id, created_at);

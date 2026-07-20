-- 0011_ai_observability.sql — extend usage_events for OTLP gen_ai ingestion.
--
-- xSOM already records one usage_events row per LLM call on the *inline proxy*
-- path (core/usage.py). This migration lets the SAME table also receive
-- *pushed* OTLP `gen_ai.*` spans from an external backend (passive observability),
-- distinguished by `source`. New columns carry the richer per-call signals
-- (latency/TTFT/status/operation/route/session) that the proxy path did not have.
-- ADR-0001. Metadata + token counts only — never content (CLAUDE.md §4.10).

alter table usage_events
    add column if not exists source     text not null default 'proxy',  -- 'proxy' | 'otlp'
    add column if not exists span_id    text,
    add column if not exists trace_id   text,
    add column if not exists session_id text,
    add column if not exists operation  text,
    add column if not exists route      text,
    add column if not exists latency_ms double precision,
    add column if not exists ttft_ms    double precision,
    add column if not exists status     text not null default 'ok',      -- 'ok' | 'error'
    add column if not exists error_type text,
    add column if not exists user_hash  text;

-- OTLP idempotency: one row per span. Proxy rows have a null span_id (excluded).
create unique index if not exists uq_usage_span
    on usage_events (span_id) where span_id is not null;
create index if not exists idx_usage_op     on usage_events (tenant_id, operation);
create index if not exists idx_usage_route  on usage_events (tenant_id, route);
create index if not exists idx_usage_status on usage_events (tenant_id, status);
create index if not exists idx_usage_session on usage_events (tenant_id, session_id);

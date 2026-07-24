-- 0015_tool_fingerprints_last_fp.sql — track the last-seen live hash — M10.
-- `fingerprint` stays the APPROVED baseline (never silently overwritten); a new
-- `last_fingerprint` records the most recently seen live hash so an operator can
-- re-baseline (approve) a drifted tool to the version they just reviewed.

alter table tool_fingerprints add column if not exists last_fingerprint text;

-- Backfill existing rows (baseline == last seen at creation), then enforce NOT NULL.
update tool_fingerprints set last_fingerprint = fingerprint where last_fingerprint is null;

alter table tool_fingerprints alter column last_fingerprint set not null;

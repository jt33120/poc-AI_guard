-- auth_compat.sql — run the xSOM schema on a plain PostgreSQL cluster.
--
-- WHAT THIS IS
--   The xSOM migrations are written against Supabase, so their RLS policies call
--   auth.jwt() and grant to the anon / authenticated / service_role roles. On a
--   self-hosted PostgreSQL none of that exists. This file creates exactly that
--   surface — a schema, three stable functions, three NOLOGIN roles — so the
--   migrations apply unchanged and the policies enforce unchanged. It is the
--   production counterpart of tests/fixtures/supabase_auth_shim.sql, which is
--   what the whole RLS suite already runs against.
--
-- WHAT THIS IS NOT
--   It is NOT an identity provider. It does not authenticate anyone, verify a
--   signature, or mint a token. auth.jwt() returns whatever the *already
--   trusted* backend put in the request.jwt.claims setting on that connection;
--   the JWT itself is verified in api/security.py before any connection is
--   opened. Nothing here relaxes a policy, and nothing here is a substitute for
--   that verification.
--
-- WHERE IT RUNS
--   * Bundled Postgres (docker-compose.yml): mounted into
--     /docker-entrypoint-initdb.d, so it runs on first boot of an empty volume —
--     before the migrate service, which is what the ordering requires.
--   * Managed Postgres (RDS / Cloud SQL / Neon): apply it once by hand as the
--     database owner, before the first migration. See the note on Section B.
--   * Real Supabase: never. Everything below already exists there.
--
--   Idempotent: safe to re-apply at any time.

-- ---------------------------------------------------------------------------
-- Section A — portable. Any database owner can apply this.
-- ---------------------------------------------------------------------------

create schema if not exists auth;

-- FK target for memberships.user_id. On Supabase this table is owned by GoTrue
-- and filled by the auth service; with no identity service in front, whatever
-- provisions an account (POST /v1/signup, or the bootstrap CLI) is what inserts
-- the row here. xSOM never stores a credential in it — id and email only.
create table if not exists auth.users (
    id uuid primary key,
    email text
);

-- PostgREST/Supabase expose the verified JWT through the request.jwt.claims GUC;
-- core/db.py::tenant_reader sets the same GUC per transaction. `stable`, not
-- `immutable`: the value changes within a session. SECURITY INVOKER (the
-- default) is deliberate — a SECURITY DEFINER function called from inside an
-- RLS policy would run as its owner and is a privilege-escalation shape.
-- search_path is pinned because these are called from within policies, where an
-- attacker-controlled search_path must not be able to shadow anything.
create or replace function auth.jwt() returns jsonb
    language sql stable
    set search_path = pg_catalog, pg_temp
as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid() returns uuid
    language sql stable
    set search_path = pg_catalog, pg_temp
as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role() returns text
    language sql stable
    set search_path = pg_catalog, pg_temp
as $$
    select auth.jwt() ->> 'role'
$$;

-- The three Supabase roles. NOLOGIN on purpose: they are targets for `grant ...
-- to authenticated` and for `set local role`, never connection identities.
do $$
begin
    if not exists (select from pg_roles where rolname = 'anon') then
        create role anon nologin;
    end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
    end if;
    if not exists (select from pg_roles where rolname = 'service_role') then
        create role service_role nologin;
    end if;
end
$$;

-- The policies call auth.jwt() while the connection is switched to
-- `authenticated`, so that role needs to reach the schema. EXECUTE on the
-- functions is already PUBLIC by default; USAGE on a non-public schema is not.
grant usage on schema auth to anon, authenticated, service_role;

-- core/db.py::tenant_reader runs `set local role authenticated` on the backend's
-- own connection, which requires membership in that role unless the connecting
-- role is a superuser. Granting it here keeps tenant-scoped reads working when
-- the application user is a plain owner — the case on every managed provider.
do $$
begin
    execute format('grant anon, authenticated, service_role to %I', current_user);
end
$$;

-- ---------------------------------------------------------------------------
-- Section B — needs superuser. Fidelity only; not load-bearing.
-- ---------------------------------------------------------------------------
-- On Supabase, service_role carries BYPASSRLS. Nothing in xSOM connects or
-- switches to service_role (the backend connects as the DSN's own role and
-- relies on table ownership), so this attribute exists only so that a database
-- prepared here matches one prepared by Supabase. Managed providers refuse
-- ALTER ROLE ... BYPASSRLS to non-superusers, which is why the failure is
-- reported and skipped instead of aborting the file: Section A is what the
-- product actually depends on. This is a deliberate, narrow exception — it is
-- not a pattern for the migrations themselves, where any error must be fatal.
do $$
begin
    execute 'alter role service_role bypassrls';
exception
    when insufficient_privilege then
        raise notice
            'auth_compat: skipped BYPASSRLS on service_role (not superuser). '
            'Harmless: no xSOM connection assumes that role.';
end
$$;

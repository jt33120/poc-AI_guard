-- supabase_auth_shim.sql — LOCAL TEST ONLY. Never applied to real Supabase.
-- Emulates the minimal Supabase auth context so RLS policies that reference
-- auth.jwt()/auth.uid() and the anon/authenticated/service_role roles can be
-- exercised against a plain PostgreSQL cluster. Applied before product migrations.

create schema if not exists auth;

-- Minimal stand-in for Supabase's auth.users (FK target for memberships).
create table if not exists auth.users (
    id uuid primary key,
    email text
);

-- PostgREST exposes the verified JWT via the request.jwt.claims GUC.
create or replace function auth.jwt() returns jsonb
    language sql stable
as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid() returns uuid
    language sql stable
as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role() returns text
    language sql stable
as $$
    select auth.jwt() ->> 'role'
$$;

do $$
begin
    if not exists (select from pg_roles where rolname = 'anon') then
        create role anon nologin;
    end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
    end if;
    if not exists (select from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
    end if;
end
$$;

-- 0026_control_plane_events.sql — les actes de plan de contrôle, chaînés.
--
-- `FR-196` / `EXH-8`. Une attribution de rôle change qui peut approuver une action
-- irréversible : c'est un acte de gouvernance, pas un appel d'outil. Déléguer
-- l'annuaire à l'IdP du client est correct ; perdre la trace de ce que le produit en
-- a *déduit* ne l'est pas — un évaluateur qui demande « qui pouvait approuver, et
-- depuis quand ? » n'a pas accès aux journaux de l'IdP.
--
-- **Pourquoi une table à part de `audit_log`.** `audit_log.ingress` est un vocabulaire
-- fermé de trois portes d'appel d'outil, et `AD-28` en fait la clé des revendications
-- de couverture. Une attribution de rôle n'arrive par aucune des trois ; lui inventer
-- une quatrième porte rendrait la carte de couverture fausse pour économiser une
-- table. Même découpage que `0024_third_party_verdicts.sql`.
--
-- **Ce qui n'entre pas.** Aucun nom de groupe : ils disent l'organigramme du client
-- (`CLAUDE.md` §4.10). Seule l'empreinte de l'ensemble est stockée, et elle suffit à
-- prouver qu'il a changé. Ni jeton, ni revendications brutes, ni adresse d'appelant.

create table if not exists control_plane_events (
    id bigserial primary key,
    tenant_id uuid not null references tenants (id) on delete cascade,
    -- Vocabulaire fermé côté application (`core/control_plane.py`). Une seule valeur
    -- aujourd'hui : `role_assigned`.
    event text not null,
    -- L'identifiant opaque du sujet chez l'émetteur (`sub`), jamais un e-mail.
    subject text not null,
    -- Même contrainte que `memberships.role` (0001) : le vocabulaire de rôles est
    -- fermé, et il l'est au même endroit pour les deux tables.
    role text not null check (role in ('admin', 'operator', 'viewer')),
    -- SHA-256 de l'ensemble trié et dédoublonné des groupes ayant motivé le rôle.
    groups_hash text not null,
    at timestamptz not null default now(),
    -- L'empreinte canonique de l'événement, recalculable depuis `AUDIT_FORMAT.md`.
    entry_digest text not null,
    prev_hash text not null,
    entry_hash text not null
);

create index if not exists idx_control_plane_events_subject
    on control_plane_events (tenant_id, subject, id desc);

alter table control_plane_events enable row level security;

drop policy if exists control_plane_events_select_own on control_plane_events;
create policy control_plane_events_select_own on control_plane_events
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- La policy filtre **après** le contrôle de privilège : sans ce grant elle serait une
-- autorisation que personne ne peut exercer (`G-32`).
grant select on table control_plane_events to authenticated;

-- Append-only par trigger, comme `audit_log` et `third_party_verdicts`. Une policy
-- absente est une permission qu'on a oublié d'accorder ; un trigger qui lève est une
-- interdiction. Les triggers lèvent y compris pour `service_role`, donc la voie
-- backend est fermée elle aussi (`CLAUDE.md` §4.2).
create or replace function control_plane_events_immutable() returns trigger
    language plpgsql as $$
begin
    raise exception 'control_plane_events is append-only (FR-196)';
end;
$$;

drop trigger if exists control_plane_events_no_update on control_plane_events;
create trigger control_plane_events_no_update
    before update on control_plane_events
    for each row execute function control_plane_events_immutable();

drop trigger if exists control_plane_events_no_delete on control_plane_events;
create trigger control_plane_events_no_delete
    before delete on control_plane_events
    for each row execute function control_plane_events_immutable();

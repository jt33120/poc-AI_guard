-- 0037_rules_packs.sql — Règles sur mesure xSOM : paquets signés, en ajout seul.
--
-- Contrat : `secret-guard/contracts/RULES-PACK.md` §1, §6, §7. Un opérateur xSOM publie
-- pour un tenant un paquet signé par la clé d'autorité xSOM ; le poste le vérifie hors
-- ligne. Chaque publication et chaque retrait est une ligne de plus, chaînée par tenant
-- (`prev_hash` → `entry_hash`), jamais une modification : l'historique de ce qui a été
-- distribué à un client est une preuve, pas un état.
--
-- **Ce qui n'entre pas.** Aucun terme en clair : un détecteur `terms` ne porte que des
-- empreintes salées (§4). Ni clé privée (la colonne n'existe pas), ni texte d'essai.
--
-- **Pourquoi une table à part de `audit_log`.** `audit_log.ingress` est le vocabulaire
-- fermé des trois portes d'appel d'outil (`AD-28`) ; une publication de réglage n'arrive
-- par aucune. Même découpage que `0024_third_party_verdicts.sql` et
-- `0026_control_plane_events.sql` : sa propre table, son propre chaînage, les primitives
-- d'audit partagées (`core/rules_packs.py`).

create table if not exists rules_pack_events (
    id bigserial primary key,
    tenant_id uuid not null references tenants (id),
    event text not null check (event in ('published', 'revoked')),
    pack_id text not null check (pack_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
    version integer not null check (version >= 1),
    -- L'enveloppe signée (§1), présente sur une publication seulement.
    payload jsonb,
    key_id text check (key_id ~ '^[0-9a-f]{64}$'),
    public_key text,
    signature text,
    payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
    expires_at timestamptz,
    -- Le `sub` opaque de l'opérateur xSOM, jamais un e-mail.
    created_by text not null,
    created_at timestamptz not null default now(),
    entry_digest text not null,
    prev_hash text not null,
    entry_hash text not null,
    check (
        (event = 'published' and payload is not null and key_id is not null
         and public_key is not null and signature is not null and expires_at is not null)
        or
        (event = 'revoked' and payload is null and key_id is null
         and public_key is null and signature is null and expires_at is null)
    )
);

create unique index if not exists rules_pack_events_published_once
    on rules_pack_events (tenant_id, pack_id, version) where event = 'published';
create unique index if not exists rules_pack_events_revoked_once
    on rules_pack_events (tenant_id, pack_id, version) where event = 'revoked';
create index if not exists rules_pack_events_tenant
    on rules_pack_events (tenant_id, id desc);

-- Versions strictement croissantes par (tenant, packId) : le poste refuse tout retour en
-- arrière (§5), la base refuse de l'écrire. L'application tient déjà un verrou
-- consultatif par tenant ; ce trigger est la seconde serrure, pas la seule.
create or replace function rules_pack_events_monotonic() returns trigger
    language plpgsql as $$
begin
    if new.event = 'published' and exists (
        select 1 from rules_pack_events
        where tenant_id = new.tenant_id and pack_id = new.pack_id
          and event = 'published' and version >= new.version
    ) then
        raise exception 'rules pack version must increase';
    end if;
    if new.event = 'revoked' and not exists (
        select 1 from rules_pack_events
        where tenant_id = new.tenant_id and pack_id = new.pack_id
          and event = 'published' and version = new.version
    ) then
        raise exception 'only a published rules pack can be revoked';
    end if;
    return new;
end;
$$;

drop trigger if exists rules_pack_events_monotonic on rules_pack_events;
create trigger rules_pack_events_monotonic
    before insert on rules_pack_events
    for each row execute function rules_pack_events_monotonic();

alter table rules_pack_events enable row level security;

drop policy if exists rules_pack_events_select_own on rules_pack_events;
create policy rules_pack_events_select_own on rules_pack_events
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- Lecture seule pour le client : aucune policy d'écriture, aucun grant d'écriture. Les
-- publications passent par le backend (propriétaire de la table), derrière le contrôle
-- d'opérateur xSOM de `api/rules_packs.py`.
grant select on table rules_pack_events to authenticated;

-- Ajout seul par trigger, comme `audit_log` et `control_plane_events` : une policy
-- absente est une permission oubliée, un trigger qui lève est une interdiction, y
-- compris pour le propriétaire.
create or replace function rules_pack_events_immutable() returns trigger
    language plpgsql as $$
begin
    raise exception 'rules_pack_events is append-only';
end;
$$;

drop trigger if exists rules_pack_events_no_update on rules_pack_events;
create trigger rules_pack_events_no_update
    before update on rules_pack_events
    for each row execute function rules_pack_events_immutable();

drop trigger if exists rules_pack_events_no_delete on rules_pack_events;
create trigger rules_pack_events_no_delete
    before delete on rules_pack_events
    for each row execute function rules_pack_events_immutable();

drop trigger if exists rules_pack_events_no_truncate on rules_pack_events;
create trigger rules_pack_events_no_truncate
    before truncate on rules_pack_events
    for each statement execute function rules_pack_events_immutable();

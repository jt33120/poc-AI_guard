-- 0032_audit_checkpoints.sql — le témoin daté et signé de la chaîne (FR-169 / INV-12).
--
-- ---------------------------------------------------------------------------
-- Le trou que cette table referme, et c'est le plus gros qui reste sur la preuve
-- ---------------------------------------------------------------------------
-- `core/audit.verify_chain` part de GENESIS et marche vers l'avant sur **les lignes
-- qu'elle trouve**. Une ligne modifiée en place se voit : son hachage ne retombe pas.
-- Un **préfixe amputé de ses k dernières lignes** ne se voit pas : il satisfait les
-- deux contrôles et rend `ok=True, count=n-k`, et aucune valeur de référence n'existe
-- pour contredire le nouveau `count`. À la limite, sur une table vide, la fonction ne
-- parcourt rien, ne trouve aucune rupture et rend `ok=True, count=0` — l'en-tête de
-- `0028_no_truncate.sql` le dit déjà : « la preuve détruite, et l'attestation qui dit
-- que tout va bien ».
--
-- `0028` a fermé le TRUNCATE et `0005` bloque UPDATE et DELETE par trigger. Ces
-- triggers protègent d'un accident et d'une injection ; ils ne protègent pas de qui
-- peut les retirer. Le backend se connecte comme **propriétaire** des tables
-- (`core/db.py` le documente : l'immuabilité repose sur la propriété), et un
-- propriétaire fait `alter table ... disable trigger`, supprime, réactive. Aucune
-- garantie interne à la base ne survit à ce scénario, par construction.
--
-- Le seul remède est un témoin **extérieur au moment** : à l'instant T, la chaîne du
-- tenant X comptait N entrées et finissait par H. Rejouer la chaîne après une
-- suppression demande alors de reproduire H sur N entrées, donc de forger la signature
-- du témoin — dont la clé privée n'est pas dans cette base et ne peut pas y être.
--
-- ---------------------------------------------------------------------------
-- Ed25519 et non HMAC, et c'est la moitié construite de FR-169
-- ---------------------------------------------------------------------------
-- Un HMAC se vérifie avec la clé qui l'a produit : publier la clé pour permettre la
-- vérification revient à publier le pouvoir de forger. Le témoin ne vaudrait alors que
-- pour nous-mêmes, c'est-à-dire pour personne.
--
-- Une signature Ed25519 se vérifie avec la clé **publique**, que la ligne porte. Un
-- régulateur, un auditeur, le client lui-même peuvent recalculer l'empreinte depuis
-- `audit_log` et vérifier la signature **sans rien nous demander**. Et la table ne
-- porte aucune colonne où une clé privée pourrait tomber : FR-169 (« la clé de
-- signature ne réside jamais en base ») cesse d'être une consigne pour devenir une
-- propriété du schéma.
--
-- Ce que le témoin n'achète toujours pas : l'indépendance ne se déduit pas de
-- l'algorithme, mais de la **garde** de la clé privée. Si la graine vit dans
-- l'environnement du même hôte que la base, qui prend l'hôte prend les deux.
-- `CHECKPOINT_KEY_CUSTODY` fait déclarer cette garde, et
-- `core/compliance.verification_independence` ne dit `independent: true` que quand elle
-- est ailleurs — c'est la seconde moitié de FR-169, et elle est déclarative parce
-- qu'aucune ligne de code ne peut constater où un opérateur range un secret.

-- ---------------------------------------------------------------------------
-- 1. La table
-- ---------------------------------------------------------------------------
-- `entries` ET `last_entry_hash`, pas l'un ou l'autre. Le hachage seul ne dit pas
-- combien d'entrées le précèdent ; le compte seul ne dit pas lesquelles. Les deux
-- ensemble, ancrés à `last_audit_id`, ferment la troncature dans les deux directions.
--
-- `entries >= 0` et non `> 0` : un témoin sur un journal vide est licite, et c'est
-- voulu. Un tenant neuf n'a rien à attester, et un relevé périodique qui devrait
-- traiter ce cas à part finirait par le traiter mal. `last_entry_hash` vaut alors
-- `GENESIS`, exactement comme le fait `core/audit.log_event` pour la première entrée.
create table if not exists audit_checkpoints (
    id              bigserial primary key,
    tenant_id       uuid   not null references tenants (id) on delete cascade,
    -- Combien d'entrées ce tenant comptait, et jusqu'à laquelle.
    entries         bigint not null check (entries >= 0),
    last_audit_id   bigint,
    -- `audit_log.entry_hash` de `last_audit_id`, ou `GENESIS` sur un journal vide.
    last_entry_hash text   not null,
    at              timestamptz not null default now(),
    -- Vocabulaire fermé côté schéma **et** côté application (`core/checkpoints.py`).
    algorithm       text   not null check (algorithm in ('ed25519')),
    -- L'empreinte de la clé publique : une rotation doit laisser les anciens témoins
    -- vérifiables, et sans ce champ elle les invalide tous en silence.
    key_id          text   not null,
    -- La clé PUBLIQUE, en base64. C'est ce qui rend le témoin vérifiable par un tiers.
    -- Aucune colonne de cette table ne peut porter une clé privée : c'est la lecture
    -- structurelle de FR-169, et non une note de revue.
    public_key      text   not null,
    signature       text   not null,
    -- Les témoins se chaînent entre eux, pour la raison qui vaut pour les entrées
    -- d'audit : sinon on supprime un témoin gênant au lieu de supprimer des entrées.
    entry_digest    text   not null,
    prev_hash       text   not null,
    entry_hash      text   not null,
    -- Reprendre un témoin à la même position n'est pas un doublon : c'est la même
    -- affirmation, à un instant différent, et deux témoins concordants valent mieux
    -- qu'un. Aucune contrainte d'unicité, donc — mais un index qui rend la lecture
    -- du dernier témoin d'un tenant immédiate.
    constraint audit_checkpoints_vide_coherent
        check ((entries = 0) = (last_audit_id is null))
);

create index if not exists idx_audit_checkpoints_tenant
    on audit_checkpoints (tenant_id, id desc);

comment on table audit_checkpoints is
    'Témoins signés de la chaîne d''audit (FR-169). La clé privée ne réside jamais '
    'en base : aucune colonne ne peut la porter. La clé publique voyage avec chaque '
    'témoin pour qu''un tiers puisse vérifier sans rien nous demander.';

-- ---------------------------------------------------------------------------
-- 2. Append-only, comme tout ce qui atteste
-- ---------------------------------------------------------------------------
-- Même patron que `approval_decision_events` (0029) et `tenant_plan_changes` (0030),
-- TRUNCATE compris **dès la première migration** : `0028` a dû revenir poser ce
-- trigger sur trois tables parce qu'il manquait, et un trigger `for each row` ne se
-- déclenche pas sur TRUNCATE. On ne recommence pas.
create or replace function audit_checkpoints_immutable() returns trigger
    language plpgsql as $$
begin
    raise exception 'audit_checkpoints is append-only';
end;
$$;

drop trigger if exists audit_checkpoints_no_update on audit_checkpoints;
create trigger audit_checkpoints_no_update before update on audit_checkpoints
    for each row execute function audit_checkpoints_immutable();
drop trigger if exists audit_checkpoints_no_delete on audit_checkpoints;
create trigger audit_checkpoints_no_delete before delete on audit_checkpoints
    for each row execute function audit_checkpoints_immutable();
drop trigger if exists audit_checkpoints_no_truncate on audit_checkpoints;
create trigger audit_checkpoints_no_truncate before truncate on audit_checkpoints
    for each statement execute function audit_checkpoints_immutable();

-- ---------------------------------------------------------------------------
-- 3. Row Level Security (§4.3)
-- ---------------------------------------------------------------------------
alter table audit_checkpoints enable row level security;

drop policy if exists audit_checkpoints_select_own on audit_checkpoints;
create policy audit_checkpoints_select_own on audit_checkpoints
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- La policy filtre APRÈS le contrôle de privilège : sans ce grant elle serait une
-- autorisation que personne ne peut exercer (`G-32`, leçon de 0021 et 0026). SELECT
-- seul, et aucune policy d'INSERT/UPDATE/DELETE n'existe : un tenant lit ses témoins,
-- il n'en pose pas.
grant select on table audit_checkpoints to authenticated;

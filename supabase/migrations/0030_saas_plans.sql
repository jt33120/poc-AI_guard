-- 0030_saas_plans.sql — la gamme libre-service.
--
-- Trois paliers, vocabulaire fermé. Une capacité est une **ligne présente** :
-- l'absence est le refus (§4.4). Pas de colonne `enabled` qu'on puisse laisser à
-- `false` en croyant avoir accordé, ni passer à `true` par un accident de seed.
--
-- Pas de table `tenant_capability_grants` : les **quotas** se négocient, les
-- **capacités** non. Une capacité accordée à un tenant seul est une combinaison que
-- personne ne teste, et le jour où elle casse, elle casse chez ce client-là.
--
-- Le palier n'accorde **jamais** la passerelle MCP. `0027` reste le seul verrou de
-- l'offre accompagnée : un tenant `entreprise` n'a pas la passerelle du fait de son
-- palier, parce que la passerelle demande une installation chez lui.

-- ---------------------------------------------------------------------------
-- 1. Les catalogues. Données de référence, publiques : c'est la page de prix.
--
--    Le catalogue existe pour une raison de **sécurité**, pas de rangement. Sans lui
--    `plan_capabilities.capability` est un `text` libre, et `('pro','judgee')` est
--    accepté par la base : le résultat est un 402 permanent sur une fonctionnalité
--    vendue, découvert par un appel client. La clé étrangère ferme ça à l'ÉCRITURE,
--    pas silencieusement à la lecture.
-- ---------------------------------------------------------------------------
create table if not exists plans (
    code  text primary key check (code in ('free', 'pro', 'entreprise')),
    rank  smallint not null unique,
    label text not null
);

insert into plans (code, rank, label) values
    ('free', 1, 'Découverte'), ('pro', 2, 'Pro'), ('entreprise', 3, 'Entreprise')
on conflict (code) do nothing;

create table if not exists capability_catalog (
    capability text primary key check (capability ~ '^[a-z][a-z0-9_]*$'),
    label      text not null
);

insert into capability_catalog (capability, label) values
    ('authorize','/v1/authorize et le moteur déterministe'),
    ('audit_chain','Journal hash-chaîné et verify_chain'),
    ('audit_export_raw','Export CSV/JSON brut'),
    ('llm_proxy','Proxy de surveillance des appels de modèle'),
    ('hitl_single','File d''approbation, un approbateur'),
    ('policy_edit','Éditeur de policy YAML'),
    ('judge','Juge LLM sur les cas ambigus'),
    ('policy_assistant','Rédaction de policy en langage naturel'),
    ('dlp','Inspection DLP de l''egress'),
    ('prompt_guard','Garde-prompt tiers'),
    ('risk_bands','Autonomie graduée'),
    ('hitl_dual','Double approbation'),
    ('taint_guard','Contamination de session'),
    ('integrity','Empreintes d''outils et quarantaine'),
    ('monitor_windows','Fenêtres d''observation'),
    ('clients','Regroupement par client / projet'),
    ('read_tokens','Jetons de lecture serveur-à-serveur'),
    ('promotion','Promotion de policy staging → prod'),
    ('compliance_pack','Attestation AI Act art. 12 / 14'),
    ('notify','Notification des approbations en attente'),
    ('sso_federation','Fédération d''identité de la console'),
    ('shadow_ai','Inventaire des IA non déclarées'),
    ('corpora','Médiation et déclaration des corpus'),
    ('third_party_verdicts','Verdicts d''outils tiers chaînés'),
    ('fria','Art. 26 déployeur et échafaudage FRIA'),
    ('quota_override','Plafonds négociés par métrique'),
    ('control_plane_export','Export des actes de gouvernance'),
    ('usage_billing','Consommation, facturation et tarification'),
    ('credentials','Identifiants fournisseurs pour le coût autoritatif'),
    ('agents_inventory','Inventaire des agents et de leurs jetons'),
    ('triage','Triage des demandes entrantes'),
    ('profiles','Profils de déploiement et souveraineté'),
    ('verdicts_ingest','Ingestion de verdicts d''outils tiers'),
    ('dlp_config','Réglage fin de la DLP par tenant'),
    ('ai_summary','Synthèses rédigées par modèle'),
    ('monitor_admin','Ouverture de fenêtres d''observation'),
    ('integrity_admin','Approbation des empreintes d''outils')
on conflict (capability) do nothing;

create table if not exists plan_capabilities (
    plan       text not null references plans (code) on delete cascade,
    capability text not null references capability_catalog (capability),
    primary key (plan, capability)
);

-- Le catalogue des métriques porte la FORME, et `plan_limits` la reprend par clé
-- étrangère COMPOSITE : une métrique ne peut pas être `flux` dans un palier et
-- `stock` dans un autre, ni exister par faute de frappe.
--   flux  : consommation remise à zéro chaque mois calendaire
--   stock : quantité concurrente, comptée à la création
--   debit : requêtes par minute, appliqué par slowapi
create table if not exists metric_catalog (
    metric text primary key check (metric ~ '^[a-z][a-z0-9_]*$'),
    shape  text not null check (shape in ('flux', 'stock', 'debit')),
    unique (metric, shape)
);

insert into metric_catalog (metric, shape) values
    ('decisions','flux'), ('proxy_calls','flux'), ('judge_calls','flux'),
    ('export_jobs','flux'), ('agents','stock'), ('seats','stock'),
    ('clients','stock'), ('downstream_servers','stock'),
    ('authorize_rpm','debit'), ('proxy_rpm','debit')
on conflict (metric) do nothing;

-- `limit_value` est un entier, **jamais NULL**. « Illimité » ne s'écrit pas comme une
-- absence : ce serait une branche de code qui saute la comparaison, donc un chemin où
-- le plafond ne s'applique pas. Et NULL est exactement ce à quoi ressemble une lecture
-- ratée. Un très grand nombre passe par la même ligne de code que 10 000.
create table if not exists plan_limits (
    plan        text   not null references plans (code) on delete cascade,
    metric      text   not null,
    shape       text   not null,
    limit_value bigint not null check (limit_value >= 0),
    -- Tolérance au-dessus du quota, en %. Sert à PRÉVENIR avant de resserrer : un
    -- client qui découvre son plafond par une panne ne renouvelle pas. À 0 pour un
    -- coût variable direct (`judge_calls`) et pour tout `stock`.
    grace_pct   smallint not null default 0 check (grace_pct between 0 and 100),
    primary key (plan, metric),
    foreign key (metric, shape) references metric_catalog (metric, shape)
);

insert into plan_capabilities (plan, capability) values
    ('free','authorize'), ('free','audit_chain'), ('free','audit_export_raw'),
    ('free','llm_proxy'), ('free','hitl_single'), ('free','policy_edit'),
    ('free','agents_inventory'), ('free','usage_billing'), ('free','triage'),
    ('pro','authorize'), ('pro','audit_chain'), ('pro','audit_export_raw'),
    ('pro','llm_proxy'), ('pro','hitl_single'), ('pro','policy_edit'),
    ('pro','agents_inventory'), ('pro','usage_billing'), ('pro','triage'),
    ('pro','judge'), ('pro','policy_assistant'), ('pro','dlp'), ('pro','prompt_guard'),
    ('pro','risk_bands'), ('pro','hitl_dual'), ('pro','taint_guard'), ('pro','integrity'),
    ('pro','monitor_windows'), ('pro','clients'), ('pro','read_tokens'),
    ('pro','promotion'), ('pro','compliance_pack'), ('pro','notify'),
    ('pro','credentials'), ('pro','dlp_config'), ('pro','ai_summary'),
    ('pro','monitor_admin'), ('pro','integrity_admin'),
    ('entreprise','authorize'), ('entreprise','audit_chain'), ('entreprise','audit_export_raw'),
    ('entreprise','llm_proxy'), ('entreprise','hitl_single'), ('entreprise','policy_edit'),
    ('entreprise','agents_inventory'), ('entreprise','usage_billing'), ('entreprise','triage'),
    ('entreprise','judge'), ('entreprise','policy_assistant'), ('entreprise','dlp'),
    ('entreprise','prompt_guard'), ('entreprise','risk_bands'), ('entreprise','hitl_dual'),
    ('entreprise','taint_guard'), ('entreprise','integrity'), ('entreprise','monitor_windows'),
    ('entreprise','clients'), ('entreprise','read_tokens'), ('entreprise','promotion'),
    ('entreprise','compliance_pack'), ('entreprise','notify'),
    ('entreprise','credentials'), ('entreprise','dlp_config'), ('entreprise','ai_summary'),
    ('entreprise','monitor_admin'), ('entreprise','integrity_admin'),
    ('entreprise','sso_federation'), ('entreprise','shadow_ai'), ('entreprise','corpora'),
    ('entreprise','third_party_verdicts'), ('entreprise','verdicts_ingest'),
    ('entreprise','fria'), ('entreprise','profiles'),
    ('entreprise','quota_override'), ('entreprise','control_plane_export')
on conflict (plan, capability) do nothing;

insert into plan_limits (plan, metric, shape, limit_value, grace_pct) values
    ('free','decisions','flux',10000,10),   ('free','proxy_calls','flux',20000,10),
    ('free','judge_calls','flux',0,0),      ('free','export_jobs','flux',5,0),
    ('free','agents','stock',1,0),          ('free','seats','stock',2,0),
    ('free','clients','stock',0,0),         ('free','downstream_servers','stock',1,0),
    ('free','authorize_rpm','debit',60,0),  ('free','proxy_rpm','debit',120,0),
    ('pro','decisions','flux',200000,10),   ('pro','proxy_calls','flux',500000,10),
    ('pro','judge_calls','flux',2000,0),    ('pro','export_jobs','flux',200,10),
    ('pro','agents','stock',10,0),          ('pro','seats','stock',15,0),
    ('pro','clients','stock',25,0),         ('pro','downstream_servers','stock',10,0),
    ('pro','authorize_rpm','debit',600,0),  ('pro','proxy_rpm','debit',1200,0),
    ('entreprise','decisions','flux',2000000,10),
    ('entreprise','proxy_calls','flux',5000000,10),
    ('entreprise','judge_calls','flux',20000,0),
    ('entreprise','export_jobs','flux',2000,10),
    ('entreprise','agents','stock',100,0),  ('entreprise','seats','stock',200,0),
    ('entreprise','clients','stock',500,0), ('entreprise','downstream_servers','stock',100,0),
    ('entreprise','authorize_rpm','debit',3000,0), ('entreprise','proxy_rpm','debit',6000,0)
on conflict (plan, metric) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Le palier d'un tenant, et la rétrogradation DIFFÉRÉE
-- ---------------------------------------------------------------------------
-- Défaut `free`, et l'asymétrie avec `0027` est voulue : là, le défaut sûr était
-- `false` parce que le booléen **accordait** ; ici `free` est le palier le plus
-- restreint, donc y retomber est le choix fail-closed. `not null` : il n'existe pas
-- d'état « sans palier », qui serait une absence dont chacun déduirait ce qu'il veut.
--
-- `plan_pending_*` matérialise la règle « un resserrement ne s'applique qu'à la
-- période suivante, un élargissement tout de suite ». Sans ces deux colonnes, la
-- règle n'est appliquée que par un opérateur qui s'en souvient — une entrée d'agenda
-- — et le garde-fou contre « un incident de paiement devient un incident de
-- production » n'est pas implémentable.
alter table tenants
    add column if not exists plan text not null default 'free' references plans (code),
    add column if not exists plan_since timestamptz not null default now(),
    add column if not exists plan_pending_tier text references plans (code),
    add column if not exists plan_pending_at   timestamptz;

alter table tenants drop constraint if exists tenants_plan_pending_coherent;
alter table tenants add constraint tenants_plan_pending_coherent
    check ((plan_pending_tier is null) = (plan_pending_at is null));

comment on column tenants.plan is
    'Palier libre-service. N''accorde jamais mcp_gateway_enabled (offre accompagnée, 0027).';
comment on column tenants.plan_pending_tier is
    'Rétrogradation programmée : appliquée par la facturation à plan_pending_at, jamais avant.';

create index if not exists idx_tenants_plan on tenants (plan);
create index if not exists idx_tenants_plan_pending
    on tenants (plan_pending_at) where plan_pending_tier is not null;

-- ---------------------------------------------------------------------------
-- 3. Quotas négociés — CHIFFRES seulement, jamais de capacité
-- ---------------------------------------------------------------------------
create table if not exists tenant_quota_overrides (
    tenant_id   uuid   not null references tenants (id) on delete cascade,
    metric      text   not null references metric_catalog (metric),
    limit_value bigint not null check (limit_value >= 0),
    reason      text   not null,
    granted_by  uuid,
    granted_at  timestamptz not null default now(),
    expires_at  timestamptz,
    primary key (tenant_id, metric)
);

-- ---------------------------------------------------------------------------
-- 4. La consommation. Une ligne par (tenant, métrique, mois). Une nouvelle période
--    est une NOUVELLE LIGNE : la remise à zéro est une clé primaire différente.
-- ---------------------------------------------------------------------------
-- AUCUN TRIGGER SUR CETTE TABLE, et c'est délibéré. Le compteur est incrémenté dans
-- la transaction qui écrit l'entrée d'audit, sous l'`advisory_xact_lock` que
-- `core/audit.log_event` tient déjà. Un trigger qui lève ferait AVORTER cette
-- transaction : une écriture de FACTURATION pourrait alors faire perdre une écriture
-- de PREUVE, ce que §4.2 interdit. L'incrément est un `+ n` sur un `bigint` sans
-- contrainte accessoire, pour qu'il ne puisse structurellement pas échouer.
-- La monotonie est tenue par l'absence de tout GRANT d'écriture (section 6) : le rôle
-- `authenticated` ne peut ni décrémenter ni supprimer.
create table if not exists plan_usage_counters (
    tenant_id    uuid   not null references tenants (id) on delete cascade,
    metric       text   not null references metric_catalog (metric),
    period_start date   not null,
    used         bigint not null default 0,
    updated_at   timestamptz not null default now(),
    primary key (tenant_id, metric, period_start)
);

-- ---------------------------------------------------------------------------
-- 5. L'histoire des paliers, chaînée. « Depuis quand, par qui, pourquoi » est la
--    question d'un litige de facturation, c'est-à-dire le ticket le plus cher du
--    support. `plan_since` seul est écrasé à chaque mouvement.
--    `reason` en vocabulaire FERMÉ : c'est ce qui vaut la table, pas la table.
-- ---------------------------------------------------------------------------
create table if not exists tenant_plan_changes (
    id         bigserial primary key,
    tenant_id  uuid not null references tenants (id) on delete cascade,
    from_tier  text references plans (code),
    to_tier    text not null references plans (code),
    reason     text not null
        check (reason in ('signup','checkout','downgrade','dunning','admin','scheduled')),
    -- Le `sub` opaque de l'opérateur, jamais un e-mail (§4.10).
    actor      text,
    at         timestamptz not null default now(),
    entry_digest text not null,
    prev_hash    text not null,
    entry_hash   text not null
);

create index if not exists idx_plan_changes_tenant
    on tenant_plan_changes (tenant_id, id desc);

create or replace function tenant_plan_changes_immutable() returns trigger
    language plpgsql as $$
begin
    raise exception 'tenant_plan_changes is append-only';
end;
$$;

drop trigger if exists tenant_plan_changes_no_update on tenant_plan_changes;
create trigger tenant_plan_changes_no_update before update on tenant_plan_changes
    for each row execute function tenant_plan_changes_immutable();
drop trigger if exists tenant_plan_changes_no_delete on tenant_plan_changes;
create trigger tenant_plan_changes_no_delete before delete on tenant_plan_changes
    for each row execute function tenant_plan_changes_immutable();
drop trigger if exists tenant_plan_changes_no_truncate on tenant_plan_changes;
create trigger tenant_plan_changes_no_truncate before truncate on tenant_plan_changes
    for each statement execute function tenant_plan_changes_immutable();

-- ---------------------------------------------------------------------------
-- 6. Row Level Security (§4.3)
-- ---------------------------------------------------------------------------
alter table plans                  enable row level security;
alter table capability_catalog     enable row level security;
alter table metric_catalog         enable row level security;
alter table plan_capabilities      enable row level security;
alter table plan_limits            enable row level security;
alter table tenant_quota_overrides enable row level security;
alter table plan_usage_counters    enable row level security;
alter table tenant_plan_changes    enable row level security;

-- La grille est publique et ne dit rien d'aucun tenant : c'est la page de prix, il
-- faut pouvoir l'afficher pour vendre le palier au-dessus.
drop policy if exists plans_select_all on plans;
create policy plans_select_all on plans for select to authenticated using (true);
drop policy if exists capability_catalog_select_all on capability_catalog;
create policy capability_catalog_select_all on capability_catalog
    for select to authenticated using (true);
drop policy if exists metric_catalog_select_all on metric_catalog;
create policy metric_catalog_select_all on metric_catalog
    for select to authenticated using (true);
drop policy if exists plan_capabilities_select_all on plan_capabilities;
create policy plan_capabilities_select_all on plan_capabilities
    for select to authenticated using (true);
drop policy if exists plan_limits_select_all on plan_limits;
create policy plan_limits_select_all on plan_limits
    for select to authenticated using (true);

-- Ce qui est PROPRE au tenant est clos par tenant. Le palier lui-même n'a besoin
-- d'aucune policy neuve : `tenants.plan` est une colonne d'une table déjà fermée par
-- `tenants_select_own` (0001), et 0001 ne donne que `select` sur `tenants` — un tenant
-- ne peut donc ni lire le palier d'un autre, ni s'auto-promouvoir.
drop policy if exists tenant_quota_overrides_select_own on tenant_quota_overrides;
create policy tenant_quota_overrides_select_own on tenant_quota_overrides
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

drop policy if exists plan_usage_counters_select_own on plan_usage_counters;
create policy plan_usage_counters_select_own on plan_usage_counters
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

drop policy if exists tenant_plan_changes_select_own on tenant_plan_changes;
create policy tenant_plan_changes_select_own on tenant_plan_changes
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- La policy filtre APRÈS le contrôle de privilège : sans grant elle serait une
-- autorisation que personne ne peut exercer (`G-32`). SELECT seul : aucune policy
-- d'INSERT/UPDATE/DELETE n'existe sur aucune de ces huit tables.
grant select on table plans, capability_catalog, metric_catalog, plan_capabilities,
                      plan_limits, tenant_quota_overrides, plan_usage_counters,
                      tenant_plan_changes to authenticated;

-- Explicite plutôt qu'implicite : un tenant qui pourrait faire un UPDATE sur
-- `tenants` s'auto-promeut. `authenticated` n'a jamais eu ce droit (0001 ne donne que
-- `select`) ; on le grave dans le schéma plutôt que dans une note de revue.
revoke insert, update, delete on table tenants from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. La trace côté audit — colonne ANNEXE, hors chaîne
-- ---------------------------------------------------------------------------
-- `core/audit.payload_v1` a une liste de champs figée par `docs/AUDIT_FORMAT.md` : y
-- ajouter un champ rendrait invérifiable toute la chaîne déjà écrite. Même choix
-- exactement que `gateway_token_id` en `0006` — l'attribution est de la métadonnée
-- opérationnelle, la chaîne couvre toujours la décision elle-même (§4.2).
alter table audit_log
    add column if not exists constraint_reason text;

comment on column audit_log.constraint_reason is
    'Pourquoi la décision a été resserrée hors policy (plan_quota_exhausted, '
    'plan_counter_unavailable). ANNEXE : hors payload_v1, la chaîne reste vérifiable.';

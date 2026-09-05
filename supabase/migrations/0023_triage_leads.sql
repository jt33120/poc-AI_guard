-- 0023_triage_leads.sql — captures du diagnostic public de profil (`QO-7`).
--
-- Le diagnostic de profil est public : un prospect coche ses profils d'usage et
-- obtient sa carte « ce qui vous concerne / ce que nous bloquons ». L'e-mail est
-- demandé avant le résultat, donc **cette table contient de la donnée personnelle**,
-- et c'est la seule du produit dans ce cas qui n'appartienne à aucun tenant : un
-- prospect n'en a pas.
--
-- Trois conséquences, chacune écrite ici parce qu'un lecteur de ce fichier est
-- exactement la personne qui doit les connaître.

create table if not exists triage_leads (
    id bigint generated always as identity primary key,
    -- Donnée personnelle. Minimisation : rien d'autre n'est collecté — pas d'IP, pas
    -- d'user-agent, pas de nom. Ce qui n'est pas collecté n'a pas à être protégé.
    email text not null,
    -- Les profils cochés : c'est la finalité même (savoir ce qui intéresse le
    -- prospect), donc c'est proportionné.
    profiles text[] not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_triage_leads_created on triage_leads (created_at desc);

-- 1. RLS activée comme partout, mais **sans policy par tenant** : la ligne
--    n'appartient à personne dans le modèle multi-tenant. Écrire
--    `tenant_id = auth.jwt()...` ici serait une phrase qui ne veut rien dire.
alter table triage_leads enable row level security;

-- 2. Aucun privilège pour les rôles de la console. `G-32` a montré qu'une policy sans
--    `grant` est une autorisation que personne ne peut exercer ; l'inverse est aussi
--    vrai — un `grant` sans besoin élargit la surface pour rendre vraie une phrase que
--    personne ne prononce. Aucun écran ne lit les leads : la lecture se fait par la
--    connexion de service, côté exploitant.
revoke all privileges on table triage_leads from anon, authenticated;

-- 3. La rétention est bornée et purgée (`core/leads.py`). Une donnée personnelle sans
--    durée de conservation n'a pas de base légale, et le produit est vendu sur la
--    gouvernance des données : se le permettre ici serait la contradiction la plus
--    coûteuse possible.
comment on table triage_leads is
    'Captures du diagnostic public (QO-7). Donnée personnelle, sans tenant, '
    'rétention bornée et purgée par core.leads.purge_expired.';

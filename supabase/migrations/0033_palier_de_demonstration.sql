-- 0033_palier_de_demonstration.sql — pendant la démonstration, un inscrit reçoit tout.
--
-- Ce que ça change : le palier d'entrée, et rien d'autre. La gamme de `0030` reste
-- entière — trois paliers, leurs capacités, leurs quotas — parce qu'elle est le
-- modèle de facturation du jour où il y en aura un. Ce qui bouge est le **défaut de
-- la colonne**, c'est-à-dire le palier qu'un tenant reçoit s'il n'en demande aucun.
--
-- Pourquoi. Le produit n'est pas facturé : il est montré. Un inscrit qui atterrit en
-- `free` obtient 9 capacités sur 37 et zéro appel de juge, alors que la page qui l'a
-- fait venir décrit ce que le produit sait faire. L'écart ne se voit pas à
-- l'inscription — il se découvre à la première fonction qui répond 402, et c'est le
-- moment précis où on perd la démonstration.
--
-- Le sens de la bascule est assumé : `free` était le choix fail-closed de `0030`, et
-- ouvrir large est le choix inverse. Ce qu'elle ouvre reste borné par ce qu'elle
-- n'ouvre PAS, et cette liste est la raison pour laquelle la bascule est tenable :
--
--   * `mcp_gateway_enabled` (`0027`) n'est pas touché. La passerelle contraignante
--     reste accordée à la main, parce qu'elle s'installe chez le client et demande
--     un `DATABASE_URL` qu'un inscrit n'a pas. C'est le seul verrou qui exécute ou
--     n'exécute pas, et il ne s'ouvre pas par un défaut de colonne.
--   * L'isolation des tenants ne dépend pas du palier : elle tient aux politiques
--     RLS, qui ne lisent pas `plan`.
--   * Les plafonds d'infrastructure de `api/ratelimit.py` s'appliquent au-dessus du
--     palier, pas en dessous : un tenant `entreprise` ne peut pas faire tomber le
--     service en consommant son quota.
--
-- Revenir en arrière est une ligne : remettre `default 'free'`. Rien d'autre n'est à
-- défaire, et c'est la raison pour laquelle la gamme n'est pas modifiée ici.
--
-- Les tenants DÉJÀ inscrits ne sont pas déplacés par cette migration, et c'est
-- délibéré : `tenant_plan_changes` est une chaîne d'empreintes calculée par
-- `core/plan_changes.py`, et l'écrire en SQL dupliquerait la convention de
-- sérialisation que `FR-163` tient en un seul endroit. Un `update` en masse laisserait
-- donc un état que l'histoire ne décrit pas — exactement ce que la table existe pour
-- empêcher. Le geste est `python -m cli plan set <tenant> entreprise`, qui écrit les
-- deux dans la même transaction.
alter table tenants alter column plan set default 'entreprise';

comment on column tenants.plan is
    'Palier libre-service. Défaut `entreprise` pendant la démonstration (0033) : le '
    'produit est montré, pas facturé. N''accorde jamais mcp_gateway_enabled (0027).';

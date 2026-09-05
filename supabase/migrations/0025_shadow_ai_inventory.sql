-- 0025_shadow_ai_inventory.sql — l'inventaire dérivé du Shadow AI.
--
-- `FR-189` / `G-09`, rattaché à `M-10` (exfiltration / Shadow AI). Mode **`A` —
-- Attesté**, et c'est `QO-3` qui l'a tranché : le marché CASB est intégralement hors
-- UE et ce sont des services qui voient tout le trafic, donc pas de substitut souverain
-- crédible. La règle de `FR-178` s'applique et la ligne descend d'`Orchestré` à
-- `Attesté`. Nous n'orchestrons personne ; nous rendons une déclaration auditable.
--
-- **Ce que cette table ne contient pas, et c'est le point.** Aucune ligne de journal,
-- aucune URL, aucun identifiant en clair. Seulement l'inventaire **dérivé** : des
-- comptes d'acteurs distincts par service reconnu. Le journal d'egress reste chez le
-- client — c'est un artefact de son SOC, et « elle ne traite pas les menaces du plan
-- endpoint » (PRD §4) reste vrai tant que rien de brut n'entre ici.
--
-- Une déclaration par tenant, remplacée par `PUT`, comme `corpora`. L'historique
-- appartient au journal d'audit, pas à cette table.

create table if not exists shadow_ai_inventory (
    tenant_id uuid primary key references tenants (id) on delete cascade,
    -- La fenêtre sur laquelle l'extrait a été produit, telle que déclarée. Un
    -- inventaire sans fenêtre ne dit pas de quoi il parle : « trois usages non
    -- supervisés » sur un jour ou sur un an ne se lisent pas pareil.
    window_start timestamptz not null,
    window_end timestamptz not null,
    -- L'inventaire dérivé : {supervised: {service: acteurs}, shadow: {...},
    -- unclassified: n, rejected: n}. Agrégé, jamais brut.
    inventory jsonb not null,
    declared_at timestamptz not null default now(),
    declared_by text,
    check (window_end > window_start)
);

alter table shadow_ai_inventory enable row level security;

drop policy if exists shadow_ai_inventory_select_own on shadow_ai_inventory;
create policy shadow_ai_inventory_select_own on shadow_ai_inventory
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- La policy filtre **après** le contrôle de privilège : sans ce grant elle serait une
-- autorisation que personne ne peut exercer (`G-32`).
grant select on table shadow_ai_inventory to authenticated;

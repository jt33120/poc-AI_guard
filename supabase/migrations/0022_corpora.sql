-- 0022_corpora.sql — provenance déclarée des corpus et bases vectorielles.
--
-- `FR-184` / `G-04`, rattaché à `M-03` (empoisonnement de données). La facette est
-- publiée en mode **`A` — Attesté**, et le mot est choisi : nous ne vérifions pas
-- d'où viennent les données du client, nous rendons sa déclaration **auditable**.
-- Revendiquer davantage serait le genre d'affirmation que `FR-175` refuse.
--
-- Ce qui fait la différence entre une attestation et un formulaire, c'est la
-- fraîcheur. Une déclaration signée une fois puis jamais revue ne dit presque rien :
-- le corpus a changé, la source a changé, le responsable est parti. `last_reviewed_at`
-- est donc obligatoire, et l'Evidence Pack publie combien de déclarations sont
-- périmées — un auditeur peut agir dessus, et un client ne peut pas y échapper en
-- déclarant une fois.

create table if not exists corpora (
    id bigint generated always as identity primary key,
    tenant_id uuid not null references tenants (id) on delete cascade,
    -- Le nom que le client donne au corpus dans ses propres documents.
    name text not null,
    -- `dataset` (jeu d'entraînement, corpus de référence) ou `vector_store` (index
    -- interrogé à l'exécution). La distinction porte le risque : un index alimenté en
    -- continu se ré-empoisonne, un jeu figé non.
    kind text not null check (kind in ('dataset', 'vector_store')),
    -- D'où viennent les données, tel que déclaré. Texte libre : contraindre une
    -- taxonomie ici produirait des déclarations qui rentrent dans les cases plutôt
    -- que des déclarations vraies.
    source text not null,
    -- Qui répond de ce corpus. Une attestation sans porteur n'engage personne.
    steward text not null,
    declared_at timestamptz not null default now(),
    declared_by text,
    -- Obligatoire : voir l'en-tête. Une attestation sans date de revue est un
    -- formulaire.
    last_reviewed_at timestamptz not null,
    unique (tenant_id, name)
);

create index if not exists idx_corpora_tenant on corpora (tenant_id, name);

alter table corpora enable row level security;

-- La console lit les corpus de son tenant ; l'API de contrôle écrit par la connexion
-- de service, comme les autres tables écrites par la machine.
--
-- `create policy` n'a pas d'`if not exists` : le drop-then-create rend le fichier
-- rejouable (restauration, échec partiel, adoption de baseline).
drop policy if exists corpora_select_own on corpora;
create policy corpora_select_own on corpora
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- La policy filtre **après** le contrôle de privilège : sans ce grant elle serait une
-- autorisation que personne ne peut exercer (`G-32`). Le garde de CI
-- `tests/test_rls_gate.py` refuserait d'ailleurs la première sans le second.
grant select on table corpora to authenticated;

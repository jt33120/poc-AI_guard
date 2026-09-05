-- 0024_third_party_verdicts.sql — les verdicts d'analyseurs tiers, reçus et chaînés.
--
-- `FR-191` / `G-14`, rattaché à `M-15` (validation aveugle de code généré par IA) et
-- à `M-11` (supply chain). Le mode revendiqué est **`O` — Orchestré**, et le mot est
-- choisi : l'analyseur tourne **chez le client**, dans sa CI, avec ses règles. Nous ne
-- l'exécutons pas et nous ne rejugeons pas son verdict — nous le recevons, nous le
-- datons, et nous le rendons inaltérable.
--
-- C'est exactement ce que `O` promet (« un contrôle tiers fait le travail ; xSOM
-- collecte son verdict et le chaîne ») et rien de plus. Écrire notre propre analyseur
-- serait construire le contrôle au lieu de l'orchestrer — le même franchissement que
-- `FR-193` doit éviter côté garde-prompt.
--
-- **Pourquoi une table, et pourquoi le journal quand même.** Le reçu est mutable par
-- nature : un rejeu de CI produit un verdict plus récent pour le même dépôt. La
-- chaîne, elle, ne se corrige pas. On applique donc la règle que `FR-163` a posée pour
-- les notes d'opérateur — la valeur vit sur la ligne mutable, et le journal
-- inaltérable en porte l'**empreinte**. « Nous avons reçu ce reçu-là, à cet
-- instant-là » est chaîné ; le détail se relit à côté.

create table if not exists third_party_verdicts (
    id bigint generated always as identity primary key,
    tenant_id uuid not null references tenants (id) on delete cascade,
    -- L'analyseur, tel qu'il se nomme : `semgrep`, `sonarqube`, `pip-audit`,
    -- `trufflehog`. Texte libre, pour la même raison que `corpora.source` : une
    -- taxonomie imposée produit des déclarations qui rentrent dans les cases.
    analyzer text not null,
    -- Sa version et son jeu de règles. Un verdict sans eux ne se rejoue pas, donc ne
    -- se vérifie pas — le même défaut que `LLM01` sans millésime (`FR-194`).
    analyzer_version text not null,
    ruleset text not null,
    -- Ce qui a été analysé. Le sha de commit est ce qui rattache le verdict à un état
    -- du code plutôt qu'à une intention.
    repository text not null,
    commit_sha text not null,
    -- Le verdict de l'analyseur, verbatim, et son décompte par sévérité. Nous ne le
    -- recalculons pas : le rejuger reviendrait à construire le contrôle.
    verdict text not null check (verdict in ('pass', 'fail')),
    findings jsonb not null default '{}'::jsonb,
    -- Quand l'analyse a tourné, **déclaré par le client**, et quand nous l'avons reçue.
    -- Les deux, séparément : l'écart entre eux est ce qu'un auditeur regarde, et une
    -- seule date les confondrait (`FR-161`, déclaré ≠ dérivé).
    ran_at timestamptz not null,
    received_at timestamptz not null default now(),
    -- L'empreinte du reçu canonique, et son chaînage.
    --
    -- **Une seconde chaîne, et non une entrée dans `audit_log`.** Le journal d'audit
    -- est la chaîne du plan de données : une décision par appel d'outil, une charge
    -- figée à douze clés (`FR-171`), une porte d'ingestion parmi trois. Un verdict de
    -- CI n'est aucune de ces choses, et `FR-163` vient d'établir qu'on n'y range pas
    -- ce qui n'y appartient pas. La primitive de chaînage, elle, est partagée —
    -- `core.audit.compute_entry_hash` — parce que deux implémentations du même
    -- hachage finissent par diverger.
    receipt_digest text not null,
    prev_hash text not null,
    entry_hash text not null,
    unique (tenant_id, analyzer, repository, commit_sha, ran_at)
);

create index if not exists idx_verdicts_tenant on third_party_verdicts (tenant_id, ran_at desc);

alter table third_party_verdicts enable row level security;

-- La console lit les verdicts de son tenant ; l'API de contrôle écrit par la connexion
-- de service, comme les autres tables écrites par la machine.
drop policy if exists third_party_verdicts_select_own on third_party_verdicts;
create policy third_party_verdicts_select_own on third_party_verdicts
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- La policy filtre **après** le contrôle de privilège : sans ce grant elle serait une
-- autorisation que personne ne peut exercer (`G-32`).
grant select on table third_party_verdicts to authenticated;

-- Append-only, comme `audit_log` et pour la même raison : une preuve qu'on peut
-- corriger n'en est pas une. Les triggers lèvent y compris pour `service_role`, donc
-- le backend lui-même ne peut pas réécrire un reçu qu'il a accepté.
create or replace function third_party_verdicts_immutable() returns trigger
language plpgsql as $$
begin
    raise exception 'third_party_verdicts is append-only (FR-191)';
end;
$$;

drop trigger if exists third_party_verdicts_no_update on third_party_verdicts;
create trigger third_party_verdicts_no_update
    before update on third_party_verdicts
    for each row execute function third_party_verdicts_immutable();

drop trigger if exists third_party_verdicts_no_delete on third_party_verdicts;
create trigger third_party_verdicts_no_delete
    before delete on third_party_verdicts
    for each row execute function third_party_verdicts_immutable();

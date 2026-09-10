-- 0029_approval_decision_events.sql
--
-- **L'acte humain n'entrait dans aucune chaîne.**
--
-- `api/approvals.py` appelle `approvals.decide(...)` et rend la vue. `grep -n audit
-- api/approvals.py` ne rendait rien. La ligne `hitl_approved` n'est écrite que plus
-- tard, quand un *poll* de l'agent consomme l'approbation — et si l'agent abandonne et
-- ne repolle jamais, l'approbation humaine d'une action irréversible n'existe nulle
-- part ailleurs que dans `approvals`, une table qu'un `update` suffit à réécrire.
--
-- C'est la confusion que `verification_independence()` s'interdit ailleurs : l'export
-- article 14 atteste « approuvé » depuis cette table mutable, sans pouvoir attester
-- « par qui, et à quel quorum ».
--
-- **Choix de table.** Pas `audit_log` : sa colonne `ingress` est un CHECK fermé de
-- trois portes d'appel d'outil (`AD-28`), et en inventer une quatrième rendrait la
-- carte de couverture fausse pour économiser une table. Pas `control_plane_events` :
-- sa colonne `role` est `not null check (role in (...))`, ce n'est pas la forme d'une
-- décision d'approbation. Sa propre table, son propre chaînage, les primitives d'audit
-- partagées — le patron que `0024` et `0026` appliquent déjà.

create table if not exists approval_decision_events (
    id bigserial primary key,
    tenant_id    uuid not null references tenants (id) on delete cascade,
    approval_id  uuid not null references approvals (id) on delete cascade,
    -- Vocabulaire fermé côté application (`core/approval_chain.py`), comme partout.
    event        text not null check (event in ('approved', 'denied')),
    tool_name    text not null,
    action_class text,
    -- Le `sub` opaque de l'approbateur. Jamais un e-mail (§4.10).
    subject      text not null,
    -- Le quorum atteint / requis au moment de la décision : `human_dual` se prouve.
    approved_count int not null check (approved_count >= 0),
    required_count int not null check (required_count >= 1),
    at           timestamptz not null default now(),
    entry_digest text not null,
    prev_hash    text not null,
    entry_hash   text not null
);

create index if not exists idx_approval_decision_events_tenant
    on approval_decision_events (tenant_id, id desc);
create index if not exists idx_approval_decision_events_approval
    on approval_decision_events (approval_id, id desc);

alter table approval_decision_events enable row level security;

drop policy if exists approval_decision_events_select_own on approval_decision_events;
create policy approval_decision_events_select_own on approval_decision_events
    for select to authenticated
    using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- La policy filtre APRÈS le contrôle de privilège : sans ce grant elle serait une
-- autorisation que personne ne peut exercer (`G-32`, leçon de 0021 et 0026).
grant select on table approval_decision_events to authenticated;

create or replace function approval_decision_events_immutable() returns trigger
    language plpgsql as $$
begin
    raise exception 'approval_decision_events is append-only';
end;
$$;

drop trigger if exists approval_decision_events_no_update on approval_decision_events;
create trigger approval_decision_events_no_update
    before update on approval_decision_events
    for each row execute function approval_decision_events_immutable();

drop trigger if exists approval_decision_events_no_delete on approval_decision_events;
create trigger approval_decision_events_no_delete
    before delete on approval_decision_events
    for each row execute function approval_decision_events_immutable();

-- Et TRUNCATE dès la première migration de la table, plutôt que trois migrations plus
-- tard comme pour les trois autres (`0028`).
drop trigger if exists approval_decision_events_no_truncate on approval_decision_events;
create trigger approval_decision_events_no_truncate
    before truncate on approval_decision_events
    for each statement execute function approval_decision_events_immutable();

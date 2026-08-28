-- 0021_policy_grants.sql — deux policies RLS décoratives, corrigées.
--
-- En Postgres, une policy RLS **filtre des lignes après** le contrôle de
-- privilège. Une `create policy ... for select to authenticated` sans
-- `grant select` correspondant n'échoue pas au chargement : elle existe, elle se
-- relit comme une autorisation, et le rôle qu'elle nomme ne pourra jamais
-- l'exercer. C'est l'équivalent RLS d'une clé de policy qui parse sans effet.
--
-- Treize tables sur quinze le faisaient correctement. Les deux fautives sont les
-- plus récentes (`0017`, `0018`) — le défaut est arrivé avec la vitesse, comme
-- toujours. Sondé sur le cluster plutôt que déduit du DDL :
--
--   SANS GRANT  monitor_windows  SELECT  monitor_windows_select_own
--   SANS GRANT  session_taint    SELECT  session_taint_select_own
--
-- Les deux ne se corrigent pas de la même façon, parce que l'intention n'est pas
-- la même.

-- `monitor_windows` : la policy dit vrai, il lui manquait le privilège. L'écran
-- d'administration ratifié (`blueprint/04-ecrans/admin-amendement.yaml`) liste les
-- fenêtres, et l'Evidence Pack déclare désormais les périodes d'observation depuis
-- une connexion scopée par RLS (`FR-179`). Une période pendant laquelle
-- l'enforcement a été relâché est une preuve : elle doit être lisible.
grant select on table monitor_windows to authenticated;

-- `session_taint` : aucun lecteur. Aucune spec d'écran ne mentionne le taint,
-- aucun endpoint ne le sert, et le gateway l'écrit sur la connexion de service.
-- Accorder un privilège dont personne n'a besoin élargit la surface pour rendre
-- vraie une phrase que rien ne prononce ; retirer la policy dit ce qui est. Le
-- jour où une vue console en aura besoin, le garde de CI obligera à écrire les
-- deux moitiés ensemble.
drop policy if exists session_taint_select_own on session_taint;
revoke all privileges on table session_taint from anon, authenticated;

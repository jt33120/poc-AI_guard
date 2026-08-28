-- 0020_audit_ingress.sql — FR-160 / INV-2 : par quelle porte, et dans quelle posture.
--
-- Le produit livre trois chemins d'entrée aux garanties inégales : la passerelle
-- MCP (obligatoire — l'agent ne peut pas ne pas passer), `/v1/authorize`
-- (coopératif — l'agent peut simplement ne pas demander) et le proxy LLM
-- (l'appel d'outil est retiré de la réponse, ce n'est pas une barrière à
-- l'exécution). `AD-28` demande qu'une revendication de couverture porte son
-- chemin d'entrée ; jusqu'ici la ligne d'audit ne le portait pas, donc la
-- revendication n'était pas démontrable depuis le journal.
--
-- `enforcement_mode` dit si une fenêtre d'observation était ouverte. Le cas qui
-- ment déjà est couvert dans la charge hachée : un appel relâché est enregistré
-- `monitor_*` (`AD-27.3`), sinon « on a bloqué » et « on aurait bloqué »
-- hacheraient pareil. Ce que cette colonne ajoute est l'autre moitié — une
-- fenêtre ouverte sur un appel qui aurait été autorisé de toute façon, invisible
-- dans `decision` et pourtant nécessaire pour répondre à « cet agent était-il
-- sous observation à ce moment ».
--
-- Les deux valeurs sont DÉRIVÉES par l'adaptateur d'ingestion : la première de
-- ce que l'adaptateur sait de lui-même, la seconde du plan de contrôle. Aucune
-- ne vient d'un corps de requête (FR-160). Côté Python, `audit.Origin` n'a pas
-- de constructeur depuis une chaîne : une valeur qu'on ne peut pas fabriquer à
-- partir d'une entrée non fiable ne peut pas s'y faufiler.
--
-- Colonnes ANNEXES (AD-1), comme `gateway_token_id` : hors du hachage.
-- `null` = ligne écrite avant que la porte ne soit enregistrée.

alter table audit_log add column if not exists ingress text;
alter table audit_log add column if not exists enforcement_mode text;

-- Vocabulaire clos jusque dans la base : une quatrième porte doit être écrite
-- ici *et* dans `audit.Ingress`, pas apparaître par une chaîne libre.
alter table audit_log drop constraint if exists audit_log_ingress_known;
alter table audit_log add constraint audit_log_ingress_known
    check (ingress is null or ingress in ('mcp_gateway', 'authorize_api', 'llm_proxy'));

alter table audit_log drop constraint if exists audit_log_enforcement_mode_known;
alter table audit_log add constraint audit_log_enforcement_mode_known
    check (enforcement_mode is null or enforcement_mode in ('enforcing', 'observing'));

comment on column audit_log.ingress is
    'Dérivé par l''adaptateur d''ingestion. Jamais accepté d''un corps de requête (FR-160).';
comment on column audit_log.enforcement_mode is
    'Dérivé du plan de contrôle (fenêtre d''observation). Jamais du corps de requête (FR-160).';

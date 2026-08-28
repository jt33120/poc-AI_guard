-- 0019_audit_provenance.sql — FR-161 / INV-3: « déclaré » et « dérivé » cessent
-- de partager une colonne.
--
-- `audit_log.request_id` portait deux provenances sous un seul nom : un UUID4
-- frappé par le serveur sur les chemins passerelle et `/v1/authorize`, et — sur
-- le proxy LLM — le champ `id` du corps de réponse du fournisseur, c'est-à-dire
-- une chaîne choisie par le tiers au bout de la connexion. Les deux entraient
-- dans la charge hachée. Un lecteur de l'export ne pouvait pas les distinguer,
-- et un amont qui renvoie un `id` choisi écrivait cette chaîne dans la chaîne
-- immuable — voire la faisait entrer en collision avec un identifiant réel.
--
-- Désormais `request_id` est *toujours* dérivé par le serveur, et les valeurs
-- déclarées vivent dans leurs propres colonnes. La distinction est structurelle :
-- pas de drapeau qu'un lecteur doit penser à consulter, pas de convention à
-- retenir — deux colonnes, deux origines.
--
-- Colonnes ANNEXES (AD-1) : hors de `_payload` et donc hors du hachage, comme
-- `gateway_token_id`. Conséquence assumée et écrite : leur contenu n'est pas
-- infalsifiable au même titre que la charge. Le remède est une charge v2
-- versionnée, qui appartient au lot « reste de l'intégrité ».

alter table audit_log add column if not exists client_request_id text;
alter table audit_log add column if not exists upstream_request_id text;

comment on column audit_log.request_id is
    'Dérivé par le serveur. Jamais accepté d''un client ni d''un amont (FR-161).';
comment on column audit_log.client_request_id is
    'Déclaré par l''agent (corrélation de sa propre trace). Non vérifié (FR-161).';
comment on column audit_log.upstream_request_id is
    'Déclaré par le fournisseur LLM (son identifiant de complétion). Non vérifié (FR-161).';

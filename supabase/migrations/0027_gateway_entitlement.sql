-- 0027_gateway_entitlement.sql — la passerelle MCP devient une capacité accordée.
--
-- Pourquoi. La passerelle stdio est la seule voie CONTRAIGNANTE : elle exécute ou
-- elle n'exécute pas. Elle tourne chez le client, lancée par son agent, et sa
-- configuration exige des identifiants Postgres directs — un `DATABASE_URL` que
-- l'assistant d'intégration ne peut que laisser en gabarit, parce qu'un inscrit
-- n'en a pas. Elle n'était donc pas en libre-service en fait ; elle l'était en
-- droit, et n'importe quel jeton de tenant valide ouvrait une session.
--
-- Le défaut est `false`, et c'est la règle 4 de CLAUDE.md : fail-closed. Un tenant
-- qui n'a pas reçu la capacité ne peut pas ouvrir de session passerelle, y compris
-- ceux qui existent déjà — leur accorder d'office reviendrait à écrire un verrou
-- qui ne ferme rien.
--
-- Les voies coopératives ne sont PAS touchées : `/v1/authorize` et le proxy passent
-- par `authenticate_gateway_principal`, qui ne lit pas cette colonne.
alter table tenants
    add column if not exists mcp_gateway_enabled boolean not null default false;

comment on column tenants.mcp_gateway_enabled is
    'La passerelle MCP contraignante est-elle accordée à ce tenant ? Accordée avec '
    'l''offre de service, jamais à l''inscription : elle demande une installation.';

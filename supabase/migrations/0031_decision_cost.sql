-- 0031_decision_cost.sql — ce que la garde coûte, mesuré là où elle décide.
--
-- `audit_log.latency_ms` existe depuis `0005` et ne mesure pas ce qu'on croit. Sur la
-- passerelle MCP il chronomètre `self._proxy.call_tool(...)`, c'est-à-dire l'outil
-- **aval** ; sur le proxy LLM il chronomètre l'appel au fournisseur. Ce sont des
-- durées que xSOM subit, pas des durées que xSOM produit. Pire, sur les classes
-- risquées la passerelle écrit la preuve AVANT d'agir (§4.2), donc `latency_ms` y est
-- `null` par construction : la colonne est vide exactement sur les actions qui comptent.
--
-- Il manquait donc le chiffre que le produit doit savoir donner : **combien de
-- millisecondes s'ajoutent à chaque appel parce que la garde est là**. `perf/overhead.json`
-- publie un coût en allers-retours SQL, jamais en millisecondes mesurées ; un prospect
-- qui demande « ça me coûte combien » reçoit une unité qu'il ne sait pas convertir.
--
-- COLONNE ANNEXE, et ce n'est pas un détail de rangement. `core/audit.payload_v1` a une
-- liste de champs figée par `docs/AUDIT_FORMAT.md` : y ajouter un champ recalculerait
-- une charge différente pour chaque entrée déjà écrite et rendrait **toute la chaîne
-- existante invérifiable**. Même choix exactement que `gateway_token_id` en `0006` et
-- `constraint_reason` en `0030`.
--
-- Et le choix est doublement juste ici : une durée est la seule chose de cette table qui
-- ne se reproduit pas à l'identique d'une exécution à l'autre. La faire entrer dans le
-- hachage ferait dépendre la vérifiabilité de la charge de la machine.
--
-- Rejouable : `add column if not exists`, aucune ligne touchée, aucune valeur par défaut
-- (une entrée écrite avant cette migration porte `null`, qui se lit « pas mesuré » et
-- non « zéro »).

alter table audit_log
    add column if not exists decision_ms int;

comment on column audit_log.decision_ms is
    'Millisecondes passées DANS la garde : de la réception de l''appel au verdict, '
    'hors exécution de l''outil aval et hors appel du fournisseur. À distinguer de '
    'latency_ms, qui mesure ce que xSOM attend. ANNEXE : hors payload_v1, la chaîne '
    'déjà écrite reste vérifiable.';

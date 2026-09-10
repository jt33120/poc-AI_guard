-- 0028_no_truncate.sql
--
-- Le trou d'un invariant que trois migrations déclarent déjà tenir (CLAUDE.md §4.2).
--
-- `0005_audit_log.sql` annonce en en-tête des « triggers that hard-block mutation even
-- for the service role », et pose deux triggers `for each row` sur UPDATE et DELETE.
-- `0024` et `0026` répètent le même patron. En PostgreSQL, **un trigger ligne à ligne
-- ne se déclenche pas sur TRUNCATE** : il faut `before truncate ... for each statement`.
-- `grep -rni truncate supabase/migrations/` ne rendait rien.
--
-- Le backend se connecte comme **propriétaire** des tables (`core/db.py` le documente
-- explicitement : l'immuabilité repose sur la propriété, pas sur un rôle restreint), et
-- un propriétaire a le droit de TRUNCATE. Une injection SQL, un script de purge, une
-- restauration ratée : le journal entier d'un tenant partait sans que rien ne lève.
--
-- Et le mode d'échec est le pire possible : `core/audit.py::verify_chain` sur une table
-- vide ne parcourt aucune ligne et rend `ok=True, count=0`. `/v1/compliance/status`
-- répondait donc `chain_ok: true` sur un journal anéanti — la preuve détruite, et
-- l'attestation qui dit que tout va bien.
--
-- Les fonctions de blocage existantes conviennent telles quelles : elles lèvent sans
-- lire ni NEW ni OLD, qui n'existent pas dans un trigger TRUNCATE.
--
-- Rien à annuler côté données : ces triggers n'ajoutent aucune colonne et ne touchent
-- aucune ligne. La migration est rejouable.

drop trigger if exists audit_log_no_truncate on audit_log;
create trigger audit_log_no_truncate
    before truncate on audit_log
    for each statement execute function audit_log_block_mutation();

drop trigger if exists control_plane_events_no_truncate on control_plane_events;
create trigger control_plane_events_no_truncate
    before truncate on control_plane_events
    for each statement execute function control_plane_events_immutable();

drop trigger if exists third_party_verdicts_no_truncate on third_party_verdicts;
create trigger third_party_verdicts_no_truncate
    before truncate on third_party_verdicts
    for each statement execute function third_party_verdicts_immutable();

# Promesses de la plateforme AI Guard, et ce qui les prouve

Chaque phrase qu'un client lit sur la plateforme AI Guard — la diapositive AI Guard de
`/produits`, les offres de `frontend/components/guard-offers-copy.ts`, la console, le
README — est rattachée ici au test ou à la barrière qui la prouve. Une promesse sans
preuve automatique est soit réécrite, soit listée comme non prouvée : elle n'est pas
laissée telle quelle.

`tests/test_platform_claims.py` relit ce fichier : chaque référence `tests/…::nom` doit
désigner un test qui existe, et chaque ligne « Prouvé » doit en citer au moins un. Une
preuve renommée ou supprimée casse la CI au lieu de laisser une promesse orpheline.

Statuts : **Prouvé** (un test automatique échoue si la promesse devient fausse),
**Borné** (la promesse est volontairement limitée par le texte, et la limite est
testée), **Non prouvé** (aucune preuve automatique ce soir ; texte corrigé ou à
qualifier).

## Contrôle des actions (passerelle MCP, `/v1/authorize`, proxy)

| # | Promesse (où on la lit) | Preuve | Statut |
|---|---|---|---|
| A1 | « Chaque action rencontre une règle : automatique, soumise à une validation humaine, ou refusée » (`/produits`, README) | `tests/test_policy.py::test_evaluate_read_is_auto`, `tests/test_policy.py::test_evaluate_irreversible_is_human_dual`, `tests/test_policy.py::test_evaluate_unknown_is_deny` | Prouvé |
| A2 | Outil inconnu = refus (fail-closed, `CLAUDE.md` §4.4, README) | `tests/test_policy.py::test_authorize_known_and_unknown`, `tests/test_downstream_proxy.py::test_unknown_tool_raises` | Prouvé |
| A3 | Une action irréversible non approuvée n'est jamais exécutée ; approuvée, elle l'est une fois (`CLAUDE.md` §4.1, « validation humaine ») | `tests/test_hitl_gate.py::test_irreversible_held_then_approved_relays_once`, `tests/test_hitl_gate.py::test_denied_is_never_relayed`, `tests/test_hitl_gate.py::test_expired_is_never_relayed` | Prouvé |
| A4 | Service d'approbation indisponible = refus de l'irréversible | `tests/test_hitl_gate.py::test_approval_service_down_fails_closed`, `tests/test_preuve_avant_action.py::test_an_unknown_class_is_denied_when_the_approval_service_is_down` | Prouvé |
| A5 | Double validation : deux approbateurs distincts pour `human_dual` | `tests/test_approvals.py::test_decide_human_dual_needs_two_distinct_approvers` | Prouvé |
| A6 | Le LLM juge classe, il n'autorise jamais ; en cas de doute il surclasse ; son coût est plafonné | `tests/test_judge.py::test_judge_never_emits_an_authorization`, `tests/test_judge.py::test_classify_overclasses_on_invalid_json`, `tests/test_judge.py::test_cost_cap_bounds_model_calls`, `tests/test_judge_gate.py::test_ambiguous_without_a_judge_is_held_not_auto_allowed` | Prouvé |
| A7 | La preuve est écrite avant l'action ; journal inaccessible = irréversible refusé | `tests/test_preuve_avant_action.py::test_the_proof_is_written_before_the_call_not_after`, `tests/test_preuve_avant_action.py::test_an_irreversible_call_is_denied_when_the_audit_cannot_be_written` | Prouvé |
| A8 | Un jeton de passerelle révoqué arrête une session vivante | `tests/test_stop_gate.py::test_a_revoked_token_stops_a_live_session` | Prouvé |
| A9 | « Seuls les outils raccordés sont contrôlés » (`/produits`, note) | limite énoncée ; le chemin non raccordé n'est par construction pas vu. `tests/test_monitor_mcp_gate.py::test_a_window_never_relays_an_irreversible_action` borne le mode observation | Borné |

## Journal d'audit

| # | Promesse (où on la lit) | Preuve | Statut |
|---|---|---|---|
| J1 | « Journal d'audit immuable » : ni modification, ni suppression, ni troncature (`/produits`, README, `CLAUDE.md` §4.2) | `tests/test_audit.py::test_append_only_triggers_block_update_and_delete`, `tests/test_audit.py::test_truncate_is_refused_like_update_and_delete` | Prouvé |
| J2 | Hash-chaîné, et `verify_chain` détecte l'altération | `tests/test_audit.py::test_log_event_chains_entries`, `tests/test_audit.py::test_verify_chain_detects_tampering`, `tests/test_audit.py::test_chain_is_per_tenant` | Prouvé |
| J3 | Une amputation de la fin du journal se voit (témoins signés) | `tests/test_checkpoints.py::test_a_deleted_tail_is_invisible_to_the_chain_and_obvious_to_the_witness`, `tests/test_checkpoints.py::test_a_third_party_can_verify_without_asking_us` | Prouvé (si `CHECKPOINT_SIGNING_KEY` est posée ; sans elle l'Evidence Pack le dit) |
| J4 | Aucun argument sensible ni donnée personnelle dans le journal : empreinte seulement | `tests/test_audit.py::test_only_args_hash_is_stored`, `tests/test_pii_boundary_gate.py::test_a_secret_key_is_still_masked_everywhere` | Prouvé |
| J5 | « Exportable » (AI Act / RGPD, JSON et PDF) | `tests/test_audit_api.py::test_export_json_and_pdf`, `tests/test_compliance_api.py::test_export_json_and_pdf` | Prouvé |
| J6 | Console : « Chaînage du journal cohérent… Ce n'est pas une attestation des postes » (`/extensions`) | `tests/test_extension_devices.py::test_registration_deduplication_revocation_and_rls` (chaîne des postes vérifiée) ; la phrase borne elle-même la portée | Borné |

## Isolation, identité, session

| # | Promesse (où on la lit) | Preuve | Statut |
|---|---|---|---|
| I1 | Isolation des tenants par RLS PostgreSQL, pas seulement applicative (`CLAUDE.md` §4.3, README) | `tests/test_rls.py::test_tenant_isolation_via_rls`, `tests/test_rls_gate.py::test_every_public_table_has_rls_enabled`, `tests/test_rls_gate.py::test_every_created_table_enables_rls_in_its_own_migration` | Prouvé |
| I2 | La RLS tient aussi hors Supabase (déploiement dans votre infrastructure) | `tests/test_deploy_compat.py::test_rls_still_isolates_tenants_without_supabase` | Prouvé |
| I3 | Jamais de jeton de session dans `localStorage` : cookies `httpOnly`, proxy même-origine (`CLAUDE.md` §4.5) | `tests/test_console_session_gate.py::test_browser_storage_holds_no_session`, `tests/test_console_session_gate.py::test_every_session_cookie_writer_forces_httponly`, `tests/test_console_session_gate.py::test_the_access_token_never_reaches_a_client_component`, `tests/test_console_session_gate.py::test_no_supabase_client_runs_in_the_browser` | Prouvé (ajouté ce soir) |
| I4 | Jetons de passerelle stockés hachés | `tests/test_tenant_tokens.py::test_hash_token_is_stable_sha256_hex`, `tests/test_tenant_tokens.py::test_resolve_revoked_token_returns_none` | Prouvé |
| I5 | Pas de documentation d'API en production, aucune trace d'erreur renvoyée au client (`CLAUDE.md` §4.8) | `tests/test_public_surface.py::test_production_serves_no_documentation`, `tests/test_platform_claims.py::test_an_unhandled_error_reveals_nothing_to_the_client` | Prouvé (second test ajouté ce soir) |
| I6 | Le proxy de la console ne relaie que les chemins qu'elle emploie | `tests/test_control_proxy.py::test_every_call_the_console_makes_is_allowed_by_the_table`, `tests/test_control_proxy.py::test_the_table_grants_nothing_the_console_does_not_ask_for` | Prouvé |

## Déploiement « dans votre infrastructure » et suivi des agents

| # | Promesse (où on la lit) | Preuve | Statut |
|---|---|---|---|
| D1 | « Tracez et monitorez les actions de vos agents » : une entrée par décision, lisible et filtrable (`/produits`) | `tests/test_audit_api.py::test_list_audit_with_isolation_and_filter`, `tests/test_llm_proxy.py::test_proxy_forwards_and_audits_tool_calls` | Prouvé |
| D2 | « Déployée dans votre infrastructure » : image et pile auto-hébergées, sans fournisseur d'identité imposé | `tests/test_docker_context.py::test_dockerfile_runs_unprivileged_and_serves_the_control_api`, `tests/test_docker_context.py::test_the_api_cannot_start_before_the_database_is_migrated`, `tests/test_docker_context.py::test_compose_states_that_it_ships_no_identity_provider` | Prouvé (pile de référence ; chaque infrastructure client reste à qualifier) |
| D3 | Le chemin de décision n'appelle pas le réseau : une action irréversible reste retenue, toute sortie coupée | `tests/test_sovereignty_gate.py::test_the_real_decision_path_cannot_reach_the_network`, `tests/test_sovereignty_gate.py::test_an_irreversible_action_is_still_held_with_all_egress_cut` | Prouvé |

## Postes Secret Guard pilotés par la plateforme (offre Équipe)

| # | Promesse (où on la lit) | Preuve | Statut |
|---|---|---|---|
| P1 | « Politiques signées » : Ed25519, clé hors base, publication fermée sans clé, version croissante | `tests/test_developer_policies.py::test_published_policy_is_signed_assigned_and_scoped_to_the_workstation`, `tests/test_developer_policies.py::test_policy_rejects_malformed_rules_and_non_increasing_versions`, `tests/test_developer_policies.py::test_policy_signer_rejects_a_missing_key` | Prouvé |
| P2 | Une politique signée se vérifie sur le poste, même avec des accents | `tests/test_developer_policy_canonical.py::test_non_ascii_characters_are_signed_as_raw_utf8`, `tests/test_developer_policy_canonical.py::test_the_workstation_runner_accepts_a_french_policy` | Prouvé (corrigé ce soir : un `reason` accentué faisait refuser la signature) |
| P3 | « Règles sur mesure calibrées et signées par xSOM » : seul un opérateur xSOM compose et signe, jamais l'administrateur du client | `tests/test_rules_packs_api.py::test_authorization_matrix`, `tests/test_rules_packs_api.py::test_operator_signs_and_the_workstation_fetches_a_verifiable_envelope` | Prouvé |
| P4 | Le paquet respecte le contrat partagé avec le poste (grammaire, détection, empreintes, validité, signature) | `tests/test_rules_pack_contract.py::test_every_vector_family_is_exercised`, `tests/test_rules_pack_contract.py::test_signature_vector_envelope_is_reproduced_byte_for_byte`, `tests/test_rules_pack_contract.py::test_signature_vector_verifies_and_tampering_is_rejected` | Prouvé |
| P5 | Les termes confidentiels ne sont ni stockés ni journalisés ; le texte d'essai non plus | `tests/test_rules_packs_api.py::test_clear_terms_and_the_test_text_are_never_stored_or_logged`, `tests/test_rules_packs.py::test_clear_terms_never_reach_the_signed_bytes` | Prouvé |
| P6 | Sans clé d'autorité, rien n'est signé (fermé) ; un motif trop coûteux est refusé, pas signé | `tests/test_rules_packs_api.py::test_publishing_fails_closed_without_a_signing_key`, `tests/test_rules_packs.py::test_a_catastrophic_pattern_is_refused_within_the_budget` | Prouvé |
| P7 | Historique des réglages en ajout seul, chaîné, versions strictement croissantes | `tests/test_rules_packs_api.py::test_history_is_append_only_monotonic_and_chained`, `tests/test_rules_packs_api.py::test_revocation_is_its_own_record_and_stops_distribution` | Prouvé |
| P8 | Console client : « N / M postes à jour », en retard, refusé | `tests/test_rules_packs_api.py::test_workstations_report_the_applied_pack_and_the_console_counts_them`, `frontend/e2e/rules-pack.spec.ts` (lecture seule, aucun champ) | Prouvé — « à jour » reste une **déclaration du poste**, et l'écran le dit |
| P9 | « Le poste vérifie la signature hors ligne avant d'appliquer » (page Secret Guard) | côté plateforme : `tests/test_rules_pack_contract.py::test_a_key_carried_by_the_envelope_is_never_trusted` ; côté poste : implémentation Secret Guard en cours, hors de ce dépôt ce soir | Non prouvé ici — texte marqué « en pilote, avec une extension compatible » |
| P10 | « État du parc et preuves de décision minimales » | `tests/test_extension_devices.py::test_content_free_posture_is_visible_in_inventory` | Prouvé (posture déclarée, sans attestation matérielle) |

## Promesses commerciales ou non testables ce soir

| # | Promesse | Statut |
|---|---|---|
| C1 | « Console de découverte gratuite. Passerelle et intégration sur devis » (`/produits`) | Commercial : relève du contrat, pas d'un test. |
| C2 | Offre Équipe : « 24 € HT / poste actif / mois · tarif cible », « 90 jours offerts » | Commercial : tarif cible, confirmé par devis — le texte le dit. |
| C3 | Offres « Produits open source · Code ouvert et consultable » (`GUARD_OFFER_FAMILIES_COPY`) | **Faux en l’état** : l’extension vers laquelle pointe l’offre est sous licence propriétaire (`secret-guard/packages/vscode/LICENSE.txt`). Texte corrigé ce soir en « Produits gratuits · Détection locale, sans envoi au cloud ». Revenir à « open source » exige d’abord une licence ouverte et un dépôt public. |
| C4 | Renforcé : « Référence Linux validée localement » | Borné par le texte ; preuves dans `tests/test_managed_environment.py::test_linux_policy_and_sandbox_fail_closed`. macOS, Windows et MDM restent à qualifier, comme écrit. |

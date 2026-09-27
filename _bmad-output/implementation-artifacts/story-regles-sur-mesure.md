# Story — Règles sur mesure xSOM, côté plateforme AI Guard

Statut : **livré localement** sur `feat/ai-guard-regles-xsom` (non poussé).
Contrat : `secret-guard/contracts/RULES-PACK.md` v1 (figé). Promesses : `docs/ai-guard/CLAIMS.md`.

## Récit

En tant qu'**opérateur xSOM**, je compose pour un client un paquet de détecteurs (motifs et
termes confidentiels), je l'éprouve sur ses tests et sur un texte d'essai, puis je le signe
avec la clé d'autorité xSOM, afin que les postes Secret Guard Équipe du client l'appliquent
hors ligne. En tant qu'**administrateur client**, je lis mon réglage et la couverture de mes
postes, et je demande un ajustement à xSOM ; je ne peux ni écrire ni signer.

## Critères d'acceptation → preuves

| CA | Critère | Preuve |
|---|---|---|
| P0-1 | ruff, format, mypy, pytest, lint, tsc, Playwright verts | commandes du rapport final |
| P0-2 | Une politique Developer Guard accentuée se vérifie sur le poste | `tests/test_developer_policy_canonical.py` |
| P1-1 | Tous les vecteurs du contrat passent en Python | `tests/test_rules_pack_contract.py` |
| P1-2 | Publication fermée sans `XSOM_RULES_SIGNING_KEY` (503), lecture servie | `tests/test_rules_packs_api.py::test_publishing_fails_closed_without_a_signing_key` |
| P1-3 | Seul un opérateur xSOM (`XSOM_OPERATOR_SUBJECTS`) compose et signe | `tests/test_rules_packs_api.py::test_authorization_matrix` |
| P1-4 | Ajout seul, versions croissantes, retrait comme enregistrement, chaîne vérifiée | `tests/test_rules_packs_api.py::test_history_is_append_only_monotonic_and_chained` |
| P1-5 | RLS : un tenant ne lit que ses paquets, aucun droit d'écriture | `tests/test_rules_packs_api.py::test_rls_keeps_each_tenant_to_its_own_packs` |
| P1-6 | Termes en clair et texte d'essai absents de la base et des journaux | `tests/test_rules_packs_api.py::test_clear_terms_and_the_test_text_are_never_stored_or_logged` |
| P1-7 | `GET /v1/extension/rules-pack` conforme à §7 ; posture et couverture | `tests/test_rules_packs_api.py` (enveloppe, `null`, 401/404, couverture) |
| P1-8 | Un motif conforme mais explosif ne bloque pas le serveur | `tests/test_rules_packs.py::test_a_catastrophic_pattern_is_refused_within_the_budget` |
| P2-1 | Vue client en lecture seule, FR/EN, quatre états | `frontend/e2e/rules-pack.spec.ts` (describe « client ») |
| P2-2 | Atelier opérateur : essai en direct, refus expliqués, signature confirmée | `frontend/e2e/rules-pack.spec.ts` (describe « opérateur ») |
| P3-1 | Chaque promesse AI Guard a sa preuve, vérifiée en CI | `tests/test_platform_claims.py` |

## Décisions prises pendant l'implémentation

- Moteur exécuté dans un processus isolé et tuable (8 s) : `re` ne s'interrompt pas et la
  grammaire admet des motifs à retour arrière explosif ; refus `budget_exceeded`.
- Un seul `packId` par tenant (409 `pack_id_mismatch`) : §7 ne distribue qu'une enveloppe.
- Chaîne propre (`rules_pack_events`) plutôt que `audit_log`, dont `ingress` est le
  vocabulaire fermé des portes d'appel d'outil (même découpage que `control_plane_events`).
- Opérateurs désignés par `sub` (UUID) et non par e-mail : une adresse se choisit à
  l'inscription, un `sub` non.

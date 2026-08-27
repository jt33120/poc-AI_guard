# Modèle de données

Périmètre : ce que la **console du démonstrateur** ajoute. Les entités déjà livrées (`tenants`, `memberships`, `audit_log`, `approvals`, `gateway_tokens`, `tool_fingerprints`, `downstream_servers`, `usage_events`…) sont hors périmètre : elles existent, elles ne sont pas re-spécifiées ici.

Règle appliquée : **aucune entité sans un écran ou un job qui la consomme.** Trois entités passent ce test ; une quatrième est de la donnée de référence et n'est pas une table.

---

## `threat_catalogue` — donnée de référence, **pas une table**

Rôle : les 16 lignes de couverture (menace, domaine, mode revendiqué, profils concernés, correspondances référentielles).
Propriétaire : le dépôt.

**Committée comme fichier versionné, jamais en base.** Deux raisons : elle est identique pour tous les tenants, et `AD-30` exige que la carte soit générée depuis les scénarios qui passent — une table modifiable en production rouvrirait exactement la porte que `AD-30` ferme.

Consommée par : `diagnostic`, `couverture`, et le générateur de la carte.
Règle invariante : une ligne en mode `Bloqué` **n'existe que si** son scénario passe sur le commit courant. Le fichier est régénéré, jamais édité à la main.

---

## `usage_profile`

Rôle : la position d'un tenant dans la chaîne de valeur IA, d'où se déduit son sous-ensemble de menaces applicables.
Propriétaire : le tenant.

| Champ | Type | Nullable | Défaut | Contrainte |
|---|---|---|---|---|
| `id` | uuid | non | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | non | | FK `tenants(id)`, unique — un profil courant par tenant |
| `tiers` | text[] | non | `'{}'` | sous-ensemble de `{P1a,P1b,P2,P3,P4,P5}`, jamais vide une fois complété |
| `answers` | jsonb | non | `'{}'` | réponses brutes du questionnaire, pour rejouer le calcul |
| `completed_at` | timestamptz | oui | | `null` = diagnostic entamé, pas terminé |
| `created_at` | timestamptz | non | `now()` | |
| `updated_at` | timestamptz | non | `now()` | |

Relations : `tenants` 1—1 `usage_profile` (`ON DELETE CASCADE`).
Index : `tenant_id` unique — seul accès réel.
RLS : activée dans la migration qui crée la table (`AD-25` hérité de l'invariant §4.3, et `FR-162`).

**Règles invariantes**
- Les paliers sont **cumulatifs** : `P3` implique `P2` implique `P1a`. Le calcul ne stocke que ce qui a été déclaré ; l'implication est dérivée à la lecture, jamais dénormalisée.
- `answers` ne contient **jamais** de nom de client, d'URL interne ou de secret — le diagnostic pose des questions de posture, pas d'inventaire.
- Un profil incomplet est un état valide et affichable, pas une erreur.

**Cycle de vie** : `entamé` (`completed_at is null`) → `complété`. Un re-diagnostic écrase le profil courant et laisse une trace d'événement de plan de contrôle — c'est une décision qui change la couverture revendiquée.

---

## `monitor_window`

Rôle : la fenêtre pendant laquelle un agent tourne en mode observation — le pipeline s'exécute entièrement, le verdict est journalisé, l'appel passe.
Propriétaire : le tenant.

| Champ | Type | Nullable | Défaut | Contrainte |
|---|---|---|---|---|
| `id` | uuid | non | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | non | | FK `tenants(id)` |
| `gateway_token_id` | uuid | non | | FK `gateway_tokens(id)` — l'observation est **par agent**, jamais globale |
| `starts_at` | timestamptz | non | `now()` | |
| `expires_at` | timestamptz | non | | `> starts_at`, et borné par un plafond de configuration |
| `enabled_by` | uuid | non | | membre ayant activé — attribution obligatoire (`FR-38` hérité) |
| `ended_at` | timestamptz | oui | | arrêt anticipé |
| `ended_by` | uuid | oui | | |

Relations : `gateway_tokens` 1—N `monitor_window` (`ON DELETE CASCADE`).
Index : `(tenant_id, gateway_token_id, expires_at)` — la question chaude est « cet agent est-il en observation maintenant ? », posée à chaque décision.
RLS : activée dans sa migration de création.

**Règles invariantes**
- `expires_at` est **obligatoire et borné**. Il n'existe pas de fenêtre d'observation sans échéance : c'est ce qui empêche le mode de devenir un contournement permanent (`CM-6`).
- Une fenêtre ne couvre **jamais** les classes `irreversible` ni `external_send` (`AD-27`) — la donnée le permettrait, la décision l'interdit, et le refus vit dans le pipeline, pas dans la table.
- Activer, prolonger ou arrêter une fenêtre est un **événement de plan de contrôle** chaîné.
- Les fenêtres ne se chevauchent pas pour un même agent : activer alors qu'une fenêtre court prolonge l'existante plutôt que d'en créer une seconde.

**Cycle de vie** : `active` → `expirée` (par le temps) ou `arrêtée` (par un humain). L'expiration ne détruit pas la ligne : le rapport de promotion lit l'historique des fenêtres.

---

## Le rapport de promotion n'est pas une entité

`FR-180` se calcule à la lecture, depuis `audit_log` filtré sur les entrées portant `enforcement_mode = monitor`, croisé avec les fenêtres du tenant. Rien à stocker.

C'est délibéré : le rapport doit refléter la chaîne d'audit, pas une agrégation parallèle qui pourrait en diverger. Une table de synthèse serait une seconde source de vérité sur le seul sujet où le produit vend la source unique.

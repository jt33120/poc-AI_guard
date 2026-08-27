# Parcours et écrans

Périmètre : **console du démonstrateur** (passe 1). La page de présentation publique fait l'objet de la passe 2.

Projet **brownfield** : la console existe (`frontend/app/`). Les écrans déjà livrés sont *ratifiés*, pas re-spécifiés — seuls les écrans neufs et ceux que les neufs forcent à changer sont détaillés dans `04-ecrans/`.

Amont : `_bmad-output/planning-artifacts/prds/prd-poc-AI_guard-2026-08-26/prd.md` · `docs/product/ARCHITECTURE-V2.5.md` · `docs/product/THREAT-COVERAGE.md`.

---

## Parcours critiques

### P1 — Le triage
**Déclencheur** : ouverture de la démonstration, ou visite autonome depuis la page de présentation.
**Étapes** : `diagnostic` → `couverture`
**Fin réussie** : une carte de couverture bidimensionnelle propre au profil du visiteur, portant le compte « **N menaces vous concernent, M sont bloquées nativement** ».
**Sorties d'échec** :
- diagnostic abandonné en cours → la carte s'affiche sur le sous-ensemble déjà déterminé, les lignes indéterminées marquées comme telles. **Jamais de carte vide.**
- aucune donnée de scénario disponible → la carte refuse de s'afficher plutôt que d'afficher des revendications non prouvées (`AD-30`).

### P2 — L'action irréversible tenue
**Déclencheur** : le consultant lance le scénario devant le prospect ; ou l'agent de démonstration agit de lui-même sur l'instance hébergée.
**Étapes** : `inspector` → `approvals` → `audit`
**Fin réussie** : l'action n'a pas eu lieu, l'approbation est en attente, l'entrée d'audit est lisible et sa chaîne vérifiable à l'écran.
**Sorties d'échec** :
- service d'approbation indisponible → l'action est refusée, pas relâchée (`CLAUDE.md §4.4`), et l'écran le dit.
- chaîne d'audit rompue → `audit` affiche la rupture au lieu de masquer, c'est le comportement vendu.

### P3 — L'injection indirecte neutralisée
**Déclencheur** : l'agent consulte un document empoisonné de la base documentaire, puis tente une action à effet externe.
**Étapes** : `inspector` → `audit`
**Fin réussie** : la session est marquée teintée, l'action suivante est escaladée ou refusée, et l'audit nomme la source de la teinte.
**Sorties d'échec** : session non résoluble → traitée comme teintée, jamais comme propre (`AD-10` hérité).

### P4 — La supervision continue
**Déclencheur** : le RSSI veut voir ce que la plateforme a observé dans la durée — le monitoring ne se démontre pas en direct, il se lit.
**Étapes** : `home` → `audit` → `costs`
**Fin réussie** : le visiteur lit une activité accumulée sur plusieurs semaines, pas une base fraîche de dix minutes.
**Sorties d'échec** : instance locale sans historique → `home` annonce explicitement « instance de démonstration locale, historique fabriqué » plutôt que de laisser croire à du réel.

### P5 — Observation puis promotion
**Déclencheur** : le prospect veut passer sa flotte sous xSOM sans rien casser.
**Étapes** : `admin` → `promotion`
**Fin réussie** : le rapport énonce « en enforcement, **N appels auraient été tenus et M refusés**, sur ces outils », avec la liste des outils concernés.
**Sorties d'échec** :
- fenêtre d'observation expirée → l'enforcement reprend seul, et l'écran l'a annoncé avant l'échéance.
- aucune donnée d'observation → le rapport affiche l'absence, jamais un zéro qui se lirait comme « rien à tenir ».

---

## Inventaire des écrans

Vocabulaire de rôles : `admin` · `operator` · `viewer` (`core/schemas.py:11-16`, miroir de la contrainte sur `memberships.role`). Il n'existe pas de rôle « approbateur » : décider d'une approbation exige `admin` ou `operator` (`api/approvals.py:18`).

| id | Nom | Route | Rôles autorisés | Parcours | Priorité | État |
|---|---|---|---|---|---|---|
| `diagnostic` | Diagnostic de profil | `/diagnostic` | public, viewer, operator, admin | P1 | 1 | **neuf** |
| `couverture` | Carte de couverture | `/couverture` | public, viewer, operator, admin | P1 | 1 | **neuf** |
| `promotion` | Rapport de promotion | `/promotion` | operator, admin | P5 | 2 | **neuf** |
| `inspector` | Inspecteur / playground | `/inspector` | viewer, operator, admin | P2, P3 | 2 | existant — ratifié |
| `approvals` | File d'approbation | `/approvals` | lecture : viewer, operator, admin · **décision : operator, admin** | P2 | 2 | existant — ratifié |
| `audit` | Explorateur d'audit | `/audit` | viewer, operator, admin | P2, P3, P4 | 2 | existant — **à amender** |
| `home` | Accueil | `/home` | viewer, operator, admin | P4 | 3 | existant — **à amender** |
| `admin` | Administration | `/admin` | admin | P5 | 3 | existant — **à amender** |
| `costs` | Coûts et usage | `/costs` | viewer, operator, admin | P4 | 3 | existant — ratifié |
| `executive` | Synthèse dirigeants | `/executive` | viewer, operator, admin | — | 4 | existant — ratifié |
| `onboarding` | Connexion d'un agent | `/onboarding` | admin | — | 4 | existant — ratifié |
| `login` · `signup` | Authentification | `/login` · `/signup` | public | — | 4 | existant — ratifié |

**Les trois amendements, et rien de plus :**
- `audit` — colonne *chemin d'ingestion* et marqueur *mode observation*, sans quoi `AD-28` est invisible et une entrée d'observation se lit comme un blocage réel.
- `home` — bandeau nommant le déploiement (hébergé / local) et la nature de l'historique.
- `admin` — activation de la fenêtre d'observation par agent, bornée dans le temps.

---

## Navigation

- Barre permanente : `home` · `couverture` · `inspector` · `approvals` · `audit` · `costs` · `admin`. `promotion` n'y figure pas : on y entre depuis `admin` ou depuis une alerte de fin de fenêtre.
- `diagnostic` et `couverture` sont **accessibles sans compte** — ce sont les deux surfaces que la page de présentation profonde-lie, et le triage est la porte d'entrée commerciale.
- Non connecté sur une route protégée → `/login`. Connecté sur `/login` → `/home`.
- `couverture` atteint sans profil → redirige vers `diagnostic`, sauf paramètre de profil explicite dans l'URL (le consultant arrive avec le profil déjà choisi).
- Rôle insuffisant → écran d'accès refusé nommant le rôle requis, jamais une redirection muette (`FR-93` : l'erreur nomme le réglage qui débloquerait).

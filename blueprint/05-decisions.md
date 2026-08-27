# Décisions techniques

Périmètre : **console du démonstrateur**. Ce fichier ne décide rien qui soit déjà décidé plus haut.

---

## Autorité, et une clause qu'il faut lire jusqu'au bout

Les décisions de sécurité de ce projet sont arrêtées ici. Pendant l'implémentation : **appliquer, ne pas re-délibérer.** Toute préoccupation nouvelle se note dans [§ À revoir](#à-revoir) et ne bloque pas la story en cours.

**Cette clause vaut pour la console, et pour elle seule.** Elle existe pour empêcher un agent de partir en durcissement pendant que le frontend est bâclé — un vrai risque, et le motif pour lequel elle est écrite.

Elle **ne gouverne pas le cœur d'enforcement** (`FR-153`→`FR-159`, `FR-198`, `FR-199`, et l'intégrité de la preuve). Là, re-délibérer *est* le travail : c'est en réexaminant des contrôles réputés tranchés qu'on a trouvé la contrainte décorative de la policy de démonstration, le `.env.example` qui documente un fail-closed inexistant, et le juge absent qui auto-autorise. Une clause « appliquer sans discuter » les aurait tous les trois enterrés.

**Autorité amont, non re-statuée ici :**

| Source | Ce qu'elle fixe |
|---|---|
| `CLAUDE.md §4` | Les invariants non négociables. Priment sur tout ce document. |
| `docs/product/ARCHITECTURE-V2.5.md` | `AD-21`→`AD-36`, et les `AD-1`→`AD-20` hérités |
| `docs/product/PRD.md` §5 | Les non-objectifs v2, toujours en vigueur |

Ce fichier ne fait qu'**appliquer** cette autorité à la surface console.

---

## Stack

Aucune dépendance nouvelle. La console est déjà scaffoldée et la strate n'en ajoute pas.

| Élément | Version / choix | Statut |
|---|---|---|
| Next.js (App Router) | 14 | existant |
| Tailwind | existant | existant |
| `@supabase/supabase-js` | existant | existant |
| Playwright | existant, déjà en CI | existant |

---

## Modèle d'authentification

Existant, ratifié — non redécidé :

- Session par **cookie `httpOnly` + `Secure` + `SameSite`**. Jamais de jeton en `localStorage` (`CLAUDE.md §4.5`).
- Vérification JWT par JWKS ; le rôle est porté par le jeton et relu côté serveur, jamais déduit du client.
- Le rôle est **scopé au tenant** (`memberships`), pas global.
- Les appels navigateur passent par les *route handlers* Next (`app/api/control/[...path]`), qui portent le secret côté serveur. Le navigateur ne voit jamais de clé de service (`CLAUDE.md §4.6`).

**Ce que la strate ajoute :** deux routes publiques sans session — `/diagnostic` et `/couverture`. Voir la matrice.

---

## Matrice de permissions

Rôles : `admin` · `operator` · `viewer` (`core/schemas.py:11-16`). `public` = non authentifié.

| Ressource | Action | public | viewer | operator | admin |
|---|---|:--:|:--:|:--:|:--:|
| Catalogue de menaces | lire | ✅ | ✅ | ✅ | ✅ |
| Diagnostic de profil | soumettre (anonyme, non persisté) | ✅ | ✅ | ✅ | ✅ |
| Profil du tenant | lire | ❌ | ✅ | ✅ | ✅ |
| Profil du tenant | écrire / re-diagnostiquer | ❌ | ❌ | ❌ | ✅ |
| Carte de couverture | lire (générée, profil par défaut) | ✅ | ✅ | ✅ | ✅ |
| Carte de couverture | lire (profil du tenant) | ❌ | ✅ | ✅ | ✅ |
| Audit | lire | ❌ | ✅ | ✅ | ✅ |
| Approbation | lire la file | ❌ | ✅ | ✅ | ✅ |
| Approbation | **décider** | ❌ | ❌ | ✅ | ✅ |
| Fenêtre d'observation | lire | ❌ | ❌ | ✅ | ✅ |
| Fenêtre d'observation | **activer / prolonger / arrêter** | ❌ | ❌ | ❌ | ✅ |
| Rapport de promotion | lire | ❌ | ❌ | ✅ | ✅ |

**Trois règles qui portent la matrice :**

1. **Le public voit le triage, jamais la donnée.** `/diagnostic` et `/couverture` sont ouverts parce que le triage est la porte d'entrée commerciale — mais un visiteur anonyme obtient une carte calculée sur le profil qu'il déclare, **rien du tenant**. Le diagnostic anonyme n'écrit pas en base.
2. **Décider n'est pas lire.** Un `viewer` voit la file d'approbation et ne peut rien décider. C'est déjà le comportement livré (`api/approvals.py:18`), et la strate ne l'assouplit pas.
3. **Activer l'observation est `admin` seul.** Le mode observation laisse passer des appels : c'est la seule action de la console qui réduit l'enforcement, donc la plus restreinte. La lire est `operator`.

---

## Données sensibles

| Donnée | Traitement |
|---|---|
| Arguments d'outils | Jamais stockés, jamais affichés. Empreinte seule (`CLAUDE.md §4.10`). |
| Réponses au diagnostic | Questions de **posture**, jamais d'inventaire : aucun nom de client, aucune URL interne, aucun secret. Contraint par le questionnaire lui-même, pas par une purge après coup. |
| Tenant de démonstration | Graine synthétique committée. Aucune donnée personnelle de tiers, aucune donnée client (`AD-31`). Contrôle CI sur les formes de PII. |
| Historique de l'instance hébergée | Trafic d'agents de démonstration uniquement. Aucun trafic client réel n'y transite, jamais. |

---

## Décisions non fonctionnelles

- **L'instance hébergée de démonstration est hébergée dans l'UE.** Non négociable : héberger hors UE une démonstration de protection souveraine la détruit sur place, et c'est la première chose qu'un RSSI vérifie. OVH, Scaleway ou on-premise.
- **L'instance locale fonctionne hors ligne**, wifi débranché. C'est la démonstration de `AD-25`, pas une commodité.
- **La carte de couverture refuse de s'afficher** plutôt que d'afficher des revendications non prouvées si les résultats de scénarios manquent (`AD-30`).
- **Aucune revendication `Bloqué` sans son chemin d'ingestion** à l'écran (`AD-28`).
- Parité de langue EN/FR sur les surfaces neuves, comme sur la console existante (`FR-112`).

---

## À revoir

Consigner ici toute préoccupation née pendant l'implémentation de la console. **Ne bloque pas la story en cours.**

- *(vide à ce stade)*

**Ce qui ne va pas ici :** une préoccupation touchant le cœur d'enforcement. Elle remonte à `docs/product/ARCHITECTURE-V2.5.md` ou à la PRD, pas à cette liste — c'est le sens de la limite posée en tête de fichier.

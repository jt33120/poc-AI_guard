# Design system

**Brownfield : ce système existe.** Ce fichier le *ratifie* et n'ajoute que ce que les trois écrans neufs exigent. Rien n'est réinventé, rien n'est renommé.

Sources : `frontend/tailwind.config.ts` (palette, typographie, ombres) · `frontend/app/globals.css` (classes sémantiques).

---

## Tokens

Les tokens vivent dans la configuration Tailwind et se consomment par les classes sémantiques ci-dessous. **On n'écrit jamais une couleur littérale dans un composant** — ni `#2563eb`, ni `bg-blue-600`.

| Rôle sémantique | Token | Valeur |
|---|---|---|
| `surface.canvas` | `navy` | `#0a1628` |
| `surface.raised` | `navy-mid` | `#0f2038` |
| `surface.overlay` | `navy-light` | `#162d4a` |
| `action.primary` | `brand` | `#2563eb` |
| `action.primary.hover` | `brand-bright` | `#3b82f6` |
| `text.muted` | `accent` | `#bfc5ce` |
| Typographie | `font-sans` | Plus Jakarta Sans |
| Rayon des pastilles | `rounded-pill` | `999px` |
| Élévation de carte | `shadow-card` | *(cf. config)* |
| Halo d'action | `shadow-glow` | *(cf. config)* |

**Un seul token manque pour la strate**, et il est sémantique parce que la carte de couverture repose entièrement dessus :

| Rôle | À ajouter | Pourquoi |
|---|---|---|
| `coverage.blocked` · `.detected` · `.orchestrated` · `.attested` · `.out-of-scope` | cinq classes de pastille dérivées des `badge-*` existantes | Les cinq modes doivent être **distinguables sans lire le texte**, y compris en projection dans une salle. Réutiliser `badge-green` / `badge-blue` / `badge-amber` / `badge-neutral` sans les nommer par leur rôle ferait dériver le sens d'un écran à l'autre. |

---

## Grille et points de rupture

Ratifiés depuis la console existante : Tailwind par défaut (`sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280).

Contrainte propre au démonstrateur : **la carte de couverture doit rester lisible en projection**, donc en `lg` et au-delà elle privilégie la densité verticale à la largeur — une salle de réunion regarde un écran 16:9 de loin, pas un portable de près.

---

## Inventaire de composants

Fermé. **Un composant n'entre pas dans l'inventaire sans au moins deux usages réels.**

### Classes sémantiques — existantes, ratifiées

| Classe | Usage |
|---|---|
| `card` | Conteneur de section |
| `btn` · `btn-primary` · `btn-ghost` · `btn-success` · `btn-danger` | Actions |
| `input` · `label` | Saisie |
| `badge` · `badge-neutral` · `badge-green` · `badge-red` · `badge-amber` · `badge-blue` | États |
| `data-table` | Tableaux |
| `muted` | Texte secondaire |

### Composants React — existants, ratifiés

`AppShell` · `Loader` · `Spinner` · `Tooltip` · `ProviderIcon` · `brand`

Les composants métier (`ApiKeys`, `ClientsManager`, `DlpSettings`, `ExecutiveSummary`, `ProviderCredentials`, `ReadTokens`, `ClientScope`) restent propres à leurs écrans : ils ne sont pas des primitives et n'ont pas à le devenir.

### Ce que la strate ajoute — deux composants, pas un de plus

| Composant | Usages réels | Rôle |
|---|---|---|
| `CoverageBadge` | `couverture`, `audit`, `diagnostic` | Rend un des cinq modes de couverture avec son token de rôle et **son chemin d'ingestion** (`AD-28`). Le chemin n'est pas décoratif : sans lui, une revendication `Bloqué` vraie sur MCP se lit comme vraie partout. |
| `ProfileTierChip` | `diagnostic`, `couverture` | Rend un palier `P1a`→`P5`, en distinguant **déclaré** et **dérivé par cumul** — la nuance qui rend le triage compréhensible plutôt que magique. |

**Ce qui a été refusé faute de deux usages :** un composant de questionnaire (un seul écran — c'est du layout, pas une primitive), un composant de rapport de promotion (idem), et un composant de graphe pour la carte (elle est un tableau dense, pas une visualisation ; un graphe rendrait le compte moins lisible en projection).

---

## Règle de rendu propre au démonstrateur

Une valeur affichée dans la console **porte toujours sa provenance quand elle est revendicative** :

- une ligne de couverture affiche son mode **et** son chemin d'ingestion ;
- une entrée d'audit en mode observation est visuellement distincte d'un blocage réel ;
- une carte générée affiche le commit et l'horodatage dont elle est issue.

C'est `AD-28` et `AD-30` rendus visibles. Sans cette règle, l'interface peut afficher quelque chose de vrai d'une façon qui se lit comme faux — et sur un produit vendu sur la preuve, c'est le pire endroit où être approximatif.

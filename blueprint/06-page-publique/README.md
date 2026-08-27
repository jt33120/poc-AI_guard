# Passe 2 — la page publique

La passe 1 a spécifié la console (`blueprint/04-ecrans/`). La passe 2 spécifie la
**surface publique** : la page de présentation d'xSOM AI Guard sur le site du cabinet.

---

## Pourquoi ce dossier existe, et pas une septième entrée dans `04-ecrans/`

`gen_ac.py` refuse une spec d'écran sans endpoint déclaré, et il a raison : un écran
d'application qui affiche des données sans dire d'où elles viennent est exactement ce
que le blueprint existe pour empêcher.

**Cette page n'appelle aucun endpoint.** Le site est un statique sans étape de build
ni backend ; le tableau de couverture y arrive comme un fragment HTML **généré dans le
dépôt produit et committé**. Déclarer une cible de build sous le nom `endpoint` pour
faire passer le contrôle serait exactement le motif du contrôle décoratif — une clé
qui *paraît* satisfaire une garantie sans la satisfaire.

Donc la page sort de `04-ecrans/`, le contrôle y reste dur, et les six specs d'écran
continuent de passer. La spec publique porte la même rigueur dans une forme adaptée à
ce qu'elle est.

```
$ for f in blueprint/04-ecrans/*.yaml; do gen_ac.py "$f"; done   # 6/6 OK
```

---

## Où la page vit

**Dépôt** : `xsom-consulting/infra-xsom_website` — le site vitrine, servi tel quel sur
GitHub Pages. Une fusion sur `main` publie.

**Ce que la passe 2 ratifie, et ne réinvente pas** — le site a déjà un système de
design abouti et documenté :

| Convention du site | Conséquence pour la page |
|---|---|
| `assets/css/tokens.css` est la source unique — aucune valeur de couleur ailleurs | Les cinq modes de couverture se dérivent des jetons cuivre et encre existants. Aucun jeton nouveau sans justification écrite |
| Classes de `assets/css/components.css` (`section`, `card`, `grid-3`, `checklist`, `numbered`, `btn--primary`, `cta-band`, `dg-*`) | La page se construit avec ces classes. Elle n'en introduit aucune |
| Bilingue FR/EN à pages dupliquées | Deux fichiers : `ia-guard.html` et `en/ai-guard.html`. Toute modification est reportée dans les deux |
| Nav et pied de page synchronisés par `tools/sync-partials.js` | Inscrire la page dans `PAGES`, puis `node tools/sync-partials.js` |
| Polices auto-hébergées, aucun CDN | La page n'introduit aucune requête externe. C'est déjà une décision de cohérence du site avec le discours de souveraineté — la page qui *vend* la souveraineté ne peut pas être celle qui l'enfreint |
| Animations pilotées par attributs `data-*`, neutralisées sous `prefers-reduced-motion` | `data-split` sur le h1, `data-diagram` sur le schéma. Rien hors de ce cadre |
| Ajouter une page : copier, adapter `title`/`description`/`canonical`/`hreflang`, inscrire dans `PAGES`, ajouter à `sitemap.xml` | La procédure est celle du `README.md` du site, sans variante |

**Page de référence à copier** : `ia-souverainete.html`. C'est la page la plus proche
en registre — argumentaire technique long, schémas animés, section d'appel à l'action.

---

## La règle qui gouverne toute la page

> Une affirmation de cette page renvoie à une ligne de la carte de couverture, et une
> ligne de couverture à un scénario qui passe.

C'est `CM-7` rendu public. Sans elle, la page est du marketing ; avec elle, c'est une
pièce qu'un évaluateur peut opposer au produit. Elle a une conséquence pratique
inconfortable et voulue : **la page ne peut pas dire mieux que ce que la suite
asserte**, et une régression de couverture se voit sur le site.

C'est aussi pourquoi la section « garanties » ne contient **aucun compte chiffré en
dur** : les chiffres ne vivent que dans le fragment généré, qui porte son commit et sa
date. Un chiffre écrit à la main dans la prose se périmerait en silence — le même
raisonnement que `data-since` sur le site, qui recalcule l'ancienneté du cabinet
plutôt que de l'écrire.

---

## Ce que la passe 2 ne couvre pas

- **Le compte de démonstration.** La page y renvoie ; ce qu'il contient relève de
  `FR-181`→`183` (rang 5) et du tenant synthétique d'`AD-31`. La spec prévoit le cas
  où il n'existe pas encore : le bloc d'appel à l'action affiche alors le contact seul,
  jamais un bouton menant à une erreur.
- **Le générateur du fragment de couverture.** Il vit dans le dépôt produit
  (`AD-30`, `G-18`) et n'est pas un travail de site. La spec fixe seulement ce que le
  fragment doit porter pour être publiable : mode, chemin d'ingestion, moyen de preuve,
  commit, date — et l'échec de génération si une ligne `Bloqué` n'a pas de scénario.
- **Les pages existantes du site.** `ia-souverainete.html` n'est pas re-spécifiée. La
  nouvelle page y renvoie plutôt que de dupliquer l'argumentaire souverain.

---

## Fichiers

| Fichier | Contenu |
|---|---|
| `presentation.yaml` | La spec de la page : zones, états, interactions, validations, responsive, a11y, cas limites |

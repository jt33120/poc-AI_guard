# Films de guard.xsom.fr (Remotion)

Toutes les vidéos du site sont rendues ici, en React, par [Remotion](https://www.remotion.dev) :
images d'archives sous licence, étalonnage maison, titres cinétiques, graphismes animés et
musique de synthèse. Aucune étape FFmpeg à la main, aucun clip généré par IA.

| Composition | Fichier produit | Page |
|---|---|---|
| `home-fr`, `home-en` | `frontend/public/signal-media/xsom-ai-home-v4-{fr,en}.mp4` + `.jpg` | Accueil |
| `products-fr`, `products-en` | `frontend/public/signal-media/xsom-products-v2-{fr,en}.mp4` + `.jpg` | Produits |
| `extension` | `frontend/public/signal-media/ai-guard-extension-v2.webm` + `.jpg` | Secret Guard (et sa carte sur l'accueil) |
| `signal-guarded`, `signal-unguarded` | `frontend/design-system/assets/{guarded,unguarded}.{webm,mp4,webp}`, copiés dans `signal-media/` | `<SignalVideo>` (onboarding) |

## Rendre

```sh
cd films
npm ci
npm run footage   # télécharge les clips de footage.json, copie polices et logo dans public/
npm run render    # tout ; ou par nom : npm run render -- home extension
npm run studio    # prévisualisation interactive
```

`public/` n'est jamais versionné : les clips se retrouvent à l'identique depuis leur
identifiant Pexels (rendu 1080p). Les rendus, eux, sont versionnés dans `frontend/`.

## Sources

- `src/kit.tsx` : enchaînement des plans (fondu de 0,3 s, lente poussée), étalonnage
  commun (ton marine, bords assombris pour l'en-tête et les commandes, vignette, grain),
  et les révélations de texte reprises à l'identique des anciens films.
- `src/overlays.tsx` : les fuites rouges (acte 2 de l'accueil) et le maillage bleu qui les
  recouvre (actes 3 et 4).
- `src/HomeFilm.tsx`, `src/ProductsFilm.tsx` : plans, mots (FR/EN) et minutages. Les mots
  restent synchronisés avec les `label` de `HOME_HERO_MEDIA` et `PRODUCTS_HERO_MEDIA`.
- `src/ExtensionLoop.tsx` : boucle sans raccord visible (la dernière seconde se fond dans
  la seconde qui précède la première image).
- `src/SignalSequence.tsx` : le schéma Agent → Guard → Policy → Tool, avec et sans gate.
- `scripts/score.mjs` : la musique, synthétisée ; même instrument que les films de
  xsom.fr (`tools/film-score.mjs` du site), un accord par acte. Aucune piste sous licence.

## Licences

**Images.** Tous les clips viennent de Pexels, sous la
[licence Pexels](https://www.pexels.com/license/) : usage commercial gratuit, modification
autorisée, attribution non obligatoire. On crédite tout de même chaque auteur dans
`footage.json` et dans la fiche de chaque vidéo. Limites retenues : pas de revente ni de
redistribution d'un clip non modifié, pas de personne identifiable présentée sous un jour
défavorable ou comme soutenant xSOM. Les clips ne quittent jamais ce dossier non montés.

**Remotion.** Remotion n'est pas une licence libre classique : gratuit pour un particulier,
une organisation à but non lucratif ou une entreprise de **trois salariés au plus** ; au-delà,
une [licence entreprise](https://www.remotion.dev/license) est requise pour un usage
commercial. À vérifier pour xSOM avant de relancer des rendus.

**Dépendances.** `remotion`, `@remotion/*`, `react`, `react-dom` et `typescript` ne sont
utilisés que pour produire les fichiers vidéo ; rien de ce dossier n'est chargé par
l'application ni déployé.

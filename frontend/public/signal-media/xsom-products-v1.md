# Film de la page produits (v1, FR et EN)

- Source : clip Grok fourni par l’utilisateur, `grok-video-5c9841c7-c965-4ac4-a3e5-13ec7ee01025-2.mp4` (source conservée intacte dans Downloads).
- Deux montages, un par langue du site : `xsom-products-v1-fr.mp4` et `xsom-products-v1-en.mp4`, chacun avec son affiche `.jpg`. `PRODUCTS_HERO_MEDIA` choisit selon la langue du visiteur.
- Format : 15 secondes, 1920 × 1080, 24 images/s, H.264 avec démarrage progressif (`faststart`). Bande sonore du clip conservée ; lecture muette par défaut sur le site.
- Direction : la typographie cinétique du film d’accueil. Aucun nom de produit n’est incrusté : la gamme va s’agrandir, et le film ne doit pas avoir à être remonté pour autant. Les produits sont nommés par le carrousel, sous le film.
- Zones de sécurité : celles du film d’accueil. Aucun titre ne commence avant 290 px ni ne descend sous 250 px du bas (sur 1080).
- Chaque temps suit un acte du clip :

| Temps | Image | FR | EN |
|---|---|---|---|
| 0,25–3,9 s | portable, fibres bleues | Sur le poste / PROTÉGER / ce que vos équipes envoient aux IA. | On the workstation / PROTECT / what your teams send to AI. |
| 4,2–8,9 s | les fibres filent vers la salle serveurs | Dans votre infrastructure / CONTRÔLER / chaque action de vos agents. | In your infrastructure / CONTROL / every action your agents take. |
| 10,45–15 s | les baies prises dans le maillage | DU POSTE / AU SERVEUR. / Nos produits de cybersécurité IA | FROM LAPTOP / TO SERVER. / Our AI cybersecurity products |

- Affiche extraite à 13,4 secondes : la carte finale, lisible avant toute lecture.

Reproduction depuis la racine, avec FFmpeg et Chromium de Playwright installés (les deux langues en un passage) :

```sh
node scripts/render-products-film.mjs /chemin/vers/source.mp4
```

Les formulations (`COPY`), positions et minutages sont dans ce script. La source n’est pas ajoutée au dépôt.

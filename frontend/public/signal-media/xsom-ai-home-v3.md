# Film d’accueil xSOM AI (v3, FR et EN)

- Source : clip Grok fourni par l’utilisateur, `grok-video-fb42b927-cd11-4b13-be08-c87949634930-2.mp4` (source conservée intacte dans Downloads).
- Deux montages, un par langue du site : `xsom-ai-home-v3-fr.mp4` et `xsom-ai-home-v3-en.mp4`, chacun avec son affiche `.jpg`. `HOME_HERO_MEDIA` choisit selon la langue du visiteur.
- Format : 15 secondes, 1920 × 1080, 24 images/s, H.264 avec démarrage progressif (`faststart`). Bande sonore du clip conservée ; lecture muette par défaut sur le site.
- Direction : typographie cinétique inspirée d’efor-group.com — une idée courte par temps, capitales Saira 800 face à un complément Source Sans en italique, révélations masquées ligne par ligne. Aucun logo incrusté : l’en-tête du site le porte déjà.
- Zones de sécurité : l’en-tête recouvre le haut du film et ses commandes le bas, que les écrans peu hauts recadrent aussi. Aucun titre ne commence avant 290 px ni ne descend sous 250 px du bas (sur 1080).
- Chaque temps suit un acte du clip :

| Temps | Image | FR | EN |
|---|---|---|---|
| 0,2–2,9 s | bureau calme | Vos équipes / ADOPTENT L’IA. | Your teams / EMBRACE AI. |
| 3,2–6,7 s | lignes rouges entre les outils IA | Secrets, données, actions d’agents : / EXPOSÉS. | Secrets, data, agent actions: / EXPOSED. |
| 7–10,5 s | le maillage bleu recouvre le rouge | DÉTECTER les secrets / BLOQUER les actions à risque / TRACER chaque décision | DETECT secrets / BLOCK risky actions / TRACE every decision |
| 11,2–15 s | le bureau sous le maillage | LA COUCHE CYBERSÉCURITÉ / DE VOS USAGES IA. / Logiciels · Conseil | THE CYBERSECURITY LAYER / FOR EVERY AI USE CASE. / Software · Consulting |

- Affiche extraite à 13,4 secondes : la carte finale, lisible avant toute lecture.

Reproduction depuis la racine, avec FFmpeg et Chromium de Playwright installés (les deux langues en un passage) :

```sh
node scripts/render-home-film.mjs /chemin/vers/source.mp4
```

Les formulations (`COPY`), positions et minutages sont dans ce script. La source n’est pas ajoutée au dépôt.

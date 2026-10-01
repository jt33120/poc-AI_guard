# Film d’accueil xSOM AI (v4, FR et EN)

- Rendu avec Remotion : composition `home-fr` / `home-en` de `films/src/HomeFilm.tsx`
  (`npm --prefix films run render -- home`). Remplace la v3, montée avec FFmpeg sur un clip Grok.
- Deux fichiers, un par langue du site : `xsom-ai-home-v4-fr.mp4` et `xsom-ai-home-v4-en.mp4`,
  chacun avec son affiche `.jpg` (13,4 s, la carte finale, lisible avant toute lecture).
  `HOME_HERO_MEDIA` choisit selon la langue du visiteur.
- Format : 15 secondes, 1920 × 1080, 24 images/s, H.264 BT.709 avec démarrage progressif,
  AAC stéréo. Lecture muette par défaut sur le site.
- Images : quatre clips Pexels, sous la [licence Pexels](https://www.pexels.com/license/)
  (usage commercial libre, attribution non obligatoire, crédités ici quand même) :

| Temps | Clip | Auteur |
|---|---|---|
| 0–3 s | [Men Brainstorming at Work](https://www.pexels.com/video/men-brainstorming-at-work-6803584/) | cottonbro studio |
| 3–6,8 s | [Modern Desktop Coding Setup with Neon Glow](https://www.pexels.com/video/modern-desktop-coding-setup-with-neon-glow-34279721/) | Jakub Zerdzicki |
| 6,8–10,9 s | [Blue Colored Cables](https://www.pexels.com/video/blue-colored-cables-1085656/) | Dima Krivoy |
| 10,9–15 s | [Нічний Брюссель (Bruxelles de nuit)](https://www.pexels.com/video/20670675/) | Borys Trusevych |

- Étalonnage commun à tous les films du site (ton marine, bords assombris sous l’en-tête
  et les commandes, vignette, grain fin), lente poussée sur chaque plan, fondus de 0,3 s.
- Graphismes animés, dessinés par la composition et non tirés des clips : des lignes rouges
  fuient de l’écran de code vers les bords du cadre (temps 2), puis un maillage bleu balaie
  le réseau (temps 3) et se referme sur le quartier d’affaires (temps 4).
- Musique : synthétisée dans le dépôt (`films/scripts/score.mjs`), un accord par temps
  (ré mineur → Fa majeur 9), environ −21 LUFS. Aucune piste sous licence.
- Titres : mêmes mots, mêmes positions et mêmes minutages que la v3 ; les zones de
  sécurité restent (aucun titre au-dessus de 290 px ni sous 250 px du bas, sur 1080).

| Temps | Image | FR | EN |
|---|---|---|---|
| 0,2–2,9 s | open space | Vos équipes / ADOPTENT L’IA. | Your teams / EMBRACE AI. |
| 3,2–6,7 s | le code, des fuites rouges | Secrets, données, actions d’agents : / EXPOSÉS. | Secrets, data, agent actions: / EXPOSED. |
| 7–10,5 s | le réseau, le maillage bleu | DÉTECTER les secrets / BLOQUER les actions à risque / TRACER chaque décision | DETECT secrets / BLOCK risky actions / TRACE every decision |
| 11,2–15 s | le quartier d’affaires sous le maillage | LA COUCHE CYBERSÉCURITÉ / DE VOS USAGES IA. / Logiciels · Conseil | THE CYBERSECURITY LAYER / FOR EVERY AI USE CASE. / Software · Consulting |

- Les personnes visibles sont des figurants de banques d’images : ni clients, ni équipes xSOM.

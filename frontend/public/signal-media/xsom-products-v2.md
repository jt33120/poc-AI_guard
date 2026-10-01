# Film de la page produits (v2, FR et EN)

- Rendu avec Remotion : composition `products-fr` / `products-en` de
  `films/src/ProductsFilm.tsx` (`npm --prefix films run render -- products`). Remplace la v1,
  montée avec FFmpeg sur un clip Grok.
- Deux fichiers, un par langue : `xsom-products-v2-fr.mp4` et `xsom-products-v2-en.mp4`, chacun
  avec son affiche `.jpg` (13,4 s, la carte finale). `PRODUCTS_HERO_MEDIA` choisit selon la langue.
- Format : 15 secondes, 1920 × 1080, 24 images/s, H.264 BT.709 avec démarrage progressif,
  AAC stéréo. Lecture muette par défaut.
- Images : trois clips Pexels, sous la [licence Pexels](https://www.pexels.com/license/)
  (usage commercial libre, attribution non obligatoire, crédités ici quand même) :

| Temps | Clip | Auteur |
|---|---|---|
| 0–4 s | [Close-Up of Hands Typing on Laptop Keyboard](https://www.pexels.com/video/close-up-of-hands-typing-on-laptop-keyboard-30357894/) | Jakub Zerdzicki |
| 4–9,4 s | [Close Up of a CPU](https://www.pexels.com/video/close-up-of-a-cpu-7140928/) (baies de serveurs) | MrColo |
| 9,4–15 s | [Video of a Digital Art](https://www.pexels.com/video/video-of-a-digital-art-8817471/) (fibres optiques) | TP Motion |

- Aucun nom de produit n’est incrusté : la gamme va s’agrandir, le carrousel sous le film
  les nomme. Même étalonnage, mêmes fondus et même lente poussée que le film d’accueil.
- Musique synthétisée (`films/scripts/score.mjs`), un accord par temps (la mineur 9 →
  Fa majeur 7 → Do majeur 9), environ −21 LUFS.
- Titres : mêmes mots, positions et minutages que la v1 ; mêmes zones de sécurité.

| Temps | Image | FR | EN |
|---|---|---|---|
| 0,25–3,9 s | le portable | Sur le poste / PROTÉGER / ce que vos équipes envoient aux IA. | On the workstation / PROTECT / what your teams send to AI. |
| 4,2–8,9 s | les serveurs | Dans votre infrastructure / CONTRÔLER / chaque action de vos agents. | In your infrastructure / CONTROL / every action your agents take. |
| 10,45–15 s | les fibres | DU POSTE / AU SERVEUR. / Nos produits de cybersécurité IA | FROM LAPTOP / TO SERVER. / Our AI cybersecurity products |

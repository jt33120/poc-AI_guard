# Secret Guard — fond de la page extension v2

- Rendu avec Remotion : composition `extension` de `films/src/ExtensionLoop.tsx`
  (`npm --prefix films run render -- extension`). Remplace la v1, un clip Grok réencodé dans
  Chromium, dont la boucle n’était pas raccordée.
- Image : [A Programmer Working on a Laptop Computer](https://www.pexels.com/video/a-programmer-working-on-a-laptop-computer-13522186/),
  Raddy, sous la [licence Pexels](https://www.pexels.com/license/) (usage commercial libre,
  attribution non obligatoire, créditée ici quand même). Un portable de développeur, de
  nuit ; le tiers gauche reste sombre pour le titre de la page.
- Boucle raccordée : sur sa dernière seconde, le clip se fond dans la seconde qui précède
  sa première image, si bien que la fin retombe exactement sur le début.
- `ai-guard-extension-v2.webm` : 10 secondes, 1920 × 1080, 30 images/s, VP9 BT.709, sans son.
- `ai-guard-extension-v2.jpg` : affiche, première image de la boucle ; elle sert aussi de
  vignette à la carte Secret Guard de l’accueil (`HomePaths.tsx`). Lorsque les animations
  sont réduites, la page n’affiche que l’affiche et ne télécharge pas la vidéo.

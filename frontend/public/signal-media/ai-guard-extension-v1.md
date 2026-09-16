# AI Guard — fond de la page extension v1

- Vidéo générée avec Grok à partir d'un prompt écrit pour cette page, fourni par Julian le 16 septembre 2026 ; aucune image ou vidéo tierce réutilisée. Le prompt verbatim est reproduit plus bas.
- Un poste de développement de nuit, hors foyer : des lignes de code défilent à droite, un trait bleu pâle balaie l'une d'elles et l'immobilise, une lueur ambrée pulse puis s'éteint. Le tiers gauche reste sombre et vide pour accueillir le titre, comme l'exige le dégradé de la bannière.
- Palette : fond `#0c1c33`, bleu glacier `#9dccff`, accent chaud `#f9b8a5`. Aucun texte lisible, aucun logo, aucun filigrane, aucune piste audio.
- Conversion locale : source `grok-video-5d41b45e-fb9b-4066-927a-cfa0c3e22707.mp4`, 1 904 × 1 072 pixels, 10,042 s, redessinée image par image sur un canevas 1 280 × 720 et réencodée par MediaRecorder dans Chromium headless, codec VP9, débit visé 620 kbit/s, cadence 30 images/s. La source n'est pas versionnée.
- `ai-guard-extension-v1.webm` : boucle d'environ 10 secondes (durée décodée : 10,105 s), 667 038 octets.
- `ai-guard-extension-v1.png` : affiche prise à l'instant initial du même canevas, 1 280 × 720 pixels, 430 521 octets.
- Vérification : lecture, dimensions et durée confirmées dans Chromium sur le fichier produit ; affiche inspectée visuellement. Prévoir l'affiche lorsque les animations sont réduites.
- Limite connue : la boucle n'est pas raccordée. Le générateur ne garantit pas une première et une dernière image identiques, et aucun fondu n'a été ajouté ; un saut est visible au bouclage.

## Prompt de génération

```text
Slow cinematic macro shot inside a dark developer workspace at night, lit only by
a screen. Deep navy blue (#0C1C33) fills the frame. The left 40% of the image stays
almost empty and unlit — soft gradient darkness, nothing happening there. On the
right, an out-of-focus monitor shows faint lines of code drifting slowly upward;
one line brightens, and a thin pale-blue light (#9DCCFF) sweeps across it and seals
it in place, holding that single line still while the others keep moving. A warm
amber glow (#F9B8A5) pulses once behind the glass, then fades. Very shallow depth
of field, heavy bokeh, volumetric haze. Almost no camera movement: a 3% slow
push-in. Calm, precise, corporate-cybersecurity mood, uncluttered. Seamless loop:
first and last frames identical.
```

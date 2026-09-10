# Asset provenance

## Original identity

`mark.svg` and `mark-source.svg` are exact copies of the original
`assets/logo/moderne-dark.svg` from corporate commit `a9dfd3c`.
SHA-256: `92425e9553245374f5fe5095d9a7340876511a0c999d2df16ba4e8b6d90cb00a`.
`mark-light.svg` is the original `assets/logo/gradient.svg`, unchanged.
The logo is never generated or recoloured. PNG sizes are rendered from these SVGs.

## Self-hosted fonts

- Manrope variable Latin, weight 200–800: `@fontsource-variable/manrope@5.3.0`.
- Source Sans 3 variable Latin, weight 200–900: `@fontsource-variable/source-sans-3@5.3.0`.
- The existing JetBrains Mono WOFF2 remains unchanged for technical identifiers.

The two new font packages are retrieved from the npm registry. Their SIL OFL
licences are retained under `licenses/`. No font CDN is contacted by visitors.

## Infrastructure hero

`infrastructure-hero.webp` and its JPG fallback are an illustrative 1536 × 1024
3D still generated with the built-in image generation tool on 2026-09-10.
It is not a customer deployment, a product screenshot or a representation of
security guarantees. Interactive labels and paths are real DOM/SVG, not baked in.

Final generation prompt:

> Use case: stylized-concept. Asset type: a premium website hero image for a French cybersecurity and network engineering services firm. Primary request: an exceptional but restrained 3D architectural still that makes a connected, resilient information system tangible. No text, no logos, no UI, no watermark. Scene: one elegant, exploded architectural model of infrastructure on a deep ink-blue studio ground. A central layered blue glass and brushed-silver secure core, with precisely machined interconnected terraces, a small cluster of silver network/server modules, transparent blue data conduits, and a few directional light paths; these form a coherent engineered system, not random floating cubes. Three readable groups (network on left, protected core at centre, data/compute on right) within a single sculptural assembly. Material: translucent cobalt glass with depth and refraction, anodised grey-blue aluminium, satin silver. Professional architectural visualisation / high-end product render quality, subtle rim lighting, soft contact shadows, no neon cyberpunk, no giant shield icon, no people, no padlock, no purple, no orange. Composition: wide landscape 3:2, isometric three-quarter view at 35 degrees, complete assembly fully inside frame with generous quiet dark navy margin on all sides. The assembly occupies ~75 percent of the image. Beautiful substantial physical depth, thin precise highlights, enough open areas for separately coded interactive hotspots. This is an illustrative infrastructure model, not a fictional customer deployment or a product screenshot. Create a polished 1536x1024 bitmap, deep navy background approximately #0c1c33.

## Explanatory clips

The Guarded/Unguarded videos are recordings of actual shared explanatory
components, regenerated after palette/font changes. WebM/MP4 and WebP posters
are produced by `tools/render-signal-media.mjs`. All shown events are illustrative.

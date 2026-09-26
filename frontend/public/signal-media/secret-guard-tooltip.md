# Tooltip Secret Guard

- Rendu depuis `statusTooltipMarkdown` de l’extension 0.6.1 (`secret-guard/packages/vscode/src/status-tooltip.ts`), cadre VS Code Dark Modern, à 2×.
- État de démonstration : protection active, niveau Expurger, presse-papiers nettoyé de deux secrets à 14:32.
- La position de chaque bouton est relevée dans `frontend/components/secret-guard/tooltip-map.json`, que la page `/secret-guard` lit pour ses légendes.
- Reproduction : `node scripts/render-secret-guard-tooltip.mjs [dossier de l’extension]`.

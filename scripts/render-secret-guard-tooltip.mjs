/** Render a picture of the Secret Guard status tooltip from the extension source, for product pages.
 * Usage: node scripts/render-secret-guard-tooltip.mjs [path/to/secret-guard/packages/vscode]
 * Requires the secret-guard workspace dependencies (esbuild) and the frontend's Playwright Chromium.
 *
 * The tooltip is not redrawn: `statusTooltipMarkdown` from the extension builds the very HTML
 * VS Code shows (SVG tiles and a few coloured lines), and Chromium lays it out inside a
 * Dark Modern hover frame. Alongside the picture, the script records where each control sits
 * (as fractions of the picture), so the page can point at the real buttons rather than at
 * guessed coordinates. Re-run it whenever the tooltip changes; the picture and its map follow.
 */
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const extension = resolve(process.argv[2] ?? join(root, "secret-guard/packages/vscode"));
const { build } = createRequire(join(root, "secret-guard/package.json"))("esbuild");
const { chromium } = createRequire(join(root, "frontend/package.json"))("@playwright/test");
const output = join(root, "frontend/public/signal-media/secret-guard-tooltip.png");
const map = join(root, "frontend/components/secret-guard/tooltip-map.json");
const version = JSON.parse(await readFile(join(extension, "package.json"), "utf8")).version;

// A protected Team workstation in Expurger, with its xSOM tuning, the clipboard just cleaned of two secrets.
const DEMO_STATE = {
  appearance: "dark",
  health: {
    state: "active",
    reason: "local_canaries_verified",
    hosts: [
      { id: "vscode", label: "GitHub Copilot", configured: true },
      { id: "claude", label: "Claude Code", configured: true },
      { id: "codex", label: "Codex", configured: true },
    ],
  },
  mode: "redact",
  lastScan: { source: "clipboard", decision: "BLOCK", findings: 2, complete: true, purged: true, time: "14:32" },
  // Édition Équipe : un réglage sur mesure signé par xSOM, appliqué sur le poste.
  rulesPack: { line: "Réglage xSOM · v3 · 12 règles · jusqu’au 01/09/2027", tone: "ok", offerRequest: false },
};

// Each control the page explains, found by what the extension itself puts on it.
const CONTROLS = {
  dashboard: 'a[href="command:secretGuard.showDashboard"]',
  observe: 'a[href^="command:secretGuard.setMode"][href*="observe"]',
  redact: 'img[alt="Niveau Expurger (actif)"]',
  block: 'a[href^="command:secretGuard.setMode"][href*="block"]',
  effects: 'img[alt^="Expurger. "]',
  purge: 'a[href="command:secretGuard.purgeClipboard"]',
  statusbar: ".item--active",
};

// VS Code Dark Modern values for the variables the tooltip references.
const css = `
  :root {
    --vscode-editorHoverWidget-foreground: #cccccc;
    --vscode-descriptionForeground: #9d9d9d;
    --vscode-charts-green: #89d185;
    --vscode-charts-blue: #3794ff;
    --vscode-charts-yellow: #cca700;
    --vscode-charts-red: #f14c4c;
  }
  html, body { margin: 0; background: transparent; }
  body { font: 13px/19px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #cccccc; }
  .frame { display: inline-flex; flex-direction: column; align-items: flex-end; padding: 28px 28px 0; background: #1f1f1f; }
  .hover { padding: 6px 8px; background: #202020; border: 1px solid #454545; border-radius: 3px; box-shadow: 0 2px 8px rgba(0,0,0,.36); }
  .hover div { line-height: 19px; }
  .hover img { display: inline-block; vertical-align: top; }
  .hover a { display: inline-block; text-decoration: none; }
  .hover small { font-size: 11px; }
  .pointer { width: 12px; height: 12px; margin: -7px 58px 6px 0; background: #202020; border: solid #454545; border-width: 0 1px 1px 0; transform: rotate(45deg); }
  .statusbar { align-self: stretch; display: flex; justify-content: flex-end; gap: 14px; margin: 0 -28px; padding: 0 16px; height: 22px; align-items: center; background: #181818; border-top: 1px solid #2b2b2b; font-size: 12px; color: #cccccc; }
  .statusbar .item--active { padding: 0 6px; height: 22px; display: inline-flex; align-items: center; background: #2b2b2b; }
`;

const work = await mkdtemp(join(tmpdir(), "secret-guard-tooltip-"));
let browser;
try {
  const bundle = join(work, "status-tooltip.mjs");
  await build({
    entryPoints: [join(extension, "src/status-tooltip.ts")],
    absWorkingDir: extension,
    bundle: true,
    format: "esm",
    platform: "node",
    external: ["vscode"],
    outfile: bundle,
    logLevel: "warning",
  });
  const { statusTooltipMarkdown } = await import(pathToFileURL(bundle).href);
  const tooltip = statusTooltipMarkdown(DEMO_STATE);
  const html = `<style>${css}</style>
    <div class="frame">
      <div class="hover">${tooltip}</div>
      <div class="pointer"></div>
      <div class="statusbar"><span>Ln 12, Col 8</span><span>UTF-8</span><span>TypeScript</span><span class="item--active">Secret Guard : Expurger</span></div>
    </div>`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 1400 }, deviceScaleFactor: 2 });
  await page.setContent(html);
  await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
  const frame = page.locator(".frame");
  await frame.screenshot({ path: output, omitBackground: true });

  const box = await frame.boundingBox();
  const spots = {};
  for (const [id, selector] of Object.entries(CONTROLS)) {
    const target = page.locator(selector).first();
    if ((await target.count()) === 0) throw new Error(`Control not found in the tooltip: ${id} (${selector})`);
    const rect = await target.boundingBox();
    const round = value => Math.round(value * 10000) / 10000;
    spots[id] = {
      x: round((rect.x - box.x) / box.width),
      y: round((rect.y - box.y) / box.height),
      w: round(rect.width / box.width),
      h: round(rect.height / box.height),
    };
  }
  await writeFile(map, `${JSON.stringify({ version, width: Math.round(box.width), height: Math.round(box.height), spots }, null, 2)}\n`);
  await writeFile(output.replace(/\.png$/, ".md"), [
    "# Tooltip Secret Guard",
    "",
    `- Rendu depuis \`statusTooltipMarkdown\` de l’extension ${version} (\`secret-guard/packages/vscode/src/status-tooltip.ts\`), cadre VS Code Dark Modern, à 2×.`,
    "- État de démonstration : poste Équipe protégé, réglage xSOM v3 appliqué, niveau Expurger, presse-papiers nettoyé de deux secrets à 14:32.",
    "- La position de chaque bouton est relevée dans `frontend/components/secret-guard/tooltip-map.json`, que la page `/secret-guard` lit pour ses légendes.",
    "- Reproduction : `node scripts/render-secret-guard-tooltip.mjs [dossier de l’extension]`.",
    "",
  ].join("\n"));
  console.log(`Rendered: ${output} (extension ${version})\nMap: ${map}`);
} finally {
  if (browser) await browser.close();
  await rm(work, { recursive: true, force: true });
}

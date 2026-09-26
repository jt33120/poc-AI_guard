/** Burn the products page kinetic titles into a supplied 15-second film, once per site language.
 * Usage: node scripts/render-products-film.mjs /absolute/path/to/source.mp4
 * Requires ffmpeg and the frontend's installed Playwright Chromium.
 *
 * Same pipeline as `render-home-film.mjs`: Chromium renders the title layer frame by
 * frame on a transparent page, ffmpeg grades the footage, composites that layer and
 * encodes. Each beat says what the image shows — the laptop, the lines running to
 * the server room, the racks sealed in the mesh — without naming a product: the
 * range will grow, and the film must not need re-cutting when it does.
 */
import { createRequire } from "node:module";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const FPS = 24;
const DURATION = 15;
const POSTER_AT = 13.4;
// The shared header and its fade overlay the top of the film; the film controls and
// short screens take the bottom. Titles stay between the two (see the homepage film).
const TITLE_SAFE_TOP = 290;
const TITLE_SAFE_BOTTOM = 250;

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(join(root, "frontend/package.json"));
const { chromium } = require("@playwright/test");
if (!process.argv[2]) throw new Error("Provide the source MP4 path.");
const source = resolve(process.argv[2]);
const media = join(root, "frontend/public/signal-media");
const work = await mkdtemp(join(tmpdir(), "xsom-products-film-"));
const titleFont = (await readFile(join(media, "saira-600-800.woff2"))).toString("base64");
const textFont = (await readFile(join(media, "source-sans-3-latin-variable.woff2"))).toString("base64");

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "warning", "-y", ...args], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
  });
}

const css = `
  @font-face { font-family: Saira; src: url(data:font/woff2;base64,${titleFont}); font-weight: 600 800; }
  @font-face { font-family: Source; src: url(data:font/woff2;base64,${textFont}); font-weight: 200 900; }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: transparent; }
  body { font-family: Source, sans-serif; color: #f5f8ff; }
  .scrim, .flash, .beat { position: absolute; inset: 0; }
  .scrim { opacity: 0; }
  .scrim--right { background: linear-gradient(270deg, rgba(3,12,26,.86), rgba(3,12,26,.5) 42%, transparent 70%); }
  .scrim--left { background: linear-gradient(90deg, rgba(3,12,26,.88), rgba(3,12,26,.55) 42%, transparent 72%); }
  .flash { opacity: 0; background: radial-gradient(ellipse at 62% 45%, rgba(140,205,255,.5), rgba(140,205,255,.1) 70%); }
  .line { overflow: hidden; padding: .16em .08em .1em; margin: 0 -.08em -.26em; }
  .line > span { display: inline-block; white-space: nowrap; will-change: transform; }
  .kicker, .sub { color: #d3e5ff; text-shadow: 0 3px 24px rgba(2,10,24,.8); }
  .kicker { font-style: italic; font-weight: 400; font-size: 68px; letter-spacing: -.5px; }
  .title { font-family: Saira, sans-serif; font-weight: 800; text-transform: uppercase; line-height: 1; letter-spacing: -.02em; text-shadow: 0 6px 40px rgba(2,10,24,.55); }
  .sub { font-weight: 600; font-size: 50px; letter-spacing: -.3px; margin-top: 24px; }
  .beat--device .stack { position: absolute; right: 120px; top: ${TITLE_SAFE_TOP}px; text-align: right; }
  .beat--platform .stack { position: absolute; left: 120px; top: ${TITLE_SAFE_TOP}px; }
  .product { font-size: 168px; }
  .beat--range .stack { position: absolute; left: 120px; bottom: ${TITLE_SAFE_BOTTOM}px; }
  .beat--range .title { font-size: 128px; }
  .beat--range .accent { color: #7cc0ff; }
  .rule { width: 120px; height: 7px; margin-bottom: 30px; background: #7cc0ff; transform: scaleX(0); transform-origin: 0 50%; }
`;

/** The burned-in words, per site language. Keep them in step with `PRODUCTS_HERO_MEDIA.label`. */
const COPY = {
  fr: {
    device: "Sur le poste", protect: "Protéger", protectWhat: "ce que vos équipes envoient aux IA.",
    platform: "Dans votre infrastructure", control: "Contrôler", controlWhat: "chaque action de vos agents.",
    from: "Du poste", to: "au serveur.", range: "Nos produits de cybersécurité IA",
  },
  en: {
    device: "On the workstation", protect: "Protect", protectWhat: "what your teams send to AI.",
    platform: "In your infrastructure", control: "Control", controlWhat: "every action your agents take.",
    from: "From laptop", to: "to server.", range: "Our AI cybersecurity products",
  },
};

function titles(copy) {
  return `
  <div class="scrim scrim--right" data-in="0" data-out="3.75"></div>
  <section class="beat beat--device"><div class="stack">
    <div class="line kicker" data-in="0.25" data-out="3.45"><span>${copy.device}</span></div>
    <div class="line title product" data-in="0.4" data-out="3.5"><span>${copy.protect}</span></div>
    <div class="line sub" data-in="0.85" data-out="3.55"><span>${copy.protectWhat}</span></div>
  </div></section>

  <div class="scrim scrim--left" data-in="4.0" data-out="8.75"></div>
  <section class="beat beat--platform"><div class="stack">
    <div class="line kicker" data-in="4.2" data-out="8.4"><span>${copy.platform}</span></div>
    <div class="line title product" data-in="4.35" data-out="8.45"><span>${copy.control}</span></div>
    <div class="line sub" data-in="4.8" data-out="8.5"><span>${copy.controlWhat}</span></div>
  </div></section>

  <div class="flash" data-at="9.4"></div>

  <div class="scrim scrim--left" data-in="10.2"></div>
  <section class="beat beat--range"><div class="stack">
    <div class="rule" data-in="10.45"></div>
    <div class="line title" data-in="10.55"><span>${copy.from}</span></div>
    <div class="line title accent" data-in="10.7"><span>${copy.to}</span></div>
    <div class="line sub" data-in="11.35"><span>${copy.range}</span></div>
  </div></section>
`;
}

/** Every element's state is a pure function of time, so any frame renders on its own. */
function installTimeline() {
  const clamp = x => Math.min(1, Math.max(0, x));
  const outExpo = x => (x >= 1 ? 1 : 1 - 2 ** (-10 * x));
  const inCubic = x => x ** 3;
  const enter = (el, t, span) => outExpo(clamp((t - Number(el.dataset.in)) / span));
  const leave = (el, t, span) => (el.dataset.out ? inCubic(clamp((t - Number(el.dataset.out)) / span)) : 0);

  window.renderAt = t => {
    for (const el of document.querySelectorAll(".line")) {
      el.firstElementChild.style.transform = `translateY(${(1 - enter(el, t, 0.62)) * 125 - leave(el, t, 0.38) * 125}%)`;
    }
    for (const el of document.querySelectorAll(".scrim")) {
      el.style.opacity = String(clamp((t - Number(el.dataset.in)) / 0.4) * (1 - leave(el, t, 0.4)));
    }
    for (const el of document.querySelectorAll(".rule")) el.style.transform = `scaleX(${enter(el, t, 0.55)})`;
    for (const el of document.querySelectorAll(".flash")) {
      const d = t - Number(el.dataset.at);
      el.style.opacity = String(d < 0 ? clamp(1 + d / 0.08) : clamp(1 - d / 0.35) ** 2);
    }
  };
}

/** Screenshot every frame of one language's title layer into `dir`. */
async function renderTitles(page, copy, dir) {
  await mkdir(dir, { recursive: true });
  await page.setContent(`<style>${css}</style>${titles(copy)}`);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(installTimeline);
  for (let frame = 0; frame < FPS * DURATION; frame++) {
    await page.evaluate(t => window.renderAt(t), frame / FPS);
    await page.screenshot({ path: join(dir, `${String(frame).padStart(4, "0")}.png`), omitBackground: true });
  }
}

async function encode(frames, output) {
  const filter = [
    `[0:v:0]scale=1920:1080:flags=lanczos,setsar=1,fps=${FPS},setpts=PTS-STARTPTS,eq=contrast=1.06:saturation=1.08,vignette=angle=PI/5[base]`,
    `[base][1:v]overlay=0:0:shortest=1,fade=t=out:st=${DURATION - 0.45}:d=0.45,format=yuv420p[out]`,
  ].join(";");
  await ffmpeg([
    "-i", source, "-framerate", String(FPS), "-i", join(frames, "%04d.png"),
    "-filter_complex", filter, "-map", "[out]", "-map", "0:a:0?", "-t", String(DURATION),
    "-c:v", "libx264", "-crf", "21", "-preset", "slow", "-c:a", "aac", "-b:a", "128k",
    "-af", `afade=t=in:d=0.15,afade=t=out:st=${DURATION - 0.45}:d=0.45`,
    "-movflags", "+faststart", "-map_metadata", "-1", output,
  ]);
  const poster = output.replace(/\.mp4$/, ".jpg");
  await ffmpeg(["-ss", String(POSTER_AT), "-i", output, "-frames:v", "1", "-q:v", "2", "-update", "1", poster]);
  console.log(`Rendered: ${output}\nPoster: ${poster}`);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  for (const lang of Object.keys(COPY)) await renderTitles(page, COPY[lang], join(work, lang));
  await browser.close();
  browser = undefined;
  for (const lang of Object.keys(COPY)) await encode(join(work, lang), join(media, `xsom-products-v1-${lang}.mp4`));
} finally {
  if (browser) await browser.close();
  await rm(work, { recursive: true, force: true });
}

/** Burn the homepage kinetic titles into a supplied 15-second film, once per site language.
 * Usage: node scripts/render-home-film.mjs /absolute/path/to/source.mp4
 * Requires ffmpeg and the frontend's installed Playwright Chromium.
 *
 * Chromium renders the title layer frame by frame on a transparent page (masked line
 * reveals need real layout, which drawtext cannot do); ffmpeg grades the footage,
 * composites that layer and encodes. Each beat is timed to one act of the source:
 * calm office, red threat lines, blue mesh taking over, office sealed in the mesh.
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
// On wide screens the homepage header and its fade overlay the top of the film: keep titles below it.
const TITLE_SAFE_TOP = 290;
// The page lays its film controls over the bottom, and short screens crop it: keep titles above.
const TITLE_SAFE_BOTTOM = 250;

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(join(root, "frontend/package.json"));
const { chromium } = require("@playwright/test");
if (!process.argv[2]) throw new Error("Provide the source MP4 path.");
const source = resolve(process.argv[2]);
const media = join(root, "frontend/public/signal-media");
const work = await mkdtemp(join(tmpdir(), "xsom-home-film-"));
const titleFont = (await readFile(join(root, "frontend/public/signal-media/saira-600-800.woff2"))).toString("base64");
const textFont = (await readFile(join(root, "frontend/public/signal-media/source-sans-3-latin-variable.woff2"))).toString("base64");

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
  .scrim--top { background: linear-gradient(180deg, rgba(3,12,26,.85), rgba(3,12,26,.5) 45%, transparent 66%); }
  .scrim--bottom { background: linear-gradient(0deg, rgba(3,12,26,.86), rgba(3,12,26,.55) 45%, transparent 68%); }
  .scrim--left { background: linear-gradient(90deg, rgba(3,12,26,.88), rgba(3,12,26,.55) 45%, transparent 78%); }
  .scrim--final { background: radial-gradient(ellipse 70% 62% at 50% 46%, rgba(3,12,26,.7), rgba(3,12,26,.34) 70%, rgba(3,12,26,.18)); }
  .flash { opacity: 0; }
  .flash--red { background: radial-gradient(ellipse at 50% 55%, rgba(255,70,100,.55), rgba(255,70,100,.12) 70%); }
  .flash--blue { background: radial-gradient(ellipse at 50% 45%, rgba(140,205,255,.6), rgba(140,205,255,.12) 70%); }
  .line { overflow: hidden; padding: .16em .08em .1em; margin: 0 -.08em -.26em; }
  .line > span { display: inline-block; white-space: nowrap; will-change: transform; }
  .kicker, .slam i, .sub { color: #d3e5ff; text-shadow: 0 3px 24px rgba(2,10,24,.8); }
  .kicker { font-style: italic; font-weight: 400; font-size: 76px; letter-spacing: -.5px; }
  .title { font-family: Saira, sans-serif; font-weight: 800; text-transform: uppercase; line-height: 1; letter-spacing: -.02em; text-shadow: 0 6px 40px rgba(2,10,24,.55); }
  .beat--one .stack { position: absolute; left: 120px; top: ${TITLE_SAFE_TOP}px; }
  .beat--one .title { font-size: 176px; }
  .beat--two .stack { position: absolute; left: 0; right: 0; bottom: ${TITLE_SAFE_BOTTOM}px; text-align: center; }
  .beat--two .kicker { font-size: 72px; }
  .threat { font-size: 216px; color: #ff4263; text-shadow: 0 0 60px rgba(255,66,99,.45), 0 6px 40px rgba(2,10,24,.6); }
  .threat > span > span { display: inline-block; }
  .beat--three .stack { position: absolute; left: 120px; top: calc(50% + ${TITLE_SAFE_TOP / 4}px); transform: translateY(-50%); display: grid; gap: 34px; }
  .slam { display: flex; align-items: baseline; gap: 34px; transform-origin: 0 60%; }
  .slam b { font-family: Saira, sans-serif; font-weight: 800; font-size: 168px; line-height: .9; text-transform: uppercase; letter-spacing: -.02em; color: color-mix(in srgb, #f5f8ff calc(100% - var(--dim, 0) * 100%), #6fb6ff); text-shadow: 0 6px 40px rgba(2,10,24,.55); }
  .slam i { font-weight: 400; font-size: 70px; }
  .beat--four .stack { position: absolute; left: 0; right: 0; top: ${TITLE_SAFE_TOP}px; text-align: center; }
  .beat--four .title { font-size: 122px; }
  .beat--four .accent { color: #7cc0ff; }
  .rule { width: 120px; height: 7px; margin: 0 auto 30px; background: #7cc0ff; transform: scaleX(0); }
  .sub { font-weight: 600; font-size: 64px; letter-spacing: -.3px; margin-top: 30px; }
`;

/** The burned-in words, per site language. Keep them in step with `HOME_HERO_MEDIA.label`. */
const COPY = {
  fr: {
    teams: "Vos équipes", adopt: "adoptent l’IA.",
    assets: "Secrets, données, actions d’agents :", exposed: "exposés.",
    controls: [["Détecter", "les secrets"], ["Bloquer", "les actions à risque"], ["Tracer", "chaque décision"]],
    layer: "La couche cybersécurité", usage: "de vos usages IA.", offer: "Logiciels · Conseil",
  },
  en: {
    teams: "Your teams", adopt: "embrace AI.",
    assets: "Secrets, data, agent actions:", exposed: "exposed.",
    controls: [["Detect", "secrets"], ["Block", "risky actions"], ["Trace", "every decision"]],
    layer: "The cybersecurity layer", usage: "for every AI use case.", offer: "Software · Consulting",
  },
};

function titles(copy) {
  const letters = [...copy.exposed].map(letter => `<span>${letter}</span>`).join("");
  const [detect, block, trace] = copy.controls.map(([verb, object]) => `<b>${verb}</b><i>${object}</i>`);
  return `
  <div class="scrim scrim--top" data-in="0" data-out="2.7"></div>
  <section class="beat beat--one"><div class="stack">
    <div class="line kicker" data-in="0.2" data-out="2.45"><span>${copy.teams}</span></div>
    <div class="line title" data-in="0.34" data-out="2.5"><span>${copy.adopt}</span></div>
  </div></section>

  <div class="scrim scrim--bottom" data-in="3.0" data-out="6.55"></div>
  <section class="beat beat--two"><div class="stack">
    <div class="line kicker" data-in="3.2" data-out="6.3"><span>${copy.assets}</span></div>
    <div class="line title threat" data-in="3.55" data-out="6.35" data-letters><span>${letters}</span></div>
  </div></section>

  <div class="scrim scrim--left" data-in="6.75" data-out="10.35"></div>
  <section class="beat beat--three"><div class="stack">
    <div class="slam" data-in="6.95" data-dim="7.8" data-out="10.1">${detect}</div>
    <div class="slam" data-in="7.8" data-dim="8.65" data-out="10.16">${block}</div>
    <div class="slam" data-in="8.65" data-out="10.22">${trace}</div>
  </div></section>

  <div class="scrim scrim--final" data-in="10.9"></div>
  <section class="beat beat--four"><div class="stack">
    <div class="rule" data-in="11.15"></div>
    <div class="line title" data-in="11.25"><span>${copy.layer}</span></div>
    <div class="line title accent" data-in="11.4"><span>${copy.usage}</span></div>
    <div class="line sub" data-in="12.05"><span>${copy.offer}</span></div>
  </div></section>

  <div class="flash flash--red" data-at="3.4"></div>
  <div class="flash flash--blue" data-at="10.95"></div>
`;
}

/** Every element's state is a pure function of time, so any frame renders on its own. */
function installTimeline() {
  const clamp = x => Math.min(1, Math.max(0, x));
  const outExpo = x => (x >= 1 ? 1 : 1 - 2 ** (-10 * x));
  const inCubic = x => x ** 3;
  const enter = (el, t, span, delay = 0) => outExpo(clamp((t - Number(el.dataset.in) - delay) / span));
  const leave = (el, t, span) => (el.dataset.out ? inCubic(clamp((t - Number(el.dataset.out)) / span)) : 0);

  window.renderAt = t => {
    for (const el of document.querySelectorAll(".line")) {
      const exit = leave(el, t, 0.38);
      const inner = el.firstElementChild;
      if (el.hasAttribute("data-letters")) {
        [...inner.children].forEach((letter, i) => {
          letter.style.transform = `translateY(${(1 - enter(el, t, 0.5, i * 0.05)) * 125}%)`;
        });
        inner.style.transform = `translateY(${-exit * 125}%)`;
      } else {
        inner.style.transform = `translateY(${(1 - enter(el, t, 0.62)) * 125 - exit * 125}%)`;
      }
    }
    for (const el of document.querySelectorAll(".slam")) {
      const shown = enter(el, t, 0.42);
      const exit = leave(el, t, 0.34);
      el.style.opacity = String(shown * (1 - exit));
      el.style.transform = `translateX(${-exit * 90}px) scale(${1.14 - 0.14 * shown})`;
      el.style.filter = `blur(${(1 - shown) * 16}px)`;
      el.style.setProperty("--dim", el.dataset.dim ? String(clamp((t - Number(el.dataset.dim)) / 0.3)) : "0");
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
    `[0:v:0]scale=1920:1080:flags=lanczos,setsar=1,fps=${FPS},setpts=PTS-STARTPTS,eq=contrast=1.07:saturation=1.12,vignette=angle=PI/5[base]`,
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
  for (const lang of Object.keys(COPY)) await encode(join(work, lang), join(media, `xsom-ai-home-v3-${lang}.mp4`));
} finally {
  if (browser) await browser.close();
  await rm(work, { recursive: true, force: true });
}

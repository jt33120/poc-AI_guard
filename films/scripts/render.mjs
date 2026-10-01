// Renders every film of guard.xsom.fr with Remotion into the frontend's public media, with
// their posters. Run `npm run footage` first. Optional arguments filter the jobs by name:
//   npm run render -- home products
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { score, cues } from './score.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const media = path.resolve(root, '../frontend/public/signal-media');
const designAssets = path.resolve(root, '../frontend/design-system/assets');

// BT.709, limited range, like every other video on the site (JPEG frames would otherwise
// leave a full-range stream).
const video = { pixelFormat: 'yuv420p', colorSpace: 'bt709' };
const film = { ...video, codec: 'h264', crf: 21, x264Preset: 'slow', audioCodec: 'aac', audioBitrate: '128k' };
const loop = { ...video, codec: 'vp9', crf: 34, muted: true };
const clip = { ...video, codec: 'h264', crf: 26, x264Preset: 'slow', muted: true };

/** id: composition; outputs: [file, encoding]; poster: [file, seconds, format]; copies: extra destinations. */
const JOBS = [
  ...['fr', 'en'].map(lang => ({
    name: 'home', id: `home-${lang}`,
    outputs: [[path.join(media, `xsom-ai-home-v4-${lang}.mp4`), film]],
    poster: [path.join(media, `xsom-ai-home-v4-${lang}.jpg`), 13.4, 'jpeg'],
  })),
  ...['fr', 'en'].map(lang => ({
    name: 'products', id: `products-${lang}`,
    outputs: [[path.join(media, `xsom-products-v2-${lang}.mp4`), film]],
    poster: [path.join(media, `xsom-products-v2-${lang}.jpg`), 13.4, 'jpeg'],
  })),
  {
    name: 'extension', id: 'extension',
    outputs: [[path.join(media, 'ai-guard-extension-v2.webm'), loop]],
    poster: [path.join(media, 'ai-guard-extension-v2.jpg'), 0, 'jpeg'],
  },
  ...['guarded', 'unguarded'].map(variant => ({
    name: 'signal', id: `signal-${variant}`,
    outputs: [[path.join(designAssets, `${variant}.webm`), { ...loop, crf: 36 }], [path.join(designAssets, `${variant}.mp4`), clip]],
    poster: [path.join(designAssets, `${variant}.webp`), 6.9, 'webp'],
    copies: [media],
  })),
];

const wanted = process.argv.slice(2);
const jobs = JOBS.filter(job => !wanted.length || wanted.includes(job.name) || wanted.includes(job.id));
if (!jobs.length) throw new Error(`No job matches ${wanted.join(', ')}`);
if (!fs.existsSync(path.join(root, 'public/footage'))) throw new Error('Run `npm run footage` first.');

fs.mkdirSync(path.join(root, 'public/score'), { recursive: true });
for (const cue of cues) score(cue, path.join(root, 'public/score', `${cue}.wav`));

const serveUrl = await bundle({ entryPoint: path.join(root, 'src/index.ts') });
for (const job of jobs) {
  const composition = await selectComposition({ serveUrl, id: job.id });
  for (const [output, encoding] of job.outputs) {
    await renderMedia({ serveUrl, composition, outputLocation: output, imageFormat: 'jpeg', jpegQuality: 92, ...encoding });
    console.log(`${job.id} → ${path.relative(path.resolve(root, '..'), output)} (${(fs.statSync(output).size / 1e6).toFixed(2)} MB)`);
  }
  const [poster, seconds, imageFormat] = job.poster;
  const frame = Math.min(composition.durationInFrames - 1, Math.round(seconds * composition.fps));
  await renderStill({ serveUrl, composition, frame, output: poster, imageFormat, ...(imageFormat === 'jpeg' && { jpegQuality: 82 }) });
  for (const destination of job.copies ?? []) {
    for (const file of [...job.outputs.map(([output]) => output), poster]) fs.copyFileSync(file, path.join(destination, path.basename(file)));
  }
}

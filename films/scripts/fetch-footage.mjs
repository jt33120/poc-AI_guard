// Fetches the films' stock footage (footage.json) into public/footage/, and copies the
// site's fonts and mark into public/. Footage is never committed: this script is the
// way back to the exact clips. Pexels serves the 1080p rendition when one exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const media = path.resolve(root, '../frontend/public/signal-media');
const footage = path.join(root, 'public/footage');
const fonts = path.join(root, 'public/fonts');
const brand = path.join(root, 'public/brand');
const HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; xsom-films/1.0)' };

/** The 1080p file behind Pexels' download link, or the original when no 1080p exists. */
async function pexelsFile(id) {
  const response = await fetch(`https://www.pexels.com/download/video/${id}/`, { redirect: 'manual', headers: HEADERS });
  const original = response.headers.get('location');
  if (!original) throw new Error(`Pexels ${id}: no download (${response.status})`);
  const size = original.match(/-u?hd_(\d+)_(\d+)_([\d.]+)fps\.mp4$/);
  if (!size || Number(size[2]) <= 1080) return original;
  const width = Math.round((Number(size[1]) * 1080) / Number(size[2]) / 2) * 2;
  const hd = original.replace(size[0], `-hd_${width}_1080_${size[3]}fps.mp4`);
  return (await fetch(hd, { method: 'HEAD', headers: HEADERS })).ok ? hd : original;
}

async function retry(task, tries = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= tries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
    }
  }
}

async function download(id) {
  const file = path.join(footage, `${id}.mp4`);
  if (fs.existsSync(file)) return;
  const url = await retry(() => pexelsFile(id));
  await retry(async () => {
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) throw new Error(`Pexels ${id}: ${response.status}`);
    fs.writeFileSync(`${file}.part`, Buffer.from(await response.arrayBuffer()));
    fs.renameSync(`${file}.part`, file);
  });
  console.log(`${id}  ${path.basename(url)}`);
}

fs.mkdirSync(footage, { recursive: true });
fs.mkdirSync(fonts, { recursive: true });
fs.mkdirSync(brand, { recursive: true });
for (const font of ['saira-600-800.woff2', 'source-sans-3-latin-variable.woff2', 'jetbrains-mono-500.woff2', 'manrope-latin-variable.woff2']) {
  fs.copyFileSync(path.join(media, font), path.join(fonts, font));
}
fs.copyFileSync(path.join(media, 'mark.svg'), path.join(brand, 'mark.svg'));
const { clips } = JSON.parse(fs.readFileSync(path.join(root, 'footage.json'), 'utf8'));
for (const { id } of clips) await download(id);

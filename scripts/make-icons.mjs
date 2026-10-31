import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const publicDir = new URL('../web/public/', import.meta.url);
const source = await readFile(new URL('icons/logo.svg', publicDir), 'utf8');
const variants = [
  ['icon-192.png', 192, 'any'], ['icon-512.png', 512, 'any'],
  ['icon-maskable-512.png', 512, 'opaque'], ['apple-touch-icon.png', 180, 'opaque'],
  ['favicon-32.png', 32, 'any'], ['icon-monochrome-512.png', 512, 'monochrome']
];
const browser = await chromium.launch({ headless: true, args: ['--force-color-profile=srgb'] });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const output = await page.evaluate(async ({ source, variants }) => {
    async function render(size, mode) {
      const doc = new DOMParser().parseFromString(source, 'image/svg+xml'), svg = doc.documentElement;
      if (doc.querySelector('parsererror') || svg.tagName !== 'svg') throw new Error('Invalid logo SVG');
      const background = svg.querySelector('rect');
      if (mode === 'opaque') background.setAttribute('rx', '0');
      if (mode === 'foreground' || mode === 'monochrome') background.remove();
      if (mode === 'monochrome') svg.querySelectorAll('rect').forEach(r => r.setAttribute('fill', '#000'));
      svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
      const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0, size, size);
      return { canvas, pixels: context.getImageData(0, 0, size, size).data };
    }
    // The opaque black maskable background is deliberately outside the safe circle.
    // Check every nontransparent pixel of the three foreground bars independently.
    const foreground = await render(512, 'foreground'); let maxRadius = 0, foregroundPixels = 0;
    for (let i = 0; i < foreground.pixels.length; i += 4) if (foreground.pixels[i + 3]) { const p = i / 4; maxRadius = Math.max(maxRadius, Math.hypot(p % 512 + .5 - 256, Math.floor(p / 512) + .5 - 256)); foregroundPixels++; }
    if (!foregroundPixels || maxRadius > 204) throw new Error(`Maskable foreground exceeds safe zone: ${maxRadius}`);
    const files = [];
    for (const [name, size, mode] of variants) {
      const { canvas, pixels } = await render(size, mode);
      let transparent = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) transparent++;
      if (mode === 'opaque' && transparent) throw new Error(`${name} must be fully opaque`);
      if (mode !== 'opaque' && pixels[3] !== 0) throw new Error(`${name} must have transparent corners`);
      files.push({ name, size, nonOpaquePixels: transparent, base64: canvas.toDataURL('image/png').split(',')[1] });
    }
    return { maxRadius, foregroundPixels, files };
  }, { source, variants });
  const files = [...output.files.map(({ base64, ...details }) => ({ ...details, bytes: Buffer.from(base64, 'base64') })), { name: 'favicon.svg', bytes: Buffer.from(source) }];
  const check = process.argv.includes('--check');
  for (const file of files) {
    const path = new URL(file.name, publicDir);
    if (check) { if (!(await readFile(path)).equals(file.bytes)) throw new Error(`Generated file is stale: ${fileURLToPath(path)}`); }
    else await writeFile(path, file.bytes);
  }
  console.log(JSON.stringify({ mode: check ? 'verified' : 'generated', chromium: browser.version(), safeRadius: 204, maxForegroundRadius: output.maxRadius, foregroundPixels: output.foregroundPixels, files: files.map(({ bytes, ...details }) => ({ ...details, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })) }, null, 2));
} finally { await browser.close(); }

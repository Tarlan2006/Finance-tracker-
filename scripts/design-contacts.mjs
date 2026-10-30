// Contact sheets for visual review; originals remain in tests/screenshots/design.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
await mkdir('.wrangler/design-review', { recursive: true });
for (const theme of ['dark', 'light']) for (const [width, height] of [[360, 740], [412, 915], [768, 1024]]) {
  const cellWidth = 400, cellHeight = Math.round(height / width * cellWidth), layers = [];
  for (const [row, stage] of ['before', 'after'].entries()) for (const [column, screen] of ['add', 'expenses', 'overview', 'more'].entries()) {
    const path = `tests/screenshots/design/${stage}/${screen}-${width}-${theme}.png`, metadata = await sharp(path).metadata();
    const image = await sharp(path).extract({ left: 0, top: 0, width: metadata.width, height: Math.min(metadata.height, Math.round(metadata.width * height / width)) }).resize(cellWidth, cellHeight, { fit: 'contain', background: theme === 'dark' ? '#000000' : '#f5f5f7' }).toBuffer();
    const label = Buffer.from(`<svg width="400" height="28"><rect width="400" height="28" fill="#333"/><text x="12" y="20" font-family="sans-serif" font-size="16" fill="white">${stage} · ${screen} · ${width} · ${theme}</text></svg>`);
    layers.push({ input: label, left: column * cellWidth, top: row * (cellHeight + 28) }, { input: image, left: column * cellWidth, top: row * (cellHeight + 28) + 28 });
  }
  await sharp({ create: { width: cellWidth * 4, height: (cellHeight + 28) * 2, channels: 3, background: '#333' } }).composite(layers).png().toFile(`.wrangler/design-review/${theme}-${width}.png`);
}

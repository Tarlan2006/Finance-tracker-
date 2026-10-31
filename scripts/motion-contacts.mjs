import fs from 'node:fs/promises';
import sharp from 'sharp';
const root = 'tests/screenshots/motion';
const frames = ['navigation-moving','navigation-final','sheet-moving','sheet-final','sheet-drag','save-moving','save-check','save-final','delete-moving','undo-moving','undo-final','week-moving','week-final','ring-moving','ring-final'];
for (const theme of ['dark','light']) {
  const images = [];
  for (const name of frames) {
    try { const image = await fs.readFile(`${root}/${theme}-${name}.png`); images.push({ name, image }); } catch { /* The other theme may still be running. */ }
  }
  if (!images.length) continue;
  const tiles = [];
  for (const [i, { name, image }] of images.entries()) {
    const x = i % 4 * 220, y = Math.floor(i / 4) * 520;
    tiles.push({ input: await sharp(image).resize({ width: 206, height: 480, fit: 'inside' }).toBuffer(), left: x+7, top: y+32 });
    tiles.push({ input: Buffer.from(`<svg width="220" height="30"><text x="7" y="20" fill="white" font-size="13" font-family="Arial">${name}</text></svg>`), left: x, top: y });
  }
  await sharp({ create: { width: 880, height: Math.ceil(images.length/4)*520, channels: 3, background: '#25252a' } }).composite(tiles).png().toFile(`${root}/contact-${theme}.png`);
}

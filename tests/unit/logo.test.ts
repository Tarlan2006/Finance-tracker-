import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { expect, it } from 'vitest';
const root = new URL('../../web/public/', import.meta.url);
const read = (name: string) => readFile(new URL(name, root));
const png = async (name: string) => { const buffer = await read(name); expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); return sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); };
it('manifest separates any/maskable/monochrome and declares actual PNG dimensions', async () => {
  const manifest = JSON.parse((await read('manifest.webmanifest')).toString());
  expect(manifest.name).toBe('Finance Tracker'); expect(manifest.short_name).toBe('Finance Tracker'); expect(manifest.background_color).toBe('#000000'); expect(manifest.theme_color).toBe('#000000');
  expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toEqual(['any', 'any', 'maskable', 'monochrome']);
  for (const icon of manifest.icons) { expect(icon.type).toBe('image/png'); const { info } = await png(icon.src.slice(1)); expect(icon.sizes).toBe(`${info.width}x${info.height}`); }
});
it('any icons retain transparent rounded corners and the approved three bar colors', async () => {
  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['favicon-32.png', 32]] as const) {
    const { info, data } = await png(file); expect(info.width).toBe(size); expect(info.height).toBe(size);
    for (const p of [0, size - 1, (size - 1) * size, size * size - 1]) expect(data[p * 4 + 3]).toBe(0);
    for (const [x, y, rgb] of [[151, 340, [42, 58, 56]], [256, 300, [79, 168, 152]], [361, 260, [127, 209, 185]]] as const) { const offset = (Math.floor(y * size / 512) * size + Math.floor(x * size / 512)) * 4; expect([...data.subarray(offset, offset + 4)]).toEqual([...rgb, 255]); }
  }
});
it('maskable is fully opaque and every colored foreground pixel is inside radius 204', async () => {
  const { info, data } = await png('icon-maskable-512.png'); expect([info.width, info.height]).toEqual([512, 512]); let pixels = 0, nonOpaque = 0, maxRadius = 0;
  for (let i = 0; i < data.length; i += 4) { if (data[i + 3] !== 255) nonOpaque++; if (data[i] || data[i + 1] || data[i + 2]) { const p = i / 4; maxRadius = Math.max(maxRadius, Math.hypot(p % 512 + .5 - 256, Math.floor(p / 512) + .5 - 256)); pixels++; } }
  expect(nonOpaque).toBe(0); expect(maxRadius).toBeLessThanOrEqual(204); expect(pixels).toBeGreaterThan(30000); expect([...data.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
});
it('Apple icon is 180 square with a black fully opaque background', async () => { const { info, data } = await png('apple-touch-icon.png'); expect([info.width, info.height]).toEqual([180, 180]); let nonOpaque = 0; for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) nonOpaque++; expect(nonOpaque).toBe(0); expect([...data.subarray(0, 4)]).toEqual([0, 0, 0, 255]); });
it('monochrome contains only black bars, with transparent background and safe alpha bounds', async () => {
  const { data } = await png('icon-monochrome-512.png'); let foreground = 0, colored = 0, maxRadius = 0;
  for (let i = 0; i < data.length; i += 4) { colored += data[i] + data[i + 1] + data[i + 2]; if (data[i + 3]) { foreground++; const p = i / 4; maxRadius = Math.max(maxRadius, Math.hypot(p % 512 + .5 - 256, Math.floor(p / 512) + .5 - 256)); } }
  expect(colored).toBe(0); expect(maxRadius).toBeLessThanOrEqual(204); expect(foreground).toBeGreaterThan(30000); expect(data[3]).toBe(0);
});
it('favicon is generated from the one SVG source, without fonts, text or external content', async () => { const source = await read('icons/logo.svg'); expect((await read('favicon.svg')).equals(source)).toBe(true); expect(source.toString().match(/<rect /g)).toHaveLength(4); expect(source.toString()).not.toMatch(/<(?:text|image|animate|script)|href=|font|₸/); });

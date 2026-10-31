import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = new URL('../', import.meta.url), out = new URL('tests/screenshots/logo/', root);
await mkdir(out, { recursive: true });
const data = async path => `data:image/png;base64,${(await readFile(new URL(path, root))).toString('base64')}`;
const any = await data('web/public/icon-512.png'), mask = await data('web/public/icon-maskable-512.png'), mono = await data('web/public/icon-monochrome-512.png');
const squircle = Array.from({ length: 128 }, (_, i) => { const angle = i * Math.PI / 64, x = Math.cos(angle), y = Math.sin(angle); return `${50 + 50 * Math.sign(x) * Math.sqrt(Math.abs(x))}% ${50 + 50 * Math.sign(y) * Math.sqrt(Math.abs(y))}%`; }).join(',');
const browser = await chromium.launch({ headless: true, args: ['--force-color-profile=srgb'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1 });
  const figure = (src, label, size, style = '') => `<figure><img src="${src}" width="${size}" height="${size}" style="${style}"/><figcaption>${label}</figcaption></figure>`;
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;font:16px Arial,sans-serif;background:#888}section{padding:32px;display:grid;grid-template-columns:320px 1fr;gap:24px;background:#f4f4f6;color:#171719}section.dark{background:#171719;color:#eee}h1{font-size:22px;margin:0 0 20px}figure{margin:0;text-align:center}figcaption{margin-top:12px;font-size:14px}img{display:inline-block;vertical-align:bottom}.variants{display:flex;gap:24px;align-items:center;flex-wrap:wrap}.large{grid-row:2/4;grid-column:1}header{grid-column:1/-1;grid-row:1}.variants{grid-column:2;grid-row:2}.small{grid-column:2;grid-row:3}.small{display:flex;align-items:end;gap:28px}</style>${['light', 'dark'].map(theme => `<section class="${theme}"><header><h1>Finance Tracker · ${theme} surface</h1></header><div class="large">${figure(any, 'Any · approved shape · 320 px', 320)}</div><div class="variants">${figure(mask, 'Circle · maskable', 128, 'clip-path:circle(50%)')}${figure(mask, 'Rounded square · maskable', 128, 'border-radius:22%')}${figure(mask, 'Squircle · maskable', 128, `clip-path:polygon(${squircle})`)}</div><div class="small">${figure(any, '48 px', 48)}${figure(any, '72 px', 72)}${figure(mono, 'Monochrome · 72 px', 72, theme === 'dark' ? 'filter:invert(1)' : '')}</div></section>`).join('')}`);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(i => i.decode())));
  await page.screenshot({ path: fileURLToPath(new URL('icons-contact.png', out)), fullPage: true });
  const shots = [];
  for (const theme of ['dark', 'light']) for (const screen of ['login', 'header-412']) shots.push({ label: `${screen} · ${theme}`, src: await data(`tests/screenshots/logo/${screen}-${theme}.png`) });
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.setContent(`<style>body{margin:0;background:#777;font:16px Arial;display:grid;grid-template-columns:repeat(4,1fr)}figure{margin:0}figcaption{padding:12px;background:#ddd;color:#111}img{display:block;width:100%;height:auto}</style>${shots.map(s => `<figure><figcaption>${s.label}</figcaption><img src="${s.src}"/></figure>`).join('')}`);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(i => i.decode())));
  await page.screenshot({ path: fileURLToPath(new URL('interface-contact.png', out)), fullPage: true });
  console.log('Created tests/screenshots/logo/icons-contact.png and interface-contact.png');
} finally { await browser.close(); }

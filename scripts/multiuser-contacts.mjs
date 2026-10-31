import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = new URL('../tests/screenshots/multiuser/', import.meta.url);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const theme of ['dark', 'light']) for (const width of [360, 412, 768, 1440]) {
    const shots = await Promise.all(['login', 'account', 'password', 'prepare'].map(async name => ({ name, src: `data:image/png;base64,${(await readFile(new URL(`${name}-${width}-${theme}.png`, root))).toString('base64')}` })));
    await page.setViewportSize({ width: Math.min(width, 412) * 4, height: 1024 });
    await page.setContent(`<style>body{margin:0;background:#777;display:grid;grid-template-columns:repeat(4,1fr);font:14px Arial}figure{margin:0}figcaption{padding:12px;background:#ddd;color:#111}img{display:block;width:100%;height:auto}</style>${shots.map(s => `<figure><figcaption>${s.name} · ${width} · ${theme}</figcaption><img src="${s.src}"/></figure>`).join('')}`);
    await page.locator('img').evaluateAll(images => Promise.all(images.map(i => i.decode())));
    await page.screenshot({ path: fileURLToPath(new URL(`contact-${width}-${theme}.png`, root)), fullPage: true });
  }
  console.log('Created 8 contact sheets for 32 mock account screens.');
} finally { await browser.close(); }

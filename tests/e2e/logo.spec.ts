import { mockSession } from './auth';
import { test, expect } from '@playwright/test';
test('logo: public icon metadata and HTTP content types', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest'); expect(response.status()).toBe(200); expect(response.headers()['content-type']).toContain('application/manifest+json'); const manifest = await response.json();
  for (const icon of [...manifest.icons, { src: '/apple-touch-icon.png', type: 'image/png' }, { src: '/favicon-32.png', type: 'image/png' }, { src: '/favicon.svg', type: 'image/svg+xml' }, { src: '/icons/logo.svg', type: 'image/svg+xml' }]) { const r = await request.get(icon.src); expect(r.status()).toBe(200); expect(r.headers()['content-type']).toContain(icon.type); if (icon.type === 'image/png') { const bytes = await r.body(), w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20); if (icon.sizes) expect(`${w}x${h}`).toBe(icon.sizes); } }
});
test('logo: inline decorative mark on login and header in both themes', async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8787', viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: info.project.name === 'light' ? 'light' : 'dark', serviceWorkers: 'block', isMobile: true, hasTouch: true });
  const page = await context.newPage(), requests: string[] = []; page.on('request', r => requests.push(r.url()));
  try {
    await page.goto('/'); const logo = page.locator('.login-logo'); await expect(logo).toHaveAttribute('aria-hidden', 'true'); await expect(logo.locator('svg rect')).toHaveCount(4); expect(await logo.evaluate(n => [n.clientWidth, n.clientHeight])).toEqual([72, 72]); await expect(page.getByRole('heading', { name: 'Finance Tracker', exact: true })).toBeVisible();
    await page.screenshot({ path: `tests/screenshots/logo/login-${info.project.name}.png`, fullPage: true });
    await page.getByLabel('Пароль', { exact: true }).fill('mock-local-key'); await page.getByRole('button', { name: 'Войти', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Траты', exact: true })).toBeVisible();
    await expect(page.locator('.brand .app-logo')).toHaveAttribute('aria-hidden', 'true'); await expect(page.locator('.brand')).toHaveText('Finance Tracker'); expect(requests.some(url => url.includes('/icons/logo.svg'))).toBe(false);
    for (const width of [360, 412, 768, 1440]) { await page.setViewportSize({ width, height: width > 412 ? 900 : 915 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `tests/screenshots/logo/header-${width}-${info.project.name}.png` }); }
  } finally { await context.close(); }
});
test('logo: updated shell cache replaces old icons and never caches API responses', async ({ page, context }) => {
  await page.goto('/favicon.svg'); await page.evaluate(async () => { await (await caches.open('tenge-old-logo')).put('/icon.svg', new Response('old')); await (await caches.open('finance-tracker-shell-old')).put('/manifest.webmanifest', new Response('old')); await (await caches.open('unrelated-cache')).put('/unrelated', new Response('keep')); });
  await page.goto('/'); await page.evaluate(async () => navigator.serviceWorker.ready); await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
  const session = await mockSession(page.request);
  await page.evaluate(async token => { for (const path of ['/api/health', '/api/bootstrap']) { const r = await fetch(path, { headers: { 'X-App-Key': token } }); if (!r.ok) throw new Error('Mock read failed'); await r.json(); } }, session.token);
  const cache = await page.evaluate(async () => { const names = await caches.keys(); const entries = await Promise.all(names.map(async name => ({ name, urls: (await (await caches.open(name)).keys()).map(r => new URL(r.url).pathname) }))); return { names, entries }; });
  expect(cache.names).not.toContain('tenge-old-logo'); expect(cache.names).not.toContain('finance-tracker-shell-old'); expect(cache.names).toContain('unrelated-cache');
  const shell = cache.entries.filter(c => c.name.startsWith('finance-tracker-shell-')); expect(shell).toHaveLength(1);
  for (const path of ['/index.html', '/manifest.webmanifest', '/favicon.svg', '/favicon-32.png', '/apple-touch-icon.png', '/icons/logo.svg', ...manifest.icons.map((i: { src: string }) => i.src)]) expect(shell[0].urls).toContain(path);
  expect(cache.entries.flatMap(c => c.urls).some(p => p.startsWith('/api/'))).toBe(false); expect(shell[0].urls).not.toContain('/icon.svg');
  await context.setOffline(true); await page.reload(); await expect(page.getByRole('heading', { name: 'Finance Tracker', exact: true })).toBeVisible();
  const offline = await page.evaluate(async () => { const icon = await fetch('/icon-maskable-512.png'); let apiFailed = false; try { await fetch('/api/health'); } catch { apiFailed = true; } return { icon: icon.status, type: icon.headers.get('content-type'), apiFailed }; }); expect(offline).toEqual({ icon: 200, type: 'image/png', apiFailed: true });
});

import { test, expect } from '@playwright/test';
import { navigate } from './navigation';
test('desktop sidebar, master-detail, shortcuts, dialog and page zoom', async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8787', reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, colorScheme: info.project.name === 'light' ? 'light' : 'dark', hasTouch: false, isMobile: false });
  const page = await context.newPage();
  try {
    await page.addInitScript(() => localStorage.setItem('app-key', 'mock-local-key')); await page.goto('/'); await expect(page.getByRole('heading', { name: 'Траты', exact: true })).toBeVisible();
    expect((await page.locator('.navigation').boundingBox())!.x).toBe(0);
    await page.locator('.expense-main').first().click(); await expect(page.getByRole('form', { name: 'Правка расхода' })).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await page.locator('.detail-panel').boundingBox())!.x).toBeGreaterThan((await page.locator('.journal-list').boundingBox())!.x);
    await page.screenshot({ path: `tests/screenshots/design/after/desktop-edit-${info.project.name}.png` }); await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.keyboard.press('n'); await expect(page.getByRole('dialog', { name: 'Добавить расход' })).toBeVisible(); const bounds = await page.locator('.add-dialog').boundingBox(); expect(bounds!.width).toBe(480); expect(bounds!.x).toBe(480);
    await page.keyboard.type('1250'); await expect(page.getByLabel('Сумма', { exact: true })).toHaveValue('1250'); await page.screenshot({ path: `tests/screenshots/design/after/desktop-add-${info.project.name}.png` }); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('/'); await expect(page.getByLabel('Поиск трат')).toBeFocused(); await page.getByLabel('Поиск трат').fill('Кофе'); await expect(page.locator('.expense-main')).toHaveCount(3); await page.getByLabel('Поиск трат').fill(''); await page.getByRole('heading', { name: 'Траты', exact: true }).click();
    const label = (await page.locator('.month-picker>span').textContent())!; await page.keyboard.press('ArrowLeft'); await expect(page.locator('.month-picker>span')).not.toHaveText(label); await page.keyboard.press('ArrowRight'); await expect(page.locator('.month-picker>span')).toHaveText(label);
    for (const [width, height] of [[600, 800], [768, 1024], [1024, 768], [1280, 800], [1440, 900], [915, 412]]) { await page.setViewportSize({ width, height }); for (const destination of ['Траты', 'Обзор', 'Ещё', 'Добавить']) { await navigate(page, destination); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); } }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const zoom of [.8, 1, 1.5]) { await page.evaluate(zoom => document.documentElement.style.zoom = String(zoom), zoom); for (const destination of ['Траты', 'Обзор', 'Ещё', 'Добавить']) { await navigate(page, destination); const metrics = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, inner: innerWidth, body: document.body.getBoundingClientRect().width })); expect(metrics.scroll, JSON.stringify({ zoom, destination, ...metrics })).toBeLessThanOrEqual(metrics.client + 1); } }
    const manifest = await (await page.request.get('/manifest.webmanifest')).json(); expect(manifest.display).toBe('standalone'); expect(manifest.display_override).toContain('standalone'); expect(manifest.theme_color).toBe('#000000');
  } finally { await context.close(); }
});

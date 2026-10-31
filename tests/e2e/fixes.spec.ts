import { initMockSession } from './auth';
import { test, expect, type Page } from '@playwright/test';
import { Api } from '../../worker/src/router';
import { MockSheetsAdapter } from '../../worker/src/mock-sheets';
import { activeItems } from '../../shared/config';
import { serialDate } from '../../shared/dates';
import type { Env } from '../../worker/src/env';
import { navigate } from './navigation';
const key = 'mock-local-key';
const env: Env = { APP_KEY: key, USE_MOCK: '1', TZ: 'Asia/Almaty', CURRENCY: '₸', DUPLICATE_WINDOW_MIN: '3', SHEET_NAME_EXPENSES: 'Ввод данных', SHEET_NAME_DICT: 'Справочник', SHEET_NAME_INCOME: 'Доходы и расходы' };
async function prepare(page: Page) {
  const mock = new MockSheetsAdapter(), read = mock.read.bind(mock);
  mock.rows.slice(1).forEach(r => { [0, 1, 2, 3, 4, 6, 7].forEach(i => { r[i] = ''; }); });
  const categories = (await read()).categories;
  [100000, 65000, 872].forEach((amount, i) => { const r = mock.rows[i + 1]; r[0] = serialDate('2026-10-31'); r[1] = ['Продукты', 'Обед', 'Проверить'][i]; r[2] = i < 2 ? categories[i].name : ''; r[3] = amount; r[6] = `1793419200000-fixes-${i}`; r[7] = 'manual'; });
  mock.read = async () => { const s = await read(); s.summaries = [{ month: '2026-10', income: 260000, fixed: 93730, journal: 165872, total: 259602, balance: 398, savings: 0 }]; return s; };
  const api = new Api(env, mock);
  await page.clock.install({ time: new Date('2026-10-31T10:00:00Z') });
  await initMockSession(page);
  // Each browser scenario gets the real Api + MockSheetsAdapter in an isolated process fixture.
  // No configuration mutation reaches the shared dev worker, let alone production.
  await page.route('**/api/**', async route => { const r = route.request(); if (['/api/account', '/api/logout', '/api/login'].some(path => new URL(r.url()).pathname.startsWith(path))) { await route.continue(); return; } const response = await api.fetchAccount(new Request(r.url(), { method: r.method(), headers: r.headers(), body: r.postData() || undefined })); await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() }); });
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Траты', exact: true })).toBeVisible();
  return { mock, api, config: async () => (await api.fetch(new Request('http://127.0.0.1:8787/api/config', { headers: { 'X-App-Key': key } }))).json() };
}
for (const [width, height] of [[360, 740], [412, 915], [768, 1024], [1440, 900]]) test(`fixes budget and settings ${width}x${height}`, async ({ browser }, info) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8787', viewport: { width, height }, colorScheme: info.project.name === 'light' ? 'light' : 'dark', reducedMotion: 'reduce', isMobile: width < 600, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage(), errors: string[] = []; page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  try {
    const { mock, config } = await prepare(page), before = structuredClone(mock.rows);
    const shot = async (name: string) => { await page.clock.runFor(5100); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `tests/screenshots/fixes/after/${name}-${width}-${info.project.name}.png`, fullPage: !(await page.getByRole('dialog').count()) }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); };
    await expect(page).toHaveTitle('Finance Tracker'); await expect(page.locator('.brand')).toHaveText('Finance Tracker');
    await expect(page.getByTestId('journal-total')).toHaveText('398 ₸'); await expect(page.locator('.journal-total')).toContainText('Потрачено 99,8% дохода'); await expect(page.locator('.journal-total')).toContainText('Можно тратить 398 ₸ в день'); await shot('journal');
    await navigate(page, 'Обзор'); await expect(page.locator('.stat-card').filter({ hasText: 'Личные расходы' })).toContainText('165 872'.replace(' ', '\u00a0')); await expect(page.locator('.stat-card').filter({ hasText: /^Остаток/ })).toContainText('398'); await expect(page.locator('.financial-card')).not.toContainText('Непредвиденные');
    await page.locator('.bar-button').last().tap(); await page.locator('.legend-row').first().tap(); await page.locator('.donut-center').tap();
    const styles = await page.locator('.donut,.donut>svg,.donut-segment,.bar-scroll,.bar-button,.bottom-nav button,.add-button').evaluateAll(nodes => nodes.map(n => ({ outline: getComputedStyle(n).outlineStyle, tap: getComputedStyle(n).getPropertyValue('-webkit-tap-highlight-color') })));
    expect(styles.every(s => s.outline === 'none' && s.tap === 'rgba(0, 0, 0, 0)')).toBe(true);
    expect(await page.locator('.overview-screen').evaluate(n => getComputedStyle(n).userSelect)).toBe('none'); await shot('overview');
    await navigate(page, 'Ещё'); await page.getByRole('button', { name: 'Настройки', exact: true }).click(); await expect(page.getByText('Настройки не созданы.')).toBeVisible(); expect(mock.createdSheets).toEqual([]); await shot('compatibility');
    await page.getByRole('button', { name: 'Создать', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('Будут созданы два служебных листа. Старые листы не изменятся.'); await page.getByRole('button', { name: 'Создать настройки', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(mock.createdSheets).toEqual(['FT Categories', 'FT Items']); await shot('settings');
    const editItem = async (name: string, amount: string, scope?: string) => { await page.getByTestId(`item-${name}`).locator('.config-row-main').click(); await page.getByLabel('Сумма статьи').fill(amount); if (scope) await page.getByLabel('Период изменения').selectOption(scope); await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); };
    await editItem('Основная зарплата', '210000');
    let c = await config(); expect(activeItems(c.items, '2026-09').find(i => i.name === 'Основная зарплата')!.amount).toBe(200000); expect(activeItems(c.items, '2026-11').find(i => i.name === 'Основная зарплата')!.amount).toBe(210000);
    await page.getByLabel('Месяц настроек', { exact: true }).fill('2026-11'); await editItem('Основная зарплата', '220000', 'month'); c = await config(); expect(activeItems(c.items, '2026-11').find(i => i.name === 'Основная зарплата')!.amount).toBe(220000); expect(activeItems(c.items, '2026-12').find(i => i.name === 'Основная зарплата')!.amount).toBe(210000);
    await page.getByLabel('Месяц настроек', { exact: true }).fill('2026-10');
    await page.getByRole('button', { name: 'Добавить статью', exact: true }).click(); await page.getByLabel('Название', { exact: true }).fill('Интернет'); await page.getByRole('combobox', { name: 'Тип', exact: true }).selectOption('fixed'); await page.getByLabel('Сумма статьи').fill('1500'); await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(page.getByTestId('item-Интернет')).toContainText('1\u00a0500');
    const remove = async () => { await page.getByRole('button', { name: 'Убрать Интернет', exact: true }).click(); await page.getByRole('button', { name: 'Убрать начиная с этого месяца', exact: true }).click(); };
    await remove(); await page.locator('.undo-stack').getByRole('button', { name: 'Отменить' }).click(); await page.clock.runFor(5100); await expect(page.getByTestId('item-Интернет')).toBeVisible(); await remove(); await page.clock.runFor(5100); await expect(page.getByTestId('item-Интернет')).toHaveCount(0);
    const food = page.locator('.config-category').filter({ hasText: 'Продукты и супермаркеты' }); await food.locator('.config-row-main').click(); await page.getByLabel('Месячный лимит').fill('70000'); await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(food).toContainText('70\u00a0000');
    await page.getByRole('button', { name: 'Добавить категорию', exact: true }).click(); await page.getByLabel('Название', { exact: true }).fill('Путешествия'); await page.getByRole('button', { name: 'Эмодзи ✈️' }).click(); await page.getByLabel('Месячный лимит').fill('20000'); await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(page.locator('.config-category').filter({ hasText: 'Путешествия' })).toBeVisible();
    const colorBefore = await food.locator('.config-dot').evaluate(n => getComputedStyle(n).backgroundColor); await food.locator('.config-row-main').click(); await page.getByLabel('Название', { exact: true }).fill('Питание'); await page.getByRole('button', { name: 'Эмодзи 🍎' }).click(); await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('Будет обновлено 1 записей'); await shot('rename'); await page.getByRole('button', { name: 'Подтвердить', exact: true }).click(); const renamed = page.locator('.config-category').filter({ hasText: 'Питание' }); await expect(renamed).toBeVisible(); await renamed.getByRole('button', { name: 'Опустить Питание' }).click(); await expect(page.locator('.config-category').nth(1)).toContainText('Питание'); expect(await renamed.locator('.config-dot').evaluate(n => getComputedStyle(n).backgroundColor)).toBe(colorBefore); expect(mock.rows[1][2]).toBe('🍎 Питание');
    await renamed.getByRole('button', { name: 'Удалить', exact: true }).click(); await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('В архиве сохранятся 1 записей'); await page.getByRole('button', { name: 'Подтвердить', exact: true }).click(); await expect(renamed).toHaveCount(0);
    await navigate(page, 'Траты'); await expect(page.locator('.expense-main').filter({ hasText: 'Продукты' })).toContainText('(архив)'); await navigate(page, 'Добавить'); await expect(page.getByRole('button', { name: '🍎 Питание', exact: true })).toHaveCount(0); await navigate(page, 'Ещё'); await page.getByRole('button', { name: 'Архив', exact: true }).click(); await page.locator('.config-category').filter({ hasText: 'Питание' }).getByRole('button', { name: 'Вернуть', exact: true }).click(); await page.getByRole('button', { name: 'Активные категории', exact: true }).click(); await expect(renamed).toBeVisible();
    await renamed.getByRole('button', { name: 'Удалить', exact: true }).click(); const target = (await config()).categories.find((c: { name: string }) => c.name === 'Путешествия'); await page.getByLabel('Что сделать').selectOption(target.id); await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('Будет обновлено 1 записей'); await page.getByRole('button', { name: 'Подтвердить', exact: true }).click(); await expect(renamed).toHaveCount(0); expect(mock.rows[1][2]).toBe('✈️ Путешествия');
    expect(mock.rows.map(r => r.filter((_, i) => i !== 2))).toEqual(before.map(r => r.filter((_, i) => i !== 2))); expect(errors).toEqual([]); await shot('settings-final');
  } finally { await context.close().catch(() => undefined); }
});
test('Finance Tracker public identity and zero-income settings link', async ({ page, request }) => {
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Finance Tracker', exact: true })).toBeVisible();
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Finance Tracker');
  const manifest = await (await request.get('/manifest.webmanifest')).json(); expect(manifest.name).toBe('Finance Tracker'); expect(manifest.short_name).toBe('Finance Tracker'); expect(manifest.description).toContain('Finance Tracker');
  const { api, config } = await prepare(page);
  const post = (path: string, body: unknown) => api.fetch(new Request(`http://127.0.0.1:8787/api/${path}`, { method: 'POST', headers: { 'X-App-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  await post('config/setup', {}); const c = await config();
  for (const item of activeItems(c.items, '2026-10').filter(i => i.kind === 'income')) expect((await post(`config/items/${item.id}`, { operationId: crypto.randomUUID(), rev: item.rev, month: '2026-10', remove: true })).status).toBe(200);
  await page.reload(); await expect(page.getByTestId('journal-total')).toHaveText('165\u00a0872 ₸'); await expect(page.locator('.journal-total')).not.toContainText('в день'); await page.getByRole('button', { name: 'Укажите доходы в настройках' }).click(); await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить категорию', exact: true }).click(); expect(await page.getByLabel('Название', { exact: true }).evaluate(n => getComputedStyle(n).userSelect)).toBe('text'); await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await navigate(page, 'Обзор'); await expect(page.locator('.stat-card')).toHaveCount(4); await expect(page.getByText('Нет данных о доходах')).toBeVisible();
});

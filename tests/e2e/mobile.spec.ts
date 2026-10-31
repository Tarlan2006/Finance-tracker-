import { mockToken } from './auth';
import { navigate } from './navigation';
import { test, expect, type Page } from '@playwright/test';
const key = 'mock-local-key';
test.afterEach(async ({ request, context }) => {
  await context.setOffline(false);
  const b = await (await request.get('/api/bootstrap', { headers: { 'X-App-Key': await mockToken(request) } })).json();
  expect(b.mock).toBe(true);
  for (const e of b.history as { id: string; row: number; fp: string }[]) {
    if (!e.id.includes('-mock-')) await request.delete(`/api/expenses/${e.row}?fp=${encodeURIComponent(e.fp)}`, { headers: { 'X-App-Key': await mockToken(request) } });
  }
});
async function bootstrap(page: Page) { return page.evaluate(async () => (await fetch('/api/bootstrap', { headers: { 'X-App-Key': localStorage.getItem('app-key') || '' } })).json()); }
async function login(page: Page, url = '/') { await page.goto(url); await page.getByLabel('Пароль', { exact: true }).fill(key); await page.getByRole('button', { name: 'Войти' }).click(); await navigate(page, 'Добавить'); await expect(page.getByRole('heading', { name: 'Новый расход' })).toBeVisible(); }
async function record(page: Page, amount = '1000') { if (amount === '1000') { await page.getByRole('button', { name: '1', exact: true }).tap(); await page.getByRole('button', { name: '000', exact: true }).tap(); } else { for (const digit of amount) await page.getByRole('button', { name: digit, exact: true }).tap(); } await page.getByRole('button', { name: '🍔 Продукты и супермаркеты', exact: true }).tap(); await page.getByRole('button', { name: /^Сохранить ·/ }).tap(); }
async function settled(page: Page, id: string) { await expect.poll(async () => (await bootstrap(page)).history.filter((e: { name: string }) => e.name === id).length).toBe(1); }
test('ручная запись за 4 касания, пустое название, скриншот', async ({ page }, info) => {
  await login(page); const before = (await bootstrap(page)).history.length;
  await page.screenshot({ path: `tests/screenshots/design/regression/add-${info.project.name}.png`, fullPage: true });
  await record(page); await expect.poll(async () => (await bootstrap(page)).history.length).toBe(before + 1);
  const latest = (await bootstrap(page)).history.at(-1); expect(latest.name).toBe(''); expect(latest.amount).toBe(1000);
  await expect(page.getByLabel('Сумма', { exact: true })).toHaveValue('0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('глубокая ссылка очищает URL, двойное сохранение не создаёт дубль', async ({ page }) => {
  const merchant = `Платёж ${Date.now()}`; await login(page, `/?amount=1%20200,50&merchant=${encodeURIComponent(merchant)}&src=wallet`);
  expect(new URL(page.url()).search).toBe(''); await expect(page.getByLabel('Название', { exact: false }).first()).toHaveValue(merchant);
  await page.getByRole('button', { name: '🍔 Продукты и супермаркеты', exact: true }).tap();
  await page.getByRole('button', { name: /^Сохранить ·/ }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await settled(page, merchant); const e = (await bootstrap(page)).history.find((x: { name: string }) => x.name === merchant); expect(e.amount).toBe(1200.5); expect(e.source).toBe('wallet');
});
test('офлайн-очередь, перезагрузка оболочки, одна строка после сети', async ({ page, context }) => {
  await login(page); await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await page.reload();
  const merchant = `Офлайн ${Date.now()}`; await page.getByLabel('Название', { exact: false }).first().fill(merchant);
  await context.setOffline(true); await record(page, '275'); await expect(page.getByRole('status')).toContainText('Сохранено');
  await page.reload(); await expect(page.getByRole('heading', { name: 'Новый расход' })).toBeVisible();
  await navigate(page, 'Траты'); await expect(page.getByText('В очереди · отправится при появлении сети')).toBeVisible();
  await context.setOffline(false); await page.getByRole('button', { name: 'Повторить', exact: true }).click(); await settled(page, merchant);
  await page.reload(); expect((await bootstrap(page)).history.filter((e: { name: string }) => e.name === merchant)).toHaveLength(1);
});
test('правка, отмена удаления и удаление без сдвига', async ({ page }, info) => {
  const merchant = `Правка ${Date.now()}`; await login(page, `/?amount=4321&merchant=${encodeURIComponent(merchant)}`); await page.getByRole('button', { name: '🍔 Продукты и супермаркеты', exact: true }).click(); await page.getByRole('button', { name: /^Сохранить ·/ }).click(); await settled(page, merchant);
  await navigate(page, 'Траты'); await page.getByLabel('Поиск трат').fill(merchant); await page.getByRole('button', { name: new RegExp(merchant + '.*в таблице') }).click(); await page.getByLabel('Изменить сумму').fill('4400'); await page.getByRole('button', { name: 'Сохранить изменения' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await bootstrap(page)).history.find((e: { name: string }) => e.name === merchant).amount).toBe(4400);
  await page.getByRole('button', { name: new RegExp(merchant + '.*в таблице') }).click(); await page.getByRole('button', { name: 'Удалить расход', exact: true }).click(); await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(page.getByRole('button', { name: new RegExp(merchant + '.*в таблице') })).toBeVisible();
  await page.screenshot({ path: `tests/screenshots/design/regression/expenses-${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: new RegExp(merchant + '.*в таблице') }).click(); await page.getByRole('button', { name: 'Удалить расход', exact: true }).click(); await expect.poll(async () => (await bootstrap(page)).history.some((e: { name: string }) => e.name === merchant), { timeout: 15000 }).toBe(false);
});
test('обзор сверяется с mock и читается в обеих темах', async ({ page }, info) => {
  await login(page); const b = await bootstrap(page); const amount = b.expenses.reduce((s: number, e: { amount: number }) => s + e.amount, 0); const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(amount) + ' ₸';
  await navigate(page, 'Обзор'); await expect(page.getByTestId('overview-total')).toHaveText(formatted); await expect(page.getByRole('heading', { name: 'По категориям' })).toBeVisible();
  await expect(page.locator('.stat-card').filter({ hasText: 'Личные расходы' }).locator('strong')).toHaveAttribute('aria-label', new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(b.expenses.reduce((s: number, e: { amount: number }) => s + e.amount, 0)) + ' ₸');
  await page.screenshot({ path: `tests/screenshots/design/regression/overview-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await navigate(page, 'Ещё'); await page.screenshot({ path: `tests/screenshots/design/regression/more-${info.project.name}.png`, fullPage: true });
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Экспорт CSV за месяц' }).click(); expect((await download).suggestedFilename()).toMatch(/finance-tracker-.*\.csv/);
  const manifest = await page.request.get('/manifest.webmanifest'); const m = await manifest.json(); expect(m.display).toBe('standalone'); for (const icon of m.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);
});
test('ошибка 422 остаётся в очереди, исправление отправляет одну запись', async ({ page }) => {
  const merchant = `Ошибка ${Date.now()}`;
  await login(page, `/?amount=1900&merchant=${encodeURIComponent(merchant)}`);
  // Stop an actual queued POST at the network boundary; the production API remains unchanged.
  await page.route('**/api/expenses', route => route.request().method() === 'POST' ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'category', message: 'Категория изменилась' }) }) : route.continue());
  await page.getByRole('button', { name: '🍔 Продукты и супермаркеты', exact: true }).click(); await page.getByRole('button', { name: /^Сохранить ·/ }).click();
  await navigate(page, 'Траты'); await expect(page.getByText('Ошибка: Категория изменилась')).toBeVisible();
  await page.unroute('**/api/expenses'); await page.getByRole('button', { name: 'Исправить', exact: true }).click(); await page.getByLabel('Изменить сумму').fill('1950'); await page.getByRole('button', { name: 'Сохранить изменения' }).click(); await settled(page, merchant); expect((await bootstrap(page)).history.find((e: { name: string }) => e.name === merchant).amount).toBe(1950);
});
test('предупреждение о дубле допускает отмену и осознанное повторение', async ({ page }) => {
  await login(page); await record(page); await expect(page.getByLabel('Сумма', { exact: true })).toHaveValue('0'); const before = (await bootstrap(page)).history.length;
  await record(page); await expect(page.getByRole('dialog', { name: 'Похоже на дубль' })).toBeVisible(); await page.getByRole('button', { name: 'Отмена', exact: true }).click(); expect((await bootstrap(page)).history.length).toBe(before);
  await page.getByRole('button', { name: /^Сохранить ·/ }).click(); await page.getByRole('button', { name: 'Всё равно сохранить' }).click(); await expect.poll(async () => (await bootstrap(page)).history.length).toBe(before + 1);
});

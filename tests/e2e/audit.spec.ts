import { navigate } from './navigation';
import { test, expect, type Page } from '@playwright/test';
const key = 'mock-local-key';
async function login(page: Page) { await page.goto('/'); await page.getByLabel('Пароль', { exact: true }).fill(key); await page.getByRole('button', { name: 'Войти' }).click(); await navigate(page, 'Добавить'); await expect(page.getByRole('heading', { name: 'Новый расход' })).toBeVisible(); }
async function save(page: Page) { await page.getByRole('button', { name: '1', exact: true }).click(); await page.getByRole('button', { name: '000', exact: true }).click(); await page.getByRole('button', { name: '🍔 Продукты и супермаркеты', exact: true }).click(); await page.getByRole('button', { name: /^Сохранить ·/ }).click(); }
test('audit: own suggestions below input with keyboard semantics', async ({ page }) => {
  await login(page); const name = page.getByLabel('Название', { exact: false }).first(); await name.fill('ко');
  await expect(page.getByRole('listbox', { name: 'Подсказки названия' })).toBeVisible();
  const field = await name.boundingBox(), list = await page.getByRole('listbox').boundingBox(); expect(list!.y).toBeGreaterThanOrEqual(field!.y + field!.height);
  await expect(name).toHaveAttribute('autocapitalize', 'off'); await name.press('Escape'); await expect(page.getByRole('listbox')).toHaveCount(0);
});
test('audit: no permanent deletion action in journal', async ({ page }) => {
  await login(page); await navigate(page, 'Траты'); await expect(page.getByRole('button', { name: /^Удалить / })).toHaveCount(0);
});
test('audit: today follows Almaty midnight in an already open form', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-30T18:30:00Z') }); await login(page);
  await expect(page.getByLabel('Дата расхода')).toHaveValue('2026-10-30');
  await page.clock.setSystemTime(new Date('2026-10-30T19:30:00Z')); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Дата расхода')).toHaveValue('2026-10-31');
});
test('audit: HTML 200 never acknowledges or discards a queued expense', async ({ page }) => {
  await login(page); await page.route('**/api/expenses', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Platform page</h1>' }));
  await save(page); await navigate(page, 'Траты'); await expect(page.getByText('В очереди · отправится при появлении сети')).toBeVisible();
});
test('audit: platform HTML 404 remains retryable', async ({ page }) => {
  await login(page); await page.route('**/api/expenses', r => r.fulfill({ status: 404, contentType: 'text/html', body: '<h1>Not found</h1>' }));
  await save(page); await navigate(page, 'Траты'); await expect(page.getByText('В очереди · отправится при появлении сети')).toBeVisible();
});
test('audit: logout closes access in a second tab and removes history cache', async ({ page, context }) => {
  await login(page); const second = await context.newPage(); await second.goto('/'); await expect(second.getByRole('heading', { name: 'Траты' })).toBeVisible();
  await navigate(page, 'Ещё'); await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(second.getByLabel('Пароль', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('bootstrap-')))).toEqual([]);
});

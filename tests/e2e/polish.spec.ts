import { expect, test } from '@playwright/test';
import { initMockSession, mockToken } from './auth';
import { navigate } from './navigation';
import type { Bootstrap, Expense } from '../../shared/types';

test('comparison shows the exact dates and amounts behind the percentage', async ({ page, request }, info) => {
  const base: Bootstrap = await (await request.get('/api/bootstrap', { headers: { 'X-App-Key': await mockToken(request) } })).json();
  expect(base.mock).toBe(true);
  const expense = (date: string, amount: number, row: number): Expense => ({ date, amount, row, id: `polish-${row}`, category: base.categories[0].name, name: 'Расход для сравнения', comment: '', source: 'manual', fp: `${date}|${amount}|${base.categories[0].name}` });
  const history = [expense('2026-11-01', 100, 2), expense('2026-11-15', 900, 3), expense('2026-10-01', 200, 4)];
  await page.clock.install({ time: new Date('2026-11-01T07:00:00Z') });
  await initMockSession(page);
  await page.route('**/api/bootstrap*', route => route.fulfill({ json: { ...base, expenses: history.slice(0, 2), history } }));
  await page.route('**/api/expenses?*', route => route.fulfill({ json: { expenses: history.filter(e => e.date.startsWith(new URL(route.request().url()).searchParams.get('month')!)) } }));
  await page.goto('/');
  await navigate(page, 'Обзор');
  await expect(page.getByTestId('overview-total')).toHaveText('1 000 ₸');
  await expect(page.locator('.comparison')).toHaveText('−50% за указанные даты');
  await expect(page.locator('.comparison-values dd')).toHaveText(['100 ₸', '200 ₸']);
  await expect(page.locator('.comparison-values dt').first()).toHaveText(/1 нояб.*2026.*—.*1 нояб.*2026/);
  await expect(page.locator('.comparison-values dt').last()).toHaveText(/1 окт.*2026.*—.*1 окт.*2026/);
  await page.screenshot({ path: `tests/screenshots/polish/comparison-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Предыдущий период', exact: true }).click();
  await expect(page.locator('.comparison-values dd')).toHaveText(['200 ₸', '0 ₸']);
  await expect(page.locator('.comparison')).toContainText('Процент недоступен');
  await page.getByRole('button', { name: 'Следующий период', exact: true }).click();
  history[0].amount = 200;
  await page.reload();
  await expect(page.locator('.comparison')).toHaveText('0% за указанные даты');
});

test('sync distinguishes an empty queue, errors and confirmed delivery', async ({ page }, info) => {
  await initMockSession(page);
  await page.clock.install();
  let posts = 0;
  await page.route('**/api/expenses', route => {
    posts++;
    if (posts === 1) return route.fulfill({ status: 409, json: { error: 'schema_mismatch', message: 'Нарушена структура таблицы' } });
    return route.fulfill({ json: { expense: { id: route.request().postDataJSON().id } } });
  });
  await page.goto('/');
  await navigate(page, 'Ещё');
  await expect(page.getByText('Очередь пуста', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Отправка подтверждена')).toHaveCount(0);
  for (const amount of ['123', '456']) {
    await navigate(page, 'Добавить');
    await expect(page.getByRole('dialog').getByRole('heading', { level: 1 })).toHaveCount(1);
    await page.getByRole('button', { name: 'Стереть цифру', exact: true }).click();
    for (const digit of amount) await page.getByRole('button', { name: digit, exact: true }).click();
    const category = page.getByRole('button', { name: '🍔 Продукты и супермаркеты', exact: true });
    await expect(category.locator('svg')).toHaveCount(1);
    await category.click();
    await page.getByRole('button', { name: /^Сохранить ·/ }).click();
    await navigate(page, 'Ещё');
    await expect(page.getByText('В очереди — 1', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Отправка подтверждена')).toHaveCount(0);
  }
  await expect(page.getByText(/Требуют исправления — 1/)).toBeVisible();
  await page.screenshot({ path: `tests/screenshots/polish/sync-error-${info.project.name}.png` });
  await navigate(page, 'Траты');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await navigate(page, 'Ещё');
  await expect(page.getByText('Все записи отправлены', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Отправка подтверждена')).toBeVisible();
  await expect(page.getByText(/Требуют исправления/)).toHaveCount(0);
});

test('connection has one main action, feedback and a recoverable preparation error', async ({ page, request }, info) => {
  const base: Bootstrap = await (await request.get('/api/bootstrap', { headers: { 'X-App-Key': await mockToken(request) } })).json();
  expect(base.mock).toBe(true);
  await initMockSession(page);
  let state = 'sheet_unlinked', attempts = 0;
  await page.route('**/api/bootstrap*', route => route.fulfill(state ? { status: 409, json: { error: state, message: 'Таблица ещё не подключена. Обратитесь к администратору' } } : { json: base }));
  await page.route('**/api/table/prepare', route => {
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 503, json: { error: 'upstream', message: 'Сервер временно недоступен' } });
    state = '';
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  const primary = page.locator('.connection-actions .primary');
  await expect(primary).toHaveText('Проверить подключение');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await primary.click();
  await expect(page.getByRole('status')).toHaveText('Проверено — ожидаем подключения администратором');
  await page.screenshot({ path: `tests/screenshots/polish/unlinked-${info.project.name}.png` });
  state = 'table_uninitialized';
  await primary.click();
  await expect(primary).toHaveText('Подготовить таблицу');
  await primary.click();
  await expect(page.getByRole('alert')).toHaveText('Сервер временно недоступен');
  await expect(primary).toBeEnabled();
  await primary.click();
  await expect(page.getByRole('heading', { name: 'Траты', exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});

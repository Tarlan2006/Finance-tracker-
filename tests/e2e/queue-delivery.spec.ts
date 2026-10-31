import { test, expect, type Page } from '@playwright/test';
import { mockToken } from './auth';
import { navigate } from './navigation';

const merchant = 'Queue delivery fixture';
async function login(page: Page) {
  await page.getByLabel('Пароль', { exact: true }).fill('mock-local-key');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
}
async function prepare(page: Page) {
  await page.goto('/?amount=100&merchant=' + encodeURIComponent(merchant));
  await login(page);
  await page.getByRole('button', { name: '🍔 Продукты и супермаркеты', exact: true }).click();
}
const save = (page: Page) => page.getByRole('button', { name: /^Сохранить ·/ }).click();
const manual = (page: Page) => page.getByRole('button', { name: 'Синхронизировать', exact: true }).click();
async function checkJournal(page: Page, id: string) {
  const headers = { 'X-App-Key': await mockToken(page.request) };
  await expect.poll(async () => {
    const data = await (await page.request.get('/api/bootstrap', { headers })).json();
    expect(data.mock).toBe(true);
    return data.history.filter((e: { id: string }) => e.id === id).length;
  }).toBe(1);
}
test.afterEach(async ({ request }) => {
  const headers = { 'X-App-Key': await mockToken(request) };
  const data = await (await request.get('/api/bootstrap', { headers })).json();
  expect(data.mock).toBe(true);
  for (const row of data.history.filter((e: { name: string }) => e.name === merchant))
    await request.delete('/api/expenses/' + row.row, { headers, data: { fp: row.fp } });
});

test('manual sync immediately retries a 503 with the original ID and records the acknowledgement', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => { const now = Date.now(); Date.now = () => now; });
  let id = '';
  await page.route('**/api/expenses', r => { id = r.request().postDataJSON().id; return r.fulfill({status:503,json:{error:'upstream'}}); });
  await save(page);
  await navigate(page, 'Траты');
  await expect(page.getByText('Сервер временно недоступен', {exact:true})).toBeVisible();
  await navigate(page, 'Ещё');
  await expect(page.getByText('Сервер временно недоступен · HTTP 503')).toBeVisible();
  await page.unroute('**/api/expenses'); await manual(page);
  await expect(page.getByText('Все записи отправлены')).toBeVisible();
  await expect(page.getByText('Запись подтверждена сервером')).toBeVisible();
  await checkJournal(page, id);
});

test('queue POST 401 returns to login and restores the same queued ID', async ({ page }) => {
  await prepare(page); let id = '';
  await page.route('**/api/expenses', r => { id = r.request().postDataJSON().id; return r.fulfill({status:401,json:{error:'unauthorized'}}); });
  await save(page);
  await expect(page.getByLabel('Пароль', {exact:true})).toBeVisible();
  await page.unroute('**/api/expenses'); await login(page);
  await checkJournal(page, id);
  await navigate(page, 'Ещё'); await expect(page.getByText('Все записи отправлены')).toBeVisible();
});

test('schema mismatch keeps the row actionable without automatic permanent retries', async ({ page }) => {
  await prepare(page); let calls = 0;
  await page.route('**/api/expenses', r => { calls++; return r.fulfill({status:409,json:{error:'schema_mismatch'}}); });
  await save(page); await navigate(page, 'Траты');
  await expect(page.getByText(/Ошибка: Нарушена структура таблицы/)).toBeVisible();
  for (const name of ['Повторить','Исправить','Убрать']) await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
  await navigate(page, 'Ещё'); await manual(page);
  await expect(page.getByText(/структура таблицы.*HTTP 409/)).toBeVisible(); expect(calls).toBe(1);
  await page.route('**/api/bootstrap', r => r.fulfill({status:409,json:{error:'schema_mismatch',message:'Нарушена структура журнала'}}));
  await page.reload();
  await expect(page.getByRole('heading',{name:'Нарушена структура журнала'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Исправить',exact:true})).toBeVisible();
});

test('an unanswered POST times out and a later manual attempt delivers once', async ({ page }) => {
  await prepare(page); let id = '';
  await page.route('**/api/expenses', async r => { id = r.request().postDataJSON().id; /* Simulate a connection with no response. */ });
  await save(page); await navigate(page, 'Ещё');
  await expect(page.getByText('Сервер не ответил вовремя')).toBeVisible({timeout:27000});
  await page.unroute('**/api/expenses'); await manual(page);
  await checkJournal(page, id);
});

test('held queue lock times out, then releases without losing or duplicating a pending record', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => new Promise<void>(ready => {
    void navigator.locks.request('tenge-queue', () => new Promise<void>(release => {
      window.addEventListener('release-test-lock', () => release(), {once:true}); ready();
    }));
  }));
  let requests = 0, id = '';
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/expenses') { requests++; id = r.postDataJSON().id; } });
  await save(page); await navigate(page, 'Ещё');
  await expect(page.getByRole('status').filter({hasText:'Очередь занята другой вкладкой'})).toBeVisible({timeout:10000});
  expect(requests).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event('release-test-lock')));
  await manual(page); await expect(page.getByText('Все записи отправлены')).toBeVisible();
  await checkJournal(page, id); expect(requests).toBe(1);
});

import { mockToken } from './auth';
import { navigate } from './navigation';
import { test, expect, type Page } from '@playwright/test';
const key = 'mock-local-key';
async function login(page: Page) { await page.goto('/'); await page.getByLabel('Пароль', { exact: true }).fill(key); await page.getByRole('button', { name: 'Войти' }).click(); await navigate(page, 'Добавить'); await expect(page.getByRole('heading', { name: 'Новый расход' })).toBeVisible(); }
async function record(page: Page) { await page.getByRole('button', { name: '1', exact: true }).click(); await page.getByRole('button', { name: '🍔 Продукты и супермаркеты', exact: true }).click(); await page.getByRole('button', { name: /^Сохранить ·/ }).click(); }
async function storage(page: Page) { return page.evaluate(async () => { const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('tenge-finance-v1'); r.onsuccess = () => resolve(r.result); }); const rows = await Promise.all(['queue', 'meta'].map(s => new Promise<unknown[]>(resolve => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => resolve(r.result); }))); db.close(); return rows; }); }
test.afterEach(async ({ request, context }) => { await context.setOffline(false); const b = await (await request.get('/api/bootstrap', { headers: { 'X-App-Key': await mockToken(request) } })).json(); expect(b.mock).toBe(true); for (const e of b.history as { id: string; row: number; fp: string }[]) if (!e.id.includes('-mock-')) await request.delete(`/api/expenses/${e.row}?fp=${encodeURIComponent(e.fp)}`, { headers: { 'X-App-Key': await mockToken(request) } }); });
test('pending logout seals queue atomically and restores only with original key', async ({ page, context }) => {
  await login(page); await context.route('**/api/expenses', r => r.abort()); await page.getByLabel('Название', { exact: false }).first().fill('Секрет очереди'); await record(page);
  await navigate(page, 'Ещё'); await page.getByRole('button', { name: 'Выйти', exact: true }).click(); await page.getByRole('button', { name: 'Выйти и защитить очередь' }).click(); await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
  const sealed = await storage(page); expect(sealed[0]).toEqual([]); expect(JSON.stringify(sealed)).not.toContain('Секрет очереди'); expect(JSON.stringify(sealed)).not.toContain(key); expect(sealed[1]).toHaveLength(1);
  await page.getByLabel('Пароль', { exact: true }).fill(key); await page.getByRole('button', { name: 'Войти' }).click(); await navigate(page, 'Добавить'); await navigate(page, 'Траты'); await expect(page.getByText('Секрет очереди · 1 ₸')).toBeVisible(); expect((await storage(page))[0]).toHaveLength(1);
  await page.getByRole('button', { name: 'Убрать', exact: true }).click(); await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(page.getByText('Секрет очереди · 1 ₸')).toBeVisible();
  await page.getByRole('button', { name: 'Убрать', exact: true }).click(); expect((await storage(page))[0]).toHaveLength(1); await expect.poll(async () => (await storage(page))[0].length).toBe(0);
});
test('lost response after server commit retries same ID exactly once across two tabs', async ({ page, context, request }) => {
  await login(page); let id = ''; let committed = false;
  const sentIds: string[] = [];
  context.on('request', r => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/expenses') sentIds.push(r.postDataJSON().id);
  });
  await page.route('**/api/expenses', async r => { id = r.request().postDataJSON().id; const response = await r.fetch(); expect(response.status()).toBe(201); committed = true; await r.abort(); });
  await record(page); await expect.poll(() => committed).toBe(true); await page.unroute('**/api/expenses');
  const other = await context.newPage(); await other.goto('/');
  // Opening the other tab resumes the delayed entry without a button race.
  await expect.poll(async () => (await storage(page))[0].length).toBe(0);
  expect(sentIds).toEqual([id, id]);
  const b = await (await request.get('/api/bootstrap', { headers: { 'X-App-Key': await mockToken(request) } })).json(); expect(b.history.filter((e: { id: string }) => e.id === id)).toHaveLength(1);
});
test('200 queued records survive a closed tab and drain without duplicates', async ({ page, context, request }) => {
  await login(page); await context.setOffline(true);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('tenge-finance-v1'); r.onsuccess = () => resolve(r.result); });
    const config = await new Promise<{ owner: string }>(resolve => { const r = db.transaction('meta').objectStore('meta').get('config'); r.onsuccess = () => resolve(r.result); });
    const now = Date.now(); const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
    await new Promise<void>(resolve => { const tx = db.transaction('queue', 'readwrite'); for (let i = 0; i < 200; i++) { const id = `${now}-audit-long-${i}`; tx.objectStore('queue').put({ id, owner: config.owner, expense: { id, date, amount: 1, name: 'Длинная очередь', category: '🍔 Продукты и супермаркеты', comment: '', source: 'manual' }, status: 'queued', attempts: 0, nextAt: 0, created: now + i }); } tx.oncomplete = () => resolve(); }); db.close();
  });
  const other = await context.newPage(); await page.close(); await context.setOffline(false); await other.goto('/');
  await expect.poll(async () => (await storage(other))[0].length, { timeout: 30000 }).toBe(0);
  const b = await (await request.get('/api/bootstrap', { headers: { 'X-App-Key': await mockToken(request) } })).json(); const rows = b.history.filter((e: { id: string }) => e.id.includes('-audit-long-')); expect(rows).toHaveLength(200); expect(new Set(rows.map((e: { row: number }) => e.row)).size).toBe(200);
});
test('custom date survives midnight', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-12-31T18:30:00Z') }); await login(page); await page.getByLabel('Дата расхода').fill('2026-12-20'); await page.clock.setSystemTime(new Date('2026-12-31T19:30:00Z')); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(page.getByLabel('Дата расхода')).toHaveValue('2026-12-20');
  await page.getByRole('button', { name: 'Сегодня', exact: true }).click(); await expect(page.getByLabel('Дата расхода')).toHaveValue('2027-01-01');
});
test('dialog supports Escape and focus return', async ({ page }) => {
  await login(page); await navigate(page, 'Траты'); const row = page.locator('.expense-main').first(); await row.click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(row).toBeFocused();
});

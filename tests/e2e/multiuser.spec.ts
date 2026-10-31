import { test, expect, type Page } from '@playwright/test';
import { AccountsService } from '../../worker/src/accounts';
import { Api } from '../../worker/src/router';
import { MemoryOperations } from '../../worker/src/config-store';
import { MockSheetsAdapter } from '../../worker/src/mock-sheets';
import { MockPreparation, TablePreparation } from '../../worker/src/prepare-table';
import type { Env } from '../../worker/src/env';
// All credentials below are fictional fixtures. No request reaches a live Sheets adapter.
const password = 'fictional-browser-password', nextPassword = 'fictional-new-password';
async function fixture(page: Page, mustChange = false, linked = true) {
  const env: Env = { APP_KEY: password, ADMIN_TOKEN: 'fictional-browser-admin', USE_MOCK: '1', TZ: 'Asia/Almaty', CURRENCY: '₸', DUPLICATE_WINDOW_MIN: '3', SHEET_NAME_EXPENSES: 'Ввод данных', SHEET_NAME_DICT: 'Справочник', SHEET_NAME_INCOME: 'Доходы и расходы' };
  const actors = new Map<string, { api: Api; mock: MockSheetsAdapter }>(); let time = Date.now();
  env.COORDINATOR = { idFromName: name => name, get: id => ({ fetch: r => { if (!actors.has(String(id))) { const mock = new MockSheetsAdapter(), storage = new MemoryOperations(), prep = new TablePreparation(new MockPreparation(mock, env.SHEET_NAME_EXPENSES, r.headers.get('X-FT-Account') !== 'tarlan'), storage, env.SHEET_NAME_EXPENSES); actors.set(String(id), { mock, api: new Api({ ...env }, mock, storage, prep) }); } return actors.get(String(id))!.api.fetchAccount(r); } }) };
  const service = new AccountsService(new MemoryOperations(), env, () => time);
  const call = (path: string, body?: unknown, token = '', method = body ? 'POST' : 'GET') => service.fetch(new Request(`http://127.0.0.1:8787/api/${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-App-Key': token, Authorization: path.startsWith('admin/') ? 'Bearer fictional-browser-admin' : '' }, body: body ? JSON.stringify(body) : undefined }));
  await call('accounts'); await call('admin/add', { login: 'aru', displayName: 'Aru', password, mustChange }); if (linked) await call('admin/set-sheet', { login: 'aru', sheet: 'fictional-browser-aru-table' });
  await page.route('**/api/**', async route => { const r = route.request(), response = await service.fetch(new Request(r.url(), { method: r.method(), headers: r.headers(), body: r.postData() || undefined })); await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() }); });
  return { call, actors, advance: (ms: number) => { time += ms; } };
}
async function login(page: Page, name = 'tarlan', pw = password) { await page.getByLabel('Аккаунт', { exact: true }).selectOption(name); await page.getByLabel('Пароль', { exact: true }).fill(pw); await page.getByRole('button', { name: 'Войти', exact: true }).click(); }
async function account(page: Page) { await page.getByRole('navigation').getByRole('button', { name: 'Ещё', exact: true }).click(); await page.getByRole('button', { name: /^Аккаунт ·/ }).click(); }
async function change(page: Page, current = password) { await page.getByLabel('Текущий пароль', { exact: true }).fill(current); await page.getByLabel('Новый пароль', { exact: true }).fill(nextPassword); await page.getByLabel('Повторите пароль', { exact: true }).fill(nextPassword); await page.getByRole('button', { name: 'Сохранить пароль', exact: true }).click(); }
test('accounts: wrong password, lockout, forced change, unlinked table and remembered login', async ({ page }) => {
  const f = await fixture(page, true, false); await page.goto('/'); await expect(page.getByLabel('Аккаунт', { exact: true })).toHaveValue('tarlan');
  for (let i = 0; i < 5; i++) { await login(page, 'aru', 'fictional-wrong'); await expect(page.getByRole('alert')).toContainText(i < 4 ? 'Неверный логин или пароль' : '15 мин'); }
  f.advance(900001); await login(page, 'aru'); await expect(page.getByRole('heading', { name: 'Задайте свой пароль' })).toBeVisible(); await page.reload(); await expect(page.getByRole('heading', { name: 'Задайте свой пароль' })).toBeVisible();
  await change(page); await expect(page.getByRole('heading', { name: 'Таблица ещё не подключена' })).toBeVisible(); await page.getByRole('button', { name: 'Выйти', exact: true }).click(); await expect(page.getByLabel('Аккаунт', { exact: true })).toHaveValue('aru'); await page.reload(); await expect(page.getByLabel('Аккаунт', { exact: true })).toHaveValue('aru');
  await login(page, 'aru', nextPassword); await expect(page.getByRole('heading', { name: 'Таблица ещё не подключена' })).toBeVisible();
});
test('accounts: sessions, password change revokes others and reopen remembers session', async ({ page }) => {
  const f = await fixture(page); await page.goto('/'); await login(page); await expect(page.getByRole('heading', { name: 'Траты', exact: true })).toBeVisible();
  const other = await (await f.call('login', { login: 'tarlan', password })).json(); await account(page); await expect(page.getByText('Другое устройство', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Завершить сеанс' }).click(); await expect(page.getByText('Другое устройство', { exact: true })).toHaveCount(0); expect((await f.call('account', undefined, other.token)).status).toBe(401);
  const second = await (await f.call('login', { login: 'tarlan', password })).json(); await page.getByRole('button', { name: 'Сменить пароль', exact: true }).click(); await change(page); await expect(page.getByRole('heading', { name: 'Аккаунт', exact: true })).toBeVisible(); expect((await f.call('account', undefined, second.token)).status).toBe(401); await page.reload(); await expect(page.getByRole('heading', { name: 'Ещё', exact: true })).toBeVisible(); await expect(page.getByLabel('Пароль', { exact: true })).toHaveCount(0);
});
test('accounts: legacy queue migrates only to tarlan and sends once after another account', async ({ page }) => {
  const f = await fixture(page); await page.goto('/');
  await page.evaluate(async password => { localStorage.setItem('app-key', password); const owner = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)))].map(n => n.toString(16).padStart(2, '0')).join(''); const d = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('tenge-finance-v1', 1); r.onupgradeneeded = () => { r.result.createObjectStore('meta', { keyPath: 'id' }); r.result.createObjectStore('queue', { keyPath: 'id' }); }; r.onsuccess = () => resolve(r.result); }); await new Promise<void>(resolve => { const tx = d.transaction(['meta', 'queue'], 'readwrite'); tx.objectStore('meta').put({ id: 'config', key: password, owner }); tx.objectStore('queue').put({ id: '1793332800000-legacy-migration-test', owner, expense: { id: '1793332800000-legacy-migration-test', date: '2026-10-01', name: 'Старая очередь Tarlan', category: '🚗 Транспорт и такси', amount: 123, source: 'manual', comment: '' }, status: 'queued', attempts: 0, nextAt: 0, created: 1 }); tx.oncomplete = () => resolve(); }); d.close(); }, password);
  await page.reload(); await login(page, 'aru'); await expect(page.getByRole('button', { name: 'Подготовить таблицу' })).toBeVisible(); await page.getByRole('button', { name: 'Подготовить таблицу' }).click(); await expect(page.getByRole('heading', { name: 'Траты', exact: true })).toBeVisible(); await expect(page.getByText('Старая очередь Tarlan')).toHaveCount(0);
  await account(page); await page.getByRole('button', { name: 'Выйти', exact: true }).click(); await login(page); await expect(page.getByRole('heading', { name: 'Траты', exact: true })).toBeVisible();
  await expect.poll(() => [...f.actors.values()].find(a => a.mock.rows.some(r => r[1] === 'Старая очередь Tarlan'))?.mock.writes.length || 0).toBe(1); await page.reload(); await expect(page.getByRole('heading', { name: 'Траты', exact: true })).toBeVisible(); expect([...f.actors.values()].filter(a => a.mock.rows.some(r => r[1] === 'Старая очередь Tarlan'))).toHaveLength(1); expect([...f.actors.values()].find(a => a.mock.rows.some(r => r[1] === 'Старая очередь Tarlan'))!.mock.writes).toHaveLength(1);
});
test('accounts: deep link survives login reload and protected queue is isolated across accounts', async ({ page }) => {
  await fixture(page); await page.goto('/?amount=123&merchant=Очередь%20Tarlan&src=wallet'); await expect(page).toHaveURL(/\/$/); await page.reload(); await login(page); await expect(page.getByRole('heading', { name: 'Новый расход' })).toBeVisible(); await expect(page.getByLabel('Название', { exact: false }).first()).toHaveValue('Очередь Tarlan');
  await page.route('**/api/expenses', r => r.abort()); await page.getByRole('button', { name: '🍔 Продукты и супермаркеты', exact: true }).click(); await page.getByRole('button', { name: /^Сохранить ·/ }).click(); await page.getByRole('button', { name: 'Закрыть добавление' }).click(); await account(page); await page.getByRole('button', { name: 'Выйти', exact: true }).click(); await page.getByRole('button', { name: 'Выйти и защитить очередь' }).click(); await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
  const contents = await page.evaluate(async () => { const d = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('tenge-finance-v1'); r.onsuccess = () => resolve(r.result); }); const values = await Promise.all(['queue', 'meta'].map(s => new Promise(resolve => { const r = d.transaction(s).objectStore(s).getAll(); r.onsuccess = () => resolve(r.result); }))); d.close(); return JSON.stringify(values); }); expect(contents).not.toContain('Очередь Tarlan');
  await login(page, 'aru'); await page.getByRole('button', { name: 'Подготовить таблицу' }).click(); await expect(page.getByRole('heading', { name: 'Траты', exact: true })).toBeVisible(); await expect(page.getByText(/Очередь Tarlan/)).toHaveCount(0); await account(page); await page.getByRole('button', { name: 'Выйти', exact: true }).click(); await login(page); await expect(page.getByText('Очередь Tarlan · 123 ₸')).toBeVisible();
});
for (const width of [360, 412, 768, 1440]) test(`accounts: visual screens ${width}`, async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8787', viewport: { width, height: width > 412 ? 1024 : 915 }, deviceScaleFactor: 1, colorScheme: info.project.name === 'light' ? 'light' : 'dark', serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage(); await fixture(page); const shot = async (name: string) => { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `tests/screenshots/multiuser/${name}-${width}-${info.project.name}.png`, fullPage: true }); };
  try { await page.goto('/'); await expect(page.getByLabel('Аккаунт', { exact: true }).locator('option')).toHaveCount(2); await shot('login'); await login(page); await expect(page.getByRole('heading', { name: 'Траты', exact: true })).toBeVisible(); await account(page); await expect(page.getByText('Это устройство', { exact: true })).toBeVisible(); await shot('account'); await page.getByRole('button', { name: 'Сменить пароль', exact: true }).click(); await shot('password'); await page.getByRole('button', { name: '← Аккаунт' }).click(); await page.getByRole('button', { name: 'Выйти', exact: true }).click(); await login(page, 'aru'); await expect(page.getByRole('button', { name: 'Подготовить таблицу' })).toBeVisible(); await shot('prepare'); } finally { await context.close(); }
});

test('payment link leaves recovery actions available when bootstrap fails', async ({page}) => {
  await fixture(page);
  await page.route('**/api/bootstrap', route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Нет связи с таблицей'})}));
  await page.goto('/?amount=100&merchant=example');
  await login(page);
  await expect(page.getByRole('alert')).toContainText('Нет связи с таблицей');
  await page.getByRole('button',{name:'Обновить',exact:true}).click();
  await page.getByRole('button',{name:'Выйти',exact:true}).click();
  await expect(page.getByRole('button',{name:'Войти',exact:true})).toBeVisible();
});

test('relinking a sheet leaves an offline expense visible without sending it to the new journal', async ({page}) => {
  const fixtureApi = await fixture(page);
  await page.goto('/?amount=123&merchant=Старая%20покупка');
  await login(page);
  await page.route('**/api/expenses', route => route.abort());
  await page.getByRole('button', {name:'🍔 Продукты и супермаркеты',exact:true}).click();
  await page.getByRole('button', {name:/^Сохранить ·/}).click();
  await page.getByRole('button', {name:'Закрыть добавление'}).click();
  await expect(page.getByText('Старая покупка · 123 ₸')).toBeVisible();
  expect((await fixtureApi.call('admin/set-sheet', {login:'tarlan',sheet:'fictional-relinked-account-sheet'})).status).toBe(200);
  await page.unroute('**/api/expenses');
  await page.reload();
  await expect(page.getByRole('button', {name:'Войти',exact:true})).toBeVisible();
  await login(page);
  await expect(page.getByText(/Ошибка: Таблица была заменена/)).toBeVisible();
  expect([...fixtureApi.actors.values()].every(actor => actor.mock.writes.length === 0)).toBe(true);
});

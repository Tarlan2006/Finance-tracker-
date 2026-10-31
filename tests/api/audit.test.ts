import { beforeEach, expect, it } from 'vitest';
import { Api } from '../../worker/src/router';
import { MockSheetsAdapter } from '../../worker/src/mock-sheets';
import { today } from '../../shared/logic';
import type { Env } from '../../worker/src/env';
const env: Env = { APP_KEY: 'audit-test-code', USE_MOCK: '1', TZ: 'Asia/Almaty', CURRENCY: '₸', DUPLICATE_WINDOW_MIN: '3', SHEET_NAME_EXPENSES: 'Ввод данных', SHEET_NAME_DICT: 'Справочник', SHEET_NAME_INCOME: 'Доходы и расходы' };
let mock: MockSheetsAdapter, api: Api;
beforeEach(() => { mock = new MockSheetsAdapter(); api = new Api(env, mock); });
const input = () => ({ id: `${Date.now()}-${crypto.randomUUID()}`, date: today(env.TZ), amount: 1000, name: 'audit', category: '🍔 Продукты и супермаркеты', comment: '', source: 'manual' });
const req = (path: string, method = 'GET', body?: unknown) => api.fetch(new Request(`https://audit.test/api/${path}`, { method, headers: { 'X-App-Key': env.APP_KEY!, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' }, body: body ? JSON.stringify(body) : undefined }));
it('sheet_full: never writes beyond the formula range', async () => {
  for (let i = 1; i < 1006; i++) mock.rows[i] = [46325, '', 'еда', 1, '', mock.rows[i][5], '', ''];
  const r = await req('expenses', 'POST', input()); expect(r.status).toBe(422); expect((await r.json()).error).toBe('sheet_full'); expect(mock.writes).toHaveLength(0);
});
it.each(['name', 'comment', 'id'])('stale %s conflicts rather than overwrites', async field => {
  const { expense } = await (await req('expenses', 'POST', input())).json();
  mock.rows[expense.row - 1][{ name: 1, comment: 4, id: 6 }[field]!] = 'changed externally';
  const r = await req(`expenses/${expense.row}?fp=${encodeURIComponent(expense.fp)}`, 'DELETE');
  expect(r.status).toBe(409); expect(mock.writes).toHaveLength(1);
});
it('idempotent retry survives a category being removed', async () => {
  const body = input(); await req('expenses', 'POST', body); const read = mock.read.bind(mock); mock.read = async () => ({ ...await read(), categories: [] });
  const r = await req('expenses', 'POST', body); expect(r.status).toBe(200); expect((await r.json()).duplicate).toBe(true); expect(mock.writes).toHaveLength(1);
});
it('API responses carry security headers, including errors', async () => {
  for (const path of ['health', 'bootstrap', 'not-found', 'export.csv']) { const r = await req(path); expect(r.headers.get('Cache-Control')).toBe('no-store'); expect(r.headers.get('Referrer-Policy')).toBe('no-referrer'); expect(r.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'"); }
});
it('fingerprint detects manual text changes even beyond the display normalization', async () => {
  const { expense } = await (await req('expenses', 'POST', input())).json();
  mock.rows[expense.row - 1][1] = 'audit   ';
  expect((await req(`expenses/${expense.row}?fp=${encodeURIComponent(expense.fp)}`, 'DELETE')).status).toBe(409);
  expect(mock.writes).toHaveLength(1);
});

it('rejects changed payloads and retries after deletion', async () => {
  const body = input(), {expense} = await (await req('expenses','POST',body)).json();
  expect((await req('expenses','POST',{...body,amount:12})).status).toBe(409);
  expect((await req('expenses/'+expense.row,'DELETE',{fp:expense.fp})).status).toBe(200);
  expect((await req('expenses','POST',body)).status).toBe(409);
  expect(mock.writes).toHaveLength(2);
});

it('keeps healthy expenses visible and reports invalid dates', async () => {
  mock.rows[1][0] = 'BAD-DATE';
  const b = await (await req('bootstrap')).json();
  expect(b.invalidDateRows).toEqual([2]);
  expect(b.history).toHaveLength(59);
});

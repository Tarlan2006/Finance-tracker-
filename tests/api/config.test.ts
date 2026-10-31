import { beforeEach, expect, it, vi } from 'vitest';
import { Api } from '../../worker/src/router';
import { MockSheetsAdapter } from '../../worker/src/mock-sheets';
import { MemoryOperations, CATEGORY_SHEET, ITEM_SHEET, headers } from '../../worker/src/config-store';
import type { Env } from '../../worker/src/env';
import { activeItems, categoryLabel } from '../../shared/config';
import type { Config } from '../../shared/types';
const env: Env = { APP_KEY: 'config-test', USE_MOCK: '1', TZ: 'Asia/Almaty', CURRENCY: '₸', DUPLICATE_WINDOW_MIN: '3', SHEET_NAME_EXPENSES: 'Ввод данных', SHEET_NAME_DICT: 'Справочник', SHEET_NAME_INCOME: 'Доходы и расходы' };
let api: Api, mock: MockSheetsAdapter, operations: MemoryOperations;
beforeEach(() => { mock = new MockSheetsAdapter(); operations = new MemoryOperations(); api = new Api(env, mock, operations); });
const req = (path: string, body?: unknown, key = 'config-test') => api.fetch(new Request(`https://app.test/api/${path}`, { method: body ? 'POST' : 'GET', headers: { 'X-App-Key': key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }));
const setup = async (): Promise<Config> => (await req('config/setup', {})).json();
const op = () => crypto.randomUUID();
it('compatibility reads cached config without writes; setup is authenticated, idempotent and imports', async () => {
  const read = vi.spyOn(mock, 'readConfigTables'); expect((await req('config', undefined, 'wrong')).status).toBe(401);
  expect((await (await req('config')).json()).configured).toBe(false); await req('config'); expect(read).toHaveBeenCalledTimes(1); expect(mock.createdSheets).toEqual([]); expect(mock.configWrites).toEqual([]);
  const c = await setup(); expect(c.configured).toBe(true); expect(c.items).toHaveLength(8); expect(c.categories).toHaveLength(9); expect(activeItems(c.items, '2026-10').map(i => i.amount)).toEqual([200000, 60000, 730, 24000, 9000, 60000]);
  const saved = structuredClone(mock.tables); await setup(); expect(mock.tables).toEqual(saved); expect(mock.createdSheets).toEqual([CATEGORY_SHEET, ITEM_SHEET]); expect(mock.configWrites).toHaveLength(1); expect(mock.writes).toEqual([]);
});
it('recovers a partially created setup without overwriting existing IDs', async () => { mock.tables.categories = [headers[CATEGORY_SHEET], ['legacy-category-0', '🍎', 'Своя категория', 999, false, 0, 7, 'manual']]; const c = await setup(); expect(c.categories[0]).toMatchObject({ name: 'Своя категория', limit: 999, rev: 7 }); expect(mock.createdSheets).toEqual([ITEM_SHEET]); expect(c.categories).toHaveLength(9); });
it('dry rename writes nothing; stale rev returns 409; C-only change preserves all money, F and rows', async () => {
  const c = await setup(), cat = c.categories[0], before = structuredClone(mock.rows), writes = mock.configWrites.length;
  const body = { operationId: op(), rev: cat.rev, emoji: '🍎', name: 'Питание' };
  const count = before.filter(r => r[2] === categoryLabel(cat)).length;
  expect(await (await req(`config/categories/${cat.id}?dry=1`, body)).json()).toEqual({ count }); expect(mock.configWrites).toHaveLength(writes);
  const response = await req(`config/categories/${cat.id}`, body); expect(response.status).toBe(200);
  expect(mock.rows.map(r => r.filter((_, i) => i !== 2))).toEqual(before.map(r => r.filter((_, i) => i !== 2))); expect(mock.rows.filter(r => r[2] === '🍎 Питание')).toHaveLength(count);
  expect((await req(`config/categories/${cat.id}`, { ...body, operationId: op() })).status).toBe(409);
  expect((await req(`config/categories/${cat.id}`, body)).status).toBe(200); expect(mock.configWrites).toHaveLength(writes + 1);
});
it('durable pending plan resumes after partial C update and process restart', async () => {
  const c = await setup(), cat = c.categories[0], original = mock.applyConfig.bind(mock), body = { operationId: op(), rev: cat.rev, name: 'Новая еда' };
  mock.applyConfig = async plan => { const first = plan.moves[0]; mock.rows[first.row - 1][2] = first.to; throw new Error('network'); };
  expect((await req(`config/categories/${cat.id}`, body)).status).toBe(503);
  mock.applyConfig = original; api = new Api(env, mock, operations);
  expect((await req(`config/categories/${cat.id}`, body)).status).toBe(200); expect(mock.rows.some(r => r[2] === categoryLabel(cat))).toBe(false);
  expect(mock.rows[1][5]).toContain('ARRAYFORMULA'); expect(mock.rows).toHaveLength(1006);
});
it('reread rejects external category changes without touching the foreign value', async () => { const c = await setup(), cat = c.categories[0], original = mock.applyConfig.bind(mock); mock.applyConfig = async p => { mock.rows[p.moves[0].row - 1][2] = 'Изменено вручную'; return original(p); }; expect((await req(`config/categories/${cat.id}`, { operationId: op(), rev: 1, name: 'Питание' })).status).toBe(409); expect(mock.tables.categories![1][2]).toBe(cat.name); expect(mock.rows[1][2]).toBe('Изменено вручную'); });
it('archive, restore and transfer retain journal amounts and exclude quick hints', async () => {
  let c = await setup(); const cat = c.categories[0], before = (await mock.read()).rows.map(r => r[3]);
  const r = await req(`config/categories/${cat.id}`, { operationId: op(), rev: 1, archived: true }); c = (await r.json()).config;
  const b = await (await req('bootstrap')).json(); expect(b.categories.some((x: { name: string }) => x.name === categoryLabel(cat))).toBe(false); expect(b.history.some((x: { category: string }) => x.category === categoryLabel(cat))).toBe(true);
  const quick = await (await req('quick', { merchant: 'Magnum', amount: 100 })).json(); expect(quick.suggestion.category).not.toBe(categoryLabel(cat));
  expect((await req(`config/categories/${cat.id}`, { operationId: op(), rev: c.categories[0].rev, archived: false })).status).toBe(200);
  expect((await req(`config/categories/${cat.id}`, { operationId: op(), rev: 3, archived: true, targetId: c.categories[1].id })).status).toBe(200);
  expect(mock.rows.some(r => r[2] === categoryLabel(cat))).toBe(false); expect((await mock.read()).rows.map(r => r[3])).toEqual(before);
});
it('items: add, single-month change, removal and concurrent stale edit', async () => {
  await setup(); const added = await req('config/items', { operationId: op(), kind: 'income', name: 'Подработка', amount: '1000', month: '2026-10' }); expect(added.status).toBe(200);
  let c: Config = (await added.json()).config; const item = c.items.find(i => i.name === 'Подработка')!;
  const changed = await req(`config/items/${item.id}`, { operationId: op(), rev: 1, month: '2026-11', scope: 'month', amount: 2000 }); c = (await changed.json()).config;
  const amounts = (month: string) => activeItems(c.items, month).filter(i => i.name === item.name).map(i => i.amount);
  expect(amounts('2026-10')).toEqual([1000]); expect(amounts('2026-11')).toEqual([2000]); expect(amounts('2026-12')).toEqual([1000]);
  const next = activeItems(c.items, '2026-12').find(i => i.name === item.name)!;
  const responses = await Promise.all([req(`config/items/${next.id}`, { operationId: op(), rev: next.rev, month: '2026-12', remove: true }), req(`config/items/${next.id}`, { operationId: op(), rev: next.rev, month: '2026-12', amount: 3000 })]); expect(responses.map(r => r.status)).toEqual([200, 409]);
});
it.each([{ kind: 'income', name: '=BAD', amount: 1 }, { kind: 'wrong', name: 'Статья', amount: 1 }, { kind: 'income', name: 'Статья', amount: 0 }, { kind: 'income', name: 'Статья', amount: 100000001 }, { kind: 'income', name: 'Статья', amount: 1.001 }])('validates item %j before writing', async b => { await setup(); const before = structuredClone(mock.tables); expect((await req('config/items', { operationId: op(), month: '2026-10', ...b })).status).toBe(422); expect(mock.tables).toEqual(before); });
it('duplicate category, emoji and capacity errors never modify sheets', async () => { const c = await setup(), n = mock.configWrites.length; for (const b of [{ name: c.categories[0].name.toUpperCase() }, { name: 'Новая', emoji: 'xx' }, { name: 'Новая', limit: -1 }]) expect((await req('config/categories', { operationId: op(), ...b })).status).toBe(422); mock.tables.capacity[CATEGORY_SHEET] = 10; expect((await req('config/categories', { operationId: op(), name: 'Новая' })).status).toBe(422); expect(mock.configWrites).toHaveLength(n); });

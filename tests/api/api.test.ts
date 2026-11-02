import { beforeEach, describe, expect, it } from 'vitest';
import { Api } from '../../worker/src/router';
import { MockSheetsAdapter } from '../../worker/src/mock-sheets';
import type { Env } from '../../worker/src/env';
import type { Expense } from '../../shared/types';
import { today } from '../../shared/logic';
export const testEnv: Env = { APP_KEY: 'test-key-only', USE_MOCK: '1', TZ: 'Asia/Almaty', CURRENCY: '₸', DUPLICATE_WINDOW_MIN: '3', SHEET_NAME_EXPENSES: 'Ввод данных', SHEET_NAME_DICT: 'Справочник', SHEET_NAME_INCOME: 'Доходы и расходы' };
let api: Api, mock: MockSheetsAdapter;
beforeEach(() => { mock = new MockSheetsAdapter(); api = new Api(testEnv, mock); });
function request(path: string, method = 'GET', body?: unknown, key = 'test-key-only') { return api.fetch(new Request(`https://app.test/api/${path}`, { method, headers: { 'X-App-Key': key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })); }
const input = () => ({ id: `${Date.now()}-${crypto.randomUUID()}`, date: today('Asia/Almaty'), amount: 1200, category: '🍔 Продукты и супермаркеты', source: 'manual' });
describe('bulk expense changes', () => {
  async function targets() {
    const data = await (await request('bootstrap')).json();
    return (data.history as Expense[]).slice(0, 2).map(({ row, fp }) => ({ row, fp }));
  }
  const bulk = (body: unknown) => request('expenses/bulk', 'POST', body);
  it('changes only selected fields, including clearing comments, and preserves raw formulas and legacy IDs', async () => {
    mock.rows[1][6] = '';
    const before = structuredClone(mock.rows);
    const selected = await targets();
    expect((await bulk({ action: 'edit', targets: selected, patch: { name: 'Общее', comment: '' } })).status).toBe(200);
    for (const t of selected) { before[t.row - 1][1] = 'Общее'; before[t.row - 1][4] = ''; }
    expect(mock.rows).toEqual(before);
  });
  it.each(['edit','delete'])('stale fingerprint blocks the entire %s before the first write', async action => {
    const selected = await targets();
    mock.rows[selected[1].row - 1][4] = 'Изменение вручную';
    const r = await bulk({ action, targets: selected, patch: { amount: 1 } });
    expect(r.status).toBe(409); expect((await r.json()).error).toBe('conflict');
    expect(mock.writes).toEqual([]);
  });
  it('requires a fresh matching preview for category changes and previews never write', async () => {
    const selected = await targets();
    const data = await (await request('bootstrap')).json();
    const group = { action: 'edit', targets: selected, patch: { category: data.categories[1].name } };
    const preview = await (await request('expenses/bulk?dry=1', 'POST', group)).json();
    expect(typeof preview.previewHash).toBe('string');
    expect((await bulk(group)).status).toBe(409);
    expect((await bulk({ ...group, targets: selected.slice(1), previewHash: preview.previewHash })).status).toBe(409);
    expect(mock.writes).toEqual([]);
    expect((await bulk({ ...group, previewHash: preview.previewHash })).status).toBe(200);
    expect((await bulk({ ...group, previewHash: preview.previewHash })).status).toBe(409);
  });
  it('rejects malformed selections, forbidden fields and invalid new values without writing', async () => {
    const selected = await targets();
    for (const patch of [{}, { id: 'override' }, { amount: -5 }, { category: 'missing' }, { date: '3000-01-01' }])
      expect((await bulk({ action: 'edit', targets: selected, patch })).status).toBe(422);
    for (const bad of [[], [selected[0], selected[0]], [{ row: 1, fp: 'header' }]])
      expect((await bulk({ action: 'delete', targets: bad })).status).toBe(422);
    mock.rows[0][1] = '';
    expect((await bulk({ action: 'delete', targets: selected })).status).toBe(409);
    expect(mock.writes).toEqual([]);
  });
  it('confirms a lost batch clear response once and leaves every F cell and other row intact', async () => {
    const selected = await targets(), before = structuredClone(mock.rows);
    const clear = mock.clearMany.bind(mock); let calls = 0;
    mock.clearMany = async rows => { calls++; await clear(rows); throw new Error('lost response'); };
    const r = await bulk({ action: 'delete', targets: selected });
    expect(await r.json()).toEqual({ count: 2 }); expect(calls).toBe(1);
    for (const { row } of selected) before[row - 1] = ['', '', '', '', '', before[row - 1][5] ?? '', '', ''];
    expect(mock.rows).toEqual(before);
    expect((await bulk({ action: 'delete', targets: selected })).status).toBe(409);
    expect(calls).toBe(1);
  });
});
describe('API', () => {
  it('health требует ключ и не читает таблицу', async () => { mock.read = async () => { throw new Error(); }; expect((await request('health')).status).toBe(200); expect((await request('health', 'GET', undefined, 'wrong')).status).toBe(401); });
  it('10 ошибок, 429', async () => { for (let i = 0; i < 9; i++) expect((await request('health', 'GET', undefined, 'bad')).status).toBe(401); expect((await request('health', 'GET', undefined, 'bad')).status).toBe(429); expect((await request('health')).status).toBe(429); });
  it('bootstrap и пустые названия', async () => { const b = await (await request('bootstrap')).json(); expect(b.categories).toHaveLength(9); expect(b.history).toHaveLength(60); expect(b.expenses).toHaveLength(20); expect(b.expenses[0].amount).toBe(2666); expect(b.expenses[0].name).toBe(''); });
  it('добавляет в первую пустую строку, F и остальные листы неизменны', async () => { const f = mock.rows.map(r => r[5]), header = [...mock.rows[0]]; const before = await mock.read(); const res = await request('expenses', 'POST', input()); expect(res.status).toBe(201); const b = await res.json(); expect(b.expense.row).toBe(62); expect(mock.rows.map(r => r[5])).toEqual(f); expect(mock.rows[0]).toEqual(header); expect((await mock.read()).categories).toEqual(before.categories); expect(mock.writes).toEqual([{ row: 62, ranges: ['A62:E62', 'G62:H62'] }]); });
  it('параллельный повтор id создаёт ровно одну строку', async () => { const b = input(); const results = await Promise.all([request('expenses', 'POST', b), request('expenses', 'POST', b)]); expect(results.map(r => r.status).sort()).toEqual([200, 201]); expect(mock.writes).toHaveLength(1); expect((await results.find(r => r.status === 200)!.json()).duplicate).toBe(true); });
  it('разные параллельные расходы не перезаписывают друг друга', async () => { const results = await Promise.all(Array.from({ length: 8 }, () => request('expenses', 'POST', input()))); expect(results.every(r => r.status === 201)).toBe(true); expect(mock.writes.map(w => w.row)).toEqual([62, 63, 64, 65, 66, 67, 68, 69]); });
  it('старую строку без G можно править: ID назначается безопасно', async () => { mock.rows[1][6] = ''; const b = await (await request('bootstrap')).json(); const old = b.history[0]; const result = await request(`expenses/${old.row}`, 'PATCH', { fp: old.fp, name: 'Правка старой траты' }); expect(result.status).toBe(200); expect((await result.json()).expense.id).toMatch(/^\d{13}-/); });
  it('пустая A:D с оставшимся ID не перезаписывается', async () => { mock.rows[61][6] = 'orphan'; expect((await request('expenses', 'POST', input())).status).toBe(409); expect(mock.writes).toHaveLength(0); });
  it.each([{ amount: 0 }, { amount: 1.001 }, { amount: '1200' }, { category: 'неизвестная' }, { category: '' }, { date: '2099-01-01' }])('422 %j', async patch => expect((await request('expenses', 'POST', { ...input(), ...patch })).status).toBe(422));
  it.each(['legacy', 'native'])('checks A:H before reading or changing journal cells (%s)', async mode => {
    api = new Api({ ...testEnv, NATIVE_TABLE: mode === 'native' ? '1' : undefined }, mock);
    expect((await request('bootstrap')).status).toBe(200);
    const headers = [...mock.rows[0]];
    const swapped = [...headers];
    [swapped[1], swapped[4]] = [swapped[4], swapped[1]];
    mock.read = async () => { throw new Error('Journal values accessed before schema check'); };
    for (const invalid of [swapped, headers.slice(0, 7), ['', ...headers.slice(1)]]) {
      mock.rows[0] = invalid;
      for (const [path, method] of [['bootstrap','GET'], ['expenses','POST'], ['quick','POST'], ['expenses/2','PATCH'], ['expenses/2','DELETE'], ['config/categories/test','POST']]) {
        const response = await request(path, method);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ error: 'schema_mismatch', message: expect.stringContaining('A:H') });
      }
    }
    expect(mock.writes).toHaveLength(0);
    expect(mock.configWrites).toHaveLength(0);
  });
  it('правка/удаление с отпечатком, конфликт не пишет', async () => { const { expense: e } = await (await request('expenses', 'POST', input())).json(); expect((await request(`expenses/${e.row}`, 'PATCH', { fp: 'stale', amount: 2000 })).status).toBe(409); const updated = await (await request(`expenses/${e.row}`, 'PATCH', { fp: e.fp, amount: 2000 })).json(); expect(updated.expense.amount).toBe(2000); expect((await request(`expenses/${e.row}?fp=${encodeURIComponent(e.fp)}`, 'DELETE')).status).toBe(409); const f = mock.rows.map(r => r[5]); expect((await request(`expenses/${e.row}?fp=${encodeURIComponent(updated.expense.fp)}`, 'DELETE')).status).toBe(200); expect(mock.rows).toHaveLength(1006); expect(mock.rows.map(r => r[5])).toEqual(f); expect((await (await request('expenses', 'POST', input())).json()).expense.row).toBe(e.row); });
  it('quick: неопределённая категория требует проверки, retry безопасен', async () => { const b = { id: input().id, amount: 900, merchant: 'Новый магазин', src: 'kaspi', save: true }; const r = await (await request('quick', 'POST', b)).json(); expect(r.expense.category).toBe(''); expect(r.expense.source).toBe('kaspi-auto'); expect((await (await request('quick', 'POST', b)).json()).duplicate).toBe(true); });
  it('csv UTF-8 BOM', async () => { const r = await request('export.csv'); expect(r.headers.get('Content-Type')).toContain('text/csv'); const bytes = new Uint8Array(await r.arrayBuffer()); expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]); });
  it('чужой origin запрещён', async () => expect((await api.fetch(new Request('https://app.test/api/health', { headers: { Origin: 'https://evil.test', 'X-App-Key': 'test-key-only' } }))).status).toBe(403));
});

describe('целостность данных', () => {
  it('правка комментария сохраняет исходную формулу суммы', async () => {
    const { history } = await (await request('bootstrap')).json();
    expect((await request('expenses/2', 'PATCH', { fp: history[0].fp, comment: 'Заметка' })).status).toBe(200);
    expect(mock.rows[1][3]).toBe(mock.formulaAmount);
    expect(mock.writes[0].ranges).toEqual(['E2']);
  });
  it('защищает ручной комментарий в первой свободной строке', async () => {
    mock.rows[61][4] = 'Заметка';
    expect((await request('expenses','POST',input())).status).toBe(409);
    expect(mock.rows[61][4]).toBe('Заметка');
  });
});

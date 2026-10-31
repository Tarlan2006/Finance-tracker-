import { beforeAll, expect, it } from 'vitest';
import { GoogleSheetsAdapter } from '../../worker/src/google-sheets';
import { ConfigApi } from '../../worker/src/config-api';
import { CATEGORY_SHEET, ITEM_SHEET, headers } from '../../worker/src/config-store';
import { MockSheetsAdapter } from '../../worker/src/mock-sheets';
import type { Env } from '../../worker/src/env';
import type { Row } from '../../shared/types';
let credentials: string;
beforeAll(async () => { const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']); credentials = JSON.stringify({ client_email: 'adapter@example.invalid', private_key: `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----` }); });
function fixture() {
  const mock = new MockSheetsAdapter(), tables = new Map<string, Row[]>(), structural: unknown[] = [], writes: string[] = [], reads: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test', expires_in: 3600 });
    if (url.pathname.endsWith('/fixture') && !init?.method) return Response.json({ sheets: [...tables.keys()].map(title => ({ properties: { title, gridProperties: { rowCount: 1006 } } })) });
    if (url.pathname.endsWith('/fixture:batchUpdate')) { const body = JSON.parse(String(init?.body)); for (const r of body.requests) { expect(Object.keys(r)).toEqual(['addSheet']); expect([CATEGORY_SHEET, ITEM_SHEET]).toContain(r.addSheet.properties.title); if (tables.has(r.addSheet.properties.title)) return Response.json({}, { status: 400 }); tables.set(r.addSheet.properties.title, []); structural.push(r); } return Response.json({}); }
    if (url.pathname.endsWith('/values:batchGet')) {
      const ranges = url.searchParams.getAll('ranges'); reads.push(...ranges);
      const legacy = await mock.readLegacyItems(), snapshot = await mock.read();
      return Response.json({ valueRanges: ranges.map(range => ({ values: range === "'Ввод данных'!A:H" || range === "'Ввод данных'!A1:H1006" ? snapshot.rows : range === "'Справочник'!A3:B" ? snapshot.categories.map(c => [c.name, c.limit]) : range.endsWith('!A3:D') ? legacy.income : range.endsWith('!F3:K') ? legacy.fixed : range.endsWith('!M3:S') ? [] : tables.get(range.split("'")[1]) || [] })) });
    }
    if (url.pathname.endsWith('/values:batchUpdate')) {
      const body = JSON.parse(String(init?.body)); expect(body.valueInputOption).toBe('RAW');
      for (const d of body.data) {
        const match = d.range.match(/^'(FT Categories|FT Items)'!A(\d+):H\2$/), cell = d.range.match(/^'Ввод данных'!C(\d+)$/);
        expect(!!match || !!cell, `Forbidden range ${d.range}`).toBe(true); writes.push(d.range);
        if (match) tables.get(match[1])![Number(match[2]) - 1] = d.values[0]; else mock.rows[Number(cell[1]) - 1][2] = d.values[0][0];
      }
      return Response.json({});
    }
    throw new Error(`Forbidden request ${url.pathname}`);
  };
  const env: Env = { GOOGLE_SERVICE_ACCOUNT_JSON: credentials, SHEET_ID: 'fixture', TZ: 'Asia/Almaty', CURRENCY: '₸', DUPLICATE_WINDOW_MIN: '3', SHEET_NAME_DICT: 'Справочник', SHEET_NAME_INCOME: 'Доходы и расходы', SHEET_NAME_EXPENSES: 'Ввод данных' };
  const adapter = new GoogleSheetsAdapter(env, fetcher);
  return { adapter, api: new ConfigApi(adapter), mock, tables, writes, structural, reads };
}
it('Google settings setup and rename issue only whitelisted requests and preserve F', async () => {
  const f = fixture(), before = structuredClone(f.mock.rows), c = await f.api.setup();
  expect(f.structural).toHaveLength(2); expect(f.tables.get(CATEGORY_SHEET)![0]).toEqual(headers[CATEGORY_SHEET]); expect(f.tables.get(ITEM_SHEET)![0]).toEqual(headers[ITEM_SHEET]);
  const writeCount = f.writes.length; await f.api.setup(); expect(f.writes).toHaveLength(writeCount);
  const cat = c.categories[0], body = { operationId: crypto.randomUUID(), rev: 1, name: 'Новое название', emoji: '🍎' };
  const preview = await f.api.mutate(`/api/config/categories/${cat.id}`, body, true); expect(preview.count).toBeGreaterThan(0); expect(f.writes).toHaveLength(writeCount);
  await f.api.mutate(`/api/config/categories/${cat.id}`, {...body, previewHash: preview.previewHash}, false);
  expect(f.writes.slice(writeCount).filter(r => r.startsWith("'Ввод данных'"))).toHaveLength(preview.count);
  expect(f.mock.rows.map(r => r.filter((_, i) => i !== 2))).toEqual(before.map(r => r.filter((_, i) => i !== 2)));
  expect(f.mock.rows).toHaveLength(1006); expect(f.reads).toContain("'Ввод данных'!A1:H1006");
});
it('Google resumes a single precreated sheet and never replaces existing settings', async () => { const f = fixture(); f.tables.set(ITEM_SHEET, []); const c = await f.api.setup(); expect(f.structural).toHaveLength(1); expect(c.configured).toBe(true); expect(c.items).toHaveLength(8); });
it('Google refuses stale settings and foreign C values before a write', async () => { const f = fixture(); await f.api.setup(); const before = structuredClone(f.tables.get(CATEGORY_SHEET)![1]), after = [...before]; after[2] = 'Changed'; after[6] = 2; f.mock.rows[1][2] = 'External'; const count = f.writes.length; await expect(f.adapter.applyConfig({ writes: [{ sheet: CATEGORY_SHEET, row: 2, before, after }], moves: [{ row: 2, from: '🍔 Продукты и супермаркеты', to: '🍎 Changed' }] })).rejects.toThrow('Настройки изменились'); expect(f.writes).toHaveLength(count); });

it('rejects a replacement expense with the same category', async () => {
  const f = fixture(), config = await f.api.setup(), c = config.categories[0];
  const apply = f.adapter.applyConfig.bind(f.adapter);
  f.adapter.applyConfig = plan => {
    f.mock.rows[1][6] = 'replacement';
    return apply(plan);
  };
  const count = f.writes.length;
  const path = '/api/config/categories/'+c.id, body = {operationId:crypto.randomUUID(), rev:c.rev, name:'Новое'};
  const preview = await f.api.mutate(path, body, true);
  await expect(f.api.mutate(path, {...body, previewHash:preview.previewHash}, false)).rejects.toThrow('Настройки изменились');
  expect(f.writes).toHaveLength(count);
});

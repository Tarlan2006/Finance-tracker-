import { expect, it } from 'vitest';
import { GooglePreparation, TablePreparation, MONTH_FORMULA } from '../../worker/src/prepare-table';
import { MemoryOperations } from '../../worker/src/config-store';
import { GoogleSheetsAdapter } from '../../worker/src/google-sheets';
import type { Env } from '../../worker/src/env';
it('Google preparation is an owned atomic batch; retry after lost reply never overwrites initialized cells', async () => {
  const key = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const credentials = JSON.stringify({ client_email: 'prepare@example.invalid', private_key: `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', key.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----` });
  const env: Env = { GOOGLE_SERVICE_ACCOUNT_JSON: credentials, SHEET_ID: 'fictional-sheet-id', NATIVE_TABLE: '1', TZ: 'Asia/Almaty', CURRENCY: '₸', DUPLICATE_WINDOW_MIN: '3', SHEET_NAME_EXPENSES: 'Ввод данных', SHEET_NAME_DICT: 'Справочник', SHEET_NAME_INCOME: 'Доходы и расходы' };
  const sheets: { properties: { sheetId: number; title: string; gridProperties: { rowCount: number; columnCount: number } }; header?: unknown[] }[] = []; const requests: Record<string, unknown>[] = [], reads: string[] = []; let loseReply = true;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'fictional-test-token', expires_in: 3600 });
    if (url.pathname.endsWith(':batchUpdate')) { const b = JSON.parse(String(init?.body)); if (!b.requests) return Response.json({}); if (b.requests.some((r: { addSheet?: { properties: { sheetId: number } } }) => r.addSheet && sheets.some(s => s.properties.sheetId === r.addSheet!.properties.sheetId))) return Response.json({}, { status: 400 }); for (const r of b.requests) { requests.push(r); if (r.addSheet) { expect(r.addSheet.properties.gridProperties.rowCount).toBe(1006); sheets.push({ properties: r.addSheet.properties }); } if (r.updateCells?.start.rowIndex === 0) sheets.find(s => s.properties.sheetId === r.updateCells.start.sheetId)!.header = r.updateCells.rows[0].values.map((v: { userEnteredValue: { stringValue: string } }) => v.userEnteredValue.stringValue); }
      if (loseReply) { loseReply = false; throw new Error('fictional connection lost after commit'); } return Response.json({}); }
    if (url.pathname.endsWith('values:batchGet')) { const ranges = url.searchParams.getAll('ranges'); reads.push(...ranges); return Response.json({ valueRanges: ranges.map(r => ({ values: r.endsWith('A1:H1') ? [sheets.find(s => r.includes(s.properties.title))!.header] : [] })) }); }
    return Response.json({ sheets });
  };
  const store = new MemoryOperations(), prep = new TablePreparation(new GooglePreparation(env, fetcher), store, env.SHEET_NAME_EXPENSES);
  await expect(prep.prepare()).rejects.toThrow(); const count = requests.length; await prep.prepare(); await prep.prepare(); expect(requests).toHaveLength(count); expect(sheets).toHaveLength(3);
  expect(JSON.stringify(requests)).toContain(JSON.stringify(MONTH_FORMULA)); expect(requests.every(r => ['addSheet', 'updateCells', 'repeatCell'].includes(Object.keys(r)[0]))).toBe(true); expect(JSON.stringify(requests)).not.toMatch(/deleteDimension|insertDimension|append|Дашборд|Справочник|Доходы и расходы/);
  const adapter = new GoogleSheetsAdapter(env, fetcher); await adapter.read(false); expect(reads.at(-1)).toBe("'Ввод данных'!A:H"); expect(reads.some(r => /Справочник|Доходы и расходы/.test(r))).toBe(false);
  await expect(new TablePreparation(new GooglePreparation(env, fetcher), new MemoryOperations(), env.SHEET_NAME_EXPENSES).prepare()).rejects.toThrow('уже есть'); expect(requests).toHaveLength(count);
});

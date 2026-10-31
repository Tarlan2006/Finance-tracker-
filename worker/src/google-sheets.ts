import { AppError, clean, serialDate } from '../../shared/logic';
import type { Category, ExpenseInput, Row, Snapshot, Summary } from '../../shared/types';
import type { Env } from './env';
import { GoogleAuth, retryFetch } from './google-auth';
import { checkExpenseHeaders, expenseColumns, type SheetsAdapter } from './sheets';
import { CATEGORY_SHEET, ITEM_SHEET, verifyPlan, type ConfigPlan, type ConfigTables } from './config-store';
export const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;
export class GoogleSheetsAdapter implements SheetsAdapter {
  private auth: GoogleAuth;
  private catalog?: { until: number; sheets: { properties: {sheetId: number; title: string; gridProperties: {rowCount: number}} }[] };
  private journal?: { until: number; ranges: Map<string, Row[]>; configured?: boolean };
  private active?: Map<string, Row[]>;
  private header?: { until: number; row: Row };
  private categories?: { items: Category[]; until: number };
  constructor(private env: Env, private fetcher: typeof fetch = fetch) { this.auth = new GoogleAuth(env.GOOGLE_SERVICE_ACCOUNT_JSON || '', fetcher); }
  private async request(path: string, init: RequestInit = {}) {
    if (!this.env.SHEET_ID) throw new AppError(503, 'configuration', 'SHEET_ID не настроен');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.env.SHEET_ID)}${/^[?:]/.test(path) ? '' : '/'}${path}`;
    const call = async () => {
      const options = { ...init, headers: { Authorization: `Bearer ${await this.auth.token()}`, 'Content-Type': 'application/json' } };
      // Retry reads. A mutation with an ambiguous outcome must start again at the row check.
      if (init.method === 'POST') return this.fetcher(url, { ...options, signal: AbortSignal.timeout(15000) });
      return retryFetch(this.fetcher, url, options);
    };
    if (init.method === 'POST') this.invalidate(path === ':batchUpdate');
    const response = await call();
    if (response.status === 401) this.auth.invalidate();
    if (response.status === 403) throw new AppError(403, 'sheets_access', 'Нет доступа к Google Sheets. Проверьте права сервисного аккаунта');
    if (response.status === 429) throw new AppError(429, 'rate_limit', 'Google Sheets ограничил частоту запросов. Повторите позже');
    if (!response.ok) throw new AppError(503, 'sheets', 'Google Sheets недоступен. Проверьте доступ сервисного аккаунта и названия листов');
    return response.json() as Promise<{ valueRanges?: { values?: Row[] }[]; sheets?: { properties: { sheetId: number; title: string; gridProperties: { rowCount: number } } }[] }>;
  }
  invalidate(structure = false) {
    this.journal = undefined;
    this.active = undefined;
    if (structure) { this.catalog = undefined; this.header = undefined; this.categories = undefined; }
  }
  finishRequest() { this.active = undefined; }
  async primeJournal(readOnly: boolean, configured?: boolean) {
    if (readOnly && this.journal && this.journal.until > Date.now() && (this.journal.configured === configured || this.journal.configured === undefined)) {
      this.active = this.journal.ranges;
      return;
    }
    const native = this.env.NATIVE_TABLE === '1';
    const journal = quoteSheet(this.env.SHEET_NAME_EXPENSES) + '!A:H';
    const income = quoteSheet(this.env.SHEET_NAME_INCOME);
    const ranges = [journal];
    if (!native) ranges.push(income + '!M3:S');
    if (configured === undefined) {
      const names = (await this.metadata()).map(s => s.properties.title);
      for (const name of [CATEGORY_SHEET, ITEM_SHEET]) if (names.includes(name)) ranges.push(quoteSheet(name) + '!A:H');
      if (!native && names.includes(this.env.SHEET_NAME_INCOME)) ranges.push(income + '!A3:D', income + '!F3:K');
      if (!native && names.includes(this.env.SHEET_NAME_DICT)) ranges.push(quoteSheet(this.env.SHEET_NAME_DICT) + '!A3:B');
    } else if (!native && !configured && (!this.categories || this.categories.until <= Date.now())) {
      ranges.push(quoteSheet(this.env.SHEET_NAME_DICT) + '!A3:B');
    }
    const result = await this.values(ranges);
    this.active = new Map(ranges.map((r,i) => [r, result[i]?.values || []]));
    const row = this.active.get(journal)?.[0] || [];
    checkExpenseHeaders(row);
    this.header = {until: Date.now()+120000, row};
    if (readOnly) this.journal = {until:Date.now()+15000, ranges:this.active, configured};
  }
  async read(legacy = true): Promise<Snapshot> {
    const needsDict = legacy && (!this.categories || this.categories.until <= Date.now());
    const ranges = [`${quoteSheet(this.env.SHEET_NAME_EXPENSES)}!A:H`];
    if (this.env.NATIVE_TABLE !== '1') ranges.push(`${quoteSheet(this.env.SHEET_NAME_INCOME)}!M3:S`);
    if (needsDict) ranges.push(`${quoteSheet(this.env.SHEET_NAME_DICT)}!A3:B`);
    const values = await this.values(ranges);
    if (needsDict) {
      const items: Category[] = [];
      for (const row of values[2]?.values || []) {
        const name = clean(row[0]);
        if (!name || /итого/i.test(name)) break;
        const limit = Number(row[1]);
        items.push({ name, limit: Number.isFinite(limit) && limit > 0 ? limit : 0 });
      }
      if (!items.length) throw new AppError(422, 'categories', 'Справочник категорий пуст');
      this.categories = { items, until: Date.now() + 300000 };
    }
    const summaries: Summary[] = (values[1]?.values || []).flatMap(row => {
      const month = clean(row[0]);
      if (!/^\d{4}-\d{2}$/.test(month)) return [];
      // A missing/broken formula is not a legitimate zero income.
      if (row.slice(1, 7).length < 6 || row.slice(1, 7).some(x => typeof x !== 'number' || !Number.isFinite(x))) return [];
      return [{ month, income: Number(row[1]), fixed: Number(row[2]), journal: Number(row[3]), total: Number(row[4]), balance: Number(row[5]), savings: Number(row[6]) }];
    });
    return { rows: values[0]?.values || [], categories: legacy ? this.categories!.items : [], summaries };
  }
  private ranges(row: number) {
    if (!Number.isSafeInteger(row) || row < 2) throw new AppError(422, 'row', 'Нельзя менять заголовки');
    const sheet = quoteSheet(this.env.SHEET_NAME_EXPENSES);
    return [`${sheet}!A${row}:E${row}`, `${sheet}!G${row}:H${row}`];
  }
  async readHeaders(cached = false) {
    const rows = this.active?.get(quoteSheet(this.env.SHEET_NAME_EXPENSES) + '!A:H');
    if (rows) return rows[0] || [];
    if (cached && this.header && this.header.until > Date.now()) return this.header.row;
    const range = quoteSheet(this.env.SHEET_NAME_EXPENSES) + '!A1:H1';
    return (await this.values([range]))[0]?.values?.[0] || [];
  }
  async readRow(row: number) {
    this.ranges(row);
    const range = quoteSheet(this.env.SHEET_NAME_EXPENSES) + '!A' + row + ':H' + row;
    return (await this.values([range]))[0]?.values?.[0] || [];
  }
  async write(row: number, e: ExpenseInput, previous?: ExpenseInput) {
    const [first, last] = this.ranges(row);
    if (previous) {
      const data = expenseColumns.flatMap((key, index) => {
        if (!key || previous[key] === e[key]) return [];
        const cell = String.fromCharCode(65 + index) + row;
        return [{ range: quoteSheet(this.env.SHEET_NAME_EXPENSES) + '!' + cell, values: [[key === 'date' ? serialDate(e.date) : e[key]]] }];
      });
      if (data.length) await this.request('values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
      return;
    }
    // RAW preserves text verbatim and the numeric Sheets date serial; never evaluates user strings.
    await this.request('values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: [{ range: first, values: [[serialDate(e.date), e.name, e.category, e.amount, e.comment]] }, { range: last, values: [[e.id, e.source]] }] }) });
  }
  async clear(row: number) { await this.request('values:batchClear', { method: 'POST', body: JSON.stringify({ ranges: this.ranges(row) }) }); }
  async metadata(fresh = false) {
    if (!fresh && this.catalog && this.catalog.until > Date.now()) return this.catalog.sheets;
    const sheets = (await this.request('?fields=sheets.properties(sheetId,title,gridProperties.rowCount)')).sheets || [];
    this.catalog = {until: Date.now()+120000, sheets};
    return sheets;
  }
  private async values(ranges: string[]) {
    const active = this.active;
    if (active && ranges.every(r => active.has(r))) return ranges.map(r => ({values:active.get(r)}));
    const query = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }); ranges.forEach(r => query.append('ranges', r)); return (await this.request(`values:batchGet?${query}`)).valueRanges || []; }
  async readConfigTables(): Promise<ConfigTables> {
    const sheets = await this.metadata(), names = [CATEGORY_SHEET, ITEM_SHEET] as const, existing = names.filter(name => sheets.some(s => s.properties.title === name));
    const values = existing.length ? await this.values(existing.map(n => `${quoteSheet(n)}!A:H`)) : [];
    return { categories: existing.includes(CATEGORY_SHEET) ? values[existing.indexOf(CATEGORY_SHEET)]?.values || [] : null, items: existing.includes(ITEM_SHEET) ? values[existing.indexOf(ITEM_SHEET)]?.values || [] : null, capacity: { [CATEGORY_SHEET]: sheets.find(s => s.properties.title === CATEGORY_SHEET)?.properties.gridProperties.rowCount || 1006, [ITEM_SHEET]: sheets.find(s => s.properties.title === ITEM_SHEET)?.properties.gridProperties.rowCount || 1006 } };
  }
  async readLegacyItems() { const values = await this.values([`${quoteSheet(this.env.SHEET_NAME_INCOME)}!A3:D`, `${quoteSheet(this.env.SHEET_NAME_INCOME)}!F3:K`]); return { income: values[0]?.values || [], fixed: values[1]?.values || [] }; }
  async createConfigSheets() {
    const sheets = await this.metadata(true);
    const requests = [CATEGORY_SHEET, ITEM_SHEET].filter(name => !sheets.some(s => s.properties.title === name)).map(title => ({ addSheet: { properties: { title, gridProperties: { rowCount: 1006, columnCount: 8 } } } }));
    if (requests.length) { try { await this.request(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) }); } catch (error) { const after = await this.metadata(); if (![CATEGORY_SHEET, ITEM_SHEET].every(n => after.some(s => s.properties.title === n))) throw error; } }
  }
  async applyConfig(plan: ConfigPlan) {
    const tables = await this.readConfigTables();
    const journal = plan.moves.length ? (await this.values([`${quoteSheet(this.env.SHEET_NAME_EXPENSES)}!A1:H1006`]))[0]?.values || [] : [];
    await verifyPlan(plan, tables, journal);
    const data = [...plan.moves.filter(m => journal[m.row - 1]?.[2] === m.from).map(m => ({ range: `${quoteSheet(this.env.SHEET_NAME_EXPENSES)}!C${m.row}`, values: [[m.to]] })), ...plan.writes.map(w => ({ range: `${quoteSheet(w.sheet)}!A${w.row}:H${w.row}`, values: [w.after] }))];
    // One atomic RAW request: journal C and settings revisions commit together.
    if (data.length) await this.request('values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
  }
}

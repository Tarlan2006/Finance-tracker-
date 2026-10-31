import { AppError } from '../../shared/logic';
import type { Row } from '../../shared/types';
import { CATEGORY_SHEET, ITEM_SHEET, headers, type OperationStorage } from './config-store';
import type { Env } from './env';
import { GoogleAuth, retryFetch } from './google-auth';
import type { MockSheetsAdapter } from './mock-sheets';
export const EXPENSE_HEADERS = ['Дата', 'Название расхода', 'Категория', 'Сумма (₸)', 'Комментарий', 'Месяц', 'ID', 'Источник'];
export const MONTH_FORMULA = '=ARRAYFORMULA(IF(A2:A1006="","",TEXT(A2:A1006,"yyyy-mm")))';
export const STARTER_CATEGORIES = [['🥦', 'Продукты'], ['☕', 'Кафе и рестораны'], ['🚗', 'Транспорт'], ['💊', 'Здоровье'], ['🛍️', 'Покупки и одежда'], ['🎬', 'Развлечения'], ['🎁', 'Подарки'], ['📦', 'Прочее']];
interface Sheet { id: number; title: string }
interface Plan { sheets: Sheet[]; categories: Row[]; done: boolean }
export interface PreparationBackend { sheets(): Promise<Sheet[]>; create(plan: Plan, missing: Sheet[]): Promise<void>; valid(plan: Plan): Promise<boolean> }
export class TablePreparation {
  constructor(private backend: PreparationBackend, private storage: OperationStorage, private expenseName: string) {}
  async status() { const plan = await this.storage.get<Plan>('table-preparation'); const sheets = await this.backend.sheets(); if (plan?.done) return { ready: sheets.some(s => s.title === this.expenseName), native: true }; return { ready: !plan && sheets.some(s => s.title === this.expenseName), native: !!plan }; }
  async prepare() {
    const sheets = await this.backend.sheets(), names = [this.expenseName, CATEGORY_SHEET, ITEM_SHEET];
    let plan = await this.storage.get<Plan>('table-preparation');
    if (!plan) {
      if (sheets.some(s => names.includes(s.title))) throw new AppError(409, 'already_initialized', 'В таблице уже есть лист расходов или служебные листы. Подготовка ничего не изменила');
      const used = new Set(sheets.map(s => s.id));
      const planned = names.map(title => { let id: number; do { id = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff; } while (used.has(id)); used.add(id); return { title, id }; });
      const time = new Date().toISOString();
      plan = { sheets: planned, categories: [headers[CATEGORY_SHEET], ...STARTER_CATEGORIES.map(([emoji, name], i) => [crypto.randomUUID(), emoji, name, 0, false, i, 1, time])], done: false };
      // Persist ownership before any structural operation. Other sheets are never renamed/deleted.
      await this.storage.put('table-preparation', plan);
    }
    if (plan.done) return { ok: true, alreadyPrepared: true };
    for (const p of plan.sheets) if (sheets.some(s => s.title === p.title && s.id !== p.id || s.id === p.id && s.title !== p.title)) throw new AppError(409, 'prepare_conflict', 'Структура таблицы изменилась. Обратитесь к администратору');
    const missing = plan.sheets.filter(p => !sheets.some(s => s.id === p.id));
    if (missing.length) await this.backend.create(plan, missing);
    if (!await this.backend.valid(plan)) throw new AppError(409, 'prepare_conflict', 'Подготовленные листы изменились. Автоматическая перезапись запрещена');
    await this.storage.put('table-preparation', { ...plan, done: true });
    return { ok: true, alreadyPrepared: false };
  }
}
export class GooglePreparation implements PreparationBackend {
  private auth: GoogleAuth;
  constructor(private env: Env, private fetcher: typeof fetch = fetch) { this.auth = new GoogleAuth(env.GOOGLE_SERVICE_ACCOUNT_JSON || '', fetcher); }
  private async request(suffix: string, init: RequestInit = {}) { const r = await retryFetch(this.fetcher, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.env.SHEET_ID || '')}${suffix}`, { ...init, headers: { Authorization: `Bearer ${await this.auth.token()}`, 'Content-Type': 'application/json' } }); if (!r.ok) throw new AppError(503, 'sheets', 'Не удалось подготовить таблицу. Проверьте доступ и повторите'); return r.json(); }
  async sheets(): Promise<Sheet[]> { const b = await this.request('?fields=sheets.properties(sheetId,title)'); return (b.sheets || []).map((s: { properties: { sheetId: number; title: string } }) => ({ id: s.properties.sheetId, title: s.properties.title })); }
  async create(plan: Plan, missing: Sheet[]) {
    const requests: unknown[] = [];
    for (const sheet of missing) {
      const rows = sheet.title === this.env.SHEET_NAME_EXPENSES ? [EXPENSE_HEADERS] : sheet.title === CATEGORY_SHEET ? plan.categories : [headers[ITEM_SHEET]];
      requests.push({ addSheet: { properties: { sheetId: sheet.id, title: sheet.title, gridProperties: { rowCount: 1006, columnCount: 8, frozenRowCount: 1 } } } });
      requests.push({ updateCells: { start: { sheetId: sheet.id, rowIndex: 0, columnIndex: 0 }, rows: rows.map(row => ({ values: row.map(value => ({ userEnteredValue: typeof value === 'number' ? { numberValue: value } : typeof value === 'boolean' ? { boolValue: value } : { stringValue: String(value) } })) })), fields: 'userEnteredValue' } });
      if (sheet.title === this.env.SHEET_NAME_EXPENSES) {
        requests.push({ updateCells: { start: { sheetId: sheet.id, rowIndex: 1, columnIndex: 5 }, rows: [{ values: [{ userEnteredValue: { formulaValue: MONTH_FORMULA } }] }], fields: 'userEnteredValue' } });
        for (const [column, type, pattern] of [[0, 'DATE', 'dd.mm.yyyy'], [3, 'NUMBER', '#,##0.00']] as const) requests.push({ repeatCell: { range: { sheetId: sheet.id, startRowIndex: 1, endRowIndex: 1006, startColumnIndex: column, endColumnIndex: column + 1 }, cell: { userEnteredFormat: { numberFormat: { type, pattern } } }, fields: 'userEnteredFormat.numberFormat' } });
      }
    }
    // Google applies this batch atomically. A lost response is recovered by owned sheet IDs.
    await this.request(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
  }
  async valid(plan: Plan) { const sheets = await this.sheets(); if (!plan.sheets.every(p => sheets.some(s => s.id === p.id && s.title === p.title))) return false; const query = new URLSearchParams(); plan.sheets.forEach(s => query.append('ranges', `'${s.title.replace(/'/g, "''")}'!A1:H1`)); const b = await this.request(`/values:batchGet?${query}`); return plan.sheets.every((s, i) => JSON.stringify(b.valueRanges?.[i]?.values?.[0]) === JSON.stringify(s.title === this.env.SHEET_NAME_EXPENSES ? EXPENSE_HEADERS : headers[s.title as typeof CATEGORY_SHEET | typeof ITEM_SHEET])); }
}
export class MockPreparation implements PreparationBackend {
  metadata: Sheet[];
  constructor(private adapter: MockSheetsAdapter, private name: string, empty: boolean) { this.metadata = empty ? [] : [{ id: 1, title: name }]; if (empty) { adapter.rows = []; adapter.native = true; } }
  async sheets() { return structuredClone(this.metadata); }
  async create(plan: Plan, missing: Sheet[]) { for (const s of missing) { if (s.title === this.name) this.adapter.rows = Array.from({ length: 1006 }, (_, i) => i === 0 ? [...EXPENSE_HEADERS] : ['', '', '', '', '', i === 1 ? MONTH_FORMULA : '', '', '']); else if (s.title === CATEGORY_SHEET) this.adapter.tables.categories = structuredClone(plan.categories); else this.adapter.tables.items = [headers[ITEM_SHEET]]; this.metadata.push(s); } }
  async valid(plan: Plan) { return plan.sheets.every(p => this.metadata.some(s => s.id === p.id && s.title === p.title)) && this.adapter.rows[0]?.[6] === 'ID' && !!this.adapter.tables.categories?.length && !!this.adapter.tables.items?.length; }
}

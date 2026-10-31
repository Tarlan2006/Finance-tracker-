import { calendarDate } from '../../shared/dates';
import { fromDateCell, serialDate, shiftMonth, today } from '../../shared/logic';
import type { Category, ExpenseInput, Row, Snapshot } from '../../shared/types';
import { expenseColumns, type SheetsAdapter } from './sheets';
import { CATEGORY_SHEET, ITEM_SHEET, verifyPlan, type ConfigPlan, type ConfigTables } from './config-store';
export const mockCategories: Category[] = [
  ['🍔 Продукты и супермаркеты', 60000], ['☕ Кафе и рестораны', 40000], ['🚗 Транспорт и такси', 20000],
  ['🎁 Подарки', 50000], ['💊 Здоровье и аптеки(+для себя)', 30000], ['🛍️ Покупки и одежда', 30000],
  ['🎬 Развлечения и досуг', 30000], ['📚 Образование и курсы', 20000], ['⚡ Непредвиденные расходы', 15000]
].map(([name, limit]) => ({ name: String(name), limit: Number(limit) }));
export class MockSheetsAdapter implements SheetsAdapter {
  native = false;
  tables: ConfigTables = { categories: null, items: null, capacity: { [CATEGORY_SHEET]: 1006, [ITEM_SHEET]: 1006 } };
  readonly configWrites: ConfigPlan[] = [];
  readonly createdSheets: string[] = [];
  rows: Row[];
  readonly formulaAmount = '=1282+574+430+380';
  readonly writes: { row: number; ranges: string[] }[] = [];
  constructor(private tz = 'Asia/Almaty') {
    this.rows = Array.from({ length: 1006 }, (_, i) => i === 0 ? ['Дата', 'Название расхода', 'Категория', 'Сумма (₸)', 'Комментарий', 'Месяц', 'ID', 'Источник'] : ['', '', '', '', '', i === 1 ? '=ARRAYFORMULA(IF(A2:A1006="","",TEXT(A2:A1006,"yyyy-mm")))' : '', '', '']);
    const month = today(tz).slice(0, 7);
    for (let i = 0; i < 60; i++) {
      const date = `${shiftMonth(month, -Math.floor(i / 20))}-${String(i % 20 + 1).padStart(2, '0')}`;
      const cat = i % 9;
      this.rows[i + 1] = [serialDate(date), i % 4 === 0 ? '' : ['Magnum', 'Кофе', 'такси', 'Подарок', 'Аптека', 'Одежда', 'Кино', 'Курс', 'Ремонт'][cat], mockCategories[cat].name, i === 0 ? this.formulaAmount : 500 + i * 135, '', this.rows[i + 1][5], `${calendarDate(date).getTime()}-mock-${String(i).padStart(8, '0')}`, 'manual'];
    }
  }
  async read(): Promise<Snapshot> {
    const rows = structuredClone(this.rows);
    // Google UNFORMATTED_VALUE returns the evaluated formula, not its source.
    rows.forEach(r => { if (r[3] === this.formulaAmount) r[3] = 2666; });
    const month = today(this.tz).slice(0, 7);
    const summaries = [0, -1, -2].map(offset => {
      const m = shiftMonth(month, offset);
      const journal = rows.slice(1).filter(r => typeof r[0] === 'number' && typeof r[3] === 'number' && Number.isFinite(r[3]) && fromDateCell(r[0]).startsWith(m)).reduce((s, r) => s + Number(r[3]), 0);
      return { month: m, income: 450000, fixed: 85000, journal, total: 85000 + journal, balance: 365000 - journal, savings: .2 };
    });
    return { rows, categories: this.native ? [] : structuredClone(mockCategories), summaries: this.native ? [] : summaries };
  }
  async readHeaders() { return [...this.rows[0]]; }
  async readRow(row: number) {
    this.assertRow(row);
    const values = [...(this.rows[row - 1] || [])];
    if (values[3] === this.formulaAmount) values[3] = 2666;
    return values;
  }
  async write(row: number, e: ExpenseInput, previous?: ExpenseInput) {
    this.assertRow(row);
    const old = this.rows[row - 1] || [];
    if (previous) {
      const ranges: string[] = [];
      expenseColumns.forEach((key, i) => {
        if (key && previous[key] !== e[key]) {
          old[i] = key === 'date' ? serialDate(e.date) : e[key];
          ranges.push(String.fromCharCode(65+i) + row);
        }
      });
      if (ranges.length) this.writes.push({ row, ranges });
      return;
    }
    this.rows[row - 1] = [serialDate(e.date), e.name, e.category, e.amount, e.comment, old[5] ?? '', e.id, e.source];
    this.writes.push({ row, ranges: [`A${row}:E${row}`, `G${row}:H${row}`] });
  }
  async clear(row: number) { this.assertRow(row); const old = this.rows[row - 1] || []; this.rows[row - 1] = ['', '', '', '', '', old[5] ?? '', '', '']; this.writes.push({ row, ranges: [`A${row}:E${row}`, `G${row}:H${row}`] }); }
  private assertRow(row: number) { if (!Number.isInteger(row) || row < 2) throw new Error('Нельзя менять заголовки'); }
  async readConfigTables() { return structuredClone(this.tables); }
  async readLegacyItems() { return { income: [['2026-09', 200000, 52000], ['2026-10', 200000, 60000], ['2026-11', '', ''], ['2026-12', '', '']], fixed: [['2026-09', 730, 24000, 5432, 60000], ['2026-10', 730, 24000, 9000, 60000]] }; }
  async createConfigSheets() { if (!this.tables.categories) { this.tables.categories = []; this.createdSheets.push(CATEGORY_SHEET); } if (!this.tables.items) { this.tables.items = []; this.createdSheets.push(ITEM_SHEET); } }
  async applyConfig(plan: ConfigPlan) { await verifyPlan(plan, this.tables, (await this.read()).rows); for (const move of plan.moves) this.rows[move.row - 1][2] = move.to; for (const write of plan.writes) (write.sheet === CATEGORY_SHEET ? this.tables.categories! : this.tables.items!)[write.row - 1] = structuredClone(write.after); this.configWrites.push(structuredClone(plan)); }
}

import { calendarDate } from '../../shared/dates';
import { fromDateCell, serialDate, shiftMonth, today } from '../../shared/logic';
import type { Category, ExpenseInput, Row, Snapshot } from '../../shared/types';
import type { SheetsAdapter } from './sheets';
export const mockCategories: Category[] = [
  ['🍔 Продукты и супермаркеты', 60000], ['☕ Кафе и рестораны', 40000], ['🚗 Транспорт и такси', 20000],
  ['🎁 Подарки', 50000], ['💊 Здоровье и аптеки(+для себя)', 30000], ['🛍️ Покупки и одежда', 30000],
  ['🎬 Развлечения и досуг', 30000], ['📚 Образование и курсы', 20000], ['⚡ Непредвиденные расходы', 15000]
].map(([name, limit]) => ({ name: String(name), limit: Number(limit) }));
export class MockSheetsAdapter implements SheetsAdapter {
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
      const journal = rows.slice(1).filter(r => typeof r[0] === 'number' && fromDateCell(r[0]).startsWith(m)).reduce((s, r) => s + Number(r[3]), 0);
      return { month: m, income: 450000, fixed: 85000, journal, total: 85000 + journal, balance: 365000 - journal, savings: .2 };
    });
    return { rows, categories: structuredClone(mockCategories), summaries };
  }
  async write(row: number, e: ExpenseInput) {
    this.assertRow(row);
    const old = this.rows[row - 1] || [];
    this.rows[row - 1] = [serialDate(e.date), e.name, e.category, e.amount, e.comment, old[5] ?? '', e.id, e.source];
    this.writes.push({ row, ranges: [`A${row}:E${row}`, `G${row}:H${row}`] });
  }
  async clear(row: number) { this.assertRow(row); const old = this.rows[row - 1] || []; this.rows[row - 1] = ['', '', '', '', '', old[5] ?? '', '', '']; this.writes.push({ row, ranges: [`A${row}:E${row}`, `G${row}:H${row}`] }); }
  private assertRow(row: number) { if (!Number.isInteger(row) || row < 2) throw new Error('Нельзя менять заголовки'); }
}

import type { Category, Expense, ExpenseInput, Row, Suggestion } from './types';
import { fromDateCell, shiftDate, today, validDate } from './dates';
export { fromDateCell, serialDate, shiftDate, shiftMonth, today } from './dates';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const clean = (value: unknown) => Array.from(String(value ?? '').trim().replace(/\s+/gu, ' ')).slice(0, 200).join('');
export const normalize = (value: string) => clean(value).toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^\p{L}\s]/gu, '').replace(/\s+/g, ' ').trim();
export function parseAmount(input: unknown): number {
  if (typeof input !== 'string' && typeof input !== 'number') throw new AppError(422, 'amount', 'Введите корректную сумму');
  const parts = String(input).replace(/[\s\u00a0]/g, '').replace(/,/g, '.').split('+');
  if (parts.some(p => !/^\d+(?:\.\d{1,2})?$/.test(p))) throw new AppError(422, 'amount', 'Сумма: число, до двух знаков после запятой');
  const cents = parts.reduce((sum, p) => sum + Math.round(Number(p) * 100), 0);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 10_000_000_000) throw new AppError(422, 'amount', 'Сумма должна быть от 0,01 до 100 000 000');
  return cents / 100;
}
export function validMonth(month: string) { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AppError(422, 'month', 'Месяц должен быть YYYY-MM'); return month; }
export const fingerprint = (e: ExpenseInput) => `v2:${JSON.stringify([e.date, e.amount, e.category, e.name, e.comment, e.id, e.source])}`;
export const displayName = (e: Pick<ExpenseInput, 'name' | 'category'>) => e.name || e.category || 'Без категории';
export const firstEmptyRow = (rows: Row[]) => { const i = rows.findIndex((row, idx) => idx > 0 && [0, 1, 2, 3].every(c => row[c] === '' || row[c] == null)); return i === -1 ? Math.max(2, rows.length + 1) : i + 1; };
export function expensesFromRows(rows: Row[], invalidDateRows?: number[]): Expense[] {
  return rows.flatMap((r, i) => {
    if (!i || r[0] === '' || r[0] == null || typeof r[3] !== 'number' || !Number.isFinite(r[3])) return [];
    const date = fromDateCell(r[0]);
    if (!validDate(date)) {
      invalidDateRows?.push(i + 1);
      return [];
    }
    const e: ExpenseInput = { date, name: clean(r[1]), category: clean(r[2]), amount: r[3], comment: clean(r[4]), id: clean(r[6]), source: clean(r[7]) || 'manual' };
    // Display normalization must not hide a concurrent manual edit in Sheets.
    return [{ ...e, row: i + 1, fp: fingerprint({ ...e, name: String(r[1] ?? ''), category: String(r[2] ?? ''), comment: String(r[4] ?? ''), id: String(r[6] ?? ''), source: String(r[7] ?? '') }) }];
  });
}
export function validateExpense(value: unknown, categories: Category[], tz: string, allowPending = false): ExpenseInput {
  if (!value || typeof value !== 'object') throw new AppError(422, 'body', 'Нужен объект расхода');
  const b = value as Record<string, unknown>;
  const date = clean(b.date);
  if (!validDate(date) || date > shiftDate(today(tz), 1) || date < '1900-01-01') throw new AppError(422, 'date', 'Проверьте дату: не позднее завтра');
  const category = clean(b.category);
  if ((!category && !allowPending) || (category && !categories.some(c => c.name === category))) throw new AppError(422, 'category', 'Выберите категорию из справочника');
  const id = clean(b.id);
  if (!/^\d{13}-[a-zA-Z0-9-]{8,80}$/.test(id)) throw new AppError(422, 'id', 'Неверный ID записи');
  // API accepts a numeric amount only; addition/locale parsing belongs to the client.
  if (typeof b.amount !== 'number') throw new AppError(422, 'amount', 'Сумма должна быть числом');
  return { id, date, amount: parseAmount(b.amount), category, name: clean(b.name), comment: clean(b.comment), source: clean(b.source) || 'manual' };
}
export function suggestion(name: string, history: Expense[]): Suggestion {
  const n = normalize(name);
  if (!n) return { name: clean(name), category: '', confidence: 0 };
  const exact = history.filter(e => e.category && normalize(e.name) === n);
  const matches = exact.length ? exact : history.filter(e => {
    const other = normalize(e.name);
    return e.category && other && (other.startsWith(n) || n.startsWith(other) || n.split(' ').some(t => t.length > 2 && other.split(' ').includes(t)));
  });
  const counts = new Map<string, number>();
  matches.forEach(e => counts.set(e.category, (counts.get(e.category) || 0) + 1));
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  const ratio = best ? best[1] / matches.length : 0;
  return { name: clean(name), category: best && best[1] >= 2 && ratio >= .6 ? best[0] : '', confidence: ratio * (exact.length ? 1 : .75) };
}
export function nameSuggestions(history: Expense[]) {
  const names = new Map<string, { name: string; count: number; date: string }>();
  for (const e of history) {
    const name = clean(e.name).toLocaleLowerCase('ru');
    const words = name.split(' ');
    if (!name || name.length > 40 || words.length > 3 || /[,+&;/]|\b(?:and)\b|(?:^|\s)(?:и|или)(?:\s|$)/iu.test(name)) continue;
    // Compound activities from the journal are not reusable merchant/name suggestions.
    if (words.filter(w => /^(магаз|магазин|покушать|кино|компы)$/u.test(w)).length > 1) continue;
    const n = normalize(name).split(' ').sort().join(' '); if (!n) continue;
    const old = names.get(n);
    names.set(n, { name: old?.name || name, count: (old?.count || 0) + 1, date: old && old.date > e.date ? old.date : e.date });
  }
  return [...names.values()].sort((a, b) => b.count - a.count || b.date.localeCompare(a.date)).map(e => e.name).slice(0, 5);
}
export function looksDuplicate(e: ExpenseInput, history: ExpenseInput[], windowMin: number, now = Date.now(), ts?: number) {
  const sameName = (s: string) => clean(s).toLocaleLowerCase('ru').replace(/ё/g, 'е');
  return history.some(old => old.id !== e.id && old.date === e.date && old.amount === e.amount && old.category === e.category && sameName(old.name) === sameName(e.name) && Math.abs((ts || now) - Number(old.id.split('-')[0])) <= windowMin * 60000);
}
export function csv(expenses: Expense[]) {
  const field = (v: string | number) => { let s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  return '\ufeff' + [['Дата', 'Название', 'Категория', 'Сумма', 'Комментарий', 'ID', 'Источник'], ...expenses.map(e => [e.date, displayName(e), e.category, e.amount, e.comment, e.id, e.source])].map(row => row.map(field).join(';')).join('\r\n');
}
export const sum = (expenses: ExpenseInput[]) => Math.round(expenses.reduce((s, e) => s + e.amount, 0) * 100) / 100;

import type { Category, Expense, ExpenseInput, Row, Suggestion } from './types';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const clean = (value: unknown) => String(value ?? '').trim().replace(/\s+/gu, ' ').slice(0, 200);
export const normalize = (value: string) => clean(value).toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^\p{L}\s]/gu, '').replace(/\s+/g, ' ').trim();
export function parseAmount(input: unknown): number {
  if (typeof input !== 'string' && typeof input !== 'number') throw new AppError(422, 'amount', 'Введите корректную сумму');
  const parts = String(input).replace(/[\s\u00a0]/g, '').replace(/,/g, '.').split('+');
  if (parts.some(p => !/^\d+(?:\.\d{1,2})?$/.test(p))) throw new AppError(422, 'amount', 'Сумма: число, до двух знаков после запятой');
  const cents = parts.reduce((sum, p) => sum + Math.round(Number(p) * 100), 0);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 10_000_000_000) throw new AppError(422, 'amount', 'Сумма должна быть от 0,01 до 100 000 000');
  return cents / 100;
}
export function today(tz: string, now = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(t => p.find(x => x.type === t)!.value).join('-');
}
export function shiftDate(date: string, days: number) { return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10); }
export function shiftMonth(month: string, delta: number) { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7); }
export function validMonth(month: string) { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AppError(422, 'month', 'Месяц должен быть YYYY-MM'); return month; }
export function serialDate(date: string) { return (Date.parse(`${date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000; }
export function fromDateCell(cell: unknown): string {
  if (typeof cell === 'number' && Number.isFinite(cell)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(cell) * 86400000).toISOString().slice(0, 10);
  const text = clean(cell);
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(text)) return text.split('.').reverse().join('-');
  return text.slice(0, 10);
}
export const fingerprint = (e: Pick<ExpenseInput, 'date' | 'amount' | 'category'>) => `${e.date}|${e.amount}|${e.category}`;
export const displayName = (e: Pick<ExpenseInput, 'name' | 'category'>) => e.name || e.category || 'Без категории';
export const firstEmptyRow = (rows: Row[]) => { const i = rows.findIndex((row, idx) => idx > 0 && [0, 1, 2, 3].every(c => row[c] === '' || row[c] == null)); return i === -1 ? Math.max(2, rows.length + 1) : i + 1; };
export function expensesFromRows(rows: Row[]): Expense[] {
  return rows.flatMap((r, i) => {
    if (!i || r[0] === '' || r[0] == null || typeof r[3] !== 'number' || !Number.isFinite(r[3])) return [];
    const e: ExpenseInput = { date: fromDateCell(r[0]), name: clean(r[1]), category: clean(r[2]), amount: r[3], comment: clean(r[4]), id: clean(r[6]), source: clean(r[7]) || 'manual' };
    return [{ ...e, row: i + 1, fp: fingerprint(e) }];
  });
}
export function validateExpense(value: unknown, categories: Category[], tz: string, allowPending = false): ExpenseInput {
  if (!value || typeof value !== 'object') throw new AppError(422, 'body', 'Нужен объект расхода');
  const b = value as Record<string, unknown>;
  const date = clean(b.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date > shiftDate(today(tz), 1) || date < '1900-01-01') throw new AppError(422, 'date', 'Проверьте дату: не позднее завтра');
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
  for (const e of history) { const n = normalize(e.name); if (!n) continue; const old = names.get(n); names.set(n, { name: e.name, count: (old?.count || 0) + 1, date: old && old.date > e.date ? old.date : e.date }); }
  return [...names.values()].sort((a, b) => b.count - a.count || b.date.localeCompare(a.date)).map(e => e.name);
}
export function looksDuplicate(e: ExpenseInput, history: ExpenseInput[], windowMin: number, now = Date.now(), ts?: number) {
  return history.some(old => old.id !== e.id && old.date === e.date && old.amount === e.amount && normalize(old.name) === normalize(e.name) && (!e.source.includes('auto') && e.source === 'manual' || Math.abs((ts || now) - Number(old.id.split('-')[0])) <= windowMin * 60000));
}
export function csv(expenses: Expense[]) {
  const field = (v: string | number) => { let s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  return '\ufeff' + [['Дата', 'Название', 'Категория', 'Сумма', 'Комментарий', 'ID', 'Источник'], ...expenses.map(e => [e.date, displayName(e), e.category, e.amount, e.comment, e.id, e.source])].map(row => row.map(field).join(';')).join('\r\n');
}
export const sum = (expenses: ExpenseInput[]) => Math.round(expenses.reduce((s, e) => s + e.amount, 0) * 100) / 100;

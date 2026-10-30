import { calendarDate, dateLabel, monthDays, shiftDate, shiftMonth } from './dates';
import { sum } from './logic';
import type { Category, Expense } from './types';
export type PeriodMode = 'week' | 'month';
export interface Period { mode: PeriodMode; start: string; end: string }
export interface JournalFilter { start: string; end: string; categories?: string[] }
export function weekStart(date: string) { return shiftDate(date, -((calendarDate(date).getUTCDay() + 6) % 7)); }
export function periodFor(date: string, mode: PeriodMode): Period { const start = mode === 'week' ? weekStart(date) : `${date.slice(0, 7)}-01`; return { mode, start, end: mode === 'week' ? shiftDate(start, 6) : shiftDate(`${shiftMonth(start.slice(0, 7), 1)}-01`, -1) }; }
export const movePeriod = (period: Period, direction: number) => periodFor(period.mode === 'week' ? shiftDate(period.start, direction * 7) : `${shiftMonth(period.start.slice(0, 7), direction)}-01`, period.mode);
export const dayCount = (start: string, end: string) => Math.round((calendarDate(end).getTime() - calendarDate(start).getTime()) / 86400000) + 1;
export const inPeriod = (rows: Expense[], period: Pick<Period, 'start' | 'end'>) => rows.filter(e => e.date >= period.start && e.date <= period.end);
export const unexpectedTotal = (rows: Expense[]) => sum(rows.filter(e => /непредвиденные/i.test(e.category)));
export function periodMonths(period: Pick<Period, 'start' | 'end'>) { const months: string[] = []; for (let m = period.start.slice(0, 7); m <= period.end.slice(0, 7); m = shiftMonth(m, 1)) months.push(m); return months; }
export function periodLabel(period: Period) { return period.mode === 'month' ? dateLabel(period.start, { month: 'long', year: 'numeric' }).replace(' г.', '') : `${dateLabel(period.start, { day: 'numeric', month: 'short' }).replaceAll('.', '')} – ${dateLabel(period.end, { day: 'numeric', month: 'short' }).replaceAll('.', '')}`; }
export function dailyTotals(rows: Expense[], period: Period) { const totals = new Map<string, number>(); for (const e of inPeriod(rows, period)) totals.set(e.date, (totals.get(e.date) || 0) + Math.round(e.amount * 100)); return Array.from({ length: dayCount(period.start, period.end) }, (_, i) => { const date = shiftDate(period.start, i); return { date, amount: (totals.get(date) || 0) / 100 }; }); }
export function periodStats(rows: Expense[], period: Period, currentDay: string) {
  const current = currentDay >= period.start && currentDay <= period.end, previous = movePeriod(period, -1);
  const elapsed = current ? dayCount(period.start, currentDay) : dayCount(period.start, period.end);
  const previousEnd = current ? shiftDate(previous.start, Math.min(elapsed, dayCount(previous.start, previous.end)) - 1) : previous.end;
  const comparable = sum(inPeriod(rows, { start: period.start, end: current ? currentDay : period.end }));
  const previousTotal = sum(inPeriod(rows, { start: previous.start, end: previousEnd }));
  return { total: sum(inPeriod(rows, period)), comparable, previousTotal, previous, previousEnd, current, elapsed, percent: previousTotal > 0 ? (comparable / previousTotal - 1) * 100 : null, forecast: current && currentDay < period.end ? Math.round(comparable / elapsed * dayCount(period.start, period.end)) : null };
}
export function remainingPerDay(spent: number, limit: number, month: string, currentDay: string): number | null { if (limit <= spent || limit <= 0 || month !== currentDay.slice(0, 7)) return null; return Math.floor((limit - spent) / (monthDays(month) - Number(currentDay.slice(8)) + 1)); }
export function budgetStatus(spent: number, limit: number) { return limit <= 0 ? 'none' : spent / limit >= .9 ? 'danger' : spent / limit >= .7 ? 'warning' : 'good'; }
export const categoryTitle = (name: string) => name.replace(/^[^\p{L}\p{N}]+\s*/u, '') || 'Без категории';
export const categoryEmoji = (name: string) => /^[^\p{L}\p{N}\s]+/u.exec(name)?.[0] || '•';
export const palette = {
  dark: ['#79B8AD', '#8EABE0', '#B8A2D4', '#D5A483', '#8EBB95', '#D0B96F', '#B58EA6', '#8BB9C9', '#B4B6C1'],
  light: ['#377F73', '#526FAD', '#8661A6', '#9A6443', '#497A50', '#887021', '#8F5F7D', '#437D8E', '#6B6E83']
};
export function colorIndex(name: string) { let hash = 2166137322; for (const char of name.normalize('NFC').toLocaleLowerCase('ru')) { hash ^= char.codePointAt(0)!; hash = Math.imul(hash, 16777619); } return (hash >>> 0) % palette.dark.length; }
export const categoryColor = (name: string, theme: 'dark' | 'light' = 'dark') => palette[theme][colorIndex(name)];
export interface CategoryTotal { name: string; amount: number; percent: number; limit: number; members: string[]; other?: boolean }
export function categoryTotals(rows: Expense[], categories: Category[]): CategoryTotal[] { const total = sum(rows), amounts = new Map<string, number>(); for (const e of rows) amounts.set(e.category, (amounts.get(e.category) || 0) + Math.round(e.amount * 100)); return [...amounts].map(([name, cents]) => ({ name, amount: cents / 100, percent: total > 0 ? cents / total : 0, limit: categories.find(c => c.name === name)?.limit || 0, members: [name] })).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)); }
export function ringSegments(categories: CategoryTotal[]): CategoryTotal[] { const small = categories.filter(c => c.percent < 2), regular = categories.filter(c => c.percent >= 2); if (!small.length) return regular; return [...regular, { name: 'Прочее', amount: small.reduce((s, c) => s + Math.round(c.amount * 100), 0) / 100, percent: small.reduce((s, c) => s + c.percent, 0), limit: 0, members: small.flatMap(c => c.members), other: true }]; }

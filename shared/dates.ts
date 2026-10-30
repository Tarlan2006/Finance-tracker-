// Date-only arithmetic: UTC is a calendar coordinate, never the user's current day.
const DAY = 86400000, EPOCH = Date.UTC(1899, 11, 30);
const pad = (n: number) => String(n).padStart(2, '0');
export function calendarString(date: Date) { return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`; }
export function calendarDate(date: string) { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
export function validDate(date: string) { return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(calendarDate(date).getTime()) && calendarString(calendarDate(date)) === date; }
export function today(tz: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(t => parts.find(x => x.type === t)!.value).join('-');
}
export function shiftDate(date: string, days: number) { return calendarString(new Date(calendarDate(date).getTime() + days * DAY)); }
export function shiftMonth(month: string, delta: number) { const [y, m] = month.split('-').map(Number); return calendarString(new Date(Date.UTC(y, m - 1 + delta, 1))).slice(0, 7); }
export const daysInMonth = (month: string) => calendarDate(`${shiftMonth(month, 1)}-01`).getTime() - calendarDate(`${month}-01`).getTime();
export const monthDays = (month: string) => daysInMonth(month) / DAY;
export const serialDate = (date: string) => (calendarDate(date).getTime() - EPOCH) / DAY;
export function fromDateCell(cell: unknown) {
  if (typeof cell === 'number' && Number.isFinite(cell)) return calendarString(new Date(EPOCH + Math.floor(cell) * DAY));
  const value = String(cell ?? '').trim();
  return /^\d{2}\.\d{2}\.\d{4}$/.test(value) ? value.split('.').reverse().join('-') : value.slice(0, 10);
}
export function dateLabel(date: string, options: Intl.DateTimeFormatOptions) { return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(calendarDate(date)); }

import { calendarDate } from '../../../shared/dates';
// Presentation-only cache. Recreating dozens of Intl formatters during a
// transition is particularly expensive on throttled/mobile CPUs.
const dates = new Map<string, Intl.DateTimeFormat>();
export function dateLabel(date: string, options: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify(options);
  let format = dates.get(key);
  if (!format) { format = new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }); dates.set(key, format); }
  return format.format(calendarDate(date));
}

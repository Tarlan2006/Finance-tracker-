import { monthDays, shiftMonth } from './dates';
import { AppError, clean, parseAmount, validMonth } from './logic';
import type { Bootstrap, Category, ConfigCategory, ConfigItem, Expense, Row } from './types';
export const categoryLabel = (c: Pick<ConfigCategory, 'emoji' | 'name'>) => `${c.emoji} ${c.name}`.trim();
export const activeItems = (items: ConfigItem[], month: string) => items.filter(i => i.from_month <= month && (!i.to_month || i.to_month >= month));
export const itemRoot = (id: string) => id.split('@')[0];
export const moneySum = (values: number[]) => values.reduce((s, n) => s + Math.round(n * 100), 0) / 100;
export const configCategories = (categories: ConfigCategory[]): Category[] => categories.slice().sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id)).map(c => ({ name: categoryLabel(c), limit: c.limit, id: c.id, archived: c.archived }));
export function budget(data: Pick<Bootstrap, 'config' | 'summaries'>, rows: Expense[], month: string, day: string) {
  const items = activeItems(data.config?.items || [], month), old = data.summaries.find(s => s.month === month);
  const income = data.config?.configured ? moneySum(items.filter(i => i.kind === 'income').map(i => i.amount)) : old?.income || 0;
  const fixed = data.config?.configured ? moneySum(items.filter(i => i.kind === 'fixed').map(i => i.amount)) : old?.fixed || 0;
  const personal = moneySum(rows.filter(e => e.date.startsWith(month)).map(e => e.amount));
  const balance = moneySum([income, -fixed, -personal]), percent = income > 0 ? (fixed + personal) / income * 100 : null;
  return { income, fixed, personal, balance, percent, hasIncome: income > 0, daily: month === day.slice(0, 7) && balance > 0 && income > 0 ? balance / (monthDays(month) - Number(day.slice(8)) + 1) : null };
}
export function configName(value: unknown, max = 40) {
  if (typeof value !== 'string') throw new AppError(422, 'name', 'Введите название текстом');
  const name = clean(value).normalize('NFC');
  if (!name || [...name].length > max || /^[=+\-@]/.test(name)) throw new AppError(422, 'name', `Название: от 1 до ${max} символов, без формульного префикса`);
  return name;
}
export function configEmoji(value: unknown) {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new AppError(422, 'emoji', 'Укажите одно эмодзи');
  const emoji = clean(value);
  if (!emoji) return '';
  if ([...new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(emoji)].length !== 1 || !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(emoji)) throw new AppError(422, 'emoji', 'Укажите одно эмодзи');
  return emoji;
}
export function uniqueCategory(name: string, categories: ConfigCategory[], id = '') {
  if (categories.some(c => c.id !== id && c.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'))) throw new AppError(422, 'duplicate_name', 'Категория с таким названием уже существует');
}
export const limitAmount = (value: unknown) => value === null || value === undefined || typeof value === 'string' && !value.trim() || /^(?:0+)(?:[.,]0{1,2})?$/.test(String(value).trim()) ? 0 : parseAmount(value);
export function importCategories(categories: Category[], stamp: string): ConfigCategory[] {
  return categories.map((c, sort) => { const first = c.name.split(' ')[0]; let emoji = ''; try { emoji = configEmoji(first); } catch { /* Plain names are valid legacy categories. */ } return { id: `legacy-category-${sort}`, emoji, name: emoji ? c.name.slice(first.length).trim() : c.name, limit: c.limit, archived: false, sort, rev: 1, updated_at: stamp }; });
}
// Legacy A:D and F:K: month in first column, article values in following columns.
export function importItems(income: Row[], fixed: Row[], stamp: string): ConfigItem[] {
  const result: ConfigItem[] = [];
  for (const [kind, rows, names] of [['income', income, ['Основная зарплата', 'Стипендия']], ['fixed', fixed, ['Spotify', 'Телефон', 'За ИИ', 'Депозит/Накопления']]] as const) {
    names.forEach((name, column) => {
      let previous: ConfigItem | undefined;
      for (const row of rows.slice().sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
        const month = String(row[0] || ''); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) continue;
        const value = row[column + 1]; if (value === '' || value === null || value === undefined) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000000) throw new AppError(422, 'import', 'Проверьте суммы в старых статьях');
        const amount = Math.round(value * 100) / 100;
        if (previous?.amount === amount) continue;
        if (previous) previous.to_month = shiftMonth(month, -1);
        previous = amount > 0 ? { id: `legacy-${kind}-${column}@${month}`, kind, name, amount, from_month: month, to_month: '', rev: 1, updated_at: stamp } : undefined;
        if (previous) result.push(previous);
      }
    });
  }
  return result;
}
// Closed intervals with end < start are tombstones: no physical rows are removed.
export function changeItem(items: ConfigItem[], current: ConfigItem, monthValue: unknown, amount: number | null, scope: 'forward' | 'month', stamp: string): ConfigItem[] {
  const month = validMonth(String(monthValue)), next = shiftMonth(month, 1), root = itemRoot(current.id);
  if (!activeItems(items, month).some(i => i.id === current.id)) throw new AppError(409, 'item', 'Статья уже изменилась. Обновите настройки');
  const affected = items.filter(i => itemRoot(i.id) === root && (!i.to_month || i.to_month >= month) && (scope === 'forward' || i.from_month <= month));
  const changes = affected.map(i => ({ ...i, to_month: shiftMonth(month > i.from_month ? month : i.from_month, -1), rev: i.rev + 1, updated_at: stamp }));
  const add = (start: string, end: string, value: number) => {
    const id = `${root}@${start}`, existing = items.find(i => i.id === id), entry = { ...current, id, amount: value, from_month: start, to_month: end, rev: (existing?.rev || 0) + 1, updated_at: stamp };
    const index = changes.findIndex(i => i.id === id); if (index < 0) changes.push(entry); else changes[index] = entry;
  };
  if (amount !== null) add(month, scope === 'month' ? month : '', amount);
  if (scope === 'month' && (!current.to_month || current.to_month >= next)) add(next, current.to_month, current.amount);
  return changes;
}

import { digest } from './passwords';
import { EXPENSE_HEADERS } from './sheets';
import { AppError } from '../../shared/logic';
import type { Config, ConfigCategory, ConfigItem, Row } from '../../shared/types';
export const CATEGORY_SHEET = 'FT Categories', ITEM_SHEET = 'FT Items';
export type ConfigSheet = typeof CATEGORY_SHEET | typeof ITEM_SHEET;
export const headers = { [CATEGORY_SHEET]: ['id', 'emoji', 'name', 'limit', 'archived', 'sort', 'rev', 'updated_at'], [ITEM_SHEET]: ['id', 'kind', 'name', 'amount', 'from_month', 'to_month', 'rev', 'updated_at'] };
export interface ConfigTables { categories: Row[] | null; items: Row[] | null; capacity: Record<ConfigSheet, number> }
export interface ConfigWrite { sheet: ConfigSheet; row: number; before: Row; after: Row }
export interface ConfigPlan { writes: ConfigWrite[]; moves: { row: number; from: string; to: string; identity?: string }[] }
export interface ConfigStorage { readConfigTables(): Promise<ConfigTables>; readLegacyItems(): Promise<{ income: Row[]; fixed: Row[] }>; createConfigSheets(): Promise<void>; applyConfig(plan: ConfigPlan): Promise<void> }
export interface OperationStorage { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<unknown> }
export class MemoryOperations implements OperationStorage { private values = new Map<string, unknown>(); async get<T>(key: string) { return this.values.get(key) as T | undefined; } async put(key: string, value: unknown) { this.values.set(key, structuredClone(value)); } }
export const configConflict = () => new AppError(409, 'config_conflict', 'Настройки изменились. Обновите страницу и повторите');
export const sameRow = (a: Row, b: Row) => Array.from({ length: 8 }, (_, i) => String(a[i] ?? '')).every((v, i) => v === String(b[i] ?? ''));
export const categoryRow = (c: ConfigCategory): Row => [c.id, c.emoji, c.name, c.limit, c.archived, c.sort, c.rev, c.updated_at];
export const itemRow = (i: ConfigItem): Row => [i.id, i.kind, i.name, i.amount, i.from_month, i.to_month, i.rev, i.updated_at];
export function decodeConfig(t: ConfigTables): Config {
  const validHeader = (rows: Row[] | null, sheet: ConfigSheet) => { if (!rows?.[0]?.some(v => v !== '' && v !== null)) return false; if (!sameRow(rows[0], headers[sheet])) throw new AppError(422, 'config_headers', 'Заголовки служебных листов не совпадают. Проверьте их вручную'); return true; };
  const catOK = validHeader(t.categories, CATEGORY_SHEET), itemOK = validHeader(t.items, ITEM_SHEET);
  const categories = (catOK ? t.categories!.slice(1) : []).filter(r => r[0]).map(r => ({ id: String(r[0]), emoji: String(r[1] || ''), name: String(r[2] || ''), limit: Number(r[3] || 0), archived: r[4] === true || String(r[4]).toUpperCase() === 'TRUE', sort: Number(r[5]), rev: Number(r[6]), updated_at: String(r[7]) }));
  const items = (itemOK ? t.items!.slice(1) : []).filter(r => r[0]).map(r => ({ id: String(r[0]), kind: String(r[1]) as ConfigItem['kind'], name: String(r[2]), amount: Number(r[3]), from_month: String(r[4]), to_month: String(r[5] || ''), rev: Number(r[6]), updated_at: String(r[7]) }));
  if (categories.some(c => !Number.isFinite(c.limit) || c.limit < 0 || !Number.isSafeInteger(c.rev) || c.rev < 1 || !Number.isFinite(c.sort)) || items.some(i => !['income', 'fixed'].includes(i.kind) || !Number.isFinite(i.amount) || i.amount <= 0 || !Number.isSafeInteger(i.rev) || i.rev < 1 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(i.from_month) || i.to_month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(i.to_month)) || new Set(categories.map(c => c.id)).size !== categories.length || new Set(items.map(i => i.id)).size !== items.length) throw new AppError(422, 'config_data', 'Проверьте значения служебных листов');
  return { configured: catOK && itemOK, categories, items, version: [...categories, ...items].map(i => `${i.id}:${i.rev}`).join('|') };
}
export function planRows(tables: ConfigTables, sheet: ConfigSheet, values: Row[], plan: ConfigPlan) {
  const rows = structuredClone((sheet === CATEGORY_SHEET ? tables.categories : tables.items) || []);
  for (const after of values) {
    let index = after[0] === 'id' ? 0 : rows.findIndex((r, i) => i > 0 && r[0] === after[0]);
    if (index < 0) { index = 1; while (rows[index]?.some(v => v !== '' && v !== null)) index++; }
    if (index >= tables.capacity[sheet]) throw new AppError(422, 'config_full', 'Служебный лист заполнен. Добавление строк приложением запрещено');
    const before = rows[index] || [];
    if (!sameRow(before, after)) plan.writes.push({ sheet, row: index + 1, before, after });
    rows[index] = after;
  }
}
export function moveIdentity(row: Row) { return digest(JSON.stringify([0, 1, 3, 4, 6, 7].map(i => row[i] ?? ''))); }
export async function verifyPlan(plan: ConfigPlan, tables: ConfigTables, journal: Row[]) {
  for (const w of plan.writes) {
    if (![CATEGORY_SHEET, ITEM_SHEET].includes(w.sheet) || !Number.isSafeInteger(w.row) || w.row < 1 || w.row > tables.capacity[w.sheet] || w.after.length !== 8) throw new AppError(422, 'range', 'Недопустимый диапазон настроек');
    const now = (w.sheet === CATEGORY_SHEET ? tables.categories : tables.items)?.[w.row - 1] || [];
    if (!sameRow(now, w.before) && !sameRow(now, w.after)) throw configConflict();
  }
  if (plan.moves.length && EXPENSE_HEADERS.some((header, i) => journal[0]?.[i] !== header)) throw configConflict();
  await Promise.all(plan.moves.map(async move => {
    if (!Number.isInteger(move.row) || move.row < 2 || move.row > 1006) throw new AppError(422, 'range', 'Недопустимая строка журнала');
    const row = journal[move.row - 1] || [];
    if ((row[2] !== move.from && row[2] !== move.to) || move.identity !== await moveIdentity(row)) throw configConflict();
  }));
}

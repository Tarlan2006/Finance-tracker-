import { AppError } from '../../shared/logic';
import type { ExpenseInput, Row, Snapshot } from '../../shared/types';
import type { ConfigStorage } from './config-store';
export const EXPENSE_HEADERS = ['Дата', 'Название расхода', 'Категория', 'Сумма (₸)', 'Комментарий', 'Месяц', 'ID', 'Источник'];
export function checkExpenseHeaders(row: Row | undefined) {
  if (EXPENSE_HEADERS.some((name, i) => row?.[i] !== name)) {
    throw new AppError(409, 'schema_mismatch', 'Нарушена структура журнала. Проверьте заголовки и порядок столбцов A:H на листе расходов.');
  }
}
export const expenseColumns = ['date','name','category','amount','comment',null,'id','source'] as const;
export interface RowEdit { row: number; before: ExpenseInput; after: ExpenseInput }
export const bulkExpensePath = '/api/expenses/bulk';
export const bodyLimit = (path: string) => path === bulkExpensePath ? 2 * 1024 * 1024 : 16384;
export interface SheetsAdapter extends ConfigStorage {
  read(legacy?: boolean): Promise<Snapshot>;
  primeJournal?(readOnly: boolean, configured?: boolean): Promise<void>;
  invalidate?(structure?: boolean): void;
  finishRequest?(): void;
  readHeaders(cached?: boolean): Promise<Row>;
  readRow(row: number): Promise<Row>;
  write(row: number, expense: ExpenseInput, previous?: ExpenseInput): Promise<void>;
  clear(row: number): Promise<void>;
  updateMany(edits: RowEdit[]): Promise<void>;
  clearMany(rows: number[]): Promise<void>;
}

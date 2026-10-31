import type { ExpenseInput, Row, Snapshot } from '../../shared/types';
import type { ConfigStorage } from './config-store';
export const EXPENSE_HEADERS = ['Дата', 'Название расхода', 'Категория', 'Сумма (₸)', 'Комментарий', 'Месяц', 'ID', 'Источник'];
export const expenseColumns = ['date','name','category','amount','comment',null,'id','source'] as const;
export interface SheetsAdapter extends ConfigStorage {
  read(legacy?: boolean): Promise<Snapshot>;
  readRow(row: number): Promise<Row>;
  write(row: number, expense: ExpenseInput, previous?: ExpenseInput): Promise<void>;
  clear(row: number): Promise<void>;
}

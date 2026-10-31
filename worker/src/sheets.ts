import type { ExpenseInput, Snapshot } from '../../shared/types';
import type { ConfigStorage } from './config-store';
export const expenseColumns = ['date','name','category','amount','comment',null,'id','source'] as const;
export interface SheetsAdapter extends ConfigStorage {
  read(legacy?: boolean): Promise<Snapshot>;
  write(row: number, expense: ExpenseInput, previous?: ExpenseInput): Promise<void>;
  clear(row: number): Promise<void>;
}

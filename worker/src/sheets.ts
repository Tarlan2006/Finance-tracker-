import type { ExpenseInput, Snapshot } from '../../shared/types';
export interface SheetsAdapter {
  read(): Promise<Snapshot>;
  write(row: number, expense: ExpenseInput): Promise<void>;
  clear(row: number): Promise<void>;
}

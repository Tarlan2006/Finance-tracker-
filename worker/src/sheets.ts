import type { ExpenseInput, Snapshot } from '../../shared/types';
import type { ConfigStorage } from './config-store';
export interface SheetsAdapter extends ConfigStorage {
  read(legacy?: boolean): Promise<Snapshot>;
  write(row: number, expense: ExpenseInput): Promise<void>;
  clear(row: number): Promise<void>;
}

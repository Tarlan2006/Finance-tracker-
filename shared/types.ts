export interface Category { name: string; limit: number }
export interface ExpenseInput { id: string; date: string; amount: number; category: string; name: string; comment: string; source: string }
export interface Expense extends ExpenseInput { row: number; fp: string }
export interface Summary { month: string; income: number; fixed: number; journal: number; total: number; balance: number; savings: number }
export interface Suggestion { name: string; category: string; confidence: number }
export interface Bootstrap { categories: Category[]; expenses: Expense[]; history: Expense[]; summaries: Summary[]; summary: Summary | null; tz: string; currency: string; duplicateWindow: number; mock: boolean }
export type Cell = string | number | boolean | null;
export type Row = Cell[];
export interface Snapshot { rows: Row[]; categories: Category[]; summaries: Summary[] }

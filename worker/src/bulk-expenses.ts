import { validDate, shiftDate, today, serialDate } from '../../shared/dates';
import { AppError, clean, parseAmount } from '../../shared/logic';
import type { Expense, ExpensePatch, Snapshot } from '../../shared/types';
import type { OperationStorage } from './config-store';
import { checkExpenseHeaders, expenseColumns, type SheetsAdapter } from './sheets';
import { SheetsCooldown } from './sheets-quota';
import { digest } from './passwords';

function parsePatch(input: unknown, snapshot: Snapshot, tz: string): ExpensePatch {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length)
    throw new AppError(422, 'patch', 'Отметьте поля для изменения');
  const patch: ExpensePatch = {};
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case 'amount':
        if (typeof value !== 'number') throw new AppError(422, 'amount', 'Проверьте сумму');
        patch.amount = parseAmount(value);
        break;
      case 'date':
        if (typeof value !== 'string' || !validDate(value) || value < '1900-01-01' || value > shiftDate(today(tz), 1))
          throw new AppError(422, 'date', 'Проверьте дату: не позднее завтра');
        patch.date = value;
        break;
      case 'category':
        if (!snapshot.categories.some(c => c.name === value && !c.archived) || typeof value !== 'string' || !value)
          throw new AppError(422, 'category', 'Выберите действующую категорию');
        patch.category = value;
        break;
      case 'name': case 'comment':
        if (typeof value !== 'string') throw new AppError(422, 'text', 'Введите текст');
        patch[key] = clean(value);
        break;
      default: throw new AppError(422, 'patch', 'Это поле нельзя менять');
    }
  }
  return patch;
}

export async function bulkExpenses(body: Record<string, unknown>, history: Expense[], snapshot: Snapshot, adapter: SheetsAdapter, storage: OperationStorage, tz: string, dry: boolean, scope: string[]) {
  if (body.action !== 'edit' && body.action !== 'delete') throw new AppError(422, 'action', 'Выберите действие');
  if (!Array.isArray(body.targets) || !body.targets.length || body.targets.length > 1005)
    throw new AppError(422, 'targets', 'Выберите от 1 до 1005 трат');
  const byRow = new Map(history.map(e => [e.row, e]));
  const selected: Expense[] = [];
  const seen = new Set<number>();
  for (const target of body.targets) {
    if (!target || !Number.isInteger(target.row) || target.row < 2 || target.row > 1006 || seen.has(target.row))
      throw new AppError(422, 'targets', 'Неверный или повторяющийся номер строки');
    const expense = byRow.get(target.row);
    if (!expense || expense.fp !== target.fp)
      throw new AppError(409, 'conflict', `Строка ${target.row} изменилась. Проверьте журнал и выберите траты заново.`);
    selected.push(expense);
    seen.add(target.row);
  }
  const clearing = body.action === 'delete';
  const patch = clearing ? {} : parsePatch(body.patch, snapshot, tz);
  const edits = selected.map(before => ({ row: before.row, before, after: { ...before, ...patch } }));
  if (dry || patch.category !== undefined) {
    const previewHash = await digest(JSON.stringify([scope, body.action, Object.entries(patch).sort(), selected.map(e => [e.row, e.fp])]));
    if (dry) return { count: selected.length, previewHash };
    if (body.previewHash !== previewHash) throw new AppError(409, 'preview_changed', 'Подтвердите актуальный предпросмотр смены категории.');
  }
  if (clearing) {
    // Reserve existing IDs before clearing, just as for a single deletion.
    await Promise.all(selected.filter(e => e.id).map(e => storage.put('deleted-expense:' + e.id, true)));
  }
  let failure: unknown;
  try {
    if (clearing) await adapter.clearMany(selected.map(e => e.row));
    else await adapter.updateMany(edits);
  } catch (error) {
    if (error instanceof SheetsCooldown) throw error;
    failure = error;
  }
  // A lost response may follow a successful Sheets write. Verify once, never replay it.
  adapter.invalidate?.();
  const latest = await adapter.read(false);
  checkExpenseHeaders(latest.rows[0]);
  for (const { row, before, after } of edits) {
    const matches = expenseColumns.every((key, i) => {
      if (!key) return true; // F is owned by the sheet formula.
      const previous = snapshot.rows[row - 1][i] ?? '';
      const expected = clearing ? '' : before[key] === after[key] ? previous : key === 'date' ? serialDate(after.date) : after[key];
      return (latest.rows[row - 1]?.[i] ?? '') === expected;
    });
    if (!matches) throw failure || new AppError(409, 'conflict', `Не удалось подтвердить строку ${row}. Проверьте журнал.`);
  }
  return { count: selected.length };
}

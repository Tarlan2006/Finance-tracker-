import { useCallback, useRef, useState, type FormEvent } from 'react';
import { displayName, parseAmount, sum } from '../../../shared/logic';
import { categoryTitle } from '../../../shared/analytics';
import type { BulkAction, Category, Expense, ExpensePatch } from '../../../shared/types';
import type { ChangeSelected } from '../lib/api';
import { useDialog } from '../lib/dialog';
import Icon from './Icon';

const labels = { category: 'Категория', date: 'Дата', amount: 'Сумма', name: 'Название', comment: 'Комментарий' };
type Field = keyof typeof labels;
const fields = Object.keys(labels) as Field[];

export default function BulkExpenseDialog({ mode, rows, categories, money, apply, close, done }: {
  mode: BulkAction['action']; rows: Expense[]; categories: Category[]; money: (n: number) => string;
  apply: ChangeSelected; close: () => void; done: () => void;
}) {
  const [values, setValues] = useState<Partial<Record<Field, string>>>({});
  const [previewHash, setPreviewHash] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null), lock = useRef(false);
  const dismiss = useCallback(() => { if (!lock.current) close(); }, [close]);
  useDialog(form, true, dismiss);
  const deleting = mode === 'delete';
  function toggle(field: Field) {
    setValues(previous => {
      const next = { ...previous };
      if (field in next) delete next[field];
      else next[field] = '';
      return next;
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const patch: ExpensePatch = {};
      for (const field of fields) {
        const value = values[field];
        if (value === undefined) continue;
        if (field === 'amount') patch.amount = parseAmount(value);
        else patch[field] = value;
      }
      if (patch.category && !previewHash) {
        const result = await apply(rows, { action: 'edit', patch }, { dry: true });
        if (!result.previewHash) throw new Error('Не удалось получить предпросмотр');
        setPreviewHash(result.previewHash);
        return;
      }
      await apply(rows, deleting ? { action: 'delete' } : { action: 'edit', patch }, { previewHash });
      done();
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось подтвердить изменения. Проверьте журнал.'); }
    finally { lock.current = false; setBusy(false); }
  }
  const heading = deleting ? 'Удалить выбранные траты?' : 'Изменить выбранные траты';
  return <div className="modal-backdrop"><form className="modal bulk-dialog" ref={form} role="dialog" aria-modal="true" aria-label={heading} onSubmit={submit}>
    <div className="section-heading"><h2>{heading}</h2><button type="button" onClick={dismiss} disabled={busy} aria-label="Закрыть"><Icon name="close"/></button></div>
    <strong>Выбрано: {rows.length} · {money(sum(rows))}</strong>
    <details><summary>Посмотреть выбранные траты</summary><ul>{rows.map(e => <li key={e.row}>{e.date} · {displayName(e)} · {money(e.amount)}</li>)}</ul></details>
    {deleting ? <p>Выбранные записи будут очищены в таблице. Отменить это действие после подтверждения нельзя.</p> : <>
      <p>Отметьте поля. Новые значения будут одинаковыми у всех выбранных трат.</p>
      {fields.map(field => <div key={field}>
        <label className="bulk-choice"><input type="checkbox" checked={field in values} disabled={busy || !!previewHash} onChange={() => toggle(field)}/>{labels[field]}</label>
        {field in values && (field === 'category'
          ? <select aria-label="Новая категория" value={values.category} required disabled={busy || !!previewHash} onChange={e => setValues({ ...values, category: e.target.value })}><option value="">Выберите категорию</option>{categories.filter(c => !c.archived).map(c => <option key={c.name} value={c.name}>{categoryTitle(c.name)}</option>)}</select>
          : <input aria-label={labels[field] + ' для выбранных трат'} value={values[field]} type={field === 'date' ? 'date' : 'text'} inputMode={field === 'amount' ? 'decimal' : undefined} maxLength={200} required={field === 'amount' || field === 'date'} disabled={busy || !!previewHash} placeholder={field === 'name' || field === 'comment' ? 'Пустое поле очистит значение' : undefined} onChange={e => setValues({ ...values, [field]: e.target.value })}/>)}
      </div>)}
    </>}
    {previewHash && <p role="status">Проверено трат: {rows.length}. Новая категория — {categoryTitle(values.category || '')}. Подтвердите изменение выбранных полей.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <button type="submit" className={deleting ? 'bulk-delete' : 'primary'} disabled={busy || (!deleting && !Object.keys(values).length)}>{busy ? 'Сохраняем…' : deleting ? `Удалить траты (${rows.length})` : values.category && !previewHash ? 'Предпросмотр изменений' : `Применить к выбранным (${rows.length})`}</button>
    <button type="button" disabled={busy} onClick={dismiss}>Отмена</button>
  </form></div>;
}

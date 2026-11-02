import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dateLabel } from '../lib/format';
import type { ChangeSelected } from '../lib/api';
import { useDialog } from '../lib/dialog';
import { displayName, parseAmount, sum, shiftDate } from '../../../shared/logic';
import { categoryTitle, inPeriod, type JournalFilter } from '../../../shared/analytics';
import { budget } from '../../../shared/config';
import { exitSnapshot, transitionScreen, useEnter, useFlip } from '../motion';
import Progress from '../motion/Progress';
import MonthPicker from './MonthPicker';
import RetryTime from './RetryTime';
import Icon from './Icon';
import BulkExpenseDialog from './BulkExpenseDialog';
import CategoryIcon from './CategoryIcon';
import { useMedia } from '../lib/media';
import { useDismissGesture } from '../lib/gestures';
import type { Bootstrap, BulkAction, Category, Expense } from '../../../shared/types';
import type { Queued } from '../lib/queue';
export default function Expenses({ data, openSettings, expenses: history, categories, queue, money, edit, changeSelected, remove, retry, editQueue, removeQueue, month, setMonth, range, clearRange, currentDay }: { data: Bootstrap | null; openSettings: () => void; expenses: Expense[]; categories: Category[]; queue: Queued[]; money: (n: number) => string; edit: (e: Expense, patch: Partial<Expense>) => Promise<void>; changeSelected: ChangeSelected; remove: (e: Expense) => void; retry: (q: Queued) => void; editQueue: (q: Queued, patch: Partial<Expense>) => Promise<void>; removeQueue: (q: Queued) => void; month: string; setMonth: (month: string) => void; range: JournalFilter | null; clearRange: () => void; currentDay: string }) {
  const expenses = range ? inPeriod(history, range).filter(e => !range.categories || range.categories.includes(e.category)) : history.filter(e => e.date.startsWith(month));
  const spent = sum(expenses), balance = data && budget(data, history, month, currentDay);
  const title = (name: string) => categoryTitle(name) + (categories.find(c => c.name === name)?.archived ? ' (архив)' : '');
  const earliest = history.reduce((min, e) => e.date.slice(0, 7) < min ? e.date.slice(0, 7) : min, currentDay.slice(0, 7));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState(''), [filter, setFilter] = useState(''), [editing, setEditing] = useState<Expense | null>(null), [queuedEdit, setQueuedEdit] = useState<Queued | null>(null);
  const [amount, setAmount] = useState(''), [name, setName] = useState(''), [category, setCategory] = useState(''), [date, setDate] = useState(''), [comment, setComment] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLFormElement>(null);
  const desktop = useMedia('(min-width: 1024px)');
  const close = useCallback(() => { exitSnapshot(dialog.current); setEditing(null); }, []);
  useEnter(dialog, editing ? editing.row || 'queue' : null, 'sheet');
  useDialog(dialog, !!editing && !desktop, close);
  useDismissGesture(dialog, !!editing && !desktop, close);
  const [queueUndo, setQueueUndo] = useState<Queued[]>([]), queueTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => { const timers = queueTimers.current; return () => timers.forEach(clearTimeout); }, []);
  function stageQueueRemoval(q: Queued) { if (queueTimers.current.has(q.id)) return; exitSnapshot(listRoot.current?.querySelector(`[data-motion-key="queue:${q.id}"]`) || null, true); setQueueUndo(rows => [...rows, q]); queueTimers.current.set(q.id, setTimeout(() => { queueTimers.current.delete(q.id); removeQueue(q); setQueueUndo(rows => rows.filter(r => r.id !== q.id)); }, 5000)); }
  function undoQueue(q: Queued) { clearTimeout(queueTimers.current.get(q.id)); queueTimers.current.delete(q.id); setQueueUndo(rows => rows.filter(r => r.id !== q.id)); }
  function open(e: Expense, q?: Queued) { setEditing(e); setQueuedEdit(q || null); setAmount(String(e.amount)); setName(e.name); setCategory(e.category); setDate(e.date); setComment(e.comment); setError(''); }
  const list = useMemo(() => expenses.filter(e => (!filter || e.category === filter) && `${e.name} ${e.category}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date) || b.row - a.row), [expenses, filter, search]);
  const groups = useMemo(() => { const groups = new Map<string, Expense[]>(); for (const e of list) if (e.category) { const rows = groups.get(e.date) || []; rows.push(e); groups.set(e.date, rows); } return [...groups]; }, [list]);
  const listRoot = useRef<HTMLDivElement>(null);
  useFlip(listRoot, `${month}|${list.map(e => e.row).join(',')}|${queue.map(q => q.id).join(',')}|${queueUndo.map(q => q.id).join(',')}`, '[data-motion-key]', true);
  const pending = list.filter(e => !e.category);
  const [selection, setSelection] = useState<Map<number, Expense> | null>(null);
  const [bulk, setBulk] = useState<{ mode: BulkAction['action']; rows: Expense[] } | null>(null);
  const closeBulk = useCallback(() => setBulk(null), []);
  useEffect(() => { setSelection(null); setBulk(null); }, [month, range, search, filter]);
  const selected = selection ? [...selection.values()] : [];
  const allSelected = list.length > 0 && list.every(e => selection?.has(e.row));
  function toggleRow(e: Expense) {
    if (!selection) { open(e); return; }
    setSelection(previous => {
      const next = new Map(previous);
      if (next.has(e.row)) next.delete(e.row); else next.set(e.row, e);
      return next;
    });
  }
  function row(e: Expense) {
    const checked = selection?.has(e.row);
    return <article className="expense-row" key={e.row} data-motion-key={`row:${e.row}`}>
      <button className="expense-main" onClick={() => toggleRow(e)} aria-pressed={checked} aria-label={`${displayName(e)} · ${title(e.category)} · ${money(e.amount)} · в таблице`}>
        {selection ? <span className="journal-check" aria-hidden="true">{checked && <Icon name="check"/>}</span> : <span className="expense-emoji"><CategoryIcon name={e.category}/></span>}
        <span className="expense-description"><strong title={displayName(e)}>{displayName(e)}</strong><small>{title(e.category)}</small></span><strong className="expense-amount">{money(e.amount)}</strong>
      </button></article>;
  }
  const dayTitle = (day: string) => day === currentDay ? 'Сегодня' : day === shiftDate(currentDay, -1) ? 'Вчера' : dateLabel(day, { weekday: 'short', day: 'numeric', month: 'long' });
  return <section className="journal-screen"><div className="section-heading journal-heading"><h1>Траты</h1>{data && <button className="text-button" disabled={!selection && !list.length} onClick={() => { close(); setSelection(selection ? null : new Map()); }}>{selection ? 'Завершить выбор' : 'Выбрать'}</button>}</div><div className="journal-layout"><div ref={listRoot} className="journal-list" inert={!!bulk || (!!editing && !desktop)}>
    {balance && <><div className="journal-total panel"><span>{range ? 'За выбранный период' : !balance.hasIncome ? 'Потрачено' : balance.balance < 0 ? 'Перерасход' : balance.balance === 0 ? 'Остаток' : 'Осталось'}</span><div className="budget-amount"><strong data-testid="journal-total">{money(range || !balance.hasIncome ? spent : Math.abs(balance.balance))}</strong></div>{!range && balance.hasIncome && <><div className={`progress ${balance.percent! >= 100 ? 'danger' : balance.percent! >= 85 ? 'warning' : 'good'}`} role="progressbar" aria-label="Использовано бюджета" aria-valuenow={Math.round(balance.percent!)} aria-valuemin={0} aria-valuemax={Math.max(100, Math.round(balance.percent!))}><Progress value={balance.percent! / 100}/></div><p className="footnote">Потрачено {balance.percent!.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}% дохода{balance.percent! >= 100 ? ' · Перерасход' : ''}</p>{balance.daily !== null && <p className="footnote">Можно тратить {money(Math.floor(balance.daily * 100) / 100)} в день</p>}</>}{!range && !balance.hasIncome && <button className="text-button" onClick={openSettings}>Укажите доходы в настройках</button>}</div>
    {range ? <div className="range-filter"><span>{range.start === range.end ? dateLabel(range.start, { day: 'numeric', month: 'long' }) : `${dateLabel(range.start, { day: 'numeric', month: 'short' })} – ${dateLabel(range.end, { day: 'numeric', month: 'short' })}`}{range.categories ? ` · ${range.categories.map(categoryTitle).join(', ')}` : ''}</span><button aria-label="Сбросить период и категорию" onClick={clearRange}><Icon name="close"/></button></div> : <MonthPicker month={month} setMonth={next => transitionScreen(() => setMonth(next), next > month ? 1 : -1)} earliest={earliest} current={currentDay.slice(0, 7)}/>}
    <div className="filters"><div className="search-field"><Icon name="search"/><input aria-label="Поиск трат" placeholder="Поиск трат" value={search} onChange={e => setSearch(e.target.value)}/></div><button className="icon-button" aria-label="Фильтры" title="Фильтры" aria-expanded={filtersOpen} aria-pressed={!!filter} onClick={() => setFiltersOpen(!filtersOpen)}><Icon name="filter"/></button></div>
    {filtersOpen && <div className="filter-panel panel"><label>Категория<select aria-label="Фильтр категории" value={filter} onChange={e => setFilter(e.target.value)}><option value="">Все категории</option>{categories.filter(c => !c.archived).map(c => <option key={c.name}>{c.name}</option>)}</select></label></div>}
    </>}
    {selection && <div className="panel selection-tools" aria-label="Выбор трат">
      <strong role="status">Выбрано: {selected.length} · {money(sum(selected))}</strong>
      <button onClick={() => setSelection(allSelected ? new Map() : new Map(list.map(e => [e.row, selection.get(e.row) || e])))} disabled={!list.length}>{allSelected ? 'Снять выделение' : `Выбрать все найденные (${list.length})`}</button>
      <div><button aria-label="Изменить выбранные" disabled={!selected.length || !navigator.onLine} onClick={() => setBulk({ mode: 'edit', rows: selected })}>Изменить</button>
      <button className="danger-action" aria-label="Удалить выбранные" disabled={!selected.length || !navigator.onLine} onClick={() => setBulk({ mode: 'delete', rows: selected })}>Удалить</button></div>
      {!navigator.onLine && <small>Для изменения записей нужен интернет.</small>}
      {!!queue.length && <small>Можно выбрать только траты, уже записанные в таблицу.</small>}
    </div>}
    {queue.length > 0 && <div className="queue-section"><h2>Ожидают отправки · {queue.length}</h2>{queue.filter(q => !queueUndo.some(item => item.id === q.id)).map(q => <article key={q.id} className="queue-card" data-motion-key={`queue:${q.id}`}><strong>{displayName(q.expense)} · {money(q.expense.amount)}</strong><p>{q.status === 'error' ? `Ошибка: ${q.error}` : !navigator.onLine ? 'В очереди · отправится при появлении сети' : q.error && q.lastAttempt?.kind !== 'offline' ? q.error : 'В очереди · ожидает отправки'}</p>{q.status === 'queued' && <RetryTime at={q.lastAttempt?.nextAt}/>}<div className="queue-actions"><button onClick={() => retry(q)}>Повторить</button><button onClick={() => open({ ...q.expense, row: 0, fp: '' }, q)}>Исправить</button><button onClick={() => stageQueueRemoval(q)}>Убрать</button></div></article>)}</div>}
    {pending.length > 0 && <div className="review-section"><h2>Нужно проверить</h2>{pending.map(row)}</div>}
    {groups.map(([day, rows]) => <div key={day} className="day-group"><div className="label-row"><h2>{dayTitle(day)}</h2><span>{money(sum(rows))}</span></div><div className="day-card">{rows.map(row)}</div></div>)}
    {data && !list.length && <div className="empty"><span>◌</span><h2>Пока нет трат</h2><p>Добавьте первую запись или измените фильтр.</p></div>}
    </div>{!!queueUndo.length && <div className="undo-stack">{queueUndo.map(q => <div key={q.id}><span>Убираем из очереди: {displayName(q.expense)}</span><button onClick={event => { exitSnapshot(event.currentTarget.parentElement); undoQueue(q); }}>Отменить</button></div>)}</div>}
    {data && !editing && desktop && <aside className="detail-placeholder panel"><Icon name="expenses"/><h2>Детали расхода</h2><p>Выберите запись слева, чтобы посмотреть или изменить её.</p></aside>}{editing && <div className={desktop ? "detail-panel" : "modal-backdrop"}><form ref={dialog} role={desktop ? "form" : "dialog"} aria-modal={desktop ? undefined : true} aria-label="Правка расхода" className="modal" onSubmit={async event => { event.preventDefault(); if (busy) return; setBusy(true); try { const patch = { amount: parseAmount(amount), name, category, date, comment }; if (!category) throw new Error('Выберите категорию'); if (queuedEdit) await editQueue(queuedEdit, patch); else await edit(editing, patch); close(); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); } finally { setBusy(false); } }}><div className="section-heading" data-drag-handle><h2>Правка расхода</h2><button type="button" aria-label="Закрыть" title="Закрыть" onClick={close}><Icon name="close"/></button></div><label>Сумма<input aria-label="Изменить сумму" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}/></label><label>Название<input value={name} onChange={e => setName(e.target.value)} maxLength={200}/></label><label>Категория<select value={category} onChange={e => setCategory(e.target.value)}><option value="">Выберите</option>{categories.filter(c => !c.archived || c.name === category).map(c => <option key={c.name} value={c.name}>{c.name}{c.archived ? " (архив)" : ""}</option>)}</select></label><label>Дата<input type="date" value={date} onChange={e => setDate(e.target.value)}/></label><label>Комментарий<textarea value={comment} maxLength={200} onChange={e => setComment(e.target.value)}/></label>{error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={busy}>Сохранить изменения</button><button type="button" className="danger-action" disabled={busy} onClick={() => { if (queuedEdit) stageQueueRemoval(queuedEdit); else { exitSnapshot(listRoot.current?.querySelector(`[data-motion-key="row:${editing.row}"]`) || null, true); remove(editing); } close(); }}>Удалить расход</button></form></div>}
  </div>{bulk && <BulkExpenseDialog mode={bulk.mode} rows={bulk.rows} categories={categories} money={money} apply={changeSelected} close={closeBulk} done={() => { closeBulk(); setSelection(null); }}/>}</section>;
}

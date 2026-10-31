import { useEffect, useMemo, useRef, useState } from 'react';
import { clean, parseAmount, shiftDate, suggestion, today } from '../../../shared/logic';
import type { Bootstrap, ExpenseInput } from '../../../shared/types';
import { categoryEmoji, categoryTitle } from '../../../shared/analytics';
import { animate, duration, reducedMotion, token } from '../motion';
import Icon from './Icon';
import NameInput from './NameInput';
export interface Draft { amount: string; name: string; source: string; ts?: number }
export default function Add({ data, draft, save, money }: { data: Bootstrap; draft: Draft; save: (e: ExpenseInput, ts?: number) => Promise<boolean>; money: (n: number) => string }) {
  const activeHistory = data.history.filter(e => data.categories.some(c => c.name === e.category && !c.archived));
  const form = useRef<HTMLElement>(null), saveButton = useRef<HTMLButtonElement>(null);
  const [amount, setAmount] = useState(draft.amount), [name, setName] = useState(draft.name);
  const [category, setCategory] = useState(suggestion(draft.name, activeHistory).category);
  useEffect(() => { if (category && !data.categories.some(c => c.name === category && !c.archived)) setCategory(''); }, [category, data.categories]);
  const [date, setDate] = useState(today(data.tz)), [comment, setComment] = useState(''), [error, setError] = useState('');
  useEffect(() => { if (error) animate(form.current?.querySelector('.amount-card') || null, [{ transform: 'translateX(0)' }, { transform: `translateX(-${token('motion-error')})` }, { transform: `translateX(${token('motion-error')})` }, { transform: 'translateX(0)' }]); }, [error]);
  const [dateMode, setDateMode] = useState<'today' | 'yesterday' | 'custom'>('today');
  useEffect(() => {
    const update = () => { if (dateMode !== 'custom') setDate(shiftDate(today(data.tz), dateMode === 'today' ? 0 : -1)); };
    const timer = setInterval(update, 30000); window.addEventListener('focus', update); document.addEventListener('visibilitychange', update); update();
    return () => { clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [data.tz, dateMode]);
  const [busy, setBusy] = useState(false), [source, setSource] = useState(draft.source || 'manual');
  useEffect(() => {
    const type = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (document.querySelector('.add-backdrop')?.hasAttribute('hidden') || document.querySelector('.modal-backdrop') || e.ctrlKey || e.metaKey || e.altKey || target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && target.id !== 'amount') return;
      if (/^[0-9,+.]$/.test(e.key)) { e.preventDefault(); setAmount(v => (v + e.key.replace('.', ',')).slice(0, 32)); }
      if (e.key === 'Backspace') { e.preventDefault(); setAmount(v => v.slice(0, -1)); }
    };
    document.addEventListener('keydown', type); return () => document.removeEventListener('keydown', type);
  }, []);
  const lock = useRef(false), id = useRef(`${Date.now()}-${crypto.randomUUID()}`);
  let total = 0; try { total = parseAmount(amount); } catch { /* incomplete expression while typing */ }
  const categories = useMemo(() => { if (data.config?.configured) return data.categories.filter(c => !c.archived); const counts = new Map<string, number>(); data.history.forEach(e => counts.set(e.category, (counts.get(e.category) || 0) + 1)); return [...data.categories].sort((a, b) => (counts.get(b.name) || 0) - (counts.get(a.name) || 0)); }, [data.categories, data.history, data.config?.configured]);
  function applyName(value: string) { setName(value); const hint = suggestion(value, activeHistory); if (hint.category) setCategory(hint.category); }
  async function submit() {
    if (lock.current) return;
    try {
      const parsed = parseAmount(amount);
      if (!category) { setError('Выберите категорию'); return; }
      lock.current = true; setBusy(true); setError('');
      const selectedDate = dateMode === 'custom' ? date : shiftDate(today(data.tz), dateMode === 'today' ? 0 : -1);
      if (await save({ id: id.current, amount: parsed, date: selectedDate, name: clean(name), category, comment: clean(comment), source }, draft.ts)) {
        setAmount(''); setName(''); setCategory(''); setComment(''); setSource('manual'); setDateMode('today'); setDate(today(data.tz)); id.current = `${Date.now()}-${crypto.randomUUID()}`;
        navigator.vibrate?.(25);
        const button = saveButton.current;
        if (button && !reducedMotion()) { button.classList.add('success'); const effect = animate(button.querySelector('.save-check'), [{ opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: 1, offset: .8 }, { opacity: 0 }], { duration: duration('dur-counter') }); void effect?.finished.then(() => button.classList.remove('success'), () => button.classList.remove('success')); }
        animate(form.current?.querySelector('.amount-card') || null, [{ opacity: .4 }, { opacity: 1 }]);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section ref={form} className="add-screen" data-invalid={!!error} aria-label="Новый расход">
    <h1>Новый расход</h1>
    {source !== 'manual' && <div className="payment-note">Из платежа · {source} <span>Проверьте и сохраните</span></div>}
    <div className="amount-card"><label htmlFor="amount">Сколько потратили?</label><div className="amount-line"><input id="amount" aria-label="Сумма" value={amount || '0'} readOnly inputMode="none"/><span>{data.currency}</span></div><div className="amount-caption">{amount.includes('+') ? `Итого: ${money(total)}` : 'В тенге. Название можно не указывать.'}</div></div>
    <div className="keypad" aria-label="Цифровая клавиатура">{['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '000', '+', '⌫'].map(key => <button key={key} type="button" aria-label={key === '⌫' ? 'Стереть цифру' : key === ',' ? 'Запятая' : key === '+' ? 'Плюс' : key} className={key === '⌫' ? 'backspace' : ''} onClick={() => setAmount(v => key === '⌫' ? v.slice(0, -1) : (v + key).slice(0, 32))}>{key === '⌫' ? <Icon name="erase"/> : key === '+' ? <Icon name="plus"/> : key}</button>)}</div>
    <div className="label-row"><h2>Категория</h2><span>{category ? 'Выбрана ✓' : 'Выберите одну'}</span></div>
    <div className="category-grid">{categories.map(c => <button type="button" key={c.name} className={category === c.name ? 'category selected' : 'category'} aria-pressed={category === c.name} aria-label={c.name} title={c.name} onClick={() => { setCategory(c.name); setError(''); }}><span className="category-emoji">{categoryEmoji(c.name)}</span><span className="category-label">{categoryTitle(c.name)}</span></button>)}</div>
    <NameInput value={name} onChange={applyName} history={activeHistory}/>
    <div className="date-row"><button aria-pressed={dateMode === 'today'} className={dateMode === 'today' ? 'chip active' : 'chip'} onClick={() => { setDateMode('today'); setDate(today(data.tz)); }}>Сегодня</button><button aria-pressed={dateMode === 'yesterday'} className={dateMode === 'yesterday' ? 'chip active' : 'chip'} onClick={() => { setDateMode('yesterday'); setDate(shiftDate(today(data.tz), -1)); }}>Вчера</button><input aria-label="Дата расхода" type="date" value={date} max={shiftDate(today(data.tz), 1)} onChange={e => { setDateMode('custom'); setDate(e.target.value); }}/></div>
    {dateMode !== 'today' && <p className="date-notice" role="status">Дата записи: {date} · {dateMode === 'yesterday' ? 'выбрано «Вчера»' : 'выбрана вручную'}</p>}
    <details className="comment-details"><summary>Добавить комментарий</summary><textarea aria-label="Комментарий" maxLength={200} value={comment} onChange={e => setComment(e.target.value)}/></details>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="save-bar"><div className="keyboard-amount" aria-label="Текущая сумма">{money(total)}<button onClick={() => { (document.activeElement as HTMLElement)?.blur(); document.getElementById('amount')?.scrollIntoView({ block: 'center' }); }}>Изменить сумму</button></div><button ref={saveButton} className="primary save" disabled={busy || !total || !category} onClick={() => void submit()}><span className="save-label">{busy ? 'Сохраняем…' : `Сохранить${total ? ` · ${money(total)}` : ''}`}</span><Icon name="arrow"/><span className="save-check" aria-hidden="true"><Icon name="check"/></span></button></div>
  </section>;
}

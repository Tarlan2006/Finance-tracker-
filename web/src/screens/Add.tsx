import { useRef, useState } from 'react';
import { clean, nameSuggestions, parseAmount, shiftDate, suggestion, today } from '../../../shared/logic';
import { parseVoice } from '../../../shared/parse-notification';
import type { Bootstrap, ExpenseInput } from '../../../shared/types';
interface SpeechRecognitionLike { lang: string; start(): void; onresult: ((event: { results: { transcript: string }[][] }) => void) | null; onerror: (() => void) | null }
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
export interface Draft { amount: string; name: string; source: string; ts?: number }
export default function Add({ data, draft, save, money }: { data: Bootstrap; draft: Draft; save: (e: ExpenseInput, ts?: number) => Promise<boolean>; money: (n: number) => string }) {
  const [amount, setAmount] = useState(draft.amount), [name, setName] = useState(draft.name);
  const [category, setCategory] = useState(suggestion(draft.name, data.history).category);
  const [date, setDate] = useState(today(data.tz)), [comment, setComment] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [source, setSource] = useState(draft.source || 'manual');
  const lock = useRef(false), id = useRef(`${Date.now()}-${crypto.randomUUID()}`);
  let total = 0; try { total = parseAmount(amount); } catch { /* incomplete expression while typing */ }
  const categories = [...data.categories].sort((a, b) => data.history.filter(e => e.category === b.name).length - data.history.filter(e => e.category === a.name).length);
  const Speech = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
  function applyName(value: string) { setName(value); const hint = suggestion(value, data.history); if (hint.category) setCategory(hint.category); }
  function voice() { if (!Speech) return; const speech = new Speech(); speech.lang = 'ru-RU'; speech.onresult = e => { try { const parsed = parseVoice(e.results[0][0].transcript); setAmount(String(parsed.amount)); applyName(parsed.name); setError(''); } catch { setError('Не удалось разобрать сумму. Попробуйте ещё раз'); } }; speech.onerror = () => setError('Голосовой ввод недоступен. Введите сумму кнопками'); speech.start(); }
  async function submit() {
    if (lock.current) return;
    try {
      const parsed = parseAmount(amount);
      if (!category) { setError('Выберите категорию'); return; }
      lock.current = true; setBusy(true); setError('');
      if (await save({ id: id.current, amount: parsed, date, name: clean(name), category, comment: clean(comment), source }, draft.ts)) {
        setAmount(''); setName(''); setCategory(''); setComment(''); setSource('manual'); setDate(today(data.tz)); id.current = `${Date.now()}-${crypto.randomUUID()}`;
        navigator.vibrate?.(25);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="add-screen" aria-label="Новый расход">
    <div className="section-heading"><div><p className="eyebrow">БЫСТРАЯ ЗАПИСЬ</p><h1>Новый расход</h1></div><span className="round-icon">↗</span></div>
    {source !== 'manual' && <div className="payment-note">Из платежа · {source} <span>Проверьте и сохраните</span></div>}
    <div className="amount-card"><label htmlFor="amount">Сколько потратили?</label><div className="amount-line"><input id="amount" aria-label="Сумма" value={amount || '0'} readOnly inputMode="none"/><span>{data.currency}</span></div><div className="amount-caption">{amount.includes('+') ? `Итого: ${money(total)}` : 'В тенге. Название можно не указывать.'}</div></div>
    <div className="keypad" aria-label="Цифровая клавиатура">{['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '000', '+', '⌫'].map(key => <button key={key} type="button" aria-label={key === '⌫' ? 'Стереть цифру' : key === ',' ? 'Запятая' : key === '+' ? 'Плюс' : key} className={key === '⌫' ? 'backspace' : ''} onClick={() => setAmount(v => key === '⌫' ? v.slice(0, -1) : (v + key).slice(0, 32))}>{key}</button>)}</div>
    <div className="label-row"><h2>Категория</h2><span>{category ? 'Выбрана ✓' : 'Выберите одну'}</span></div>
    <div className="category-grid">{categories.map(c => { const space = c.name.indexOf(' '); return <button type="button" key={c.name} className={category === c.name ? 'category selected' : 'category'} aria-pressed={category === c.name} aria-label={c.name} onClick={() => { setCategory(c.name); setError(''); }}><span className="category-emoji">{c.name.slice(0, space)}</span><span>{c.name.slice(space + 1)}</span></button>; })}</div>
    <div className="optional"><label htmlFor="name">Название <span>необязательно</span></label><div className="input-with-action"><input id="name" placeholder="Например, Magnum" maxLength={200} value={name} onChange={e => applyName(e.target.value)} list="history-names"/>{Speech && <button type="button" aria-label="Голосовой ввод" onClick={voice}>🎙</button>}</div><datalist id="history-names">{nameSuggestions(data.history).slice(0, 30).map(n => <option key={n} value={n}/>)}</datalist></div>
    <div className="date-row"><button className={date === today(data.tz) ? 'chip active' : 'chip'} onClick={() => setDate(today(data.tz))}>Сегодня</button><button className={date === shiftDate(today(data.tz), -1) ? 'chip active' : 'chip'} onClick={() => setDate(shiftDate(today(data.tz), -1))}>Вчера</button><input aria-label="Дата расхода" type="date" value={date} max={shiftDate(today(data.tz), 1)} onChange={e => setDate(e.target.value)}/></div>
    <details className="comment-details"><summary>Добавить комментарий</summary><textarea aria-label="Комментарий" maxLength={200} value={comment} onChange={e => setComment(e.target.value)}/></details>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="save-bar"><button className="primary save" disabled={busy || !total || !category} onClick={() => void submit()}>{busy ? 'Сохраняем…' : `Сохранить${total ? ` · ${money(total)}` : ''}`} <span>↗</span></button></div>
  </section>;
}

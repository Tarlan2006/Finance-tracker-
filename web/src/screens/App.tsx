import { useCallback, useEffect, useRef, useState } from 'react';
import { displayName, looksDuplicate, shiftMonth, today, validateExpense } from '../../../shared/logic';
import type { Bootstrap, Expense, ExpenseInput } from '../../../shared/types';
import { api } from '../lib/api';
import { allQueued, enqueue, flushQueue, putQueued, removeQueued, retryQueued, setQueueKey, type Queued } from '../lib/queue';
import Add, { type Draft } from './Add';
import Expenses from './Expenses';
import Overview from './Overview';
const tabs = [{ name: 'Добавить', icon: '+' }, { name: 'Траты', icon: '≡' }, { name: 'Обзор', icon: '◔' }, { name: 'Ещё', icon: '···' }];
function readDraft(): Draft { const p = new URLSearchParams(location.search); const draft = { amount: p.get('amount') || '', name: p.get('merchant') || '', source: p.get('src') || 'manual', ts: p.has('ts') ? Number(p.get('ts')) * 1000 : undefined }; if (p.has('amount') || p.has('merchant')) history.replaceState(null, '', location.pathname); return draft; }
// Consume once, including React StrictMode's development remount.
const initialDraft = readDraft();
export default function App() {
  const [key, setKey] = useState(localStorage.getItem('app-key') || ''), [keyInput, setKeyInput] = useState(''), [owner, setOwner] = useState('');
  const [data, setData] = useState<Bootstrap | null>(null), [tab, setTab] = useState(0), [month, setMonth] = useState(today('Asia/Almaty').slice(0, 7));
  const [queue, setQueue] = useState<Queued[]>([]), [online, setOnline] = useState(navigator.onLine), [error, setError] = useState(''), [toast, setToast] = useState(''), [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'system');
  const [deletions, setDeletions] = useState<Expense[]>([]), timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const [duplicate, setDuplicate] = useState<{ expense: ExpenseInput; resolve: (yes: boolean) => void } | null>(null);
  const [draft, setDraft] = useState(initialDraft);
  const notify = (text: string) => { setToast(text); setTimeout(() => setToast(''), 5000); };
  const money = useCallback((n: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n)} ${data?.currency || '₸'}`, [data?.currency]);
  const reload = useCallback(async () => {
    if (!key || !owner) return;
    try { const b = await api<Bootstrap>(`bootstrap?month=${month}`, key); setData(b); localStorage.setItem(`bootstrap-${owner}`, JSON.stringify(b)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Нет связи с таблицей'); }
  }, [key, owner, month]);
  const sync = useCallback(async () => {
    if (!owner) return;
    await flushQueue(); setQueue(await allQueued(owner));
    if (navigator.onLine) await reload();
  }, [owner, reload]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('theme', theme); }, [theme]);
  useEffect(() => {
    let active = true;
    if (!key) return;
    void (async () => { try { const id = await setQueueKey(key); if (!active) return; setOwner(id); const cache = localStorage.getItem(`bootstrap-${id}`); if (cache) setData(JSON.parse(cache)); setQueue(await allQueued(id)); } catch { setError('Хранилище недоступно. Разрешите сохранение данных сайта'); } })();
    return () => { active = false; };
  }, [key]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const network = () => { setOnline(navigator.onLine); if (navigator.onLine) void sync(); };
    const message = () => void sync();
    window.addEventListener('online', network); window.addEventListener('offline', network); navigator.serviceWorker?.addEventListener('message', message);
    const timer = setInterval(() => { if (navigator.onLine) void sync(); }, 15000);
    void sync();
    return () => { clearInterval(timer); window.removeEventListener('online', network); window.removeEventListener('offline', network); navigator.serviceWorker?.removeEventListener('message', message); };
  }, [sync]);
  // Display cached history for the selected month while offline.
  const visibleData = data ? { ...data, expenses: data.history.filter(e => e.date.startsWith(month) && !deletions.some(d => d.row === e.row)), summary: data.summaries.find(s => s.month === month) || null } : null;
  async function login() { setLoading(true); setError(''); try { const b = await api<Bootstrap>(`bootstrap?month=${month}`, keyInput); const id = await setQueueKey(keyInput); localStorage.setItem('app-key', keyInput); localStorage.setItem(`bootstrap-${id}`, JSON.stringify(b)); setOwner(id); setData(b); setKey(keyInput); setKeyInput(''); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось войти'); } finally { setLoading(false); } }
  async function save(e: ExpenseInput, ts?: number) {
    if (!data) return false;
    validateExpense(e, data.categories, data.tz);
    const previous = [...data.history, ...queue.map(q => q.expense)];
    if (looksDuplicate(e, previous, data.duplicateWindow, Date.now(), ts)) {
      const yes = await new Promise<boolean>(resolve => setDuplicate({ expense: e, resolve }));
      if (!yes) return false;
    }
    await enqueue(e, owner); setQueue(await allQueued(owner));
    setDraft({ amount: '', name: '', source: 'manual' });
    notify(navigator.onLine ? 'Сохранено · отправляется в таблицу' : 'Сохранено в очередь');
    if ('serviceWorker' in navigator) void navigator.serviceWorker.getRegistration().then(reg => (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } } | undefined)?.sync?.register('finance-queue')).catch(() => undefined);
    void sync(); return true;
  }
  async function edit(e: Expense, patch: Partial<Expense>) { await api(`expenses/${e.row}`, key, { method: 'PATCH', body: JSON.stringify({ ...patch, fp: e.fp }) }); await reload(); notify('Изменения сохранены'); }
  function remove(e: Expense) {
    if (timers.current.has(e.row)) return;
    setDeletions(items => [...items, e]);
    const timer = setTimeout(() => { timers.current.delete(e.row); void (async () => { try { await api(`expenses/${e.row}?fp=${encodeURIComponent(e.fp)}`, key, { method: 'DELETE' }); await reload(); notify('Запись удалена'); } catch (err) { setError(err instanceof Error ? err.message : 'Ошибка удаления'); } finally { setDeletions(items => items.filter(x => x.row !== e.row)); } })(); }, 5000);
    timers.current.set(e.row, timer);
  }
  function undo(e: Expense) { clearTimeout(timers.current.get(e.row)); timers.current.delete(e.row); setDeletions(items => items.filter(x => x.row !== e.row)); }
  async function logout() { timers.current.forEach(clearTimeout); timers.current.clear(); setDeletions([]); await setQueueKey(''); localStorage.removeItem('app-key'); setKey(''); setOwner(''); setData(null); setQueue([]); setError(''); }
  async function exportCsv() { try { const r = await fetch(`/api/export.csv?month=${month}`, { headers: { 'X-App-Key': key } }); if (!r.ok) throw new Error('Экспорт недоступен. Проверьте сеть и код доступа'); const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = `expenses-${month}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (e) { setError((e as Error).message); } }
  if (!key) return <main className="login"><div className="brand-mark">₸</div><p className="eyebrow">ЛИЧНЫЕ ФИНАНСЫ</p><h1>Каждая трата<br/>на своём месте.</h1><p className="login-description">Быстрые записи. Понятный бюджет.<br/>Ваша привычная Google-таблица.</p><form onSubmit={e => { e.preventDefault(); void login(); }}><label htmlFor="access-key">Код доступа</label><input id="access-key" type="password" autoComplete="current-password" value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder="Введите ваш код" required/>{error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={loading}>{loading ? 'Подключаем…' : 'Войти →'}</button></form><small>Теңге · личный трекер расходов</small></main>;
  return <div className="app-shell"><header className="app-header"><a className="brand" href="/" onClick={e => { e.preventDefault(); setTab(0); }}><span className="brand-mark small">₸</span><span>теңге<span className="brand-sub">ЛИЧНЫЙ ЖУРНАЛ</span></span></a><span className={online ? 'connection' : 'connection offline'}><i/>{online ? data?.mock ? 'Демо-режим' : 'На связи' : 'Офлайн'}{queue.length ? ` · ${queue.length}` : ''}</span></header>
    {error && <div className="error-banner" role="alert">{error} <button onClick={() => void reload()}>Обновить</button><button onClick={() => void logout()}>Выйти</button></div>}
    <main>{(tab === 1 || tab === 2 || tab === 3) && <div className="month-picker"><button aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button><span>{new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`))}</span><button aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))}>›</button></div>}
    {!visibleData ? <div className="empty"><h1>Подключаем таблицу…</h1><p>Для первого входа нужен интернет.</p></div> : <>
      <div hidden={tab !== 0}><Add data={data!} draft={draft} save={save} money={money}/></div>
      {tab === 1 && <Expenses expenses={visibleData.expenses} categories={data!.categories} queue={queue} money={money} edit={edit} remove={remove} retry={q => void retryQueued(q).then(sync)} editQueue={async (q, patch) => { const expense = validateExpense({ ...q.expense, ...patch }, data!.categories, data!.tz); await putQueued({ ...q, expense, status: 'queued', error: undefined, attempts: 0, nextAt: 0 }); await sync(); }} removeQueue={q => void removeQueued(q.id).then(async () => setQueue(await allQueued(owner)))}/>}
      {tab === 2 && <Overview data={visibleData} month={month} money={money}/>}
      {tab === 3 && <section><p className="eyebrow">ПОД ВАШ КОНТРОЛЬ</p><h1>Ещё</h1><div className="panel"><h2>Синхронизация</h2><p>{queue.length ? `${queue.length} записей в очереди` : 'Все записи отправлены'}</p><button className="secondary" onClick={() => void sync()}>Синхронизировать</button><p className="muted">Очередь хранится на этом устройстве. После выхода она останется до следующего входа с тем же кодом.</p></div><div className="panel"><h2>Оформление</h2><label>Тема<select aria-label="Тема" value={theme} onChange={e => setTheme(e.target.value)}><option value="system">Как в системе</option><option value="dark">Тёмная</option><option value="light">Светлая</option></select></label></div><div className="panel"><h2>Данные</h2><button className="secondary" onClick={() => void exportCsv()}>Экспорт CSV за месяц</button><p className="muted">Категории и лимиты меняются в листе «Справочник». Изменения появятся в течение 5 минут.</p></div><div className="panel"><h2>Запись из уведомления</h2><p>MacroDroid открывает ссылку с суммой и магазином. Проверьте категорию и сохраните.</p><ol><li>Разрешите доступ к уведомлениям и работу без ограничения батареи.</li><li>Создайте отдельные триггеры для Wallet и Kaspi.</li><li>Извлеките сумму и магазин; входящие и переводы себе пропустите.</li><li>Откройте ссылку с URL-кодированными параметрами amount, merchant, src.</li></ol><a href="/MACRODROID.md" target="_blank" rel="noreferrer">Полная инструкция ↗</a></div><div className="panel"><h2>Код доступа</h2><p>Для смены кода обновите секрет APP_KEY командой wrangler secret put APP_KEY, затем войдите заново. Сначала отправьте очередь.</p><button className="secondary" onClick={() => void logout()}>Выйти</button></div><p className="version">Теңге 1.0.0 · {data!.tz}<br/>Ваши записи — в вашей таблице.</p></section>}
    </> }</main>
    <nav className="bottom-nav" aria-label="Основная навигация">{tabs.map((t, i) => <button key={t.name} aria-current={tab === i ? 'page' : undefined} onClick={() => { setTab(i); window.scrollTo({ top: 0 }); }}><span>{t.icon}</span>{t.name}</button>)}</nav>
    {toast && <div role="status" className="toast">✓ {toast}</div>}
    {!!deletions.length && <div className="undo-stack">{deletions.map(e => <div key={e.row}><span>Удаляем: {displayName(e)}</span><button onClick={() => undo(e)}>Отменить</button></div>)}</div>}
    {duplicate && <div className="modal-backdrop"><div role="dialog" aria-modal="true" aria-label="Похоже на дубль" className="modal"><h2>Похоже на дубль</h2><p>{displayName(duplicate.expense)} · {money(duplicate.expense.amount)}</p><p>Такая трата уже есть. Всё равно сохранить?</p><button className="primary" onClick={() => { duplicate.resolve(true); setDuplicate(null); }}>Всё равно сохранить</button><button onClick={() => { duplicate.resolve(false); setDuplicate(null); }}>Отмена</button></div></div>}
  </div>;
}

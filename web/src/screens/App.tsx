import { useCallback, useEffect, useRef, useState } from 'react';
import { displayName, looksDuplicate, shiftMonth, today, validateExpense } from '../../../shared/logic';
import type { Bootstrap, Expense, ExpenseInput } from '../../../shared/types';
import { api } from '../lib/api';
import { allQueued, changeQueued, discardQueued, enqueue, flushQueue, retryQueued, setQueueKey, type Queued } from '../lib/queue';
import Add, { type Draft } from './Add';
import Expenses from './Expenses';
import Overview from './Overview';
import { dateLabel } from '../../../shared/dates';
import { useVisualViewport } from '../lib/viewport';
import { useDialog } from '../lib/dialog';
import { storage } from '../lib/storage';
import { readCachedBootstrap } from '../lib/data';
const tabs = [{ name: 'Добавить', icon: '+' }, { name: 'Траты', icon: '≡' }, { name: 'Обзор', icon: '◔' }, { name: 'Ещё', icon: '···' }];
function readDraft(): Draft { const p = new URLSearchParams(location.search); const draft = { amount: p.get('amount') || '', name: p.get('merchant') || '', source: p.get('src') || 'manual', ts: p.has('ts') ? Number(p.get('ts')) * 1000 : undefined }; if (p.has('amount') || p.has('merchant')) history.replaceState(null, '', location.pathname); return draft; }
// Consume once, including React StrictMode's development remount.
const initialDraft = readDraft();
export default function App() {
  useVisualViewport();
  const [key, setKey] = useState(storage.getItem('app-key') || ''), [keyInput, setKeyInput] = useState(''), [owner, setOwner] = useState('');
  const [data, setData] = useState<Bootstrap | null>(null), [tab, setTab] = useState(0), [month, setMonth] = useState(today('Asia/Almaty').slice(0, 7));
  const [queue, setQueue] = useState<Queued[]>([]), [online, setOnline] = useState(navigator.onLine), [error, setError] = useState(''), [toast, setToast] = useState(''), [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState(storage.getItem('theme') || 'system');
  const [deletions, setDeletions] = useState<Expense[]>([]), timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const [duplicate, setDuplicate] = useState<{ expense: ExpenseInput; resolve: (yes: boolean) => void } | null>(null);
  const [draft, setDraft] = useState(initialDraft);
  const knownQueue = useRef<Queued[]>([]);
  knownQueue.current = queue;
  const session = useRef(key), requestSequence = useRef(0), dialogRef = useRef<HTMLDivElement>(null);
  const [logoutPrompt, setLogoutPrompt] = useState(false);
  const cancelDialog = useCallback(() => { duplicate?.resolve(false); setDuplicate(null); setLogoutPrompt(false); }, [duplicate]);
  useDialog(dialogRef, !!duplicate || logoutPrompt, cancelDialog);
  const showError = (e: unknown) => setError(e instanceof Error ? e.message : 'Не удалось выполнить действие. Повторите');
  function closeSession() {
    session.current = ''; requestSequence.current++;
    timers.current.forEach(clearTimeout); timers.current.clear(); setDeletions([]);
    duplicate?.resolve(false); setDuplicate(null); setKey(''); setOwner(''); setData(null); setQueue([]); setToast(''); setLogoutPrompt(false);
  }
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === 'app-key' && event.newValue !== session.current) closeSession(); };
    const back = (event: PopStateEvent) => setTab(Number(event.state?.tab) || 0);
    window.addEventListener('storage', changed); window.addEventListener('popstate', back);
    return () => { window.removeEventListener('storage', changed); window.removeEventListener('popstate', back); };
  });
  const notify = (text: string) => { setToast(text); setTimeout(() => setToast(''), 5000); };
  const money = useCallback((n: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n)} ${data?.currency || '₸'}`, [data?.currency]);
  const reload = useCallback(async () => {
    if (!key || !owner || session.current !== key) return;
    const sequence = ++requestSequence.current;
    try { const b = await api<Bootstrap>(`bootstrap?month=${month}`, key); if (session.current !== key || sequence !== requestSequence.current) return; setData(b); storage.setItem(`bootstrap-${owner}`, JSON.stringify(b)); setError(''); }
    catch (e) { if (session.current === key && sequence === requestSequence.current) setError(e instanceof Error ? e.message : 'Нет связи с таблицей. Повторите'); }
  }, [key, owner, month]);
  const sync = useCallback(async () => {
    if (!owner || session.current !== key) return;
    try {
      const displayed = knownQueue.current; const before = await allQueued(owner); await flushQueue();
      if (session.current !== key) return;
      const after = await allQueued(owner); setQueue(after);
      if (navigator.onLine && [...before, ...displayed].some(row => !after.some(item => item.id === row.id))) await reload();
    } catch (e) { if (session.current === key) showError(e); }
  }, [owner, key, reload]);
  useEffect(() => { document.documentElement.dataset.theme = theme; storage.setItem('theme', theme); }, [theme]);
  useEffect(() => {
    let active = true;
    if (!key) return;
    void (async () => { try { if (storage.getItem('app-key') !== key) return; const id = await setQueueKey(key, () => active && session.current === key && storage.getItem('app-key') === key); if (!active || session.current !== key) return; setOwner(id); const cache = storage.getItem(`bootstrap-${id}`); if (cache) setData(readCachedBootstrap(cache)); const rows = await allQueued(id); if (session.current === key) setQueue(rows); } catch { if (active) setError('Хранилище недоступно. Разрешите сохранение данных сайта'); } })();
    return () => { active = false; };
  }, [key]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const network = () => { setOnline(navigator.onLine); if (navigator.onLine) { void sync(); void reload(); } };
    const message = () => void sync();
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('tenge-sync') : null; if (channel) channel.onmessage = message;
    window.addEventListener('online', network); window.addEventListener('offline', network); navigator.serviceWorker?.addEventListener('message', message);
    const timer = setInterval(() => { if (navigator.onLine) void sync(); }, 15000);
    void sync();
    return () => { channel?.close(); clearInterval(timer); window.removeEventListener('online', network); window.removeEventListener('offline', network); navigator.serviceWorker?.removeEventListener('message', message); };
  }, [sync, reload]);
  // Display cached history for the selected month while offline.
  const visibleData = data ? { ...data, expenses: data.history.filter(e => e.date.startsWith(month) && !deletions.some(d => d.row === e.row)), summary: data.summaries.find(s => s.month === month) || null } : null;
  async function login() { setLoading(true); setError(''); try { const b = await api<Bootstrap>('bootstrap', keyInput); if (!storage.setItem('app-key', keyInput)) throw new Error('Разрешите хранение данных сайта для входа'); const id = await setQueueKey(keyInput); storage.setItem(`bootstrap-${id}`, JSON.stringify(b)); session.current = keyInput; setMonth(today(b.tz).slice(0, 7)); setOwner(id); setData(b); setKey(keyInput); setKeyInput(''); } catch (e) { showError(e); } finally { setLoading(false); } }
  async function save(e: ExpenseInput, ts?: number) {
    if (!data || session.current !== key) return false;
    validateExpense(e, data.categories, data.tz);
    const previous = [...data.history, ...queue.map(q => q.expense)];
    if (looksDuplicate(e, previous, data.duplicateWindow, Date.now(), ts)) {
      const yes = await new Promise<boolean>(resolve => setDuplicate({ expense: e, resolve }));
      if (!yes) return false;
    }
    await enqueue(e, owner); setQueue(await allQueued(owner));
    setDraft({ amount: '', name: '', source: 'manual' });
    notify(navigator.onLine ? 'Сохранено · отправляется в таблицу' : 'Сохранено в очередь');
    void sync(); return true;
  }
  async function edit(e: Expense, patch: Partial<Expense>) { await api(`expenses/${e.row}`, key, { method: 'PATCH', body: JSON.stringify({ ...patch, fp: e.fp }) }); await reload(); notify('Изменения сохранены'); }
  function remove(e: Expense) {
    if (timers.current.has(e.row)) return;
    setDeletions(items => [...items, e]);
    const timer = setTimeout(() => { timers.current.delete(e.row); void (async () => { try { await api(`expenses/${e.row}`, key, { method: 'DELETE', body: JSON.stringify({ fp: e.fp }) }); await reload(); notify('Запись удалена'); } catch (err) { setError(err instanceof Error ? err.message : 'Ошибка удаления'); } finally { setDeletions(items => items.filter(x => x.row !== e.row)); } })(); }, 5000);
    timers.current.set(e.row, timer);
  }
  function undo(e: Expense) { clearTimeout(timers.current.get(e.row)); timers.current.delete(e.row); setDeletions(items => items.filter(x => x.row !== e.row)); }
  async function logout() {
    try {
      await setQueueKey('');
      if (!storage.removeItem('app-key')) throw new Error('Storage unavailable');
      storage.keys().filter(k => k.startsWith('bootstrap-')).forEach(k => storage.removeItem(k));
      closeSession(); setError('');
    } catch { setError('Не удалось защитить очередь. Не закрывайте приложение: повторите выход'); }
  }
  function requestLogout() { if (queue.length) setLogoutPrompt(true); else void logout(); }
  async function exportCsv() { try { const r = await fetch(`/api/export.csv?month=${month}`, { headers: { 'X-App-Key': key } }); if (!r.ok || !r.headers.get('Content-Type')?.includes('text/csv')) throw new Error('Экспорт недоступен. Проверьте сеть и код доступа'); const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = `expenses-${month}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (e) { setError((e as Error).message); } }
  if (!key) return <main className="login"><div className="brand-mark">₸</div><p className="eyebrow">ЛИЧНЫЕ ФИНАНСЫ</p><h1>Каждая трата<br/>на своём месте.</h1><p className="login-description">Быстрые записи. Понятный бюджет.<br/>Ваша привычная Google-таблица.</p><form onSubmit={e => { e.preventDefault(); void login(); }}><label htmlFor="access-key">Код доступа</label><input id="access-key" type="password" autoComplete="current-password" value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder="Введите ваш код" required/>{error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={loading}>{loading ? 'Подключаем…' : 'Войти →'}</button></form><small>Теңге · личный трекер расходов</small></main>;
  return <div className="app-shell"><header className="app-header"><a className="brand" href="/" onClick={e => { e.preventDefault(); setTab(0); }}><span className="brand-mark small">₸</span><span>теңге<span className="brand-sub">ЛИЧНЫЙ ЖУРНАЛ</span></span></a><span className={online ? 'connection' : 'connection offline'}><i/>{online ? data?.mock ? 'Демо-режим' : 'На связи' : 'Офлайн'}{queue.length ? ` · ${queue.length}` : ''}</span></header>
    {error && <div className="error-banner" role="alert">{error} <button onClick={() => void reload()}>Обновить</button><button onClick={requestLogout}>Выйти</button></div>}
    <main>{(tab === 1 || tab === 2 || tab === 3) && <div className="month-picker"><button aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button><span>{dateLabel(`${month}-01`, { month: 'long', year: 'numeric' })}</span><button aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))}>›</button></div>}
    {!visibleData ? <div className="loading-state" aria-busy="true"><div className="skeleton"/><div className="skeleton"/><h1>Подключаем таблицу…</h1><p>Для первого входа нужен интернет.</p></div> : <>
      <div hidden={tab !== 0}><Add data={data!} draft={draft} save={save} money={money}/></div>
      {tab === 1 && <Expenses expenses={visibleData.expenses} categories={data!.categories} queue={queue} money={money} edit={edit} remove={remove} retry={q => void retryQueued(q).then(sync).catch(showError)} editQueue={async (q, patch) => { const expense = validateExpense({ ...q.expense, ...patch }, data!.categories, data!.tz); await changeQueued(q, expense); await sync(); }} removeQueue={q => void discardQueued(q).then(sync).catch(showError)}/>}
      {tab === 2 && <Overview data={visibleData} month={month} money={money}/>}
      {tab === 3 && <section><p className="eyebrow">ПОД ВАШ КОНТРОЛЬ</p><h1>Ещё</h1><div className="panel"><h2>Синхронизация</h2><p>{queue.length ? `${queue.length} записей в очереди` : 'Все записи отправлены'}</p><button className="secondary" onClick={() => void sync()}>Синхронизировать</button><p className="muted">После выхода очередь зашифрована и откроется с прежним кодом. Очистка данных сайта удалит неотправленные записи. Перед сменой кода отправьте очередь.</p></div><div className="panel"><h2>Оформление</h2><label>Тема<select aria-label="Тема" value={theme} onChange={e => setTheme(e.target.value)}><option value="system">Как в системе</option><option value="dark">Тёмная</option><option value="light">Светлая</option></select></label></div><div className="panel"><h2>Данные</h2><button className="secondary" onClick={() => void exportCsv()}>Экспорт CSV за месяц</button><p className="muted">Категории и лимиты меняются в листе «Справочник». Изменения появятся в течение 5 минут.</p></div><div className="panel"><h2>Запись из уведомления</h2><p>MacroDroid открывает ссылку с суммой и магазином. Проверьте категорию и сохраните.</p><ol><li>Разрешите доступ к уведомлениям и работу без ограничения батареи.</li><li>Создайте отдельные триггеры для Wallet и Kaspi.</li><li>Извлеките сумму и магазин; входящие и переводы себе пропустите.</li><li>Откройте ссылку с URL-кодированными параметрами amount, merchant, src.</li></ol><a href="/MACRODROID.md" target="_blank" rel="noreferrer">Полная инструкция ↗</a></div><div className="panel"><h2>Код доступа</h2><p>Выход удалит код и сохранённую историю с этого устройства. Для следующего входа нужен код доступа.</p><button className="danger-action" onClick={requestLogout}>Выйти</button></div><p className="version">Теңге 1.1.0 · {data!.tz}<br/>Ваши записи — в вашей таблице.</p></section>}
    </> }</main>
    <nav className="bottom-nav" aria-label="Основная навигация">{tabs.map((t, i) => <button key={t.name} aria-current={tab === i ? 'page' : undefined} onClick={() => { history.pushState({ tab: i }, '', location.pathname); setTab(i); window.scrollTo({ top: 0 }); }}><span>{t.icon}</span>{t.name}</button>)}</nav>
    {logoutPrompt && <div className="modal-backdrop"><div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Выход с очередью" className="modal"><h2>В очереди {queue.length} записей</h2><p>Очередь останется зашифрованной на этом устройстве. Для восстановления понадобится прежний код доступа. Очистка данных сайта уничтожит эти записи.</p><button className="primary" onClick={() => setLogoutPrompt(false)}>Остаться</button><button className="danger-action" onClick={() => void logout()}>Выйти и защитить очередь</button></div></div>}
    {toast && <div role="status" className="toast">✓ {toast}</div>}
    {!!deletions.length && <div className="undo-stack">{deletions.map(e => <div key={e.row}><span>Удаляем: {displayName(e)}</span><button onClick={() => undo(e)}>Отменить</button></div>)}</div>}
    {duplicate && <div className="modal-backdrop"><div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Похоже на дубль" className="modal"><h2>Похоже на дубль</h2><p>{displayName(duplicate.expense)} · {money(duplicate.expense.amount)}</p><p>Такая трата уже есть. Всё равно сохранить?</p><button className="primary" onClick={() => { duplicate.resolve(true); setDuplicate(null); }}>Всё равно сохранить</button><button onClick={() => { duplicate.resolve(false); setDuplicate(null); }}>Отмена</button></div></div>}
  </div>;
}

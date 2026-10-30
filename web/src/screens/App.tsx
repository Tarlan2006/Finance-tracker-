import { useCallback, useEffect, useRef, useState } from 'react';
import { displayName, today } from '../../../shared/logic';
import type { JournalFilter } from '../../../shared/analytics';
import { useFinance } from '../lib/useFinance';
import { useAppearance } from '../lib/appearance';
import { useVisualViewport } from '../lib/viewport';
import { useDialog } from '../lib/dialog';
import Add, { type Draft } from './Add';
import Expenses from './Expenses';
import Overview from './Overview';
import More from './More';
import Icon, { type IconName } from './Icon';
const tabs: { name: string; icon: IconName }[] = [{ name: 'Траты', icon: 'expenses' }, { name: 'Обзор', icon: 'overview' }, { name: 'Ещё', icon: 'more' }];
function readDraft(): Draft & { open: boolean } { const p = new URLSearchParams(location.search), open = p.has('amount') || p.has('merchant'); const draft = { amount: p.get('amount') || '', name: p.get('merchant') || '', source: p.get('src') || 'manual', ts: p.has('ts') ? Number(p.get('ts')) * 1000 : undefined, open }; if (open) history.replaceState({ tab: 0, add: true }, '', location.pathname); return draft; }
const initialDraft = readDraft();
export default function App() {
  useVisualViewport();
  const finance = useFinance(), { key, data, queue, online, error, toast, duplicate, setDuplicate } = finance;
  const { theme, setTheme } = useAppearance();
  const [tab, setTab] = useState<number>(history.state?.tab || 0), [addOpen, setAddOpen] = useState(initialDraft.open || !!history.state?.add);
  const [draft, setDraft] = useState<Draft>(initialDraft), [month, setMonth] = useState(today('Asia/Almaty').slice(0, 7)), [filter, setFilter] = useState<JournalFilter | null>(null);
  const [compact, setCompact] = useState(false), [logoutPrompt, setLogoutPrompt] = useState(false);
  const dialog = useRef<HTMLDivElement>(null), addDialog = useRef<HTMLDivElement>(null), previousKey = useRef(key);
  const money = useCallback((n: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n)} ₸`, []);
  const cancelDialog = useCallback(() => { duplicate?.resolve(false); setDuplicate(null); setLogoutPrompt(false); }, [duplicate, setDuplicate]);
  useDialog(dialog, !!duplicate || logoutPrompt, cancelDialog);
  const closeAdd = useCallback(() => { setAddOpen(false); history.replaceState({ tab: history.state?.tab || 0 }, '', location.pathname); }, []);
  useDialog(addDialog, addOpen && !!data && !duplicate, closeAdd);
  useEffect(() => { const back = (event: PopStateEvent) => { setTab(event.state?.tab || 0); setAddOpen(!!event.state?.add); }, scroll = () => setCompact(window.scrollY > 64); window.addEventListener('popstate', back); window.addEventListener('scroll', scroll, { passive: true }); return () => { window.removeEventListener('popstate', back); window.removeEventListener('scroll', scroll); }; }, []);
  useEffect(() => { if (previousKey.current && !key) { setDraft({ amount: '', name: '', source: 'manual' }); setAddOpen(false); setLogoutPrompt(false); setTab(0); setFilter(null); history.replaceState({ tab: 0 }, '', location.pathname); } previousKey.current = key; }, [key]);
  useEffect(() => { if (key && data && tab === 0) void finance.loadMonths([month]); }, [key, !!data, tab, month, finance.loadMonths]);
  function navigate(next: number) { history.pushState({ tab: next }, '', location.pathname); setTab(next); setAddOpen(false); window.scrollTo({ top: 0 }); }
  function openAdd() { history.pushState({ tab, add: true }, '', location.pathname); setAddOpen(true); }
  const logout = async () => { if (await finance.logout()) setLogoutPrompt(false); };
  const requestLogout = () => queue.length ? setLogoutPrompt(true) : void logout();
  if (!key) return <main className="login"><div className="brand-mark">₸</div><h1>Каждая трата<br/>на своём месте.</h1><p>Быстрые записи. Понятный бюджет.<br/>Ваша привычная Google-таблица.</p><form onSubmit={e => { e.preventDefault(); void finance.login(); }}><label htmlFor="access-key">Код доступа</label><input id="access-key" type="password" autoComplete="current-password" value={finance.keyInput} onChange={e => finance.setKeyInput(e.target.value)} placeholder="Введите ваш код" required/>{error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={finance.loading}>{finance.loading ? 'Подключаем…' : 'Войти'}</button></form><small>Теңге · личный трекер расходов</small></main>;
  const modal = addOpen || logoutPrompt || !!duplicate;
  return <div className="app-shell"><div className="app-content" inert={modal}>
    <header className={`app-header material ${compact ? 'compact' : ''}`}><span className="brand">теңге<span className="brand-mark small">₸</span></span><strong className="compact-title">{tabs[tab].name}</strong><span className={`connection ${online ? '' : 'offline'}`}><i/>{online ? data?.mock ? 'Демо' : 'На связи' : 'Офлайн'}{queue.length ? ` · ${queue.length}` : ''}</span></header>
    {error && <div className="error-banner" role="alert">{error}<div><button onClick={() => void finance.reload()}>Обновить</button><button onClick={requestLogout}>Выйти</button></div></div>}
    <main className="main-content">{!data ? <div className="loading-state" aria-busy="true"><div className="skeleton"/><h1>Подключаем таблицу…</h1><p>Для первого входа нужен интернет.</p></div> : <>
      {tab === 0 && <Expenses expenses={data.history} categories={data.categories} queue={queue} money={money} edit={finance.edit} remove={finance.remove} retry={finance.retry} editQueue={finance.editQueue} removeQueue={finance.removeQueue} month={month} setMonth={m => { setMonth(m); setFilter(null); }} range={filter} clearRange={() => setFilter(null)} currentDay={today(data.tz)}/>}
      {tab === 1 && <Overview data={data} money={money} loadMonths={finance.loadMonths} showExpenses={range => { setFilter(range); setMonth(range.start.slice(0, 7)); navigate(0); }}/>}
      {tab === 2 && <More data={data} queue={queue} theme={theme} setTheme={setTheme} sync={finance.sync} exportCsv={finance.exportCsv} logout={requestLogout}/>}
    </>}</main>
    <div className="navigation"><nav className="bottom-nav material" aria-label="Основная навигация">{tabs.map((t, i) => <button key={t.name} aria-label={t.name} aria-current={tab === i ? 'page' : undefined} onClick={() => navigate(i)}><Icon name={t.icon}/><span>{t.name}</span></button>)}</nav><button className="add-button" aria-label="Добавить расход" title="Добавить расход (N)" onClick={openAdd}><Icon name="plus"/><span>Добавить</span></button></div>
  </div>
    {data && <div hidden={!addOpen} className="add-backdrop"><div ref={addDialog} className="add-dialog scroll-surface" role="dialog" aria-modal="true" aria-label="Добавить расход" inert={!!duplicate}><div className="add-toolbar material"><button className="icon-button" aria-label="Закрыть добавление" onClick={closeAdd}><Icon name="back"/></button><span>Добавить расход</span></div><Add data={data} draft={draft} save={finance.save} money={money}/></div></div>}
    {logoutPrompt && <div className="modal-backdrop"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Выход с очередью" className="modal"><h2>В очереди {queue.length} записей</h2><p>Очередь останется зашифрованной на этом устройстве. Для восстановления понадобится прежний код доступа. Очистка данных сайта уничтожит эти записи.</p><button className="primary" onClick={() => setLogoutPrompt(false)}>Остаться</button><button className="danger-action" onClick={() => void logout()}>Выйти и защитить очередь</button></div></div>}
    {toast && <div role="status" className="toast"><Icon name="check"/>{toast}</div>}
    {!!finance.deletions.length && <div className="undo-stack">{finance.deletions.map(e => <div key={e.row}><span>Удаляем: {displayName(e)}</span><button onClick={() => finance.undo(e)}>Отменить</button></div>)}</div>}
    {duplicate && <div className="modal-backdrop"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Похоже на дубль" className="modal"><h2>Похоже на дубль</h2><p>{displayName(duplicate.expense)} · {money(duplicate.expense.amount)}</p><p>Такая трата уже есть. Всё равно сохранить?</p><button className="primary" onClick={() => { duplicate.resolve(true); setDuplicate(null); }}>Всё равно сохранить</button><button onClick={cancelDialog}>Отмена</button></div></div>}
  </div>;
}

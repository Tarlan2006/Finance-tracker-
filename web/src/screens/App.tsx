import { useCallback, useEffect, useRef, useState } from 'react';
import { displayName, today } from '../../../shared/logic';
import { configCategories } from '../../../shared/config';
import type { JournalFilter } from '../../../shared/analytics';
import { useFinance } from '../lib/useFinance';
import { useAppearance } from '../lib/appearance';
import { useVisualViewport } from '../lib/viewport';
import { useDialog } from '../lib/dialog';
import { useDismissGesture } from '../lib/gestures';
import { exitSnapshot, finishScreenTransition, transitionScreen, useEnter, useMotionLifecycle } from '../motion';
import Presence from '../motion/Presence';
import Add, { type Draft } from './Add';
import Expenses from './Expenses';
import Overview from './Overview';
import More from './More';
import Logo from './Logo';
import { PasswordForm } from './Account';
import Icon, { type IconName } from './Icon';
const currencyFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const tabs: { name: string; icon: IconName }[] = [{ name: 'Траты', icon: 'expenses' }, { name: 'Обзор', icon: 'overview' }, { name: 'Ещё', icon: 'more' }];
function readDraft(): Draft & { open: boolean } { const p = new URLSearchParams(location.search), open = p.has('amount') || p.has('merchant'); let draft = { amount: p.get('amount') || '', name: p.get('merchant') || '', source: p.get('src') || 'manual', ts: p.has('ts') ? Number(p.get('ts')) * 1000 : undefined, open }; try { if (open) sessionStorage.setItem('pending-payment', JSON.stringify(draft)); else { const saved = JSON.parse(sessionStorage.getItem('pending-payment') || 'null'); if (saved && typeof saved.amount === 'string' && typeof saved.name === 'string') draft = saved; } } catch { /* In-memory draft still works if session storage is unavailable. */ } if (open) history.replaceState({ tab: 0, add: true }, '', location.pathname); return draft; }
const initialDraft = readDraft();
export default function App() {
  useVisualViewport(); useMotionLifecycle();
  const finance = useFinance(), { key, data, queue, online, error, toast, duplicate, setDuplicate } = finance;
  const { theme, setTheme } = useAppearance(finance.account?.id);
  const [tab, setTab] = useState<number>(history.state?.tab || 0), [addOpen, setAddOpen] = useState(initialDraft.open || !!history.state?.add);
  const [draft, setDraft] = useState<Draft>(initialDraft), [month, setMonth] = useState(today('Asia/Almaty').slice(0, 7)), [filter, setFilter] = useState<JournalFilter | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [compact, setCompact] = useState(false), [logoutPrompt, setLogoutPrompt] = useState(false);
  const dialog = useRef<HTMLDivElement>(null), addDialog = useRef<HTMLDivElement>(null), previousKey = useRef(key);
  const money = useCallback((n: number) => `${currencyFormat.format(n)} ₸`, []);
  const cancelDialog = useCallback(() => { exitSnapshot(dialog.current); duplicate?.resolve(false); setDuplicate(null); setLogoutPrompt(false); }, [duplicate, setDuplicate]);
  useDialog(dialog, !!duplicate || logoutPrompt, cancelDialog);
  const closeAdd = useCallback(() => { exitSnapshot(addDialog.current); setAddOpen(false); history.replaceState({ tab: history.state?.tab || 0 }, '', location.pathname); }, []);
  useEnter(addDialog, addOpen && !!data, 'sheet');
  useEnter(dialog, !!duplicate || logoutPrompt, 'sheet');
  useDialog(addDialog, addOpen && !!data && !duplicate, closeAdd);
  useDismissGesture(addDialog, addOpen && !!data && !duplicate, closeAdd);
  useDismissGesture(dialog, !!duplicate || logoutPrompt, cancelDialog);
  useEffect(() => { let last = window.scrollY; const back = (event: PopStateEvent) => { setTab(event.state?.tab || 0); setAddOpen(!!event.state?.add); }, scroll = () => { const y = window.scrollY; setCompact(y > 64); if (Math.abs(y - last) > 8) { setQuiet(y > 120 && y > last); last = y; } }; window.addEventListener('popstate', back); window.addEventListener('scroll', scroll, { passive: true }); return () => { window.removeEventListener('popstate', back); window.removeEventListener('scroll', scroll); }; }, []);
  useEffect(() => { if (previousKey.current && !key) { setDraft({ amount: '', name: '', source: 'manual' }); setAddOpen(false); setLogoutPrompt(false); setTab(0); setFilter(null); history.replaceState({ tab: 0 }, '', location.pathname); } previousKey.current = key; }, [key]);
  useEffect(() => { if (key && data && tab === 0) void finance.loadMonths([month]); }, [key, !!data, tab, month, finance.loadMonths]);
  useEffect(() => { if (key && data) { try { sessionStorage.removeItem('pending-payment'); } catch { /* Optional draft persistence. */ } } }, [key, !!data]);
  function navigate(next: number, search = false) { transitionScreen(() => { history.pushState({ tab: next }, '', location.pathname); setTab(next); setQuiet(false); if (search) requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Поиск трат"]')?.focus()); window.scrollTo({ top: 0 }); }, Math.sign(next - tab)); }
  function openAdd() { finishScreenTransition(); history.pushState({ tab, add: true }, '', location.pathname); setAddOpen(true); }
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (!key || !data || event.ctrlKey || event.metaKey || event.altKey || target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || addOpen || duplicate || logoutPrompt || document.querySelector('.modal-backdrop [role="dialog"]')) return;
      if (event.key.toLowerCase() === 'n' || event.key.toLowerCase() === 'т') { event.preventDefault(); openAdd(); }
      if (event.key === '/') { event.preventDefault(); navigate(0, true); }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { const direction = event.key === 'ArrowLeft' ? 'Предыдущий' : 'Следующий', unit = tab === 1 ? 'период' : 'месяц'; const button = document.querySelector<HTMLButtonElement>(`[aria-label="${direction} ${unit}"]`); if (button && !button.disabled) { event.preventDefault(); button.click(); } }
    };
    document.addEventListener('keydown', shortcuts); return () => document.removeEventListener('keydown', shortcuts);
  });
  const logout = async () => { if (await finance.logout()) setLogoutPrompt(false); };
  const requestLogout = () => queue.length ? setLogoutPrompt(true) : void logout();
  if (!key) return <main className="login"><Logo className="login-logo"/><h1>Finance Tracker</h1><p>Быстрые записи. Понятный бюджет.<br/>Ваша привычная Google-таблица.</p><form onSubmit={e => { e.preventDefault(); void finance.login(); }}><label htmlFor="login-name">Аккаунт</label><select id="login-name" name="username" autoComplete="username" value={finance.loginName} onChange={e => finance.setLoginName(e.target.value)} required>{finance.accounts.map(a => <option key={a.login} value={a.login}>{a.displayName} · {a.login}</option>)}</select><label htmlFor="access-key">Пароль</label><input id="access-key" name="password" type="password" autoComplete="current-password" maxLength={128} value={finance.keyInput} onChange={e => finance.setKeyInput(e.target.value)} placeholder="Введите пароль" required/>{error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={finance.loading || !finance.accounts.length}>{finance.loading ? 'Подключаем…' : 'Войти'}</button></form><small>Finance Tracker · личный бюджет</small></main>;
  if (finance.account?.mustChangePassword) return <PasswordForm forced change={finance.changePassword} logout={requestLogout}/>;
  if (finance.tableState === 'schema_mismatch') return <main className="login">
    <h1>Нарушена структура журнала</h1>
    <p role="alert">Проверьте заголовки и порядок столбцов A:H на листе расходов.</p>
    <button onClick={() => void finance.reload()}>Проверить снова</button>
    <button onClick={() => void finance.logout()}>Выйти</button>
  </main>;
  if (finance.tableState) return <main className="login"><Logo className="login-logo"/><h1>{finance.tableState === 'sheet_unlinked' ? 'Таблица ещё не подключена' : 'Таблица подключена, но пуста'}</h1><p>{finance.tableState === 'sheet_unlinked' ? 'Обратитесь к администратору: он подключит вашу Google-таблицу.' : 'Подготовим журнал и начальные категории. Доходы и ежемесячные расходы вы добавите в настройках.'}</p>{finance.tableState === 'table_uninitialized' && <button className="primary" disabled={finance.loading} onClick={() => void finance.prepareTable()}>{finance.loading ? 'Подготавливаем…' : 'Подготовить таблицу'}</button>}<button onClick={() => void finance.reload()}>Проверить подключение</button><button onClick={requestLogout}>Выйти</button>{error && <p role="alert" className="error">{error}</p>}</main>;
  const allCategories = data?.config?.configured ? configCategories(data.config.categories) : data?.categories || [];
  const modal = (addOpen && !!data) || logoutPrompt || !!duplicate;
  return <div className="app-shell"><div className="app-content" inert={modal}>
    <header className={`app-header material ${compact ? 'compact' : ''}`}><span className="brand"><Logo/>Finance Tracker</span><strong className="compact-title">{tabs[tab].name}</strong><span className={`connection ${online ? '' : 'offline'}`}><i/>{online ? data?.mock ? 'Демо' : 'На связи' : 'Офлайн'}{queue.length ? ` · ${queue.length}` : ''}</span></header>
    {!!data?.invalidAmountRows?.length && <div className="error-banner" role="status">Итоги неполные. Проверьте сумму в строках журнала: {data.invalidAmountRows.join(', ')}.</div>}
    {!!data?.invalidDateRows?.length && <div className="error-banner" role="status">Итоги неполные. Проверьте дату в строках журнала: {data.invalidDateRows.join(', ')}.</div>}
    {data?.freeRows !== undefined && data.freeRows <= 50 && <div className="error-banner" role="status">Свободных строк в журнале: {data.freeRows} из 1005. Запланируйте перенос или расширение таблицы.</div>}
    {error && <div className="error-banner" role="alert">{error}<div><button onClick={() => void finance.reload()}>Обновить</button><button onClick={requestLogout}>Выйти</button></div></div>}
    <main className="main-content">{!data ? <div className="loading-state" aria-busy="true"><div className="skeleton"/><h1>Подключаем таблицу…</h1><p>Для первого входа нужен интернет.</p></div> : <>
      {tab === 0 && <Expenses data={data} openSettings={() => { setSettingsOpen(true); navigate(2); }} expenses={data.history} categories={allCategories} queue={queue} money={money} edit={finance.edit} remove={finance.remove} retry={finance.retry} editQueue={finance.editQueue} removeQueue={finance.removeQueue} month={month} setMonth={m => { setMonth(m); setFilter(null); }} range={filter} clearRange={() => setFilter(null)} currentDay={today(data.tz)}/>}
      {tab === 1 && <Overview data={data} money={money} loadMonths={finance.loadMonths} showExpenses={range => { setFilter(range); setMonth(range.start.slice(0, 7)); navigate(0); }}/>}
      {tab === 2 && <More account={finance.account!} token={key} changePassword={finance.changePassword} settingsOpen={settingsOpen} setSettingsOpen={setSettingsOpen} changeConfig={finance.changeConfig} removeItem={finance.removeItem} data={data} queue={queue} theme={theme} setTheme={setTheme} sync={finance.sync} exportCsv={finance.exportCsv} logout={requestLogout}/>}
    </>}</main>
    <div className={`navigation ${quiet ? 'quiet' : ''}`}><nav className="bottom-nav material" aria-label="Основная навигация" style={{ '--active-tab': tab } as React.CSSProperties}><i className="nav-indicator" aria-hidden="true"/>{tabs.map((t, i) => <button key={t.name} aria-label={t.name} aria-current={tab === i ? 'page' : undefined} onClick={() => navigate(i)}><Icon name={t.icon}/><span>{t.name}</span></button>)}</nav><button className="add-button" aria-label="Добавить расход" title="Добавить расход (N)" onClick={openAdd}><Icon name="plus"/><span>Добавить</span></button></div>
  </div>
    {data && <div hidden={!addOpen} className="add-backdrop"><div ref={addDialog} className="add-dialog scroll-surface" role="dialog" aria-modal="true" aria-label="Добавить расход" inert={!!duplicate}><div className="add-toolbar material" data-drag-handle><button className="icon-button" aria-label="Закрыть добавление" title="Закрыть добавление" onClick={closeAdd}><Icon name="back"/></button><span>Добавить расход</span></div><div className="motion-edge" aria-hidden="true" data-edge-handle/><Add data={data} draft={draft} save={finance.save} money={money}/></div></div>}
    {logoutPrompt && <div className="modal-backdrop"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Выход с очередью" className="modal"><h2 data-drag-handle>В очереди {queue.length} записей</h2><p>Очередь останется зашифрованной на этом устройстве. Она откроется при следующем входе в этот аккаунт. Очистка данных сайта уничтожит эти записи.</p><button className="primary" onClick={cancelDialog}>Остаться</button><button className="danger-action" onClick={() => void logout()}>Выйти и защитить очередь</button></div></div>}
    <Presence>{toast && <div role="status" className="toast"><Icon name="check"/>{toast}</div>}</Presence>
    {!!finance.itemDeletions.length && <div className="undo-stack">{finance.itemDeletions.map(item => <div key={item.id}><span>Убираем статью: {item.name}</span><button onClick={() => finance.undoItem(item)}>Отменить</button></div>)}</div>}
    {!!finance.deletions.length && <div className="undo-stack">{finance.deletions.map(e => <div key={e.row}><span>Удаляем: {displayName(e)}</span><button onClick={event => { exitSnapshot(event.currentTarget.parentElement); finance.undo(e); }}>Отменить</button></div>)}</div>}
    {duplicate && <div className="modal-backdrop"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Похоже на дубль" className="modal"><h2 data-drag-handle>Похоже на дубль</h2><p>{displayName(duplicate.expense)} · {money(duplicate.expense.amount)}</p><p>Такая трата уже есть. Всё равно сохранить?</p><button className="primary" onClick={() => { exitSnapshot(dialog.current); duplicate.resolve(true); setDuplicate(null); }}>Всё равно сохранить</button><button onClick={cancelDialog}>Отмена</button></div></div>}
  </div>;
}

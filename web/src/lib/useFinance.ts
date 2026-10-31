import { useCallback, useEffect, useRef, useState } from 'react';
import { looksDuplicate, today, validateExpense } from '../../../shared/logic';
import type { Bootstrap, Config, ConfigItem, Expense, ExpenseInput } from '../../../shared/types';
import { configCategories } from '../../../shared/config';
import { api, ApiError } from './api';
import type { AccountSession, AccountView } from '../../../shared/accounts';
import { accountApi, savedSession } from './account';
import { storage } from './storage';
import { classifyFailure, retryDelay, readSyncResult, syncText, type SyncResult } from './sync-result';
import { readCachedBootstrap } from './data';
import { allQueued, changeQueued, discardQueued, enqueue, flushQueue, retryQueued, setQueueKey, type Queued } from './queue';
export function useFinance() {
  const [accountSession, setAccountSession] = useState<AccountSession | null>(savedSession), [accounts, setAccounts] = useState<{ login: string; displayName: string }[]>([]);
  const [loginName, setLoginName] = useState(storage.getItem('last-login') || 'tarlan');
  const [key, setKey] = useState(savedSession()?.token || ''), [keyInput, setKeyInput] = useState(''), [owner, setOwner] = useState('');
  const [bootstrapRetry, setBootstrapRetry] = useState(0);
  const readFailures = useRef(0), readNotBefore = useRef(0);
  const [lastSync, setLastSync] = useState<SyncResult>();
  const [tableState, setTableState] = useState('');
  const [data, setData] = useState<Bootstrap | null>(null), [queue, setQueue] = useState<Queued[]>([]);
  const [online, setOnline] = useState(navigator.onLine), [error, setError] = useState(''), [toast, setToast] = useState(''), [loading, setLoading] = useState(false);
  const [deletions, setDeletions] = useState<Expense[]>([]), timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const [itemDeletions, setItemDeletions] = useState<ConfigItem[]>([]), itemTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [duplicate, setDuplicate] = useState<{ expense: ExpenseInput; resolve: (yes: boolean) => void } | null>(null);
  const session = useRef(key), sequence = useRef(0), knownQueue = useRef(queue), toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cacheKey = useCallback((ownerId: string) => {
    const version = accountSession?.account.sheetVersion || 1;
    return version === 1 ? `bootstrap-${ownerId}` : `bootstrap-${ownerId}-v${version}`;
  }, [accountSession?.account.sheetVersion]);
  const loadedMonths = useRef(new Set<string>()), pendingMonths = useRef(new Map<string, Promise<void>>());
  knownQueue.current = queue;
  const showError = useCallback((e: unknown) => setError(e instanceof Error ? e.message : 'Не удалось выполнить действие. Повторите'), []);
  const notify = useCallback((text: string) => { clearTimeout(toastTimer.current); setToast(text); toastTimer.current = setTimeout(() => setToast(''), 5000); }, []);
  const closeSession = useCallback(() => { session.current = ''; sequence.current++; timers.current.forEach(clearTimeout); timers.current.clear(); itemTimers.current.forEach(clearTimeout); itemTimers.current.clear(); setItemDeletions([]); setDeletions([]); setDuplicate(d => { d?.resolve(false); return null; }); setKey(''); setLastSync(undefined); setBootstrapRetry(0); readFailures.current = 0; readNotBefore.current = 0; setAccountSession(null); setTableState(''); setOwner(''); setData(null); setQueue([]); setToast(''); loadedMonths.current.clear(); pendingMonths.current.clear(); }, []);
  useEffect(() => { if (key) return; let active = true; void accountApi<{ login: string; displayName: string }[]>('accounts').then(list => { if (active) { setAccounts(list); setLoginName(name => list.some(a => a.login === name) ? name : list[0]?.login || ''); } }).catch(() => { if (active) setError('Нет связи. Для входа нужен интернет'); }); return () => { active = false; }; }, [key]);
  useEffect(() => { const changed = (event: StorageEvent) => { if (event.key === 'app-key' && event.newValue !== session.current) closeSession(); }; window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed); }, [closeSession]);
  useEffect(() => { const pending = timers.current; return () => { pending.forEach(clearTimeout); clearTimeout(toastTimer.current); }; }, []);
  useEffect(() => { const pending = itemTimers.current; return () => pending.forEach(clearTimeout); }, []);
  const expireSession = useCallback(async () => {
    const active = () => session.current === key && storage.getItem('app-key') === key;
    if (!active()) return;
    await setQueueKey('', active);
    if (!active()) return;
    storage.removeItem('app-key'); storage.removeItem('account-session'); storage.removeItem(cacheKey(owner));
    closeSession();
  }, [key, owner, cacheKey, closeSession]);
  const reload = useCallback(async () => {
    if (!key || !owner || session.current !== key || document.hidden || Date.now() < readNotBefore.current) return;
    const request = ++sequence.current;
    try { const b = await api<Bootstrap>('bootstrap', key); if (session.current !== key || request !== sequence.current) return; readFailures.current = 0; readNotBefore.current = 0; setBootstrapRetry(0); setData(b); setTableState(''); storage.setItem(cacheKey(owner), JSON.stringify(b)); loadedMonths.current = new Set([today(b.tz).slice(0, 7)]); setError(''); }
    catch (e) { if (session.current === key && request === sequence.current) { if (e instanceof ApiError && e.status === 401) { await expireSession(); } else if (e instanceof ApiError && ['sheet_unlinked', 'table_uninitialized', 'schema_mismatch'].includes(e.code)) { setTableState(e.code); setData(null); storage.removeItem(cacheKey(owner)); } else if (e instanceof ApiError && e.retryable) {
      const next = Date.now() + retryDelay(readFailures.current++, e.retryAfter);
      readNotBefore.current = Date.now() + e.retryAfter * 1000;
      setBootstrapRetry(next);
      setError(syncText(classifyFailure(e, navigator.onLine)) + ' · следующая попытка в ' + new Date(next).toLocaleTimeString('ru-RU'));
      return;
    } showError(e); } }
  }, [key, owner, showError, expireSession, cacheKey]);
  const sync = useCallback(async (manual = false) => {
    if (!owner || session.current !== key || document.hidden) return;
    const report = (result: SyncResult) => {
      if (session.current !== key) return;
      storage.setItem('sync-result-' + owner, JSON.stringify(result));
      setLastSync(result);
    };
    try {
      const displayed = knownQueue.current, before = await allQueued(owner);
      await flushQueue({ key, owner, manual, report });
      if (session.current !== key) return;
      const after = await allQueued(owner);
      setQueue(after);
      // Recover auth failures left by older clients as well.
      if (after.some(row => row.status === 'error' && row.errorStatus === 401)) throw new ApiError(401, 'Войдите снова');
      if (navigator.onLine && [...before, ...displayed].some(row => !after.some(item => item.id === row.id))) await reload();
    } catch (error) {
      if (session.current !== key) return;
      const result = classifyFailure(error instanceof ApiError ? error : new ApiError(0, '', true, 'queue_storage'), navigator.onLine);
      report(result);
      if (result.kind === 'auth' || result.kind === 'password') {
        try { await expireSession(); } catch (e) { showError(e); return; }
      }
      showError(new Error(syncText(result)));
    }
  }, [owner, key, reload, expireSession, showError]);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    const saved = savedSession();
    if (!key || !saved?.queueKey || saved.account.mustChangePassword) return;
    const current = () => active && session.current === key && storage.getItem('app-key') === key;
    async function initialize() {
      if (!current() || !saved) return;
      try {
        const id = await setQueueKey(key, current, saved);
        if (!current()) return;
        setOwner(id);
        setLastSync(readSyncResult(storage.getItem('sync-result-' + id)));
        const cache = readCachedBootstrap(storage.getItem(cacheKey(id)));
        if (cache) setData(cache);
        const rows = await allQueued(id);
        if (current()) setQueue(rows);
      } catch (error) {
        if (!current()) return;
        const busy = error instanceof ApiError && error.code === 'queue_busy';
        setError(busy ? error.message : 'Хранилище недоступно. Разрешите сохранение данных сайта');
        if (busy) timer = setTimeout(() => void initialize(), 3000);
      }
    }
    void initialize();
    return () => { active = false; clearTimeout(timer); };
  }, [key, cacheKey]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const resume = () => {
      if (document.hidden || !navigator.onLine) return;
      void sync(true);
      if (!data && !bootstrapRetry) void reload();
    };
    const network = () => { setOnline(navigator.onLine); resume(); if (data && navigator.onLine && !document.hidden && !bootstrapRetry) void reload(); };
    const message = () => { if (!document.hidden && navigator.onLine) void sync(); };
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('tenge-sync') : null;
    if (channel) channel.onmessage = message;
    window.addEventListener('online', network); window.addEventListener('offline', network);
    document.addEventListener('visibilitychange', resume);
    navigator.serviceWorker?.addEventListener('message', message);
    return () => {
      window.removeEventListener('online', network); window.removeEventListener('offline', network);
      document.removeEventListener('visibilitychange', resume);
      navigator.serviceWorker?.removeEventListener('message', message); channel?.close();
    };
  }, [sync, reload, bootstrapRetry, data]);
  useEffect(() => { if (!document.hidden) void sync(true); }, [sync]);
  useEffect(() => {
    const head = queue.find(row => row.status !== 'error');
    if (!head || !online || document.hidden) return;
    const at = Math.max(head.nextAt || 0, head.lastAttempt?.notBefore || 0, lastSync?.kind === 'busy' ? lastSync.at + 5000 : 0);
    const timer = setTimeout(() => void sync(), Math.max(250, at - Date.now()));
    return () => clearTimeout(timer);
  }, [queue, online, lastSync, sync]);
  useEffect(() => {
    if (!bootstrapRetry || !online) return;
    const retry = () => { if (!document.hidden && Date.now() >= bootstrapRetry) void reload(); };
    const timer = setTimeout(retry, Math.max(0, bootstrapRetry - Date.now()));
    document.addEventListener('visibilitychange', retry);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', retry); };
  }, [bootstrapRetry, online, reload]);
  const loadMonths = useCallback(async (months: string[]) => {
    if (!key || !owner || !navigator.onLine) return;
    await Promise.all(months.map(month => {
      if (loadedMonths.current.has(month)) return;
      if (pendingMonths.current.has(month)) return pendingMonths.current.get(month);
      const request = sequence.current;
      const promise = api<{ expenses: Expense[] }>(`expenses?month=${month}`, key).then(b => {
        if (session.current !== key || sequence.current !== request) return;
        loadedMonths.current.add(month);
        setData(current => { if (!current) return current; const next = { ...current, history: [...current.history.filter(e => !e.date.startsWith(month)), ...b.expenses] }; storage.setItem(cacheKey(owner), JSON.stringify(next)); return next; });
      }).catch(e => { if (session.current === key) showError(e); }).finally(() => pendingMonths.current.delete(month));
      pendingMonths.current.set(month, promise); return promise;
    }));
  }, [key, owner, showError, cacheKey]);
  async function acceptSession(s: AccountSession, previousPassword?: string) {
    // Finish claiming/sealing the queue before publishing the new session to other tabs.
    const id = !s.account.mustChangePassword && s.queueKey ? await setQueueKey(s.token, () => true, s, previousPassword) : await setQueueKey('');
    if (!storage.setItem('account-session', JSON.stringify(s)) || !storage.setItem('app-key', s.token)) throw new Error('Разрешите хранение данных сайта для входа');
    if (session.current !== s.token) { setData(null); setQueue([]); setTableState(''); }
    setOwner(id); setLastSync(readSyncResult(storage.getItem('sync-result-' + id))); session.current = s.token; setAccountSession(s); setKey(s.token);
  }
  async function login() { setLoading(true); setError(''); try { const s = await accountApi<AccountSession>('login', '', { login: loginName, password: keyInput }); storage.setItem('last-login', loginName); await acceptSession(s, keyInput); setKeyInput(''); } catch (e) { showError(e instanceof TypeError ? new Error('Нет связи. Для входа нужен интернет') : e); } finally { setLoading(false); } }
  async function changePassword(currentPassword: string, password: string, confirmPassword: string) { const result = await accountApi<{ account: AccountView; queueKey: string }>('account/password', key, { currentPassword, password, confirmPassword }); await acceptSession({ token: key, ...result }, currentPassword); notify('Пароль изменён. Другие устройства вышли из аккаунта'); }
  async function prepareTable() { setLoading(true); try { await accountApi('table/prepare', key, {}); await reload(); } catch (e) { showError(e); } finally { setLoading(false); } }
  async function save(e: ExpenseInput, ts?: number) {
    if (!data || session.current !== key) return false; validateExpense(e, data.categories, data.tz);
    if (looksDuplicate(e, [...data.history, ...queue.map(q => q.expense)], data.duplicateWindow, Date.now(), ts)) { const yes = await new Promise<boolean>(resolve => setDuplicate({ expense: e, resolve })); if (!yes) return false; }
    await enqueue(e, owner); if (session.current !== key) return false; setQueue(await allQueued(owner)); notify(navigator.onLine ? 'Сохранено · отправляется в таблицу' : 'Сохранено в очередь'); void sync(); return true;
  }
  async function edit(e: Expense, patch: Partial<Expense>) { await api(`expenses/${e.row}`, key, { method: 'PATCH', body: JSON.stringify({ ...patch, fp: e.fp }) }); await reload(); notify('Изменения сохранены'); }
  async function changeConfig(path: string, body: Record<string, unknown>): Promise<{ config?: Config; count?: number; previewHash?: string }> {
    if (session.current !== key) throw new Error('Войдите заново');
    const result = await api<Config | { config?: Config; count?: number; previewHash?: string }>(path, key, { method: 'POST', body: JSON.stringify(body) });
    if (session.current !== key) throw new Error('Сеанс завершён');
    if (path.includes('dry=1')) return result as { count: number; previewHash?: string };
    const config = 'configured' in result ? result : result.config;
    if (config) setData(current => current ? { ...current, config, categories: configCategories(config.categories).filter(c => !c.archived) } : current);
    await reload(); notify('Настройки сохранены'); return { config };
  }
  function removeItem(item: ConfigItem, month: string) { if (itemTimers.current.has(item.id)) return; setItemDeletions(items => [...items, item]); const operationId = crypto.randomUUID(); itemTimers.current.set(item.id, setTimeout(() => { itemTimers.current.delete(item.id); setItemDeletions(items => items.filter(i => i.id !== item.id)); void changeConfig(`config/items/${item.id}`, { operationId, rev: item.rev, month, remove: true }).catch(showError).finally(() => setItemDeletions(items => items.filter(i => i.id !== item.id))); }, 5000)); }
  function undoItem(item: ConfigItem) { clearTimeout(itemTimers.current.get(item.id)); itemTimers.current.delete(item.id); setItemDeletions(items => items.filter(i => i.id !== item.id)); }
  function remove(e: Expense) { if (timers.current.has(e.row)) return; setDeletions(items => [...items, e]); navigator.vibrate?.(15); timers.current.set(e.row, setTimeout(() => { timers.current.delete(e.row); void (async () => { try { await api(`expenses/${e.row}`, key, { method: 'DELETE', body: JSON.stringify({ fp: e.fp }) }); await reload(); notify('Запись удалена'); } catch (e) { showError(e); } finally { setDeletions(items => items.filter(x => x.row !== e.row)); } })(); }, 5000)); }
  function undo(e: Expense) { clearTimeout(timers.current.get(e.row)); timers.current.delete(e.row); setDeletions(items => items.filter(x => x.row !== e.row)); }
  async function logout() { try { try { await accountApi('logout', key, {}); } catch (e) { if (!(e instanceof ApiError && e.status === 401)) throw e; } await setQueueKey(''); if (!storage.removeItem('app-key') || !storage.removeItem('account-session')) throw new Error(); storage.keys().filter(k => k.startsWith('bootstrap-')).forEach(k => storage.removeItem(k)); closeSession(); setError(''); return true; } catch { setError('Для безопасного выхода нужна сеть. Очередь сохранена; подключитесь и повторите'); return false; } }
  async function exportCsv(month: string) { try { const r = await fetch(`/api/export.csv?month=${month}`, { headers: { 'X-App-Key': key } }); if (!r.ok || !r.headers.get('Content-Type')?.includes('text/csv')) throw new Error('Экспорт недоступен. Проверьте сеть и код доступа'); const url = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = url; a.download = `finance-tracker-${month}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (e) { showError(e); } }
  return { key, keyInput, setKeyInput, accounts, loginName, setLoginName, account: accountSession?.account, changePassword, tableState, prepareTable, data: data ? { ...data, history: data.history.filter(e => !deletions.some(d => d.row === e.row)) } : null, queue, online, lastSync, error, toast, loading, duplicate, setDuplicate, deletions, itemDeletions, undoItem, undo, login, logout, save, edit, remove, reload, sync, exportCsv, loadMonths, changeConfig, removeItem,
    retry: (q: Queued) => void retryQueued(q).then(() => sync(true)).catch(showError), removeQueue: (q: Queued) => void discardQueued(q).then(() => sync()).catch(showError),
    editQueue: async (q: Queued, patch: Partial<Expense>) => { const expense = validateExpense({ ...q.expense, ...patch }, data?.categories ?? [{name: q.expense.category, limit: 0}], data?.tz || 'Asia/Almaty'); await changeQueued(q, expense); await sync(); }
  };
}

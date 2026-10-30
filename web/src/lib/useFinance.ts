import { useCallback, useEffect, useRef, useState } from 'react';
import { looksDuplicate, today, validateExpense } from '../../../shared/logic';
import type { Bootstrap, Expense, ExpenseInput } from '../../../shared/types';
import { api } from './api';
import { storage } from './storage';
import { readCachedBootstrap } from './data';
import { allQueued, changeQueued, discardQueued, enqueue, flushQueue, retryQueued, setQueueKey, type Queued } from './queue';
export function useFinance() {
  const [key, setKey] = useState(storage.getItem('app-key') || ''), [keyInput, setKeyInput] = useState(''), [owner, setOwner] = useState('');
  const [data, setData] = useState<Bootstrap | null>(null), [queue, setQueue] = useState<Queued[]>([]);
  const [online, setOnline] = useState(navigator.onLine), [error, setError] = useState(''), [toast, setToast] = useState(''), [loading, setLoading] = useState(false);
  const [deletions, setDeletions] = useState<Expense[]>([]), timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const [duplicate, setDuplicate] = useState<{ expense: ExpenseInput; resolve: (yes: boolean) => void } | null>(null);
  const session = useRef(key), sequence = useRef(0), knownQueue = useRef(queue), toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const loadedMonths = useRef(new Set<string>()), pendingMonths = useRef(new Map<string, Promise<void>>());
  knownQueue.current = queue;
  const showError = useCallback((e: unknown) => setError(e instanceof Error ? e.message : 'Не удалось выполнить действие. Повторите'), []);
  const notify = useCallback((text: string) => { clearTimeout(toastTimer.current); setToast(text); toastTimer.current = setTimeout(() => setToast(''), 5000); }, []);
  const closeSession = useCallback(() => { session.current = ''; sequence.current++; timers.current.forEach(clearTimeout); timers.current.clear(); setDeletions([]); setDuplicate(d => { d?.resolve(false); return null; }); setKey(''); setOwner(''); setData(null); setQueue([]); setToast(''); loadedMonths.current.clear(); pendingMonths.current.clear(); }, []);
  useEffect(() => { const changed = (event: StorageEvent) => { if (event.key === 'app-key' && event.newValue !== session.current) closeSession(); }; window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed); }, [closeSession]);
  useEffect(() => { const pending = timers.current; return () => { pending.forEach(clearTimeout); clearTimeout(toastTimer.current); }; }, []);
  const reload = useCallback(async () => {
    if (!key || !owner || session.current !== key) return;
    const request = ++sequence.current;
    try { const b = await api<Bootstrap>('bootstrap', key); if (session.current !== key || request !== sequence.current) return; setData(b); storage.setItem(`bootstrap-${owner}`, JSON.stringify(b)); loadedMonths.current = new Set([today(b.tz).slice(0, 7)]); setError(''); }
    catch (e) { if (session.current === key && request === sequence.current) showError(e); }
  }, [key, owner, showError]);
  const sync = useCallback(async () => {
    if (!owner || session.current !== key) return;
    try { const displayed = knownQueue.current, before = await allQueued(owner); await flushQueue(); if (session.current !== key) return; const after = await allQueued(owner); setQueue(after); if (navigator.onLine && [...before, ...displayed].some(row => !after.some(item => item.id === row.id))) await reload(); }
    catch (e) { if (session.current === key) showError(e); }
  }, [owner, key, reload, showError]);
  useEffect(() => {
    let active = true; if (!key) return;
    void (async () => { try { if (storage.getItem('app-key') !== key) return; const id = await setQueueKey(key, () => active && session.current === key && storage.getItem('app-key') === key); if (!active || session.current !== key) return; setOwner(id); const cache = readCachedBootstrap(storage.getItem(`bootstrap-${id}`)); if (cache) setData(cache); const rows = await allQueued(id); if (session.current === key) setQueue(rows); } catch { if (active) setError('Хранилище недоступно. Разрешите сохранение данных сайта'); } })();
    return () => { active = false; };
  }, [key]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const network = () => { setOnline(navigator.onLine); if (navigator.onLine) { void sync(); void reload(); } }, message = () => void sync();
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('tenge-sync') : null; if (channel) channel.onmessage = message;
    window.addEventListener('online', network); window.addEventListener('offline', network); navigator.serviceWorker?.addEventListener('message', message);
    const timer = setInterval(() => { if (navigator.onLine) void sync(); }, 15000); void sync();
    return () => { clearInterval(timer); channel?.close(); window.removeEventListener('online', network); window.removeEventListener('offline', network); navigator.serviceWorker?.removeEventListener('message', message); };
  }, [sync, reload]);
  const loadMonths = useCallback(async (months: string[]) => {
    if (!key || !owner || !navigator.onLine) return;
    await Promise.all(months.map(month => {
      if (loadedMonths.current.has(month)) return;
      if (pendingMonths.current.has(month)) return pendingMonths.current.get(month);
      const request = sequence.current;
      const promise = api<{ expenses: Expense[] }>(`expenses?month=${month}`, key).then(b => {
        if (session.current !== key || sequence.current !== request) return;
        loadedMonths.current.add(month);
        setData(current => { if (!current) return current; const next = { ...current, history: [...current.history.filter(e => !e.date.startsWith(month)), ...b.expenses] }; storage.setItem(`bootstrap-${owner}`, JSON.stringify(next)); return next; });
      }).catch(e => { if (session.current === key) showError(e); }).finally(() => pendingMonths.current.delete(month));
      pendingMonths.current.set(month, promise); return promise;
    }));
  }, [key, owner, showError]);
  async function login() { setLoading(true); setError(''); try { const b = await api<Bootstrap>('bootstrap', keyInput); if (!storage.setItem('app-key', keyInput)) throw new Error('Разрешите хранение данных сайта для входа'); const id = await setQueueKey(keyInput); storage.setItem(`bootstrap-${id}`, JSON.stringify(b)); session.current = keyInput; setOwner(id); setData(b); setKey(keyInput); setKeyInput(''); loadedMonths.current.add(today(b.tz).slice(0, 7)); } catch (e) { showError(e); } finally { setLoading(false); } }
  async function save(e: ExpenseInput, ts?: number) {
    if (!data || session.current !== key) return false; validateExpense(e, data.categories, data.tz);
    if (looksDuplicate(e, [...data.history, ...queue.map(q => q.expense)], data.duplicateWindow, Date.now(), ts)) { const yes = await new Promise<boolean>(resolve => setDuplicate({ expense: e, resolve })); if (!yes) return false; }
    await enqueue(e, owner); if (session.current !== key) return false; setQueue(await allQueued(owner)); notify(navigator.onLine ? 'Сохранено · отправляется в таблицу' : 'Сохранено в очередь'); void sync(); return true;
  }
  async function edit(e: Expense, patch: Partial<Expense>) { await api(`expenses/${e.row}`, key, { method: 'PATCH', body: JSON.stringify({ ...patch, fp: e.fp }) }); await reload(); notify('Изменения сохранены'); }
  function remove(e: Expense) { if (timers.current.has(e.row)) return; setDeletions(items => [...items, e]); navigator.vibrate?.(15); timers.current.set(e.row, setTimeout(() => { timers.current.delete(e.row); void (async () => { try { await api(`expenses/${e.row}`, key, { method: 'DELETE', body: JSON.stringify({ fp: e.fp }) }); await reload(); notify('Запись удалена'); } catch (e) { showError(e); } finally { setDeletions(items => items.filter(x => x.row !== e.row)); } })(); }, 5000)); }
  function undo(e: Expense) { clearTimeout(timers.current.get(e.row)); timers.current.delete(e.row); setDeletions(items => items.filter(x => x.row !== e.row)); }
  async function logout() { try { await setQueueKey(''); if (!storage.removeItem('app-key')) throw new Error(); storage.keys().filter(k => k.startsWith('bootstrap-')).forEach(k => storage.removeItem(k)); closeSession(); setError(''); return true; } catch { setError('Не удалось защитить очередь. Повторите выход'); return false; } }
  async function exportCsv(month: string) { try { const r = await fetch(`/api/export.csv?month=${month}`, { headers: { 'X-App-Key': key } }); if (!r.ok || !r.headers.get('Content-Type')?.includes('text/csv')) throw new Error('Экспорт недоступен. Проверьте сеть и код доступа'); const url = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = url; a.download = `expenses-${month}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (e) { showError(e); } }
  return { key, keyInput, setKeyInput, data: data ? { ...data, history: data.history.filter(e => !deletions.some(d => d.row === e.row)) } : null, queue, online, error, toast, loading, duplicate, setDuplicate, deletions, undo, login, logout, save, edit, remove, reload, sync, exportCsv, loadMonths,
    retry: (q: Queued) => void retryQueued(q).then(sync).catch(showError), removeQueue: (q: Queued) => void discardQueued(q).then(sync).catch(showError),
    editQueue: async (q: Queued, patch: Partial<Expense>) => { const expense = validateExpense({ ...q.expense, ...patch }, data!.categories, data!.tz); await changeQueued(q, expense); await sync(); }
  };
}

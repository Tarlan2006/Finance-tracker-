import type { ExpenseInput } from '../../../shared/types';
import { ApiError, readJson } from './http';
export interface Queued { id: string; owner: string; expense: ExpenseInput; status: 'queued' | 'error'; error?: string; attempts: number; nextAt: number; created: number }
interface Config { id: 'config'; key: string; owner: string }
interface Sealed { id: string; iv: number[]; data: number[] }
async function cipher(key: string) { return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)), 'AES-GCM', false, ['encrypt', 'decrypt']); }
function db(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const r = indexedDB.open('tenge-finance-v1', 1); r.onupgradeneeded = () => { r.result.createObjectStore('queue', { keyPath: 'id' }); r.result.createObjectStore('meta', { keyPath: 'id' }); }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
async function transaction<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => { const tx = d.transaction(store, mode); const req = run(tx.objectStore(store)); tx.oncomplete = () => { d.close(); resolve(req.result); }; tx.onerror = () => { d.close(); reject(tx.error); }; tx.onabort = () => { d.close(); reject(tx.error || new Error('Не удалось сохранить очередь')); }; });
}
export const allQueued = (owner: string) => transaction<Queued[]>('queue', 'readonly', s => s.getAll()).then(rows => rows.filter(r => r.owner === owner).sort((a, b) => a.created - b.created || a.id.localeCompare(b.id)));
export const putQueued = (row: Queued) => transaction('queue', 'readwrite', s => s.put(row));
export const removeQueued = (id: string) => transaction('queue', 'readwrite', s => s.delete(id));
export async function hasWaitingQueue() { const config = await transaction<Config | undefined>('meta', 'readonly', s => s.get('config')); return config ? (await allQueued(config.owner)).some(q => q.status === 'queued') : false; }
export async function setQueueKey(key: string, stillActive: () => boolean = () => true): Promise<string> {
  return withQueueLock(() => withSessionLock(async () => {
    if (!stillActive()) return '';
    const old = await transaction<Config | undefined>('meta', 'readonly', s => s.get('config'));
    if (old && old.key !== key) {
      const rows = await allQueued(old.owner);
      let sealed: Sealed | undefined;
      if (rows.length) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cipher(old.key), new TextEncoder().encode(JSON.stringify(rows)));
        sealed = { id: `sealed:${old.owner}`, iv: [...iv], data: [...new Uint8Array(encrypted)] };
      }
      await atomic((meta, queue) => { if (sealed) meta.put(sealed); rows.forEach(row => queue.delete(row.id)); meta.delete('config'); });
    }
    if (!key) { await transaction('meta', 'readwrite', s => s.delete('config')); return ''; }
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    const owner = [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
    const sealed = await transaction<Sealed | undefined>('meta', 'readonly', s => s.get(`sealed:${owner}`));
    if (sealed) {
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(sealed.iv) }, await cipher(key), new Uint8Array(sealed.data));
      const rows = JSON.parse(new TextDecoder().decode(decrypted)) as Queued[];
      await atomic((meta, queue) => { rows.forEach(row => queue.put(row)); meta.delete(sealed.id); meta.put({ id: 'config', key, owner }); });
    }
    await transaction('meta', 'readwrite', s => s.put({ id: 'config', key, owner }));
    return owner;
  }));
}
export async function enqueue(expense: ExpenseInput, owner: string) {
  return withSessionLock(async () => {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(['meta', 'queue'], 'readwrite');
    const config = tx.objectStore('meta').get('config');
    config.onsuccess = () => {
      if (config.result?.owner !== owner) { tx.abort(); return; }
      tx.objectStore('queue').put({ id: expense.id, expense, owner, status: 'queued', attempts: 0, nextAt: 0, created: Date.now() });
    };
    tx.oncomplete = () => { database.close(); resolve(); };
    tx.onabort = tx.onerror = () => { database.close(); reject(new Error('Не удалось записать очередь. Проверьте хранилище и войдите снова')); };
  });
  });
}
async function atomic(run: (meta: IDBObjectStore, queue: IDBObjectStore) => void) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction(['meta', 'queue'], 'readwrite'); run(tx.objectStore('meta'), tx.objectStore('queue'));
    tx.oncomplete = () => { database.close(); resolve(); };
    tx.onerror = tx.onabort = () => { database.close(); reject(tx.error || new Error('Хранилище недоступно')); };
  });
}
async function withSessionLock<T>(task: () => Promise<T>): Promise<T> { return navigator.locks ? await navigator.locks.request('tenge-session', task) : await task(); }
async function withQueueLock<T>(task: () => Promise<T>): Promise<T> { return navigator.locks ? await navigator.locks.request('tenge-queue', task) : await task(); }
export async function changeQueued(row: Queued, expense: ExpenseInput) {
  await withQueueLock(async () => {
    const current = await transaction<Queued | undefined>('queue', 'readonly', s => s.get(row.id));
    if (!current || current.owner !== row.owner) throw new Error('Запись уже отправлена. Обновите журнал и измените её там');
    await putQueued({ ...current, expense, status: 'queued', attempts: 0, nextAt: 0, error: undefined });
  });
}
export async function discardQueued(row: Queued) { await withQueueLock(async () => { const current = await transaction<Queued | undefined>('queue', 'readonly', s => s.get(row.id)); if (current?.owner === row.owner) await removeQueued(row.id); }); }
export async function retryQueued(row: Queued) { await withQueueLock(async () => { const current = await transaction<Queued | undefined>('queue', 'readonly', s => s.get(row.id)); if (current?.owner === row.owner) await putQueued({ ...current, status: 'queued', attempts: 0, nextAt: 0, error: undefined }); }); }
async function drain() {
  const config = await transaction<Config | undefined>('meta', 'readonly', s => s.get('config'));
  if (!config) return;
  for (const item of await allQueued(config.owner)) {
    if (item.status === 'error') continue;
    if (item.nextAt > Date.now()) break;
    // Recheck logout/account switch between network calls.
    const current = await transaction<Config | undefined>('meta', 'readonly', s => s.get('config'));
    if (current?.owner !== config.owner) break;
    try {
      const r = await fetch('/api/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Key': config.key }, body: JSON.stringify(item.expense), signal: AbortSignal.timeout(20000) });
      const data = await readJson(r);
      const saved = data.expense as Partial<ExpenseInput> | undefined;
      if (saved?.id !== item.id) throw new ApiError(502, 'Сервер не подтвердил запись. Повторяем с тем же ID', true);
      await removeQueued(item.id);
    } catch (error) {
      if (error instanceof ApiError && !error.retryable) {
        await putQueued({ ...item, status: 'error', error: error.message });
        if (error.status === 401 || error.status === 403) break;
        continue;
      }
      await putQueued({ ...item, attempts: item.attempts + 1, nextAt: Date.now() + Math.min(60000, 1000 * 2 ** item.attempts) }); break;
    }
  }
}
let running: Promise<void> | undefined;
export function flushQueue(): Promise<void> {
  if (!running) running = (async () => { if (navigator.locks) await navigator.locks.request('tenge-queue', drain); else await drain(); })().finally(() => { running = undefined; });
  return running;
}

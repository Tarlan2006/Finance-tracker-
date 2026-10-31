import type { AccountSession } from '../../../shared/accounts';
import { storage } from './storage';
import { ApiError } from './http';
export function savedSession(): AccountSession | null { try { const s = JSON.parse(storage.getItem('account-session') || 'null'); return s && typeof s.token === 'string' && /^[a-f0-9]{64}$/.test(s.token) && typeof s.account?.id === 'string' ? s : null; } catch { return null; } }
export async function accountApi<T>(path: string, token = '', body?: unknown, method = body ? 'POST' : 'GET'): Promise<T> {
  const response = await fetch(`/api/${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-App-Key': token }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('Сервис временно недоступен. Повторите позже');
  const result = await response.json(); if (!response.ok) throw new ApiError(response.status, result.message || 'Не удалось выполнить запрос', response.status >= 500 || response.status === 429, result.error || ''); return result;
}

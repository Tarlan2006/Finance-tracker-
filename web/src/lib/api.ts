import { readJson } from './http';
import { isBootstrap, isConfig, isExpense } from './data';
export { ApiError } from './http';
export async function api<T>(path: string, key: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-App-Key': key }, signal: AbortSignal.timeout(20000) });
  const data = await readJson(response);
  if (path.startsWith('config') && (path.includes('dry=1') ? typeof data.count !== 'number' || !Number.isFinite(data.count) : !isConfig('configured' in data ? data : data.config))) throw new Error('Сервер вернул неполные настройки. Обновите страницу');
  if ((path.startsWith('bootstrap') && !isBootstrap(data)) || ((path === 'expenses' || path.startsWith('expenses?')) && (!init.method || init.method === 'GET') && (!Array.isArray(data.expenses) || !data.expenses.every(isExpense)))) throw new Error('Сервер вернул неполные данные. Обновите страницу позже');
  return data as T;
}

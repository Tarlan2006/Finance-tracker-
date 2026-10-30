import { readJson } from './http';
export { ApiError } from './http';
export async function api<T>(path: string, key: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-App-Key': key }, signal: AbortSignal.timeout(20000) });
  const data = await readJson(response);
  return data as T;
}

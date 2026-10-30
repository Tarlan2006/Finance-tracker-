export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function api<T>(path: string, key: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-App-Key': key }, signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.message || 'Не удалось выполнить запрос');
  return data as T;
}

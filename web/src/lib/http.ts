export class ApiError extends Error { constructor(public status: number, message: string, public retryable = false) { super(message); } }
export async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new ApiError(response.status, 'Сервер временно недоступен. Запись сохранена в очереди; повторите позже', true);
  let data: Record<string, unknown>;
  try { data = await response.json(); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); }
  catch { throw new ApiError(response.status, 'Сервер вернул неполный ответ. Повторите позже', true); }
  if (!response.ok) throw new ApiError(response.status, typeof data.message === 'string' ? data.message : 'Запрос не выполнен. Повторите позже', response.status === 408 || response.status === 429 || response.status >= 500);
  return data;
}

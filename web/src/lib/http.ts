import { retryAfterSeconds } from '../../../shared/retry';
export class ApiError extends Error { constructor(public status: number, message: string, public retryable = false, public code = '', public retryAfter = 0) { super(message); } }
export async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (response.status === 401) throw new ApiError(401, 'Сеанс завершён. Войдите снова', false, 'unauthorized');
  const retryAfter = retryAfterSeconds(response.headers.get('Retry-After'));
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new ApiError(response.status, 'Сервер временно недоступен. Запись сохранена в очереди; повторите позже', response.status !== 403, 'invalid_response', retryAfter);
  let data: Record<string, unknown>;
  try { data = await response.json(); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); }
  catch { throw new ApiError(response.status, 'Сервер вернул неполный ответ. Повторите позже', response.status !== 403, 'invalid_response', retryAfter); }
  if (!response.ok) throw new ApiError(response.status, typeof data.message === 'string' ? data.message : 'Запрос не выполнен. Повторите позже', response.status === 408 || response.status === 429 || response.status >= 500, typeof data.error === 'string' ? data.error : '', retryAfter);
  return data;
}

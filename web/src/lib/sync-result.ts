import { ApiError } from './http';

const messages = {
  sending: 'Отправляем в таблицу', sent: 'Запись подтверждена сервером',
  offline: 'Нет сети. Запись сохранена', network: 'Не удалось соединиться с сервером',
  timeout: 'Сервер не ответил вовремя', server: 'Сервер временно недоступен',
  response: 'Сервер не подтвердил запись', auth: 'Сеанс завершён. Войдите снова',
  password: 'Для отправки войдите снова и задайте новый пароль', denied: 'Нет доступа к операции',
  schema: 'Нарушена структура таблицы. Проверьте заголовки A:H',
  sheet: 'Таблица была заменена или отключена. Проверьте привязку',
  conflict: 'Конфликт с записью в таблице. Проверьте журнал',
  invalid: 'Проверьте поля расхода', rate: 'Слишком много попыток. Повторите позже',
  busy: 'Очередь занята другой вкладкой. Закройте её и повторите',
  client: 'Ошибка приложения при отправке. Откройте приложение снова', storage: 'Не удалось открыть очередь на устройстве', access: 'Google Sheets отклонил запрос (403). Проверьте доступ и квоту',
};
export type SyncResult = { at: number; kind: keyof typeof messages; status?: number };
export const syncText = (result: SyncResult) => messages[result.kind];
export function classifyFailure(error: unknown, online: boolean): SyncResult {
  const at = Date.now();
  if (!(error instanceof ApiError)) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return { at, kind: 'timeout' };
    if (!online) return { at, kind: 'offline' };
    return { at, kind: error instanceof TypeError ? 'network' : 'client' };
  }
  const { status, code } = error;
  let kind: SyncResult['kind'];
  if (code === 'queue_busy') kind = 'busy';
  else if (code === 'queue_storage') kind = 'storage';
  else if (status === 401 || (status === 403 && code === 'unauthorized')) kind = 'auth';
  else if (code === 'must_change_password') kind = 'password';
  else if (code === 'sheets_access') kind = 'access';
  else if (status === 403) kind = 'denied';
  else if (status === 429) kind = 'rate';
  else if (status === 408) kind = 'timeout';
  else if (code === 'schema_mismatch') kind = 'schema';
  else if (['sheet_changed', 'sheet_unlinked'].includes(code)) kind = 'sheet';
  else if (code === 'invalid_response') kind = 'response';
  else if (status >= 500) kind = 'server';
  else if (status === 409) kind = 'conflict';
  else kind = 'invalid';
  return { at, kind, ...(status ? { status } : {}) };
}
export function readSyncResult(value: string | null): SyncResult | undefined {
  try {
    const result = JSON.parse(value || 'null');
    if (result && Number.isFinite(result.at) && Object.hasOwn(messages, result.kind)) return result;
  } catch { /* An older diagnostic must not block the queue. */ }
}

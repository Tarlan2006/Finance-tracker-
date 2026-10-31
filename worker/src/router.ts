import { AppError, clean, csv, displayName, expensesFromRows, fingerprint, firstEmptyRow, parseAmount, suggestion, today, validMonth, validateExpense } from '../../shared/logic';
import type { Expense, ExpenseInput, Snapshot } from '../../shared/types';
import type { Env } from './env';
import { isMock } from './env';
import { Auth } from './auth';
import type { SheetsAdapter } from './sheets';
import { securityHeaders } from './headers';
import { ConfigApi } from './config-api';
import { configCategories } from '../../shared/config';
import type { OperationStorage } from './config-store';
export const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
export function errorResponse(error: unknown) { return error instanceof AppError ? json({ error: error.code, message: error.message }, error.status) : json({ error: 'upstream', message: 'Не удалось связаться с таблицей. Повторите позже' }, 503); }
export class Api {
  private auth: Auth;
  private tail: Promise<unknown> = Promise.resolve();
  private config: ConfigApi;
  constructor(private env: Env, private adapter: SheetsAdapter, operations?: OperationStorage) { this.auth = new Auth(env.APP_KEY || ''); this.config = new ConfigApi(adapter, operations); }
  async fetch(request: Request): Promise<Response> {
    try {
      const origin = request.headers.get('Origin');
      if (origin && origin !== new URL(request.url).origin) throw new AppError(403, 'origin', 'Запрос с другого сайта запрещён');
      await this.auth.check(request);
      if (new URL(request.url).pathname === '/api/health' && request.method === 'GET') return json({ ok: true });
      // Serializes read/check/write, including concurrent calls in the same DO.
      const run = this.tail.then(() => this.route(request));
      this.tail = run.catch(() => undefined);
      return await run;
    } catch (e) { return errorResponse(e); }
  }
  private async snapshot() {
    const config = await this.config.read(), s = await this.adapter.read(!config.configured);
    if (config.configured) s.categories = configCategories(config.categories).filter(c => !c.archived);
    if (s.rows[0]?.[6] !== 'ID' || s.rows[0]?.[7] !== 'Источник') throw new AppError(422, 'headers', 'Добавь столбцы G и H: G1 = ID, H1 = Источник');
    return s;
  }
  private async body(request: Request): Promise<Record<string, unknown>> {
    if (Number(request.headers.get('Content-Length') || 0) > 16384) throw new AppError(413, 'body', 'Слишком большой запрос');
    const text = await request.text();
    if (text.length > 16384) throw new AppError(413, 'body', 'Слишком большой запрос');
    try { const value = JSON.parse(text); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; } catch { throw new AppError(422, 'json', 'Неверный JSON'); }
  }
  private async create(body: unknown, s: Snapshot, allowPending = false) {
    const id = body && typeof body === 'object' ? clean((body as Record<string, unknown>).id) : '';
    const existing = id ? expensesFromRows(s.rows).find(x => x.id === id) : undefined;
    if (existing) return { expense: existing, duplicate: true };
    if (id && s.rows.some(r => r[6] === id)) throw new AppError(409, 'partial_row', 'Запись с этим ID изменена вручную. Обновите журнал');
    const e = validateExpense(body, s.categories, this.env.TZ, allowPending);
    const row = firstEmptyRow(s.rows);
    if (row > 1006) throw new AppError(422, 'sheet_full', 'Лист заполнен до строки 1006. Запись осталась в очереди. Расширьте формулу и лимит строк приложения перед повтором');
    // A:D empty with nonempty G/H can be an incomplete external edit. Never overwrite metadata.
    if (s.rows[row - 1]?.[6] || s.rows[row - 1]?.[7]) throw new AppError(409, 'partial_row', 'В пустой строке остался ID. Проверьте таблицу вручную');
    await this.adapter.write(row, e);
    return { expense: { ...e, row, fp: fingerprint(e) }, duplicate: false };
  }
  private async route(request: Request): Promise<Response> {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (path === '/api/config' && method === 'GET') return json(await this.config.read());
    if (path === '/api/config/setup' && method === 'POST') return json(await this.config.setup());
    if (path.startsWith('/api/config/') && (method === 'POST' || method === 'PATCH')) return json(await this.config.mutate(path, await this.body(request), url.searchParams.get('dry') === '1'));
    const known = ['/api/bootstrap', '/api/expenses', '/api/quick', '/api/export.csv'].includes(path) || /^\/api\/expenses\/\d+$/.test(path);
    if (!known) throw new AppError(404, 'not_found', 'Маршрут не найден');
    const s = await this.snapshot(), history = expensesFromRows(s.rows);
    const month = validMonth(url.searchParams.get('month') || today(this.env.TZ).slice(0, 7));
    const expenses = history.filter(e => e.date.startsWith(month));
    if (method === 'GET' && path === '/api/bootstrap') return json({ categories: s.categories, config: await this.config.read(), expenses, history, summaries: s.summaries, summary: s.summaries.find(x => x.month === month) || null, tz: this.env.TZ, currency: this.env.CURRENCY, duplicateWindow: Number(this.env.DUPLICATE_WINDOW_MIN) || 3, mock: isMock(this.env) });
    if (method === 'GET' && path === '/api/expenses') return json({ expenses });
    if (method === 'GET' && path === '/api/export.csv') return new Response(csv(expenses), { headers: { ...securityHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="expenses-${month}.csv"`, 'Cache-Control': 'no-store' } });
    if (method === 'POST' && path === '/api/expenses') { const result = await this.create(await this.body(request), s); return json(result, result.duplicate ? 200 : 201); }
    if (method === 'POST' && path === '/api/quick') {
      const b = await this.body(request), amount = parseAmount(b.amount), name = clean(b.merchant);
      const hint = suggestion(name, history.filter(e => s.categories.some(c => c.name === e.category)));
      if (b.save !== true && b.save !== 1) return json({ suggestion: hint });
      // Automatic clients must retain their event ID across retries.
      const input: ExpenseInput = { id: clean(b.id), date: today(this.env.TZ), amount, name, category: hint.confidence >= .6 ? hint.category : '', comment: '', source: b.src === 'kaspi' ? 'kaspi-auto' : 'wallet-auto' };
      const result = await this.create(input, s, true);
      return json({ ...result, suggestion: hint, text: `✓ ${amount.toLocaleString('ru-RU')} ${this.env.CURRENCY} · ${displayName(input)} · ${input.category || 'Нужно проверить'}` }, result.duplicate ? 200 : 201);
    }
    const match = path.match(/^\/api\/expenses\/(\d+)$/);
    if (match && (method === 'PATCH' || method === 'DELETE')) {
      const row = Number(match[1]);
      if (!Number.isSafeInteger(row) || row < 2) throw new AppError(422, 'row', 'Неверный номер строки');
      const b = method === 'PATCH' || (request.body !== null && request.headers.get('Content-Type')?.includes('application/json')) ? await this.body(request) : {};
      const fp = b.fp || url.searchParams.get('fp');
      const current = history.find(e => e.row === row);
      if (!current || !fp || current.fp !== fp) throw new AppError(409, 'conflict', 'Строка изменилась. Обновите список и повторите');
      if (method === 'DELETE') { await this.adapter.clear(row); return json({ ok: true }); }
      const changed = validateExpense({ ...current, ...b, id: current.id || `${Date.now()}-${crypto.randomUUID()}` }, s.categories, this.env.TZ);
      await this.adapter.write(row, changed);
      return json({ expense: { ...changed, row, fp: fingerprint(changed) } satisfies Expense });
    }
    throw new AppError(405, 'method', 'Метод не поддерживается');
  }
}

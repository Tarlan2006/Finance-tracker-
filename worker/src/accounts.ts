import { bodyLimit, bulkExpensePath } from './sheets';
import { AppError } from '../../shared/logic';
import type { AccountView } from '../../shared/accounts';
import type { Env } from './env';
import type { OperationStorage } from './config-store';
import { json, errorResponse } from './router';
import { constantEqual, digest, hashPassword, randomSecret, validatePassword, verifyPassword, type PasswordHash } from './passwords';
interface Account extends PasswordHash { id: string; login: string; displayName: string; sheetId: string; sheetVersion?: number; queueKey: string; mustChangePassword: boolean; disabled: boolean; createdAt: number; passwordChangedAt: number }
interface Session { id: string; hash: string; accountId: string; device: string; createdAt: number; lastUsedAt: number; expiresAt: number }
interface Failure { count: number; level: number; until: number; touched: number }
interface State { accounts: Account[]; sessions: Session[]; failures: Record<string, Failure>; rates: Record<string, { count: number; until: number }>; dummy: PasswordHash }
export const SESSION_LIFE = 180 * 86400000;
const view = (a: Account): AccountView => ({ id: a.id, login: a.login, displayName: a.displayName, mustChangePassword: a.mustChangePassword, hasSheet: !!a.sheetId, sheetVersion: a.sheetVersion || 1 });
export function parseSheetId(value: unknown) { const s = typeof value === 'string' ? value.trim() : ''; const id = s.startsWith('https://docs.google.com/spreadsheets/d/') ? s.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:[/?#]|$)/)?.[1] || '' : s; if (!/^[a-zA-Z0-9_-]{20,200}$/.test(id)) throw new AppError(422, 'sheet_id', 'Введите ссылку Google Sheets или корректный ID таблицы'); return id; }
async function body(request: Request) { if (Number(request.headers.get('Content-Length')) > 4096) throw new AppError(413, 'body', 'Слишком большой запрос'); const text = await request.text(); if (text.length > 4096) throw new AppError(413, 'body', 'Слишком большой запрос'); try { const b = JSON.parse(text); if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error(); return b as Record<string, unknown>; } catch { throw new AppError(422, 'json', 'Неверный JSON'); } }
class Limited extends AppError { constructor(readonly retry: number) { super(429, 'rate_limit', `Слишком много попыток. Повторите через ${Math.ceil(retry / 60)} мин.`); } }
// One SQLite-backed DO. A committed state value atomically contains accounts, token hashes and lockouts.
// Authentication is serialized; sheet network requests run outside this queue.
export class AccountsService {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private storage: OperationStorage, private env: Env, private now = () => Date.now()) {}
  private async state(): Promise<State> {
    const saved = await this.storage.get<State>('accounts-v1'); if (saved && (saved.accounts.length || !this.env.APP_KEY)) return saved;
    const state: State = saved || { accounts: [], sessions: [], failures: {}, rates: {}, dummy: await hashPassword(randomSecret()) };
    if (this.env.APP_KEY) state.accounts.push({ id: 'tarlan', login: 'tarlan', displayName: 'Tarlan', sheetId: this.env.USE_MOCK === '1' ? 'mock-tarlan-table-0000000000' : this.env.SHEET_ID || '', queueKey: randomSecret(), mustChangePassword: false, disabled: false, createdAt: this.now(), passwordChangedAt: this.now(), ...await hashPassword(this.env.APP_KEY) });
    await this.storage.put('accounts-v1', state); return state;
  }
  private rate(s: State, key: string, max: number) { const time = this.now(); const r = s.rates[key]; if (r && r.until > time) { if (++r.count > max) throw new Limited(Math.ceil((r.until - time) / 1000)); } else s.rates[key] = { count: 1, until: time + 60000 }; }
  private blocked(s: State, keys: string[]) { const until = Math.max(0, ...keys.map(k => s.failures[k]?.until || 0)); if (until > this.now()) throw new Limited(Math.ceil((until - this.now()) / 1000)); }
  private fail(s: State, keys: string[]) { for (const key of keys) { const f = s.failures[key] || { count: 0, level: 0, until: 0, touched: this.now() }; f.touched = this.now(); if (++f.count >= 5) { f.until = this.now() + Math.min(86400000, 900000 * 2 ** f.level); f.level++; f.count = 0; } s.failures[key] = f; } this.blocked(s, keys); }
  async fetch(request: Request): Promise<Response> {
    // Buffer the bounded incoming stream before queued work/early responses. A DO must not
    // leave a caller-owned stream unread after replying (e.g. logout or rate limiting).
    if (request.body) {
      const limit = bodyLimit(new URL(request.url).pathname);
      try { const reader = request.body.getReader(), chunks: Uint8Array[] = []; let length = 0; for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > limit) { await reader.cancel(); throw new AppError(413, 'body', 'Слишком большой запрос'); } chunks.push(value); } const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } request = new Request(request, { body: bytes }); } catch (e) { return errorResponse(e); }
    }
    const task = this.tail.then(async () => {
      const origin = request.headers.get('Origin'); if (origin && origin !== new URL(request.url).origin) return errorResponse(new AppError(403, 'origin', 'Запрос с другого сайта запрещён'));
      if (new URL(request.url).pathname === '/api/health' && request.method === 'GET') return json({ ok: true });
      const s = await this.state();
      s.sessions = s.sessions.filter(x => x.expiresAt > this.now());
      for (const [k, r] of Object.entries(s.rates)) if (r.until <= this.now()) delete s.rates[k];
      for (const [k, f] of Object.entries(s.failures)) if (f.touched < this.now() - 7 * 86400000) delete s.failures[k];
      let result: Response | { account: Account };
      try { result = await this.route(request, s); } catch (e) { result = errorResponse(e); if (e instanceof Limited) result.headers.set('Retry-After', String(e.retry)); }
      await this.storage.put('accounts-v1', s);
      return result;
    });
    this.tail = task.catch(() => undefined);
    try {
      const result = await task;
      if (result instanceof Response) return result;
      const a = result.account;
      if (!this.env.COORDINATOR) return errorResponse(new AppError(503, 'configuration', 'Не настроена координация записей'));
      const headers = new Headers(request.headers);
      // Never trust client routing metadata. Only this DO chooses the table and actor.
      headers.delete('X-App-Key'); headers.delete('Authorization'); headers.set('X-FT-Account', a.id); headers.set('X-FT-Sheet', a.sheetId);
      return await this.env.COORDINATOR.get(this.env.COORDINATOR.idFromName(`sheet:${a.id}:${a.sheetId}`)).fetch(new Request(request, { headers }));
    } catch { return errorResponse(new AppError(503, 'accounts', 'Сервис аккаунтов временно недоступен')); }
  }
  private async route(request: Request, s: State): Promise<Response | { account: Account }> {
    const path = new URL(request.url).pathname, method = request.method, ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (path.startsWith('/api/admin/')) return this.admin(request, s, ip);
    if (path === '/api/accounts' && method === 'GET') { this.rate(s, 'list-global', 600); this.rate(s, `list:${ip}`, 60); return json(s.accounts.filter(a => !a.disabled).map(a => ({ login: a.login, displayName: a.displayName }))); }
    if (path === '/api/login' && method === 'POST') {
      this.rate(s, 'login-global', 200); this.rate(s, `login-ip:${ip}`, 30);
      const b = await body(request), login = typeof b.login === 'string' ? b.login.toLowerCase().slice(0, 32) : '', password = typeof b.password === 'string' && b.password.length <= 256 ? b.password : '';
      const keys = [`login:${login}`, `pair:${ip}:${login}`]; this.blocked(s, keys);
      if (Object.keys(s.failures).length >= 5000 && keys.some(k => !s.failures[k])) throw new Limited(900);
      const a = s.accounts.find(a => a.login === login);
      const valid = await verifyPassword(password, a || s.dummy);
      if (!a || !valid || a.disabled) { // Count distinct failing sources toward the account-wide lockout. A single source
        // exhausts its own bucket without preventing the owner signing in elsewhere.
        this.fail(s, s.failures[keys[1]] ? [keys[1]] : keys); throw new AppError(401, 'credentials', 'Неверный логин или пароль'); }
      keys.forEach(k => delete s.failures[k]);
      const token = randomSecret(), now = this.now();
      const own = s.sessions.filter(x => x.accountId === a.id).sort((a, b) => a.lastUsedAt - b.lastUsedAt); if (own.length >= 20) s.sessions = s.sessions.filter(x => x.id !== own[0].id);
      s.sessions.push({ id: crypto.randomUUID(), hash: await digest(token), accountId: a.id, device: (request.headers.get('User-Agent') || 'Неизвестное устройство').slice(0, 200), createdAt: now, lastUsedAt: now, expiresAt: now + SESSION_LIFE });
      return json({ token, account: view(a), ...(!a.mustChangePassword ? { queueKey: a.queueKey } : {}) });
    }
    const token = request.headers.get('X-App-Key') || '';
    const hash = await digest(token), session = /^[a-f0-9]{64}$/.test(token) ? s.sessions.find(x => x.hash === hash) : undefined;
    const a = session && s.accounts.find(a => a.id === session.accountId && !a.disabled);
    if (!a || !session) throw new AppError(401, 'unauthorized', 'Сеанс завершён. Войдите снова');
    session.lastUsedAt = this.now(); session.expiresAt = this.now() + SESSION_LIFE;
    if (path === '/api/logout' && method === 'POST') { s.sessions = s.sessions.filter(x => x.id !== session.id); return json({ ok: true }); }
    if (path === '/api/account/password' && method === 'POST') {
      const keys = [`change:${a.id}`]; this.blocked(s, keys); const b = await body(request);
      const valid = await verifyPassword(typeof b.currentPassword === 'string' && b.currentPassword.length <= 256 ? b.currentPassword : '', a);
      if (!valid) { this.fail(s, keys); throw new AppError(401, 'current_password', 'Текущий пароль неверен'); }
      validatePassword(b.password); if (b.password !== b.confirmPassword) throw new AppError(422, 'password_match', 'Пароли не совпадают');
      Object.assign(a, await hashPassword(b.password), { mustChangePassword: false, passwordChangedAt: this.now() });
      s.sessions = s.sessions.filter(x => x.accountId !== a.id || x.id === session.id); delete s.failures[keys[0]];
      return json({ account: view(a), queueKey: a.queueKey });
    }
    if (a.mustChangePassword) throw new AppError(403, 'must_change_password', 'Задайте свой пароль');
    if (path === '/api/account' && method === 'GET') return json({ account: view(a), queueKey: a.queueKey });
    if (path === '/api/account/sessions' && method === 'GET') return json(s.sessions.filter(x => x.accountId === a.id).map(x => ({ id: x.id, device: x.device, createdAt: x.createdAt, lastUsedAt: x.lastUsedAt, current: x.id === session.id })));
    if (path.startsWith('/api/account/sessions/') && method === 'DELETE') { const id = path.slice('/api/account/sessions/'.length); s.sessions = s.sessions.filter(x => x.accountId !== a.id || x.id !== id); return json({ ok: true }); }
    if (request.headers.has('X-FT-Expected-Sheet') && request.headers.get('X-FT-Expected-Sheet') !== a.sheetId) throw new AppError(409, 'sheet_changed', 'Привязка таблицы изменилась');
    if (!a.sheetId) throw new AppError(409, 'sheet_unlinked', 'Таблица ещё не подключена. Обратитесь к администратору');
    if (path === bulkExpensePath && request.headers.get('X-FT-Sheet-Version') !== String(a.sheetVersion || 1))
      throw new AppError(409, 'sheet_changed', 'Привязка таблицы изменилась. Откройте журнал заново.');
    if (path === '/api/expenses' && method === 'POST' && (request.headers.get('X-FT-Sheet-Version') || '1') !== String(a.sheetVersion || 1)) {
      throw new AppError(409, 'sheet_changed', 'Таблица была заменена. Эта трата сохранена для прежней таблицы. Проверьте её и при необходимости создайте новую запись.');
    }
    return { account: a };
  }
  private async admin(request: Request, s: State, ip: string) {
    if (!this.env.ADMIN_TOKEN) throw new AppError(404, 'not_found', 'Маршрут не найден');
    this.rate(s, 'admin-global', 100); this.rate(s, `admin:${ip}`, 20);
    if (!await constantEqual(request.headers.get('Authorization') || '', `Bearer ${this.env.ADMIN_TOKEN}`)) throw new AppError(401, 'unauthorized', 'Нет доступа');
    const action = new URL(request.url).pathname.slice('/api/admin/'.length);
    if (action === 'list' && request.method === 'GET') return json(s.accounts.map(a => ({ login: a.login, displayName: a.displayName, hasSheet: !!a.sheetId, mustChangePassword: a.mustChangePassword, disabled: a.disabled, sessions: s.sessions.filter(x => x.accountId === a.id).length, passwordChangedAt: a.passwordChangedAt })));
    if (request.method !== 'POST') throw new AppError(405, 'method', 'Метод не поддерживается');
    const b = await body(request), login = typeof b.login === 'string' ? b.login.toLowerCase() : '';
    if (!/^[a-z0-9]{2,32}$/.test(login)) throw new AppError(422, 'login', 'Логин: 2–32 латинские буквы или цифры');
    let a = s.accounts.find(a => a.login === login);
    if (action === 'add') {
      if (a) throw new AppError(409, 'login_exists', 'Аккаунт уже существует');
      validatePassword(b.password); if (typeof b.displayName !== 'string' || !b.displayName.trim() || b.displayName.length > 80) throw new AppError(422, 'name', 'Укажите имя до 80 символов');
      if (s.accounts.length >= 100) throw new AppError(422, 'accounts_full', 'Достигнут лимит аккаунтов');
      a = { id: crypto.randomUUID(), login, displayName: b.displayName.trim(), sheetId: '', queueKey: randomSecret(), mustChangePassword: b.mustChange === true, disabled: false, createdAt: this.now(), passwordChangedAt: this.now(), ...await hashPassword(b.password) }; s.accounts.push(a); return json({ ok: true });
    }
    if (!a) throw new AppError(404, 'account_missing', 'Аккаунт не найден');
    if (action === 'set-password') { validatePassword(b.password); Object.assign(a, await hashPassword(b.password), { mustChangePassword: b.mustChange === true, passwordChangedAt: this.now() }); s.sessions = s.sessions.filter(x => x.accountId !== a.id); for (const key of Object.keys(s.failures)) if (key === `login:${login}` || key.endsWith(`:${login}`) || key === `change:${a.id}`) delete s.failures[key]; }
    else if (action === 'set-sheet') { const id = parseSheetId(b.sheet); if (s.accounts.some(other => other.id !== a!.id && other.sheetId === id)) throw new AppError(409, 'sheet_taken', 'Эта таблица уже принадлежит другому аккаунту'); if (a.sheetId && a.sheetId !== id) {
      a.sheetVersion = (a.sheetVersion || 1) + 1;
      s.sessions = s.sessions.filter(session => session.accountId !== a!.id);
    }
    a.sheetId = id; let email = ''; try { email = JSON.parse(this.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}').client_email || ''; } catch { /* No secret content in errors. */ } return json({ ok: true, serviceAccountEmail: email }); }
    else if (action === 'revoke') s.sessions = s.sessions.filter(x => x.accountId !== a.id || (typeof b.sessionId === 'string' && x.id !== b.sessionId));
    else if (action === 'disable' || action === 'enable') { a.disabled = action === 'disable'; if (a.disabled) s.sessions = s.sessions.filter(x => x.accountId !== a.id); }
    else throw new AppError(404, 'not_found', 'Маршрут не найден');
    return json({ ok: true });
  }
}
export class AccountsDO {
  private service: AccountsService;
  constructor(state: { storage: OperationStorage }, env: Env) { this.service = new AccountsService(state.storage, env); }
  fetch(request: Request) { return this.service.fetch(request); }
}

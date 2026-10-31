import { AppError } from '../../shared/logic';
import type { Env } from './env';
import { isMock } from './env';
import { GoogleSheetsAdapter } from './google-sheets';
import { MockSheetsAdapter } from './mock-sheets';
import { Api, errorResponse } from './router';
import type { OperationStorage } from './config-store';
export { AccountsDO } from './accounts';
// Each account/table pair has an independent serialized read/check/write actor.
export class SheetCoordinator {
  private api?: Api;
  private identity = '';
  constructor(private state: { storage?: OperationStorage }, private env: Env) {}
  fetch(request: Request) {
    // This binding is only invoked by AccountsDO, which replaces both headers.
    const account = request.headers.get('X-FT-Account'), sheet = request.headers.get('X-FT-Sheet');
    if (!account || !sheet) return Promise.resolve(errorResponse(new AppError(401, 'unauthorized', 'Нет доступа')));
    const identity = `${account}:${sheet}`;
    if (this.identity && this.identity !== identity) return Promise.resolve(errorResponse(new AppError(403, 'scope', 'Другой аккаунт')));
    if (!this.api) { this.identity = identity; const env = { ...this.env, APP_KEY: undefined, SHEET_ID: sheet }; this.api = new Api(env, isMock(env) ? new MockSheetsAdapter(env.TZ) : new GoogleSheetsAdapter(env), this.state.storage); }
    return this.api.fetchAccount(request);
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (!env.ACCOUNTS) return errorResponse(new AppError(503, 'configuration', 'Не настроены аккаунты'));
      return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts-v1')).fetch(request);
    }
    if (!env.ASSETS) return new Response('Сначала npm run build', { status: 503 });
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    return response;
  }
};

import { AppError } from '../../shared/logic';
import type { Env } from './env';
import { isMock } from './env';
import { GoogleSheetsAdapter } from './google-sheets';
import { MockSheetsAdapter } from './mock-sheets';
import { Api, errorResponse } from './router';
import type { OperationStorage } from './config-store';
// All API requests for this application share one globally addressable actor.
export class SheetCoordinator {
  private api: Api;
  constructor(state: { storage?: OperationStorage }, env: Env) { this.api = new Api(env, isMock(env) ? new MockSheetsAdapter(env.TZ) : new GoogleSheetsAdapter(env), state.storage); }
  fetch(request: Request) { return this.api.fetch(request); }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (!env.COORDINATOR) return errorResponse(new AppError(503, 'configuration', 'Не настроена координация записей'));
      return env.COORDINATOR.get(env.COORDINATOR.idFromName('finance-tracker-v1')).fetch(request);
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

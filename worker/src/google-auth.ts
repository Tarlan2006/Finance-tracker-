import { AppError } from '../../shared/logic';
interface ServiceAccount { client_email: string; private_key: string }
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
export class GoogleAuth {
  private cached?: { token: string; until: number };
  private pending?: Promise<string>;
  constructor(private credentials: string, private fetcher: typeof fetch = fetch, private now = () => Date.now()) {}
  invalidate() { this.cached = undefined; }
  async token() {
    if (this.cached && this.cached.until > this.now() + 60000) return this.cached.token;
    if (!this.pending) this.pending = this.obtain().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async obtain() {
    let account: ServiceAccount;
    try { account = JSON.parse(this.credentials); if (!account.client_email || !account.private_key) throw new Error(); } catch { throw new AppError(503, 'configuration', 'Проверьте сервисный аккаунт на сервере'); }
    const encoder = new TextEncoder(), iat = Math.floor(this.now() / 1000);
    const body = { iss: account.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 };
    const unsigned = `${base64url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))}.${base64url(encoder.encode(JSON.stringify(body)))}`;
    const pem = account.private_key.replace(/-----[^-]+-----|\s/g, '');
    const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
    const response = await retryFetch(this.fetcher, 'https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64url(new Uint8Array(signature))}` }) });
    if (!response.ok) throw new AppError(503, 'google_auth', 'Google не принял сервисный аккаунт');
    const data = await response.json() as { access_token: string; expires_in: number };
    if (!data.access_token) throw new AppError(503, 'google_auth', 'Google не вернул токен');
    this.cached = { token: data.access_token, until: this.now() + Number(data.expires_in || 3600) * 1000 };
    return data.access_token;
  }
}
export async function retryFetch(fetcher: typeof fetch, url: string, init: RequestInit, sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(15000) });
      if (response.status !== 429 && response.status < 500 || attempt === 3) return response;
      await response.body?.cancel();
    } catch (e) { if (attempt === 3) throw e; }
    await sleep(200 * 2 ** attempt);
  }
  throw new Error('Unreachable');
}

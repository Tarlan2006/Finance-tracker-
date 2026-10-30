import { AppError } from '../../shared/logic';
export class Auth {
  private failures = new Map<string, { count: number; until: number }>();
  constructor(private key: string, private now = () => Date.now()) {}
  async check(request: Request) {
    if (!this.key) throw new AppError(503, 'configuration', 'Код доступа сервера не настроен');
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const entry = this.failures.get(ip);
    if (entry && entry.until > this.now() && entry.count >= 10) throw new AppError(429, 'rate_limit', 'Слишком много попыток. Подождите 15 минут');
    const incoming = request.headers.get('X-App-Key') || '';
    const encoder = new TextEncoder();
    const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(incoming)), crypto.subtle.digest('SHA-256', encoder.encode(this.key))]);
    const left = new Uint8Array(a), right = new Uint8Array(b);
    let diff = 0; for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
    if (diff !== 0) {
      // Bound isolate memory and expire idle IP entries.
      if (this.failures.size > 10000) for (const [id, f] of this.failures) if (f.until <= this.now()) this.failures.delete(id);
      const count = entry && entry.until > this.now() ? entry.count + 1 : 1;
      this.failures.set(ip, { count, until: this.now() + 15 * 60000 });
      if (count >= 10) throw new AppError(429, 'rate_limit', 'Слишком много попыток. Подождите 15 минут');
      throw new AppError(401, 'unauthorized', 'Неверный код доступа');
    }
    this.failures.delete(ip);
  }
}

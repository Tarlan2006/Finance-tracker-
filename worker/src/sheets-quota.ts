import { AppError } from '../../shared/logic';
import { retryAfterSeconds } from '../../shared/retry';
import type { OperationStorage } from './config-store';
import type { Env } from './env';

export class SheetsCooldown extends AppError {
  constructor(readonly seconds: number) { super(503, 'sheets_quota', 'Google ограничил частоту запросов'); }
}
interface Window { recent: { table: string; at: number }[]; until: number; last429: number; strikes: number }
export const quotaUrl = 'https://quota.internal/sheets';
export class SheetsQuota {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private store: OperationStorage, private now = () => Date.now()) {}
  reserve(table: string, retry?: number): Promise<number> {
    const work = this.tail.then(async () => {
      const now = this.now(), win = await this.store.get<Window>('sheets-quota-v1') ?? { recent: [], until: 0, last429: 0, strikes: 0 };
      win.recent = win.recent.filter(r => r.at > now - 60000);
      if (retry !== undefined) {
        if (win.until <= now) win.strikes = now - win.last429 < 300000 ? Math.min(win.strikes + 1, 4) : 1;
        win.last429 = now;
        const delay = Math.min(120, 20 * 2 ** Math.max(0, win.strikes - 1)) + Math.floor(Math.random() * 6);
        win.until = Math.max(win.until, now + 1000 * Math.max(delay, retry));
        await this.store.put('sheets-quota-v1', win);
      }
      if (win.until > now) return Math.ceil((win.until - now) / 1000);
      const same = win.recent.filter(r => r.table === table);
      const oldest = win.recent.length >= 48 ? win.recent[0] : same.length >= 30 ? same[0] : undefined;
      if (oldest) return Math.ceil((oldest.at + 60000 - now) / 1000);
      win.recent.push({ table, at: now });
      await this.store.put('sheets-quota-v1', win);
      return 0;
    });
    this.tail = work.catch(() => undefined);
    return work;
  }
}

// One internal Durable Object shares the service-account budget across table coordinators.
export function tableTransport(env: Env, table: string, local: SheetsQuota, upstream: typeof fetch = fetch) {
  let until = 0;
  const check = () => { if (until > Date.now()) throw new SheetsCooldown(Math.ceil((until - Date.now()) / 1000)); };
  async function reserve(retry?: number) {
    const ns = env.COORDINATOR;
    let seconds: number;
    if (!ns) seconds = await local.reserve(table, retry);
    else {
      const stub = ns.get(ns.idFromName('sheets-quota-v1'));
      const res = await stub.fetch(new Request(quotaUrl, { method:'POST', body:JSON.stringify({table,retry}) }));
      if (!res.ok) throw new SheetsCooldown(30);
      seconds = Number(await res.text());
      if (!Number.isFinite(seconds) || seconds < 0) throw new SheetsCooldown(30);
    }
    if (seconds > 0) { until = Date.now() + seconds * 1000; throw new SheetsCooldown(seconds); }
  }
  const fetcher: typeof fetch = async (input, init) => {
    if (new URL(String(input)).hostname !== 'sheets.googleapis.com') return upstream(input, init);
    check(); await reserve();
    const response = await upstream(input, init);
    if (response.status === 429) {
      await response.body?.cancel();
      await reserve(retryAfterSeconds(response.headers.get('Retry-After')));
    }
    return response;
  };
  return { check, fetcher };
}

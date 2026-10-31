import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GoogleAuth, retryFetch } from '../../worker/src/google-auth';
import { GoogleSheetsAdapter } from '../../worker/src/google-sheets';
import type { Env } from '../../worker/src/env';
let credentials: string, publicKey: CryptoKey;
beforeAll(async () => {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  publicKey = keys.publicKey;
  const der = await crypto.subtle.exportKey('pkcs8', keys.privateKey);
  credentials = JSON.stringify({ client_email: 'unit@example.invalid', private_key: `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString('base64')}\n-----END PRIVATE KEY-----` });
});
describe('Google auth and transport', () => {
  it('подпись JWT проверяется, токен кэшируется и обновляется', async () => {
    let now = 1793332800000;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const assertion = (init!.body as URLSearchParams).get('assertion')!;
      const [header, payload, sig] = assertion.split('.');
      expect(JSON.parse(Buffer.from(header, 'base64url').toString()).alg).toBe('RS256');
      expect(JSON.parse(Buffer.from(payload, 'base64url').toString()).aud).toBe('https://oauth2.googleapis.com/token');
      expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${header}.${payload}`))).toBe(true);
      return Response.json({ access_token: 'test-token', expires_in: 3600 });
    });
    const auth = new GoogleAuth(credentials, fetcher, () => now);
    await Promise.all([auth.token(), auth.token()]); expect(fetcher).toHaveBeenCalledTimes(1);
    now += 3600000; await auth.token(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('429/5xx максимум четыре попытки с backoff', async () => { const waits: number[] = []; const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('', { status: 502 })).mockResolvedValue(new Response('{}')); expect((await retryFetch(fetcher, 'https://example.invalid', {}, async n => { waits.push(n); })).ok).toBe(true); expect(fetcher).toHaveBeenCalledTimes(4); expect(waits).toEqual([200, 400, 800]); });
  it('ошибку 400 не повторяет', async () => { const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 400 })); expect((await retryFetch(fetcher, 'https://example.invalid', {})).status).toBe(400); expect(fetcher).toHaveBeenCalledTimes(1); });
  it('пакетное чтение, категории кэшированы; записи только A:E/G:H RAW', async () => {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url).includes('oauth2')) return Response.json({ access_token: 'test-token', expires_in: 3600 });
      calls.push({ url: String(url), body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (String(url).includes('batchGet')) return Response.json({ valueRanges: [{ values: [['Дата', '', '', '', '', '', 'ID', 'Источник'], [46200, '', 'еда', 2666]] }, { values: [['2026-10', 10, 1, 2, 3, 7, .7]] }, { values: [['еда', 100], ['ИТОГО', 100], ['НЕ ЧИТАТЬ', 4]] }] });
      return Response.json({});
    };
    const env: Env = { GOOGLE_SERVICE_ACCOUNT_JSON: credentials, SHEET_ID: 'test-sheet', SHEET_NAME_EXPENSES: 'Ввод данных', SHEET_NAME_DICT: 'Справочник', SHEET_NAME_INCOME: 'Доходы и расходы', TZ: 'Asia/Almaty', CURRENCY: '₸', DUPLICATE_WINDOW_MIN: '3' };
    const adapter = new GoogleSheetsAdapter(env, fetcher);
    expect((await adapter.read()).categories).toEqual([{ name: 'еда', limit: 100 }]);
    await adapter.read();
    expect(new URL(calls[0].url).searchParams.getAll('ranges')).toHaveLength(3);
    expect(new URL(calls[1].url).searchParams.getAll('ranges')).toHaveLength(2);
    expect(new URL(calls[0].url).searchParams.get('valueRenderOption')).toBe('UNFORMATTED_VALUE');
    await adapter.write(157, { id: '1793332800000-testtest', date: '2026-10-30', amount: 1200, name: '=EVIL()', comment: '+cmd', category: 'еда', source: 'manual' });
    await adapter.clear(157);
    expect(calls[2].body).toEqual({ valueInputOption: 'RAW', data: [{ range: "'Ввод данных'!A157:E157", values: [[46325, '=EVIL()', 'еда', 1200, '+cmd']] }, { range: "'Ввод данных'!G157:H157", values: [['1793332800000-testtest', 'manual']] }] });
    expect(calls[3].body).toEqual({ ranges: ["'Ввод данных'!A157:E157", "'Ввод данных'!G157:H157"] });
    await expect(adapter.clear(1)).rejects.toThrow();
  });
});

it.each([[403, 403, 'sheets_access'], [429, 429, 'rate_limit']] as const)('distinguishes Google write failure %s on mock fetch', async (upstream, status, code) => {
  const fetcher: typeof fetch = async url => String(url).includes('oauth2')
    ? Response.json({ access_token: 'fixture', expires_in: 3600 }) : new Response(null, { status: upstream });
  const env: Env = { GOOGLE_SERVICE_ACCOUNT_JSON: credentials, SHEET_ID:'test', SHEET_NAME_EXPENSES:'Ввод данных', SHEET_NAME_INCOME:'Доходы и расходы', SHEET_NAME_DICT:'Справочник', TZ:'Asia/Almaty', CURRENCY:'₸', DUPLICATE_WINDOW_MIN:'3' };
  await expect(new GoogleSheetsAdapter(env, fetcher).write(2, {id:'fixture', date:'2026-10-30', amount:100, name:'fixture', category:'еда', comment:'', source:'manual'})).rejects.toMatchObject({ status, code });
});

it('does not repeat an ambiguous Google clear', async () => {
  let clears = 0;
  const fetcher: typeof fetch = async url => {
    if (String(url).includes('oauth2')) return Response.json({access_token:'fictional-token',expires_in:3600});
    clears++;
    throw new Error('lost reply');
  };
  const env: Env = { GOOGLE_SERVICE_ACCOUNT_JSON: credentials, SHEET_ID:'test', SHEET_NAME_EXPENSES:'Ввод данных', SHEET_NAME_INCOME:'Доходы и расходы', SHEET_NAME_DICT:'Справочник', TZ:'Asia/Almaty', CURRENCY:'₸', DUPLICATE_WINDOW_MIN:'3' };
  await expect(new GoogleSheetsAdapter(env, fetcher).clear(2)).rejects.toThrow('lost reply');
  expect(clears).toBe(1);
});

import { afterEach, expect, it, vi } from 'vitest';
import { GoogleAuth } from '../../worker/src/google-auth';
import { SheetsQuota } from '../../worker/src/sheets-quota';
import { SheetCoordinator } from '../../worker/src/index';
import { MockSheetsAdapter } from '../../worker/src/mock-sheets';
import { MemoryOperations } from '../../worker/src/config-store';
import { today } from '../../shared/logic';
import type { Env } from '../../worker/src/env';

const env: Env = { GOOGLE_SERVICE_ACCOUNT_JSON:'fixture', TZ:'Asia/Almaty', CURRENCY:'₸', DUPLICATE_WINDOW_MIN:'3', SHEET_NAME_EXPENSES:'Ввод данных', SHEET_NAME_DICT:'Справочник', SHEET_NAME_INCOME:'Доходы и расходы' };
class CountingSheets extends MockSheetsAdapter {
  calls = 0;
  overloaded = false;
  rejectWrites = false;
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== 'sheets.googleapis.com') throw Error('Unexpected transport');
    this.calls++;
    if (this.overloaded || (this.rejectWrites && init?.method === 'POST')) return new Response(null, {status:429, headers:{'Retry-After':'45'}});
    if (url.pathname.endsWith('/values:batchGet')) {
      const snapshot = await this.read(), articles = await this.readLegacyItems();
      const values = (r: string) => {
        if (r.endsWith('!A:H')) return snapshot.rows;
        if (r.endsWith('!A1:H1')) return [snapshot.rows[0]];
        if (r.endsWith('!A3:B')) return snapshot.categories.map(c => [c.name,c.limit]);
        if (r.endsWith('!F3:K')) return articles.fixed;
        if (r.endsWith('!A3:D')) return articles.income;
        if (r.endsWith('!M3:S')) return [];
        throw Error('Unexpected range');
      };
      return Response.json({valueRanges:url.searchParams.getAll('ranges').map(r=>({values:values(r)}))});
    }
    if (url.pathname.endsWith('/values:batchUpdate')) {
      for (const range of JSON.parse(String(init?.body)).data) {
        const m = /!([AG])(\d+):[EH]\d+$/.exec(range.range);
        if (!m) throw Error('Unexpected write range');
        const row = this.rows[Number(m[2])-1];
        range.values[0].forEach((value: string|number,i: number) => {row[(m[1]==='A'?0:6)+i]=value;});
      }
      return Response.json({});
    }
    return Response.json({sheets:[env.SHEET_NAME_EXPENSES,env.SHEET_NAME_DICT,env.SHEET_NAME_INCOME].map((title,sheetId)=>({properties:{title,sheetId,gridProperties:{rowCount:1006}}}))});
  };
}
function fixture() {
  const google = new CountingSheets();
  vi.spyOn(GoogleAuth.prototype,'token').mockResolvedValue('fixture');
  vi.stubGlobal('fetch',google.fetch);
  const actor = new SheetCoordinator({storage:new MemoryOperations()},env);
  const call = (path: string, body?: unknown) => actor.fetch(new Request('https://local.test/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-FT-Account':'sample','X-FT-Sheet':'fixture-sheet'},body:body?JSON.stringify(body):undefined}));
  const create = () => call('expenses',{id:Date.now()+'-'+crypto.randomUUID(),date:today(env.TZ),amount:9,category:'🍔 Продукты и супермаркеты',source:'manual'});
  return { google, call, create };
}
afterEach(()=>{ vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('measures Sheets calls at the transport boundary',async()=>{
  const {google,call,create}=fixture();
  const responses = await Promise.all(Array.from({length:5}, () => call('bootstrap')));
  expect(responses.every(r => r.status === 200)).toBe(true); const cold=google.calls;
  expect((await call('bootstrap')).status).toBe(200); const warm=google.calls-cold;
  const before=google.calls;
  for(let i=0;i<10;i++) expect((await create()).status).toBe(201);
  const writes=google.calls-before;
  console.log({cold,warm,tenCreates:writes});
  expect({cold,warm,writes}).toEqual({cold:2,warm:0,writes:20});
  const refreshed = await (await call('bootstrap')).json();
  expect(refreshed.history).toHaveLength(70);
  expect(google.calls - before - writes).toBe(1);
  const [name, comment] = [google.rows[0][1], google.rows[0][4]];
  google.rows[0][1] = comment; google.rows[0][4] = name;
  const rejected = await create();
  expect(rejected.status).toBe(409);
  expect(await rejected.json()).toMatchObject({error:'schema_mismatch'});
});
it('measures repeated 429 responses', async()=>{
  const {google,call}=fixture();google.overloaded=true;
  for(let i=0;i<60;i++) {
    const result = await call('bootstrap');
    expect(result.status).toBe(503);
    expect(Number(result.headers.get('Retry-After'))).toBeGreaterThanOrEqual(44);
  }
  expect(google.calls).toBe(1);
});
it('passes write Retry-After to the client without replaying the mutation', async () => {
  const {google,call,create} = fixture();
  await call('bootstrap');
  const before = google.calls;
  google.rejectWrites = true;
  const limited = await create();
  expect(limited.status).toBe(503);
  expect(limited.headers.get('Retry-After')).toBe('45');
  expect(await limited.json()).toMatchObject({error:'sheets_quota'});
  expect(google.calls - before).toBe(2);
  await create();
  expect(google.calls - before).toBe(2);
});

it('shares a rolling budget between tables and preserves cooldown over actor restarts', async () => {
  let now = 1000000;
  const storage = new MemoryOperations(), governor = new SheetsQuota(storage, () => now);
  const burst = (table: string, n: number) => Promise.all(Array.from({length:n}, () => governor.reserve(table)));
  expect((await burst('a', 40)).filter(s => !s)).toHaveLength(30);
  expect((await burst('b', 40)).filter(s => !s)).toHaveLength(18);
  now += 60000;
  expect(await governor.reserve('b')).toBe(0);
  expect(await governor.reserve('a', 90)).toBe(90);
  now += 30000;
  const restarted = new SheetsQuota(storage, () => now);
  expect(await restarted.reserve('b')).toBe(60);
  now += 60000;
  expect(await restarted.reserve('a')).toBe(0);
  expect(await restarted.reserve('a', 0)).toBeGreaterThanOrEqual(40);
});

it('limits concurrent account coordinators through one internal governor and isolates their snapshots', async () => {
  const a = new CountingSheets(), b = new CountingSheets();
  b.rows[1][1] = 'Only B';
  vi.spyOn(GoogleAuth.prototype,'token').mockResolvedValue('fixture');
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => (input.includes('/tableA') ? a : b).fetch(input, init));
  const governor = new SheetCoordinator({storage:new MemoryOperations()},env);
  const ns = { idFromName: (name: string) => name, get: () => governor };
  const make = (name: string) => {
    const actor = new SheetCoordinator({storage:new MemoryOperations()},{ ...env, COORDINATOR:ns });
    return () => actor.fetch(new Request('https://local.test/api/bootstrap',{headers:{'X-FT-Account':name,'X-FT-Sheet':'table'+name}}));
  };
  const one = make('A'), two = make('B');
  const [left,right] = await Promise.all([one(),two()]);
  expect((await left.json()).history[0].name).not.toBe('Only B');
  expect((await right.json()).history[0].name).toBe('Only B');
  expect([a.calls,b.calls]).toEqual([2,2]);
  a.overloaded = true;
  const restartedA = make('A'), restartedB = make('B');
  expect((await restartedA()).status).toBe(503);
  expect((await restartedB()).headers.get('Retry-After')).toBeTruthy();
  expect(b.calls).toBe(2);
});

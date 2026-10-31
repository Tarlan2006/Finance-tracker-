import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const base = 'https://finance-tracker.tarlan-b06.workers.dev';
const markerPath = '.wrangler/audit-live-smoke.json';
if (process.env.SMOKE_WRITE !== '1') throw new Error('Live smoke requires SMOKE_WRITE=1');
// A persisted marker makes an accidental second invocation fail before any write.
await mkdir('.wrangler', { recursive: true });
const oldMarker = await readFile(markerPath, 'utf8').catch(() => '');
if (oldMarker) throw new Error('Smoke already attempted. Inspect the local marker; do not create another row.');
const vars = parseEnv(await readFile('.dev.vars', 'utf8'));
await build({ entryPoints: ['worker/src/google-auth.ts'], outfile: '.wrangler/audit-auth.mjs', bundle: true, platform: 'neutral', format: 'esm' });
await build({ entryPoints: ['shared/logic.ts'], outfile: '.wrangler/audit-logic.mjs', bundle: true, platform: 'neutral', format: 'esm' });
const { GoogleAuth } = await import('../.wrangler/audit-auth.mjs');
const { firstEmptyRow, today } = await import('../.wrangler/audit-logic.mjs');
const auth = new GoogleAuth(vars.GOOGLE_SERVICE_ACCOUNT_JSON);
const sheetBase = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(vars.SHEET_ID)}`;
async function google(path) { const r = await fetch(`${sheetBase}${path}`, { headers: { Authorization: `Bearer ${await auth.token()}` }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`Google read HTTP ${r.status}`); return r.json(); }
async function rows() { const q = new URLSearchParams({ ranges: "'Ввод данных'!A1:H1006", valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }); return (await google(`/values:batchGet?${q}`)).valueRanges[0].values; }
async function formulas() { const q = new URLSearchParams({ ranges: "'Ввод данных'!F1:F1006", includeGridData: 'true', fields: 'sheets(data(rowData(values(userEnteredValue))))' }); const grid = (await google(`?${q}`)).sheets[0].data[0].rowData; return Array.from({ length: 1006 }, (_, i) => grid?.[i]?.values?.[0]?.userEnteredValue ?? null); }
if (!vars.VERIFY_LOGIN || !vars.VERIFY_PASSWORD) throw new Error('Set VERIFY_LOGIN and VERIFY_PASSWORD for the intended sheet');
const login = await fetch(new URL('/api/login', base), { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: vars.VERIFY_LOGIN, password: vars.VERIFY_PASSWORD }), signal: AbortSignal.timeout(20000) });
if (!login.ok) throw new Error('Smoke login failed: HTTP ' + login.status);
const session = await login.json();
const headers = { 'X-App-Key': session.token, 'X-FT-Expected-Sheet': vars.SHEET_ID, 'X-FT-Sheet-Version': String(session.account.sheetVersion || 1), 'Content-Type': 'application/json' };
try {
  if (!Number.isSafeInteger(session.account.sheetVersion)) throw new Error('Worker must support versioned sheet bindings before smoke writes');
  await runSmoke();
} finally {
  const response = await fetch(new URL('/api/logout', base), { method: 'POST', redirect: 'error', headers: { 'X-App-Key': session.token }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) { console.error('Smoke logout failed: HTTP ' + response.status); process.exitCode = 1; }
}
async function readApi(path) { for (let i = 0; i < 5; i++) { const r = await fetch(new URL(path, base), { headers, redirect: 'error', signal: AbortSignal.timeout(20000) }); if (r.ok && r.headers.get('content-type')?.includes('application/json')) return r.json(); await r.body?.cancel(); if (i === 4) throw new Error(`Read verification HTTP ${r.status}`); await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); } }
async function runSmoke() {
  const normalize = rows => Array.from({ length: 1006 }, (_, i) => [0, 1, 2, 3, 4, 6, 7].map(j => rows[i]?.[j] ?? ''));
  const before = await rows(), fBefore = await formulas(), bootstrap = await readApi('/api/bootstrap');
  assert.equal(bootstrap.mock, false); assert.equal(before[0][6], 'ID'); assert.equal(before[0][7], 'Источник');
  const expectedRow = firstEmptyRow(before); assert.ok(expectedRow <= 1006); assert.ok(!before[expectedRow - 1]?.[4] && !before[expectedRow - 1]?.[6] && !before[expectedRow - 1]?.[7]);
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const record = { id, date: today('Asia/Almaty'), amount: 1, name: 'audit smoke-test', category: bootstrap.categories[0].name, comment: 'Temporary audit verification', source: 'smoke-test' };
  const result = { id, expectedRow, postAttempts: 0, verified: false, cleaned: false, formulaUnchanged: false, otherRowsUnchanged: false };
  await writeFile(markerPath, JSON.stringify(result, null, 2), { flag: 'wx' });
  let failure;
  try {
    result.postAttempts = 1; await writeFile(markerPath, JSON.stringify(result, null, 2));
    // Exactly ONE creation request. A lost response is recovered by reading this ID.
    try { const response = await fetch(`${base}/api/expenses`, { method: 'POST', headers, redirect: 'error', body: JSON.stringify(record), signal: AbortSignal.timeout(30000) }); result.postStatus = response.status; await response.body?.cancel(); } catch { result.postStatus = 'response-lost'; }
    const b = await readApi('/api/bootstrap'); const matches = b.history.filter(e => e.id === id); assert.equal(matches.length, 1, 'Exactly one smoke ID must exist'); const e = matches[0]; assert.equal(e.source, 'smoke-test'); assert.equal(e.row, expectedRow);
    const during = await rows(); assert.equal(during[e.row - 1][6], id); assert.equal(during[e.row - 1][7], 'smoke-test'); assert.deepEqual(await formulas(), fBefore);
    const other = normalize(during); other[e.row - 1] = normalize(before)[e.row - 1]; assert.deepEqual(other, normalize(before)); result.verified = true;
  } catch (error) { failure = error instanceof assert.AssertionError ? 'Safety assertion failed; see local marker and investigate' : error.message; }
  finally {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const b = await readApi('/api/bootstrap'); const matches = b.history.filter(e => e.id === id);
        if (!matches.length) { result.cleaned = true; break; }
        assert.equal(matches.length, 1); const e = matches[0]; assert.equal(e.source, 'smoke-test'); assert.equal(e.name, record.name);
        const response = await fetch(`${base}/api/expenses/${e.row}?fp=${encodeURIComponent(e.fp)}`, { method: 'DELETE', headers, redirect: 'error', signal: AbortSignal.timeout(30000) }); await response.body?.cancel();
      }
      const afterBootstrap = await readApi('/api/bootstrap'); result.cleaned = !afterBootstrap.history.some(e => e.id === id);
      assert.deepEqual(await formulas(), fBefore); result.formulaUnchanged = true;
      assert.deepEqual(normalize(await rows()), normalize(before)); result.otherRowsUnchanged = true;
      assert.equal(result.cleaned, true);
    } catch { failure = 'Cleanup or final verification failed. Do not create another test row; recover only marker ID.'; }
    if (failure) result.failure = failure;
    await writeFile(markerPath, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  }
  if (failure) process.exitCode = 1;
}

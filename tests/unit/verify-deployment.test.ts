import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const script = pathToFileURL(resolve('scripts/verify-deployment.mjs')).href;
const origin = 'https://finance-tracker.tarlan-b06.workers.dev';
const history = [{ date: '2026-10-15', amount: 12.34 }];
const correct = [{ month: '2026-10', journal: 12.34 }];
it.each([
  { publicOnly: true, summaries: [], count: 0, status: 0, message: '' },
  { summaries: [], count: 1, status: 1, message: 'нужны расходы и месячные сводки' },
  { summaries: [{ month: '2026-10', journal: 12.33 }], count: 1, status: 1, message: 'Суммы журнала не совпали' },
  { summaries: [...correct, ...correct], count: 1, status: 1, message: 'Наборы месяцев' },
  { summaries: correct, count: 2, status: 1, message: 'Количество расходов' },
  { summaries: correct, count: 1, status: 0, message: '' },
])('checks mock deployment responses %#', ({summaries, count, status, message, publicOnly = false}) => {
  const fixture = { history, summaries, categories: [], mock: false };
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', [
    'process.argv[2] = ' + JSON.stringify(origin),
    publicOnly ? "process.argv.push('--public-only')" : '',
    'const bootstrap = ' + JSON.stringify(fixture),
    `globalThis.fetch = async (url, options = {}) => {
      if (process.argv.includes('--public-only') && (options.method || 'GET') !== 'GET') throw Error('Public verifier attempted a mutation');
      const path = new URL(url).pathname;
      const headers = {'Content-Security-Policy': "frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store'};
      const bodies = {'/api/health': {ok:true}, '/api/accounts': [], '/': {}, '/api/login': {account:{},token:'fixture'}, '/api/bootstrap': bootstrap, '/api/config': {}, '/api/logout': {}};
      if (!(path in bodies)) throw Error('Unexpected request');
      return Response.json(bodies[path], {headers, status: path === '/api/bootstrap' && !options.headers?.['X-App-Key'] ? 401 : 200});
    }`,
    'await import(' + JSON.stringify(script) + ')'
  ].join(';')], { encoding: 'utf8', cwd: tmpdir(), env: { SystemRoot: process.env.SystemRoot, VERIFY_LOGIN: 'fixture', VERIFY_PASSWORD: 'fixture', VERIFY_EXPECTED_EXPENSES: String(count) } });
  expect(run.status).toBe(status);
  if (status) {
    expect(run.stderr).toContain(message);
    expect(run.stdout).not.toContain('"summariesMatch": true');
  } else if (publicOnly) expect(JSON.parse(run.stdout)).toMatchObject({ liveRead: false, sheetsWrites: 0 });
  else expect(JSON.parse(run.stdout)).toMatchObject({ summariesMatch: true, sheetsWrites: 0, expenseCount: 1 });
});

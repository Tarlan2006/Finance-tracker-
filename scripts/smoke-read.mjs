import { readFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { build } from 'esbuild';
// Read-only by construction. Never logs credentials or individual expenses.
try {
  const secrets = parseEnv(await readFile('.dev.vars', 'utf8'));
  const account = JSON.parse(secrets.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
  if (!account.private_key || !account.client_email || !secrets.SHEET_ID || !secrets.APP_KEY) throw new Error('Не заполнены реальные секреты .dev.vars');
  await mkdir('.wrangler', { recursive: true });
  await build({ entryPoints: ['worker/src/google-sheets.ts'], outfile: '.wrangler/read-adapter.mjs', bundle: true, platform: 'neutral', format: 'esm', target: 'es2022' });
  const { GoogleSheetsAdapter } = await import('../.wrangler/read-adapter.mjs');
  const env = { SHEET_NAME_EXPENSES: 'Ввод данных', SHEET_NAME_DICT: 'Справочник', SHEET_NAME_INCOME: 'Доходы и расходы', TZ: 'Asia/Almaty', CURRENCY: '₸', DUPLICATE_WINDOW_MIN: '3', ...secrets };
  const snapshot = await new GoogleSheetsAdapter(env).read();
  if (snapshot.rows[0]?.[6] !== 'ID' || snapshot.rows[0]?.[7] !== 'Источник') throw new Error('Ожидаются заголовки G1=ID, H1=Источник');
  const rows = snapshot.rows.slice(1).filter(r => r[0] !== '' && r[0] != null && typeof r[3] === 'number');
  const totals = {};
  for (const r of rows) { const date = typeof r[0] === 'number' ? new Date(Date.UTC(1899, 11, 30) + Math.floor(r[0]) * 86400000).toISOString().slice(0, 10) : String(r[0]); const month = date.slice(0, 7); totals[month] = Math.round(((totals[month] || 0) + r[3]) * 100) / 100; }
  const comparisons = snapshot.summaries.map(s => ({ month: s.month, journalMatchesSummary: Math.abs((totals[s.month] || 0) - s.journal) < .01 }));
  console.log(JSON.stringify({ readOnly: true, expenseCount: rows.length, categoryCount: snapshot.categories.length, summaryMonths: snapshot.summaries.map(s => s.month), comparisons, writes: 0 }, null, 2));
} catch (error) { console.error('Read-only smoke failed:', error instanceof Error && !/private_key|BEGIN|token|Bearer/.test(error.message) ? error.message : 'Ошибка конфигурации или сети; значения секретов скрыты'); process.exitCode = 1; }

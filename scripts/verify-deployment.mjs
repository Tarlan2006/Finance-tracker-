import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
const base = process.argv[2];
if (!base || !/^https:\/\/finance-tracker\.[a-z0-9-]+\.workers\.dev\/?$/.test(base)) throw new Error('Передайте HTTPS URL finance-tracker на workers.dev');
try {
  const vars = parseEnv(await readFile('.dev.vars', 'utf8'));
  const headers = { 'X-App-Key': vars.APP_KEY };
  const health = await fetch(new URL('/api/health', base), { headers });
  if (!health.ok || !(await health.json()).ok) throw new Error('health не прошёл');
  const response = await fetch(new URL('/api/bootstrap', base), { headers });
  if (!response.ok) throw new Error(`bootstrap HTTP ${response.status}`);
  const b = await response.json();
  if (b.mock) throw new Error('Опубликованный Worker работает в mock');
  const totals = b.history.reduce((out, e) => { const month = e.date.slice(0, 7); out[month] = (out[month] || 0) + e.amount; return out; }, {});
  const match = b.summaries.every(s => Math.abs((totals[s.month] || 0) - s.journal) < .01);
  if (!match) throw new Error('Суммы журнала не совпали со сводкой');
  const unauthenticated = await fetch(new URL('/api/health', base));
  if (unauthenticated.status !== 401) throw new Error('API допускает запрос без ключа');
  console.log(JSON.stringify({ url: base, health: true, liveRead: true, mock: false, expenseCount: b.history.length, categories: b.categories.length, summariesMatch: match, unauthorizedStatus: unauthenticated.status, writes: 0 }, null, 2));
} catch (error) { console.error('Deployment verification failed:', error.message); process.exitCode = 1; }

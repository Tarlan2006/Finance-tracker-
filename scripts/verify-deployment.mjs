import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
const base = process.argv[2];
if (!base || !/^https:\/\/finance-tracker\.[a-z0-9-]+\.workers\.dev\/?$/.test(base)) throw new Error('Передайте HTTPS URL finance-tracker на workers.dev');
let platformRetries = 0;
async function read(path, headers = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(new URL(path, base), { headers, signal: AbortSignal.timeout(20000) });
    const platform404 = response.status === 404 && response.headers.get('content-type')?.includes('text/html');
    if ((!platform404 && response.status < 500) || attempt === 4) return response;
    platformRetries++;
    console.warn(`Cloudflare HTTP ${response.status}: повтор проверки ${attempt + 1}/4`);
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempt));
  }
}
try {
  const vars = parseEnv(await readFile('.dev.vars', 'utf8'));
  const headers = { 'X-App-Key': vars.APP_KEY };
  const health = await read('/api/health', headers);
  if (!health.ok || !(await health.json()).ok) throw new Error(`health не прошёл, HTTP ${health.status}`);
  const started = performance.now();
  const response = await read('/api/bootstrap', headers);
  const bootstrapMs = [Math.round(performance.now() - started)];
  if (!response.ok) throw new Error(`bootstrap HTTP ${response.status}`);
  const b = await response.json();
  if (b.mock) throw new Error('Опубликованный Worker работает в mock');
  const configResponse = await read('/api/config', headers);
  if (!configResponse.ok) throw new Error(`config HTTP ${configResponse.status}`);
  const config = await configResponse.json();
  if (typeof config.configured !== 'boolean' || !Array.isArray(config.categories) || !Array.isArray(config.items)) throw new Error('Настройки вернули неполные данные');
  const totals = b.history.reduce((out, e) => { const month = e.date.slice(0, 7); out[month] = (out[month] || 0) + e.amount; return out; }, {});
  const match = b.summaries.every(s => Math.abs((totals[s.month] || 0) - s.journal) < .01);
  if (!match) throw new Error('Суммы журнала не совпали со сводкой');
  const unauthenticated = await read('/api/health');
  if (unauthenticated.status !== 401) throw new Error(`Без ключа ожидался HTTP 401, получен ${unauthenticated.status}`);
  const shell = await read('/');
  for (const r of [response, shell]) if (!r.headers.get('Content-Security-Policy')?.includes("frame-ancestors 'none'") || r.headers.get('X-Content-Type-Options') !== 'nosniff' || r.headers.get('Referrer-Policy') !== 'no-referrer') throw new Error('Security headers missing');
  if (response.headers.get('Cache-Control') !== 'no-store') throw new Error('API cache policy missing');
  for (let i = 0; i < 2; i++) { const start = performance.now(); const warm = await read('/api/bootstrap', headers); if (!warm.ok) throw new Error('Warm read failed'); await warm.json(); bootstrapMs.push(Math.round(performance.now() - start)); }
  console.log(JSON.stringify({ url: base, health: true, liveRead: true, mock: false, expenseCount: b.history.length, categories: b.categories.length, settingsConfigured: config.configured, compatibilityMode: !config.configured, summariesMatch: match, unauthorizedStatus: unauthenticated.status, securityHeaders: true, bootstrapMs, platformRetries, writes: 0 }, null, 2));
} catch (error) { console.error('Deployment verification failed:', error.message); process.exitCode = 1; }

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
let sessionToken = '';
try {
  const vars = { ...parseEnv(await readFile('.dev.vars', 'utf8').catch(() => '')), ...process.env };
  const health = await read('/api/health');
  if (!health.ok || !(await health.json()).ok) throw new Error('health не прошёл');
  const unauthorized = await read('/api/bootstrap');
  if (unauthorized.status !== 401) throw new Error('Без сессии ожидался HTTP 401');
  const accountsResponse = await read('/api/accounts'), accounts = await accountsResponse.json();
  if (!accountsResponse.ok || !Array.isArray(accounts) || accounts.some(a => Object.keys(a).sort().join(',') !== 'displayName,login')) throw new Error('Публичный список аккаунтов некорректен');
  const shell = await read('/');
  for (const r of [health, unauthorized, accountsResponse, shell]) if (!r.headers.get('Content-Security-Policy')?.includes("frame-ancestors 'none'") || r.headers.get('X-Content-Type-Options') !== 'nosniff' || r.headers.get('Referrer-Policy') !== 'no-referrer') throw new Error('Security headers missing');
  for (const r of [health, unauthorized, accountsResponse]) if (r.headers.get('Cache-Control') !== 'no-store') throw new Error('API cache policy missing');
  const result = { url: base, health: true, unauthorizedStatus: 401, securityHeaders: true, accounts: accounts.map(a => a.login), liveRead: false, sheetsWrites: 0, adminCalls: 0 };
  if (!vars.VERIFY_LOGIN || !vars.VERIFY_PASSWORD) { console.log(JSON.stringify({ ...result, skipped: 'VERIFY_LOGIN/VERIFY_PASSWORD не заданы: чтение данных пропущено', platformRetries }, null, 2)); }
  else {
    const login = await fetch(new URL('/api/login', base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: vars.VERIFY_LOGIN, password: vars.VERIFY_PASSWORD }), signal: AbortSignal.timeout(20000) });
    if (!login.ok) throw new Error('Не удалось войти проверочным аккаунтом, HTTP ' + login.status);
    const auth = await login.json(); sessionToken = auth.token;
    if (auth.account.mustChangePassword) throw new Error('Проверочному аккаунту требуется смена пароля человеком');
    const headers = { 'X-App-Key': sessionToken }, started = performance.now();
    const response = await read('/api/bootstrap', headers), bootstrapMs = [Math.round(performance.now() - started)];
    if (!response.ok) throw new Error('bootstrap HTTP ' + response.status);
    const b = await response.json(); if (b.mock) throw new Error('Опубликованный Worker работает в mock');
    const configResponse = await read('/api/config', headers); if (!configResponse.ok) throw new Error('config HTTP ' + configResponse.status);
    const config = await configResponse.json();
    const totals = b.history.reduce((out, e) => { const month = e.date.slice(0, 7); out[month] = (out[month] || 0) + e.amount; return out; }, {});
    const match = b.summaries.every(s => Math.abs((totals[s.month] || 0) - s.journal) < .01); if (!match) throw new Error('Суммы журнала не совпали со сводкой');
    for (let i = 0; i < 2; i++) { const start = performance.now(); const warm = await read('/api/bootstrap', headers); if (!warm.ok) throw new Error('Warm read failed'); await warm.json(); bootstrapMs.push(Math.round(performance.now() - start)); }
    console.log(JSON.stringify({ ...result, liveRead: true, expenseCount: b.history.length, categories: b.categories.length, settingsConfigured: config.configured, summariesMatch: match, bootstrapMs, platformRetries }, null, 2));
  }
} catch (error) { console.error('Deployment verification failed:', error.message); process.exitCode = 1; }
finally { if (sessionToken) { try { const r = await fetch(new URL('/api/logout', base), { method: 'POST', headers: { 'X-App-Key': sessionToken }, signal: AbortSignal.timeout(20000) }); if (!r.ok) { console.error('Проверочная сессия не отозвана, HTTP ' + r.status); process.exitCode = 1; } } catch { console.error('Не удалось завершить проверочную сессию. Отзовите её в аккаунте.'); process.exitCode = 1; } } }

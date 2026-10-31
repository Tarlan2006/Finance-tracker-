import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const vars = parseEnv(await readFile('.dev.vars', 'utf8').catch(() => ''));
const sensitive = [vars.APP_KEY, vars.ADMIN_TOKEN, vars.VERIFY_PASSWORD, vars.SHEET_ID, vars.GOOGLE_SERVICE_ACCOUNT_JSON].filter(v => v && v.length > 7);
if (vars.GOOGLE_SERVICE_ACCOUNT_JSON) { try { const account = JSON.parse(vars.GOOGLE_SERVICE_ACCOUNT_JSON); sensitive.push(account.private_key, account.client_email); } catch { /* Invalid secret is handled by live smoke. */ } }
const failures = [];
for (const path of tracked) { const content = await readFile(path, 'utf8').catch(() => ''); if (path === '.dev.vars' || sensitive.some(value => value && content.includes(value))) failures.push(path); }
if (failures.length) { console.error('Secret scan FAILED:', failures.join(', ')); process.exitCode = 1; }
else console.log(`Secret scan passed: ${tracked.length} tracked files, no configured secret values found.`);

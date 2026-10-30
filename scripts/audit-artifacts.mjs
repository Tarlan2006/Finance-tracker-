import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { inflateRawSync } from 'node:zlib';
const vars = parseEnv(await readFile('.dev.vars', 'utf8').catch(() => ''));
const values = [vars.APP_KEY, vars.SHEET_ID, vars.GOOGLE_SERVICE_ACCOUNT_JSON].filter(Boolean);
try { const account = JSON.parse(vars.GOOGLE_SERVICE_ACCOUNT_JSON || '{}'); values.push(account.client_email, account.private_key, ...(account.private_key || '').split('\n').filter(line => /^[A-Za-z0-9+/=]{40,}$/.test(line))); } catch { /* No secret contents in diagnostics. */ }
const needles = values.filter(v => v && v.length >= 8).map(v => Buffer.from(v));
let scanned = 0, failures = 0, zipEntries = 0;
function inspect(buffer) { scanned++; if (needles.some(n => buffer.includes(n))) failures++; }
const objects = execFileSync('git', ['rev-list', '--objects', '--all'], { encoding: 'utf8' }).trim().split('\n').map(line => line.split(' ')[0]);
const batch = execFileSync('git', ['cat-file', '--batch'], { input: objects.join('\n') + '\n', maxBuffer: 128 * 1024 * 1024 });
let offset = 0;
while (offset < batch.length) { const end = batch.indexOf(10, offset); const [, type, sizeText] = batch.subarray(offset, end).toString().split(' '); const size = Number(sizeText); if (!Number.isFinite(size)) throw new Error('Invalid git object stream'); const content = batch.subarray(end + 1, end + 1 + size); if (type === 'blob') inspect(content); offset = end + size + 2; }
async function walk(directory) { for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) { const path = `${directory}/${entry.name}`; if (entry.isDirectory()) await walk(path); else { const content = await readFile(path); inspect(content); if (path.endsWith('.zip')) for (let i = 0; i + 46 < content.length; i++) if (content.readUInt32LE(i) === 0x02014b50) { const method = content.readUInt16LE(i + 10), size = content.readUInt32LE(i + 20), local = content.readUInt32LE(i + 42); const start = local + 30 + content.readUInt16LE(local + 26) + content.readUInt16LE(local + 28); const data = content.subarray(start, start + size); if (method === 0 || method === 8) { inspect(method === 8 ? inflateRawSync(data) : data); zipEntries++; } i += 45 + content.readUInt16LE(i + 28) + content.readUInt16LE(i + 30) + content.readUInt16LE(i + 32); } } } }
for (const directory of ['dist', 'tests/screenshots', 'playwright-report', 'test-results']) await walk(directory);
const lock = JSON.parse(await readFile('package-lock.json', 'utf8')); const licenses = {}, missing = [];
for (const [path, pkg] of Object.entries(lock.packages)) { if (!path) continue; let license = pkg.license; if (!license) { try { license = JSON.parse(await readFile(`${path}/package.json`, 'utf8')).license; } catch { /* Optional platform package not installed. */ } } if (!license) missing.push(path); else licenses[license] = (licenses[license] || 0) + 1; }
console.log(JSON.stringify({ historyObjects: objects.length, scanned, zipEntries, secretMatches: failures, licenses, missingLicenseMetadata: missing }, null, 2));
if (failures || !needles.length) process.exitCode = 1;

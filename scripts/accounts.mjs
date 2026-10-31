import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
export function parseArguments(args) {
  const [command, login, ...rest] = args;
  if (!['list', 'add', 'set-password', 'set-sheet', 'revoke', 'disable', 'enable'].includes(command)) throw new Error('Команды: list, add, set-password, set-sheet, revoke, disable, enable');
  if (command === 'list') { if (args.length !== 1) throw new Error('list не принимает аргументы'); return { command }; }
  if (!login || !/^[a-zA-Z0-9]{2,32}$/.test(login)) throw new Error('Укажите логин: 2–32 латинские буквы или цифры');
  const data = { login: login.toLowerCase() };
  if (command === 'add') { if (!rest[0] || rest.length > 2 || rest[1] && rest[1] !== '--must-change') throw new Error('add <login> <имя> [--must-change]. Пароль вводится только скрытым запросом'); data.displayName = rest[0]; data.mustChange = rest[1] === '--must-change'; }
  else if (command === 'set-password') { if (rest.length > 1 || rest[0] && rest[0] !== '--must-change') throw new Error('set-password <login> [--must-change]. Пароль не принимается аргументом'); data.mustChange = rest[0] === '--must-change'; }
  else if (command === 'set-sheet') { if (rest.length !== 1) throw new Error('set-sheet <login> <ссылка-или-id>'); const id = rest[0].startsWith('https://docs.google.com/spreadsheets/d/') ? rest[0].match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)(?:[/?#]|$)/)?.[1] : rest[0]; if (!id || !/^[\w-]{20,200}$/.test(id)) throw new Error('Некорректная ссылка или ID Google Sheets'); data.sheet = id; }
  else if (command === 'revoke' && rest.length === 2 && rest[0] === '--session') data.sessionId = rest[1];
  else if (rest.length) throw new Error('Лишние аргументы');
  return { command, data };
}
async function hidden(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('Пароль вводится только в интерактивном терминале со скрытым вводом');
  process.stdout.write(prompt); const input = process.stdin, wasRaw = input.isRaw; input.setRawMode(true); input.resume(); input.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (error) => { input.off('data', data); input.setRawMode(!!wasRaw); input.pause(); process.stdout.write('\n'); if (error) reject(error); else resolve(value); };
    const data = chunk => { for (const c of chunk) { if (c === '\u0003' || c === '\u001b') { done(new Error('Отменено')); return; } if (c === '\r' || c === '\n') { done(); return; } if (c === '\u007f' || c === '\b') value = [...value].slice(0, -1).join(''); else if (c >= ' ' && [...value].length < 129) value += c; } };
    input.on('data', data);
  });
}
export async function main(args = process.argv.slice(2)) {
  const { command, data } = parseArguments(args), vars = { ...parseEnv(await readFile('.dev.vars', 'utf8').catch(() => '')), ...process.env };
  const url = vars.WORKER_URL;
  if (!url || !/^https:\/\/finance-tracker\.[a-z0-9-]+\.workers\.dev\/?$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(url)) throw new Error('Задайте WORKER_URL существующего Worker или локального mock');
  if (!vars.ADMIN_TOKEN) throw new Error('Задайте ADMIN_TOKEN в окружении или .dev.vars');
  if (command === 'add' || command === 'set-password') { const password = await hidden('Пароль (ввод скрыт): '), repeat = await hidden('Повторите пароль: '); if (password !== repeat) throw new Error('Пароли не совпадают'); if ([...password].length < 5 || [...password].length > 128) throw new Error('Пароль: от 5 до 128 символов'); data.password = password; }
  const r = await fetch(new URL(`/api/admin/${command}`, url), { method: command === 'list' ? 'GET' : 'POST', headers: { Authorization: `Bearer ${vars.ADMIN_TOKEN}`, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(30000) });
  if (!r.headers.get('Content-Type')?.includes('application/json')) throw new Error(`Сервис недоступен (HTTP ${r.status})`);
  const result = await r.json(); if (!r.ok) throw new Error(typeof result.message === 'string' ? result.message : `Ошибка HTTP ${r.status}`);
  if (command === 'list') console.table(result.map(a => ({ login: a.login, имя: a.displayName, таблица: a.hasSheet, сменитьПароль: a.mustChangePassword, отключён: a.disabled, сессии: a.sessions, парольИзменён: new Date(a.passwordChangedAt).toISOString() })));
  else { console.log('Готово.'); if (command === 'set-sheet') console.log(result.serviceAccountEmail ? `Предоставьте доступ «Редактор»: ${result.serviceAccountEmail}` : 'Email сервисного аккаунта не настроен (mock).'); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e instanceof TypeError ? 'Нет связи с Worker. Повторите позже' : e.message); process.exitCode = 1; });

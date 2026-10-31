import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
if (!existsSync('dist/index.html')) {
  for (const args of [['node_modules/vite/bin/vite.js', 'build'], ['scripts/build-sw.mjs']]) {
    const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
// Explicit mock override: local real credentials are never used by this command.
const children = [];
function start(args) { const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, windowsHide: true }); children.push(child); child.on('exit', code => { if (code) stop(code); }); return child; }
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; children.forEach(c => c.kill()); process.exit(code); }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
start(['node_modules/wrangler/bin/wrangler.js', 'dev', '--port', '8787', '--var', 'USE_MOCK:1', '--var', 'APP_KEY:mock-local-key', '--var', 'ADMIN_TOKEN:mock-admin-only']);
start(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1']);

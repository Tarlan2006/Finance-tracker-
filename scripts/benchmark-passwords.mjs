import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { execFileSync } from 'node:child_process';
// Local runtime only; no passwords, salts, hashes or credentials are printed.
const cpu = () => [].concat(JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', '@(Get-Process workerd -ErrorAction SilentlyContinue | Select-Object Id,CPU) | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true }) || '[]'));
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: '2026-10-01', script: `export default { async fetch(request) { const n = Number(new URL(request.url).searchParams.get('n')); const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('fictional-benchmark-only'), 'PBKDF2', false, ['deriveBits']); for(let i=0;i<20;i++) await crypto.subtle.deriveBits({ name:'PBKDF2',hash:'SHA-256',salt:new Uint8Array(16),iterations:n },key,256); return new Response('ok'); } };` }));
try {
  await mf.ready;
  for (const iterations of [50000, 100000, 200000, 600000]) {
    const before = cpu(), start = performance.now(); const r = await mf.dispatchFetch(`http://localhost/?n=${iterations}`); await r.text(); const wall = performance.now() - start, after = cpu();
    const total = after.reduce((sum, p) => sum + (p.CPU - (before.find(q => q.Id === p.Id)?.CPU || 0)) * 1000, 0);
    console.log(JSON.stringify({ runtime: 'local workerd', iterations, repetitions: 20, status: r.status, wallMsPerHash: +(wall / 20).toFixed(2), processCpuMsPerHash: +(total / 20).toFixed(2) }));
  }
} finally { await mf.dispose(); }

import { build } from 'esbuild';
import { readdir, readFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function files(dir) { const entries = await readdir(dir, { withFileTypes: true }); const output = []; for (const entry of entries) { const path = `${dir}/${entry.name}`; if (entry.isDirectory()) output.push(...await files(path)); else output.push(path); } return output; }
const paths = (await files('dist')).filter(p => !p.endsWith('/sw.js') && !p.endsWith('/_headers')).sort();
const version = createHash('sha256').update((await Promise.all(paths.map(p => readFile(p)))).reduce((s, b) => s + b.toString('base64'), '')).digest('hex').slice(0, 12);
await build({ entryPoints: ['web/src/sw.ts'], outfile: 'dist/sw.js', bundle: true, minify: true, format: 'iife', target: 'es2022', define: { __PRECACHE__: JSON.stringify(paths.map(p => p.slice(4))), __VERSION__: JSON.stringify(version) } });
await copyFile('MACRODROID.md', 'dist/MACRODROID.md');
console.log(`Service worker: ${paths.length} precached assets, ${version}`);

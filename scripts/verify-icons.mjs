import { readFile } from 'node:fs/promises';
const base = process.argv[2];
if (!base || !/^https:\/\/finance-tracker\.[a-z0-9-]+\.workers\.dev\/?$/.test(base)) throw new Error('Expected the existing finance-tracker workers.dev HTTPS URL');
const root = new URL('../web/public/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
const assets = [{ src: '/manifest.webmanifest', type: 'application/manifest+json' }, ...manifest.icons, { src: '/apple-touch-icon.png', type: 'image/png', sizes: '180x180' }, { src: '/favicon-32.png', type: 'image/png', sizes: '32x32' }, { src: '/favicon.svg', type: 'image/svg+xml' }, { src: '/icons/logo.svg', type: 'image/svg+xml' }];
const results = [];
for (const asset of assets) {
  const response = await fetch(new URL(asset.src, base), { signal: AbortSignal.timeout(20000) });
  if (response.status !== 200 || !response.headers.get('content-type')?.includes(asset.type)) throw new Error(`Unexpected response: ${asset.src}, HTTP ${response.status}, ${response.headers.get('content-type')}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.equals(await readFile(new URL(asset.src.slice(1), root)))) throw new Error(`Published asset differs from verified local file: ${asset.src}`);
  let sizes;
  if (asset.type === 'image/png') { if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Invalid PNG: ${asset.src}`); sizes = `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`; if (sizes !== asset.sizes) throw new Error(`Wrong dimensions: ${asset.src}`); }
  results.push({ path: asset.src, status: response.status, type: asset.type, sizes, bytesMatch: true });
}
console.log(JSON.stringify({ url: base, method: 'GET', writes: 0, assets: results }, null, 2));

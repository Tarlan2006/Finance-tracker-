import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
const mockState = join(tmpdir(), 'ft-e2e-' + randomUUID().slice(0, 8));
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 45000,
  expect: { timeout: 10000 }, reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:8787', reducedMotion: 'reduce', viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'dark', use: { colorScheme: 'dark' } }, { name: 'light', use: { colorScheme: 'light' } }],
  webServer: { command: `node node_modules/wrangler/bin/wrangler.js dev --port 8787 --var USE_MOCK:1 --var APP_KEY:mock-local-key --var ADMIN_TOKEN:mock-admin-only --persist-to "${mockState}"`, url: 'http://127.0.0.1:8787', reuseExistingServer: false, timeout: 120000, env: { WRANGLER_SEND_METRICS: 'false' } }
});

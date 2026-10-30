import { test, expect } from '@playwright/test';
test('synthetic mobile startup and optimistic offline acknowledgement', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750, connectionType: 'cellular4g' });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => localStorage.setItem('app-key', 'mock-local-key'));
  let bootstrapRequests = 0; page.on('request', r => { if (r.url().includes('/api/bootstrap')) bootstrapRequests++; });
  const start = Date.now(); await page.goto('/'); await expect(page.getByRole('heading', { name: 'Новый расход' })).toBeVisible(); const startupMs = Date.now() - start;
  await page.evaluate(async () => navigator.serviceWorker.ready); await context.setOffline(true);
  await page.getByRole('button', { name: '1', exact: true }).click(); await page.getByRole('button', { name: '🍔 Продукты и супермаркеты', exact: true }).click();
  const click = Date.now(); await page.getByRole('button', { name: /^Сохранить ·/ }).click(); await expect(page.getByLabel('Сумма', { exact: true })).toHaveValue('0'); const acknowledgementMs = Date.now() - click;
  console.log(JSON.stringify({ synthetic4G: true, startupMs, acknowledgementMs, bootstrapRequests })); expect(acknowledgementMs).toBeLessThan(1000);
});

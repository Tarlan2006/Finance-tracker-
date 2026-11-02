import { initMockSession } from './auth';
import { navigate } from './navigation';
import { test, expect } from '@playwright/test';
test('synthetic mobile startup and optimistic offline acknowledgement', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750, connectionType: 'cellular4g' });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await initMockSession(page);
  let bootstrapRequests = 0; page.on('request', r => { if (r.url().includes('/api/bootstrap')) bootstrapRequests++; });
  const start = Date.now(); await page.goto('/'); await expect(page.getByRole('heading', { name: 'Траты' })).toBeVisible(); const startupMs = Date.now() - start; await navigate(page, 'Добавить');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await page.getByRole('button', { name: '1', exact: true }).click(); await page.getByRole('button', { name: '🍔 Продукты и супермаркеты', exact: true }).click();
  const save = page.getByRole('button', { name: /^Сохранить ·/ });
  await expect(page.getByLabel('Сумма', { exact: true })).toHaveValue('1');
  await save.evaluate(button => {
    button.addEventListener('pointerdown', event => {
      function observeFrame() {
        const amount = document.querySelector<HTMLInputElement>('#amount');
        const toast = document.querySelector('.toast');
        if (amount?.value !== '0' || toast?.textContent !== 'Сохранено в очередь') {
          requestAnimationFrame(observeFrame);
          return;
        }
        // Allow the frame containing both the cleared amount and receipt to be painted.
        requestAnimationFrame(() => performance.measure('offline-ack', { start: event.timeStamp, end: performance.now() }));
      }
      requestAnimationFrame(observeFrame);
    }, { once: true });
  });
  const automationStart = Date.now();
  await save.click();
  await expect(page.getByLabel('Сумма', { exact: true })).toHaveValue('0');
  const automationMs = Date.now() - automationStart;
  const measure = await page.waitForFunction(() => performance.getEntriesByName('offline-ack', 'measure')[0]?.duration);
  const acknowledgementMs = await measure.jsonValue();
  console.log(JSON.stringify({ synthetic4G: true, startupMs, acknowledgementMs, automationMs, bootstrapRequests }));
  expect(acknowledgementMs).toBeLessThan(1000);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  expect(await reopened.evaluate(() => navigator.onLine)).toBe(false);
  await navigate(reopened, 'Траты');
  const queued = reopened.locator('.queue-card');
  await expect(queued).toHaveCount(1);
  await expect(queued.locator('strong')).toContainText(' · 1 ₸');
  await expect(queued).toContainText('В очереди · отправится при появлении сети');
});

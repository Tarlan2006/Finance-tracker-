import { test, expect } from '@playwright/test';
const key = 'mock-local-key';
test('audit2: denied localStorage renders login instead of a blank page', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Denied', 'SecurityError'); } }); });
  await page.goto('/'); await expect(page.getByLabel('Код доступа', { exact: true })).toBeVisible();
});
test('audit2: another context drains queue and journal still refreshes', async ({ page, request }) => {
  await page.goto('/'); await page.getByLabel('Код доступа', { exact: true }).fill(key); await page.getByRole('button', { name: 'Войти →' }).click();
  await page.route('**/api/expenses', r => r.abort());
  await page.getByLabel('Название', { exact: false }).first().fill('audit2 other context'); await page.getByRole('button', { name: '1', exact: true }).click(); await page.getByRole('button', { name: '🍔 Продукты и супермаркеты', exact: true }).click(); await page.getByRole('button', { name: /^Сохранить ·/ }).click();
  await page.getByRole('button', { name: '≡ Траты', exact: true }).click(); await expect(page.getByText('В очереди · отправится при появлении сети')).toBeVisible();
  const expense = await page.evaluate(async () => { const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('tenge-finance-v1'); r.onsuccess = () => resolve(r.result); }); const rows = await new Promise<{ expense: Record<string, unknown> }[]>(resolve => { const r = db.transaction('queue').objectStore('queue').getAll(); r.onsuccess = () => resolve(r.result); }); db.close(); return rows[0].expense; });
  const response = await request.post('/api/expenses', { headers: { 'X-App-Key': key }, data: expense }); const { expense: saved } = await response.json();
  try {
    await page.evaluate(async id => { const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('tenge-finance-v1'); r.onsuccess = () => resolve(r.result); }); await new Promise<void>(resolve => { const tx = db.transaction('queue', 'readwrite'); tx.objectStore('queue').delete(id as string); tx.oncomplete = () => resolve(); }); db.close(); navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'queue-updated' } })); }, expense.id);
    await expect(page.locator('.expense-main').filter({ hasText: 'audit2 other context' })).toBeVisible();
  } finally { await request.delete(`/api/expenses/${saved.row}`, { headers: { 'X-App-Key': key }, data: { fp: saved.fp } }); }
});

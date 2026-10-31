import { expect, test } from '@playwright/test';
import { initMockSession } from './auth';

test('marks totals incomplete and identifies the row with an invalid amount', async ({ page }) => {
  await initMockSession(page);
  await page.route('**/api/bootstrap', async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, invalidAmountRows: [2] } });
  });
  await page.goto('/');
  await expect(page.getByText('Итоги неполные. Проверьте сумму в строках журнала: 2.')).toBeVisible();
});

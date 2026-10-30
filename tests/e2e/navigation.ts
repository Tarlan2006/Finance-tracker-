import { expect, type Page } from '@playwright/test';
export async function navigate(page: Page, destination: string) {
  await expect(page.locator('.add-screen')).toBeAttached();
  if (destination === 'Добавить') {
    if (!await page.getByRole('button', { name: 'Закрыть добавление' }).isVisible()) await page.getByRole('button', { name: 'Добавить расход', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Новый расход' })).toBeVisible();
    return;
  }
  if (await page.getByRole('button', { name: 'Закрыть добавление' }).isVisible()) await page.getByRole('button', { name: 'Закрыть добавление' }).click();
  await page.getByRole('navigation').getByRole('button', { name: destination, exact: true }).click();
}

import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Bootstrap } from '../../shared/types';
import { today } from '../../shared/dates';
import { initMockSession, mockToken } from './auth';

test('select filtered expenses, edit shared fields, cancel or confirm a batch delete', async ({ page, request }, info) => {
  const headers = { 'X-App-Key': await mockToken(request) };
  const bootstrap = async (): Promise<Bootstrap> => (await request.get('/api/bootstrap', { headers })).json();
  const base = await bootstrap();
  expect(base.mock).toBe(true);
  const prefix = 'Выбор-' + randomUUID().slice(0, 8);
  const ids: string[] = [];
  try {
    for (const amount of [101, 202]) {
      const id = Date.now() + '-' + randomUUID();
      ids.push(id);
      const response = await request.post('/api/expenses', { headers, data: {
        id, date: today(base.tz), name: prefix + '-' + amount, category: base.categories[0].name, amount, source: 'manual', comment: 'Прежний',
      } });
      expect(response.status()).toBe(201);
    }
    await initMockSession(page); await page.goto('/');
    const search = page.getByRole('textbox', { name: 'Поиск трат' });
    await search.fill(prefix);
    await page.getByRole('button', { name: 'Выбрать', exact: true }).click();
    await page.locator('.expense-main').first().click();
    await expect(page.getByText('Выбрано: 1', { exact: false })).toBeVisible();
    await search.fill(prefix + '-101');
    await expect(page.getByRole('button', { name: 'Выбрать', exact: true })).toBeVisible();
    await search.fill(prefix);
    await page.getByRole('button', { name: 'Выбрать', exact: true }).click();
    await page.getByRole('button', { name: 'Выбрать все найденные (2)' }).click();
    await expect(page.getByText('Выбрано: 2 · 303 ₸')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `tests/screenshots/bulk/selection-${info.project.name}.png` });
    await page.getByRole('button', { name: 'Изменить выбранные' }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Применить к выбранным (2)' })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Комментарий' }).check();
    await dialog.getByLabel('Комментарий для выбранных трат').fill('Общий комментарий');
    await dialog.getByRole('checkbox', { name: 'Категория' }).check();
    await dialog.getByLabel('Новая категория').selectOption(base.categories[1].name);
    await dialog.getByRole('button', { name: 'Предпросмотр изменений' }).click();
    await expect(dialog.getByRole('status')).toContainText('Проверено трат: 2');
    expect((await bootstrap()).history.filter(e => ids.includes(e.id)).every(e => e.comment === 'Прежний')).toBe(true);
    await page.screenshot({ path: `tests/screenshots/bulk/preview-${info.project.name}.png` });
    await dialog.getByRole('button', { name: 'Применить к выбранным (2)' }).click();
    await expect(dialog).toHaveCount(0);
    const changed = (await bootstrap()).history.filter(e => ids.includes(e.id));
    expect(changed.map(e => e.amount)).toEqual([101, 202]);
    expect(changed.every(e => e.category === base.categories[1].name && e.comment === 'Общий комментарий')).toBe(true);
    await page.getByRole('button', { name: 'Выбрать', exact: true }).click();
    await page.getByRole('button', { name: 'Выбрать все найденные (2)' }).click();
    await page.getByRole('button', { name: 'Удалить выбранные' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    expect((await bootstrap()).history.filter(e => ids.includes(e.id))).toHaveLength(2);
    await page.getByRole('button', { name: 'Удалить выбранные' }).click();
    await dialog.getByRole('button', { name: 'Удалить траты (2)' }).click();
    await expect(dialog).toHaveCount(0);
    expect((await bootstrap()).history.filter(e => ids.includes(e.id))).toHaveLength(0);
  } finally {
    for (const row of (await bootstrap()).history.filter(e => ids.includes(e.id)))
      await request.delete('/api/expenses/' + row.row, { headers, data: { fp: row.fp } });
  }
});

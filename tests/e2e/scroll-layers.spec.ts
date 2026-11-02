import { expect, test, type Page } from '@playwright/test';
import { initMockSession, mockToken } from './auth';
import { navigate } from './navigation';
import { today } from '../../shared/dates';
import type { Bootstrap } from '../../shared/types';

async function longJournal(page: Page) {
  const headers = { 'X-App-Key': await mockToken(page.request) };
  const base: Bootstrap = await (await page.request.get('/api/bootstrap', { headers })).json();
  expect(base.mock).toBe(true);
  const month = today(base.tz).slice(0, 7);
  const history = Array.from({ length: 84 }, (_, i) => ({
    ...base.history[0], row: i + 2, id: 'scroll-fixture-' + i, name: 'Покупка ' + (i + 1),
    date: month + '-' + String(1 + Math.floor(i / 4)).padStart(2, '0'), amount: 100 + i,
  }));
  await initMockSession(page);
  await page.route('**/api/bootstrap*', r => r.fulfill({ json: { ...base, history, expenses: history } }));
  await page.route('**/api/expenses?*', r => r.fulfill({ json: { expenses: history } }));
  await page.goto('/');
  await expect(page.locator('.expense-main')).toHaveCount(84);
}

test('long journal keeps selection controls above moving dates and the last expense above navigation', async ({ page }, info) => {
  await longJournal(page);
  await page.getByRole('button', { name: 'Выбрать', exact: true }).click();
  await page.locator('.expense-main').first().click();
  await page.locator('.expense-main').nth(1).click();
  const tools = page.locator('.selection-tools');
  for (const width of [412, 360, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    for (const index of [0, 1, 2]) {
      await page.locator('.day-group').nth(8).evaluate((group, index) => {
        const toolbar = document.querySelector('.selection-tools')!;
        const control = [toolbar.querySelector('strong')!, ...toolbar.querySelectorAll('button')][index];
        const offset = control.getBoundingClientRect().top - toolbar.getBoundingClientRect().top;
        const y = document.querySelector('.app-header')!.getBoundingClientRect().height + offset + 6;
        window.scrollBy(0, group.getBoundingClientRect().top - y);
      }, index);
      await expect.poll(() => tools.evaluate(toolbar => [...toolbar.querySelectorAll('strong,button')].every(control => {
        const r = control.getBoundingClientRect();
        return control.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }))).toBe(true);
    }
    await expect(tools.locator('strong')).toContainText('Выбрано: 2');
    if (width === 412) await page.screenshot({ path: `tests/screenshots/scroll/selected-${info.project.name}.png` });
    await tools.getByRole('button', { name: 'Изменить выбранные' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    if (width < 1024) {
      const last = (await page.locator('.expense-main').last().boundingBox())!;
      const nav = (await page.locator('.navigation').boundingBox())!;
      expect(last.y + last.height).toBeLessThanOrEqual(nav.y);
      await expect(page.locator('.navigation')).toHaveCSS('opacity', '1');
    }
  }
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; window.scrollTo(0, 1100); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 760, height: 380 });
  await expect(tools).toHaveCSS('position', 'static');
  await expect(page.locator('.navigation')).toHaveCSS('width', '72px');
  await page.setViewportSize({ width: 412, height: 800 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '100%'; });
  await page.getByRole('button', { name: 'Завершить выбор' }).click();
  const day = page.locator('.day-group').nth(8);
  await day.evaluate(n => window.scrollBy(0, n.getBoundingClientRect().top));
  await expect.poll(async () => {
    const title = (await day.locator('.label-row').first().boundingBox())!;
    const header = (await page.locator('.app-header').boundingBox())!;
    return Math.abs(title.y - header.y - header.height);
  }).toBeLessThan(2);
  for (const tab of ['Обзор', 'Ещё']) {
    await navigate(page, tab);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('.navigation')).toHaveCSS('opacity', '1');
    expect(await page.locator('.navigation').evaluate(n => getComputedStyle(n).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  }
});

test('queue undo and a save receipt remain visible together without covering navigation', async ({ page, context }) => {
  await initMockSession(page);
  await page.goto('/?amount=123&merchant=Проверка уведомлений');
  await page.getByRole('button', { name: '🍔 Продукты и супермаркеты', exact: true }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: /^Сохранить ·/ }).click();
  await expect(page.locator('.toast')).toContainText('Сохранено');
  await page.getByRole('button', { name: 'Закрыть добавление' }).click();
  await page.locator('.queue-card').getByRole('button', { name: 'Убрать' }).click();
  const toast = page.locator('.toast'), undo = page.locator('.undo-stack');
  await expect(undo).toBeVisible();
  const receipt = (await toast.boundingBox())!, notice = (await undo.boundingBox())!;
  expect(receipt.y + receipt.height).toBeLessThanOrEqual(notice.y);
  expect(notice.y + notice.height).toBeLessThanOrEqual((await page.locator('.navigation').boundingBox())!.y);
  await undo.getByRole('button', { name: 'Отменить' }).click();
  await expect(page.locator('.queue-card')).toHaveCount(1);
});

test('keyboard keeps a bulk editor field visible without scrolling the journal behind it', async ({ page }) => {
  await longJournal(page);
  await page.getByRole('button', { name: 'Выбрать', exact: true }).click();
  await page.locator('.expense-main').nth(30).click();
  await page.getByRole('button', { name: 'Изменить выбранные' }).click();
  const dialog = page.getByRole('dialog', { name: 'Изменить выбранные траты' });
  for (const field of ['Категория', 'Дата', 'Сумма', 'Название', 'Комментарий'])
    await dialog.getByRole('checkbox', { name: field, exact: true }).check();
  const comment = dialog.getByLabel('Комментарий для выбранных трат');
  await comment.focus();
  const scroll = await page.evaluate(() => {
    const before = window.scrollY;
    Object.defineProperty(visualViewport!, 'height', { configurable: true, value: 360 });
    visualViewport!.dispatchEvent(new Event('resize'));
    return before;
  });
  await expect.poll(async () => { const r = (await comment.boundingBox())!; return r.y >= 0 && r.y + r.height <= 360; }).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  await expect(page.locator('.navigation')).toBeHidden();
});

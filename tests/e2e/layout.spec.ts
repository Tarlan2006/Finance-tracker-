import { navigate } from './navigation';
import { test, expect } from '@playwright/test';
test('responsive layouts, enlarged type, viewport keyboard and screenshots', async ({ page }, info) => {
  await page.goto('/'); await page.getByLabel('Пароль', { exact: true }).fill('mock-local-key'); await page.getByRole('button', { name: 'Войти' }).click(); await navigate(page, 'Добавить'); await expect(page.getByRole('heading', { name: 'Новый расход' })).toBeVisible();
  for (const [width, height] of [[412, 915], [360, 740], [768, 1024]]) {
    await page.setViewportSize({ width, height });
    for (const [button, file] of [['Добавить', 'add'], ['Траты', 'expenses'], ['Обзор', 'overview'], ['Ещё', 'more']]) {
      await navigate(page, button);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `tests/screenshots/design/after/${file}-${width}-${info.project.name}.png`, fullPage: true });
      if (width === 412) await page.screenshot({ path: `tests/screenshots/design/after/${file}-viewport-${info.project.name}.png` });
    }
  }
  await page.setViewportSize({ width: 360, height: 740 }); await navigate(page, 'Добавить');
  const tile = await page.locator('.category').first().boundingBox(); expect(tile!.height).toBe(80);
  for (const scale of [130, 200]) { await page.evaluate(scale => document.documentElement.style.fontSize = `${scale}%`, scale); for (const [i, name] of ['Добавить', 'Траты', 'Обзор', 'Ещё'].entries()) { await navigate(page, name); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); if (i === 2) await expect.poll(() => page.locator('.stat-grid strong').evaluateAll(nodes => nodes.every(n => n.scrollWidth <= n.clientWidth + 1))).toBe(true); if (scale === 200) await page.screenshot({ path: `tests/screenshots/design/after/large-type-${i}-${info.project.name}.png`, fullPage: true }); } }
  await page.evaluate(() => document.documentElement.style.fontSize = '100%'); await navigate(page, 'Добавить'); await page.getByLabel('Название', { exact: false }).first().fill('ко');
  await page.screenshot({ path: `tests/screenshots/design/after/suggestions-${info.project.name}.png`, fullPage: true });
  await page.evaluate(() => { Object.defineProperty(visualViewport!, 'height', { configurable: true, value: 420 }); visualViewport!.dispatchEvent(new Event('resize')); });
  const button = await page.locator('.save').boundingBox(); expect(button!.y + button!.height).toBeLessThanOrEqual(420); await expect(page.getByLabel('Текущая сумма')).toBeVisible();
  await expect.poll(async () => { const input = await page.getByLabel('Название', { exact: false }).first().boundingBox(), panel = await page.locator('.save-bar').boundingBox(); return input!.y + input!.height <= panel!.y; }).toBe(true);
  await expect.poll(async () => { const list = await page.getByRole('listbox').boundingBox(), panel = await page.locator('.save-bar').boundingBox(); return list!.y + list!.height <= panel!.y; }).toBe(true);
  await page.screenshot({ path: `tests/screenshots/design/after/keyboard-${info.project.name}.png` });
});

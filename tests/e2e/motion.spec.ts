import { test, expect, type Page, type Locator } from '@playwright/test';
import fs from 'node:fs/promises';
test.use({ reducedMotion: 'no-preference', deviceScaleFactor: 1 });
const key = 'mock-local-key';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const list: string[] = []; errors.set(page, list); page.on('pageerror', e => list.push(e.message)); });
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));
async function ready(page: Page) {
  await page.addInitScript(() => localStorage.setItem('app-key', 'mock-local-key'));
  await page.goto('/'); await expect(page.locator('.expense-main').first()).toBeVisible();
  await page.waitForTimeout(650);
}
async function settled(page: Page) {
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
  await expect(page.locator('[data-motion-ghost]')).toHaveCount(0);
}
test('motion: fast navigation, sheet interruption, retained draft and pointer drag', async ({ page }, info) => {
  await ready(page);
  const shot = (name: string) => page.screenshot({ path: `tests/screenshots/motion/${info.project.name}-${name}.png`, scale: 'css' });
  await page.getByRole('button', { name: 'Обзор', exact: true }).click(); await shot('navigation-moving'); await settled(page); await shot('navigation-final');
  await page.locator('.bottom-nav button').evaluateAll(nodes => { (nodes[2] as HTMLElement).click(); (nodes[0] as HTMLElement).click(); (nodes[1] as HTMLElement).click(); });
  await expect(page.getByRole('heading', { name: 'Обзор', exact: true })).toBeVisible(); await settled(page);
  await page.getByRole('button', { name: 'Добавить расход', exact: true }).click(); await shot('sheet-moving');
  await page.getByRole('button', { name: '3', exact: true }).click(); await expect(page.getByLabel('Сумма', { exact: true })).toHaveValue('3');
  await settled(page); await shot('sheet-final'); await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Добавить расход', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Добавить расход', exact: true }).click(); await expect(page.getByLabel('Сумма', { exact: true })).toHaveValue('3'); await settled(page);
  const handle = page.locator('.add-toolbar'); const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 28); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + 100, { steps: 8 });
  expect(await page.locator('.add-dialog').evaluate(n => n.style.transform)).toContain('translateY'); await shot('sheet-drag');
  await page.mouse.move(box.x + box.width / 2, box.y + 160, { steps: 3 }); await page.mouse.up(); await expect(page.locator('.add-backdrop')).toBeHidden(); await settled(page);
  await page.evaluate(() => { Object.defineProperty(document, 'startViewTransition', { value: undefined, configurable: true }); });
  await page.getByRole('button', { name: 'Ещё', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Ещё', exact: true })).toBeVisible(); await settled(page);
});
test('motion: save, chart morph, selection, deletion and undo settle', async ({ page, request }, info) => {
  const base = await (await request.get('/api/bootstrap', { headers: { 'X-App-Key': key } })).json(); expect(base.mock).toBe(true);
  await ready(page); const name = `Motion ${info.project.name} ${Date.now()}`;
  const shot = (label: string) => page.screenshot({ path: `tests/screenshots/motion/${info.project.name}-${label}.png`, scale: 'css' });
  try {
    await page.getByRole('button', { name: 'Добавить расход', exact: true }).click(); await page.getByRole('button', { name: '7', exact: true }).click(); await page.locator('.category').first().click();
    await page.getByRole('combobox', { name: /Название/ }).fill(name); await page.locator('.save').click(); await expect(page.locator('.save')).toHaveClass(/success/);
    // Freeze the real 400 ms effect at its midpoint for an inspectable frame;
    // screenshot encoding itself can take longer than the feedback animation.
    await page.locator('.save-check').evaluate(n => n.getAnimations().forEach(a => { a.pause(); a.currentTime = 200; }));
    await shot('save-moving'); await expect(page.locator('.save-label')).toHaveCSS('opacity', '0'); await expect(page.locator('.save-check')).toHaveCSS('opacity', '1'); await shot('save-check');
    await page.locator('.save-check').evaluate(n => n.getAnimations().forEach(a => a.play()));
    await expect(page.getByLabel('Сумма', { exact: true })).toHaveValue('0'); await settled(page); await shot('save-final'); await page.getByRole('button', { name: 'Закрыть добавление' }).click();
    await expect(page.locator('.expense-main').filter({ hasText: name })).toBeVisible();
    await page.locator('.expense-main').filter({ hasText: name }).click(); await page.getByRole('button', { name: 'Удалить расход', exact: true }).click(); await shot('delete-moving');
    await expect(page.locator('.expense-main').filter({ hasText: name })).toHaveCount(0); await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await shot('undo-moving'); await settled(page);
    await expect(page.locator('.expense-main').filter({ hasText: name })).toBeVisible(); await shot('undo-final');
    await page.getByRole('button', { name: 'Обзор', exact: true }).click(); await settled(page);
    const first = await page.locator('.bar-button').first().elementHandle();
    await page.getByRole('button', { name: 'Неделя', exact: true }).click(); await shot('week-moving'); await settled(page);
    expect(await first!.evaluate(node => node === document.querySelector('.bar-button'))).toBe(true); await expect(page.locator('.bar-button')).toHaveCount(7); await shot('week-final');
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: i % 2 ? 'Неделя' : 'Месяц', exact: true }).evaluate((n: HTMLButtonElement) => n.click());
    await settled(page); const total = page.getByTestId('overview-total'); await expect(total).toHaveText(await total.getAttribute('aria-label') || '');
    await page.locator('.legend-row').first().click(); await shot('ring-moving'); await settled(page); await shot('ring-final');
    await expect(page.locator('.donut-segment[aria-pressed="true"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Сбросить выбор категории' }).click(); await settled(page); await expect(page.locator('.donut-center')).toContainText('Всего');
  } finally {
    const data = await (await request.get('/api/bootstrap', { headers: { 'X-App-Key': key } })).json(); expect(data.mock).toBe(true);
    for (const e of data.history.filter((e: { name: string }) => e.name === name)) await request.delete(`/api/expenses/${e.row}?fp=${encodeURIComponent(e.fp)}`, { headers: { 'X-App-Key': key } });
  }
});
test('motion: reduced preference changes cancel movement immediately', async ({ page }) => {
  await ready(page); await page.getByRole('button', { name: 'Добавить расход', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' }); await settled(page);
  await expect(page.locator('.add-dialog')).toHaveCSS('transform', 'none'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Обзор', exact: true }).click(); await page.getByRole('button', { name: 'Неделя', exact: true }).click(); await settled(page);
  await expect(page.locator('.bar-button').first()).toHaveCSS('transform', 'none');
  expect(await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Месяц', exact: true }).click();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await settled(page); const total = page.getByTestId('overview-total'); await expect(total).toHaveText(await total.getAttribute('aria-label') || '');
});
test('motion: CPU x4 transition performance', async ({ page, context }, info) => {
  await ready(page); const session = await context.newCDPSession(page); await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  if (process.env.MOTION_PROFILE) { await session.send('Profiler.enable'); await session.send('Profiler.start'); }
  await page.evaluate(() => {
    const state = { long: [] as number[], shifts: [] as { value: number; recent: boolean }[], frames: [] as number[], previous: 0, measuring: false };
    Object.assign(window, { motionMetrics: state });
    new PerformanceObserver(list => { if (state.measuring) for (const e of list.getEntries()) state.long.push(e.duration); }).observe({ type: 'longtask' });
    new PerformanceObserver(list => { if (state.measuring) for (const e of list.getEntries()) { const shift = e as PerformanceEntry & { value: number; hadRecentInput: boolean }; state.shifts.push({ value: shift.value, recent: shift.hadRecentInput }); } }).observe({ type: 'layout-shift' });
    const frame = (time: number) => { if (state.measuring && state.previous) state.frames.push(time - state.previous); state.previous = time; requestAnimationFrame(frame); }; requestAnimationFrame(frame);
  });
  const results: unknown[] = [];
  const measure = async (name: string, action: () => Promise<unknown>) => {
    await page.evaluate(() => { const s = (window as unknown as { motionMetrics: { measuring: boolean; long: number[]; shifts: unknown[]; frames: number[] } }).motionMetrics; s.long = []; s.shifts = []; s.frames = []; s.measuring = true; });
    await action(); await page.waitForTimeout(700);
    results.push(await page.evaluate(name => { const s = (window as unknown as { motionMetrics: { measuring: boolean; long: number[]; shifts: { value: number; recent: boolean }[]; frames: number[] } }).motionMetrics; s.measuring = false; const sorted = [...s.frames].sort((a,b) => a-b); return { name, longTasks: s.long, cls: s.shifts.filter(x => !x.recent).reduce((n,x) => n+x.value,0), inputLayoutShift: s.shifts.reduce((n,x) => n+x.value,0), frameP95: sorted[Math.floor(sorted.length*.95)] || 0, frameMax: Math.max(0,...sorted) }; }, name));
  };
  const measureClick = async (name: string, locator: Locator) => {
    // Resolve/accessibility queries outside the window. Measure a real pointer
    // event, not Playwright's repeated actionability work under CPU throttling.
    await locator.scrollIntoViewIfNeeded(); const box = (await locator.boundingBox())!; await page.waitForTimeout(150);
    await measure(name, () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2));
  };
  await measureClick('navigation', page.getByRole('button', { name: 'Обзор', exact: true }));
  await measureClick('sheet-open', page.getByRole('button', { name: 'Добавить расход', exact: true }));
  await measure('sheet-close', () => page.keyboard.press('Escape'));
  await measureClick('week-month', page.getByRole('button', { name: 'Неделя', exact: true }));
  await page.getByRole('button', { name: 'Месяц', exact: true }).click(); await settled(page);
  await page.locator('.legend-row').first().scrollIntoViewIfNeeded(); await page.waitForTimeout(250);
  await measureClick('ring-selection', page.locator('.legend-row').first());
  await settled(page); await fs.mkdir('tests/screenshots/motion', { recursive: true });
  await fs.writeFile(`tests/screenshots/motion/performance-${info.project.name}.json`, JSON.stringify({ cpu: 4, viewport: '412x915', results }, null, 2));
  for (const result of results as { cls: number }[]) expect(result.cls).toBeLessThan(.01);
  if (process.env.MOTION_PROFILE) { const profile = await session.send('Profiler.stop'); await fs.writeFile('.wrangler/motion-profile.json', JSON.stringify(profile)); }
  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});

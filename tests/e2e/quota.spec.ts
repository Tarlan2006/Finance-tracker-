import { expect, test } from '@playwright/test';
import { navigate } from './navigation';
import { initMockSession } from './auth';

test('fifteen visible idle minutes create no queue polls or API requests', async ({page}) => {
  await initMockSession(page);
  await page.clock.install();
  await page.addInitScript(() => {
    window.setInterval = new Proxy(window.setInterval, {apply(target, self, args) {
      const [handler, delay] = args;
      if (delay === 15000 && typeof handler === 'function') args[0] = (...params: unknown[]) => {
        document.documentElement.dataset.queuePolls = String(Number(document.documentElement.dataset.queuePolls || 0) + 1);
        return handler(...params);
      };
      return Reflect.apply(target, self, args);
    }});
  });
  await page.goto('/');
  await expect(page.getByTestId('journal-total')).toBeVisible();
  await page.waitForLoadState('networkidle');
  let requests = 0;
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) requests++; });
  await page.clock.runFor(900000);
  const polls = await page.evaluate(() => Number(document.documentElement.dataset.queuePolls || 0));
  console.log({idleMinutes:15,polls,requests});
  expect(requests).toBe(0);
  expect(polls).toBe(0);
});

test('quota response blocks early manual retries and sends after returning to a visible tab', async ({page}) => {
  await initMockSession(page);
  await page.clock.install();
  let posts = 0;
  await page.route('**/api/expenses', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    posts++;
    if (posts === 1) return route.fulfill({status:503,headers:{'Retry-After':'40'},json:{error:'sheets_quota',message:'Google ограничил частоту запросов'}});
    return route.fulfill({json:{expense:{id:route.request().postDataJSON().id}}});
  });
  await page.goto('/?amount=100&merchant=Fixture');
  await page.getByRole('button',{name:'🍔 Продукты и супермаркеты',exact:true}).click();
  await page.getByRole('button',{name:/^Сохранить ·/}).click();
  await navigate(page,'Ещё');
  await expect(page.getByText(/Google ограничил частоту запросов.*503/)).toBeVisible();
  await expect(page.getByText(/Следующая попытка в/)).toBeVisible();
  await page.getByRole('button',{name:'Синхронизировать'}).click();
  await page.clock.runFor(1000); expect(posts).toBe(1);
  const visibility = (hidden: boolean) => page.evaluate(v => {
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>v});
    document.dispatchEvent(new Event('visibilitychange'));
  },hidden);
  await visibility(true); await page.clock.runFor(45000); expect(posts).toBe(1);
  await visibility(false); await expect(page.getByText('Все записи отправлены')).toBeVisible();
  expect(posts).toBe(2);
});

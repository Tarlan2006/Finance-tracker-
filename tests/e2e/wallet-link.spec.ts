import { expect, test, type Page } from '@playwright/test';
import { initMockSession } from './auth';

const walletText = 'SMALL SUPERMARKET AST111 KZT360.00 with Akatsuki Visa Rewards ••9613';
const addHeading = (page: Page) => page.getByRole('heading', { name: 'Новый расход', exact: true });
const amount = (page: Page) => page.getByLabel('Сумма', { exact: true });
const merchant = (page: Page) => page.getByRole('combobox', { name: /^Название/ });

async function expectDraft(page: Page, value: string | RegExp, name: string) {
  await expect(addHeading(page)).toBeVisible();
  await expect(amount(page)).toHaveValue(value);
  await expect(merchant(page)).toHaveValue(name);
  await expect(page.getByRole('button', { name: 'Сегодня', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.category[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Сохранить/ })).toBeDisabled();
  await expect(page).toHaveURL(/\/$/);
}

async function deliverToOpenApp(page: Page, text: string, event: 'pageshow' | 'visibilitychange') {
  await page.evaluate(({ text, event }) => {
    history.replaceState(history.state, '', '/?text=' + text);
    (event === 'pageshow' ? window : document).dispatchEvent(new Event(event));
  }, { text, event });
}

test('Wallet link prefills the signed-in form and saves only after confirmation', async ({ page }, info) => {
  await initMockSession(page);
  const expensePosts: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/expenses') expensePosts.push(request.url());
  });

  await page.goto('/?text=' + walletText);
  await expectDraft(page, '360', 'SMALL SUPERMARKET AST111');
  expect(expensePosts).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('wallet-draft.png') });

  await page.locator('.category').first().tap();
  const posted = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/expenses');
  await page.getByRole('button', { name: /^Сохранить/ }).tap();
  expect((await posted).postDataJSON()).toMatchObject({ amount: 360, name: 'SMALL SUPERMARKET AST111', source: 'wallet', comment: '' });
  await expect(amount(page)).toHaveValue('0');
  expect(expensePosts).toHaveLength(1);
});

test('Wallet draft survives refresh before login and a repeated link stays closed after login', async ({ page }) => {
  await page.goto('/?text=' + walletText);
  await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => Object.values(sessionStorage).join(' '))).not.toMatch(/Akatsuki|9613/);
  await page.reload();
  await page.getByLabel('Пароль', { exact: true }).fill('mock-local-key');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expectDraft(page, '360', 'SMALL SUPERMARKET AST111');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('pending-payment'))).toBeNull();

  await page.getByRole('button', { name: 'Закрыть добавление' }).click();
  await page.goto('/?text=' + walletText);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Траты', exact: true })).toBeVisible();
  await expect(addHeading(page)).toBeHidden();
});

test('Warm Wallet links update the mounted form and ignore duplicate delivery', async ({ page }) => {
  await initMockSession(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Добавить расход', exact: true }).click();
  await page.getByRole('button', { name: 'Вчера', exact: true }).click();

  const raw = 'КОФЕ & CO #7 + BAR USD4.50 with Visa ••1234';
  await deliverToOpenApp(page, raw, 'visibilitychange');
  await expectDraft(page, /^4[.,]5$/, 'КОФЕ & CO #7 + BAR');
  await expect(page.getByLabel('Комментарий', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Комментарий', { exact: true })).toHaveValue(/USD/);

  await merchant(page).fill('Уточнённое название');
  await deliverToOpenApp(page, raw, 'pageshow');
  await expect(page).toHaveURL(/\/$/);
  await expect(merchant(page)).toHaveValue('Уточнённое название');

  // The mock journal already knows Magnum, so the normal name suggestion has a category.
  await page.locator('.category').first().click();
  await deliverToOpenApp(page, 'Magnum KZT1,250.00 with Visa', 'pageshow');
  await expectDraft(page, '1250', 'Magnum');
});

test('Unrecognized Wallet text opens a blank add form', async ({ page }) => {
  await initMockSession(page);
  await page.goto('/?text=Акция! Скидки до 50%');
  await expectDraft(page, '0', '');
});

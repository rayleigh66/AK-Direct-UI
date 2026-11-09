import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.use({ locale: 'zh-CN' });

async function capture(page: Page, name: string) {
  if (process.env.ROUND2_SCREENSHOTS !== '1') return;
  const directory = path.join(process.cwd(), 'docs/ui-review/round2');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
}

async function overflow(page: Page) {
  const value = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(value).toBeLessThanOrEqual(1);
}

async function openOrderList(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Shop in-stock wholesale' })).toBeVisible();
  await page.locator('[data-testid="product-card"]').first().click();
  const detail = page.getByTestId('product-detail');
  await detail.locator('[data-testid="quantity-input"]').fill('12');
  await detail.locator('[data-testid="add-to-order"]').click();
  await expect(detail.getByText('Added to your order list.')).toBeVisible();
  await detail.getByRole('button', { name: 'View order list' }).click();
  await expect(page.getByRole('heading', { name: 'Order list' })).toBeVisible();
}

test('English date display and Sea default survive a Chinese system locale', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'One explicit viewport pass.');

  await openOrderList(page);

  const sea = page.getByRole('button', { name: 'Sea freight' });
  await expect(sea).toHaveClass(/border-slate-900/);

  const dateInput = page.getByTestId('expected-ship-date');
  const dateDisplay = page.getByTestId('expected-ship-date-display');
  const iso = await dateInput.inputValue();
  expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(dateDisplay).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  expect(await dateDisplay.innerText()).not.toMatch(/[年月日]/);

  await dateInput.fill('2026-12-01');
  await expect(dateDisplay).toHaveText('Dec 1, 2026');
  await expect(dateInput).toHaveValue('2026-12-01');
  await capture(page, 'customer-order-list-english-date-1440');
  for (const width of [768, 430, 390, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await overflow(page);
    await expect(dateDisplay).toHaveText('Dec 1, 2026');
    await capture(page, `customer-order-list-english-date-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByTestId('submit-order').click();
  await expect(page.getByRole('heading', { name: 'Order request submitted' })).toBeVisible();
  await expect(page.getByTestId('success-expected-ship')).toHaveText('Dec 1, 2026');
  expect(await page.getByTestId('success-expected-ship').innerText()).not.toMatch(/[年月日]/);
});

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openInternalTab, waitForInternalWorkspace } from './internalNav';

const ADMIN_EMAIL = process.env.REAL_E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.REAL_E2E_ADMIN_PASSWORD ?? '';
const SALES_EMAIL = process.env.REAL_E2E_SALES_EMAIL ?? '';
const SALES_PASSWORD = process.env.REAL_E2E_SALES_PASSWORD ?? '';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/');
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: /Sign in/ }).click();
  await waitForInternalWorkspace(page);
}

async function capture(page: Page, name: string, fullPage = true) {
  if (process.env.REAL_E2E_SCREENSHOTS !== '1') return;
  const directory = path.join(process.cwd(), 'docs/ui-review/real-admin-shell');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage });
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
  ).toBeLessThanOrEqual(1);
}

test('admin desktop uses the fixed sidebar and topbar while keeping real tabs', async ({
  page,
}, testInfo) => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'Real-auth admin credentials are required.');
  test.skip(testInfo.project.name !== 'real-desktop-1440', 'Desktop shell check at 1440.');

  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page.getByTestId('real-sidebar')).toBeVisible();
  await expect(page.getByTestId('internal-nav-open')).toBeHidden();
  const sidebar = await page.getByTestId('real-sidebar').boundingBox();
  expect(sidebar?.width).toBe(248);
  await expect(page.getByTestId('real-tab-products')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('internal-page-title')).toHaveText('Products');
  await expect(page.locator('nav[aria-label="Internal sections"]')).toHaveCount(0);
  await expect(page.getByTestId('admin-product-search')).toBeVisible();
  await capture(page, 'admin-products-1440');

  await openInternalTab(page, 'customers');
  await expect(page.getByTestId('admin-customers')).toBeVisible();
  await expect(page.getByTestId('real-tab-customers')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('internal-page-title')).toHaveText('Customers');
  await capture(page, 'admin-customers-1440');

  await page.getByTestId('internal-language-toggle').getByRole('button', { name: '中文' }).click();
  await expect(page.getByTestId('real-tab-customers')).toContainText('客户管理');
  await expect(page.getByTestId('internal-page-title')).toHaveText('客户管理');
  await expect(page.getByTestId('admin-customers')).toBeVisible();
  await page.getByTestId('internal-language-toggle').getByRole('button', { name: 'EN' }).click();
  await noOverflow(page);

  for (const width of [1024, 768, 430, 390, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    if (width >= 1024) {
      await expect(page.getByTestId('real-sidebar')).toBeVisible();
      await expect(page.getByTestId('internal-nav-open')).toBeHidden();
    } else {
      await expect(page.getByTestId('internal-nav-open')).toBeVisible();
      await expect(page.getByTestId('real-sidebar')).toBeHidden();
      await page.getByTestId('internal-nav-open').click();
      await expect(page.getByTestId('real-sidebar')).toBeVisible();
      await noOverflow(page);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('real-sidebar')).toBeHidden();
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test('sales sees only authorised sidebar entries and lands on orders', async ({
  page,
}, testInfo) => {
  test.skip(!SALES_EMAIL || !SALES_PASSWORD, 'Real-auth sales credentials are required.');
  test.skip(testInfo.project.name !== 'real-desktop-1440', 'Sales shell check at 1440.');

  await signIn(page, SALES_EMAIL, SALES_PASSWORD);
  await expect(page.getByTestId('real-tab-orders')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('real-tab-customers')).toHaveCount(0);
  await expect(page.getByTestId('real-tab-products')).toHaveCount(0);
  await expect(page.getByTestId('internal-page-title')).toHaveText('Orders');
  await capture(page, 'sales-orders-1440');
});

test('mobile sidebar supports backdrop, Escape, focus and selection without overflow', async ({
  page,
}, testInfo) => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'Real-auth admin credentials are required.');
  test.skip(testInfo.project.name !== 'real-mobile-390', 'Mobile shell check at 390.');

  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const sidebar = page.getByTestId('real-sidebar');
  const backdrop = page.getByTestId('real-sidebar-backdrop');
  const menu = page.getByTestId('internal-nav-open');
  await expect(sidebar).toBeHidden();
  await expect(menu).toBeVisible();

  await menu.click();
  await expect(sidebar).toBeVisible();
  await expect(backdrop).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe('hidden');
  await expect
    .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('#real-sidebar'))))
    .toBe(true);
  await page.waitForTimeout(250);
  await capture(page, 'admin-mobile-sidebar-390', false);
  await page.getByTestId('real-tab-tiers').focus();
  await page.keyboard.press('Tab');
  await expect
    .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('#real-sidebar'))))
    .toBe(true);

  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();
  await expect(backdrop).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe('');
  await expect(menu).toBeFocused();

  await menu.click();
  await expect(sidebar).toBeVisible();
  await backdrop.click({ position: { x: 350, y: 400 } });
  await expect(sidebar).toBeHidden();

  await menu.click();
  await expect(sidebar).toBeVisible();
  await page.getByTestId('real-tab-customers').click();
  await expect(sidebar).toBeHidden();
  await expect(page.getByTestId('admin-customers')).toBeVisible();
  await expect(page.getByTestId('real-tab-customers')).toHaveAttribute('aria-current', 'page');
  await noOverflow(page);
});

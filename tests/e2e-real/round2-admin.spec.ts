import fs from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.REAL_E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.REAL_E2E_ADMIN_PASSWORD ?? '';

async function signIn(page: Page) {
  await page.goto('/');
  await page.locator('input[autocomplete="username"]').fill(ADMIN_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /Sign in/ }).click();
  await expect(page.getByTestId('real-tab-products')).toBeVisible();
}

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

test('round 2 admin visual, language, CSV, product views and tier preview', async ({ page }, testInfo) => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'Real-auth admin credentials are required.');
  test.skip(testInfo.project.name !== 'real-desktop-1440', 'One admin pass at desktop 1440.');

  await signIn(page);
  await expect(page.getByTestId('real-tab-products')).toHaveAttribute('aria-current', 'page');

  // Chinese mode applies to the shell and multiple admin pages.
  await page.getByTestId('internal-language-toggle').getByRole('button', { name: '中文' }).click();
  await expect(page.getByTestId('real-tab-inventory')).toContainText('库存');
  await expect(page.getByTestId('real-tab-tiers')).toContainText('客户等级与折扣');
  await expect(page.getByTestId('admin-product-search')).toHaveAttribute(
    'placeholder',
    '搜索商品款号、名称或品牌'
  );

  await page.getByTestId('real-tab-inventory').click();
  await expect(page.getByRole('button', { name: '库存列表', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '仓库视图', exact: true })).toBeVisible();
  await expect(page.getByTestId('real-tab-products')).not.toHaveAttribute('aria-current', 'page');

  await page.getByTestId('real-tab-import').click();
  await expect(page.getByText('下载 CSV 模板', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('import-template-download').click();
  const download = await downloadPromise;
  const downloadPath = path.join(testInfo.outputDir, 'template.csv');
  await download.saveAs(downloadPath);
  const template = await fs.readFile(downloadPath, 'utf8');
  expect(template.split(/\r?\n/)[0]).toBe('sku_code,warehouse_code,on_hand,unsellable');
  expect(template).toBe('sku_code,warehouse_code,on_hand,unsellable\n');

  await page.getByTestId('real-tab-setup').click();
  await expect(page.getByText('仓库', { exact: true }).first()).toBeVisible();
  await page.getByTestId('real-tab-tiers').click();
  await expect(page.getByTestId('tier-preview')).toBeVisible();
  await expect(page.getByText('界面预览，尚未应用于真实订单。').first()).toBeVisible();
  await capture(page, 'admin-tier-preview-zh-1440');
  await expect(page.getByTestId('tier-preview-badge-5')).toHaveText('Diamond');

  // Switching back to EN persists and keeps the current page (Tier preview).
  await page.getByTestId('internal-language-toggle').getByRole('button', { name: 'EN' }).click();
  await expect(page.getByTestId('tier-preview')).toBeVisible();
  await expect(page.getByText(/UI preview only/i).first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('real-tab-products')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('internal-language-toggle').getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('admin-product-search')).toHaveAttribute(
    'placeholder',
    'Search product code, name or brand'
  );
  await overflow(page);

  // Create an isolated product through the real API, then exercise grid/list.
  const csrf = (await (await page.request.get('/api/auth/csrf')).json()).csrfToken;
  const unique = Date.now().toString().slice(-7);
  const productCode = `R2-${unique}`;
  const created = await page.request.post('/api/admin/catalog/products', {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      brandId: 'brand-aoking',
      productCode,
      title: `第二轮网格商品 ${unique}`,
      titleEn: `Round 2 grid product ${unique}`,
      category: 'Backpacks',
    },
  });
  expect(created.status()).toBe(201);

  await page.getByTestId('real-tab-products').click();
  await page.reload();
  await page.getByTestId('admin-product-search').fill(productCode);
  await page.getByTestId('admin-product-view-grid').click();
  await expect(page.getByTestId('admin-product-view')).toHaveAttribute('data-view-mode', 'grid');
  const card = page.locator(`[data-product-code="${productCode}"]`);
  await expect(card).toBeVisible();
  await card.locator('button').first().click();
  const editor = card.getByRole('textbox').first();
  await editor.fill(`Draft ${unique}`);
  await page.getByTestId('admin-product-view-list').click();
  await expect(page.getByTestId('admin-product-view')).toHaveAttribute('data-view-mode', 'list');
  await expect(page.getByTestId('admin-product-search')).toHaveValue(productCode);
  await expect(card.locator('input').first()).toHaveValue(`Draft ${unique}`);
  await overflow(page);
  await capture(page, 'admin-products-list-1440');
  await page.getByTestId('admin-product-view-grid').click();
  await expect(page.getByTestId('admin-product-view')).toHaveAttribute('data-view-mode', 'grid');
  await page.reload();
  await expect(page.getByTestId('admin-product-view')).toHaveAttribute('data-view-mode', 'grid');
  await capture(page, 'admin-products-grid-1440');
  for (const width of [768, 430, 390, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await overflow(page);
    await capture(page, `admin-products-grid-${width}`);
  }
});

import { expect, test, type Page } from '@playwright/test';

async function switchRole(page: Page, profile: RegExp, option: string) {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1024) {
    await page.getByRole('button', { name: /Open navigation|菜单/ }).first().click();
  }
  await page.locator('aside').getByRole('button', { name: profile }).first().click();
  await page.getByText(option, { exact: true }).click();
}

async function navTo(page: Page, label: string) {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1024) {
    await page.getByTestId('customer-bottom-nav').getByRole('button', { name: label }).click();
  } else {
    await page.getByRole('button', { name: label }).first().click();
  }
}

async function openCatalog(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Shop in-stock wholesale' })).toBeVisible();
}

test('customer search and statistics respect brand authorization', async ({ page }) => {
  await openCatalog(page);
  const availability = page.locator('div.bg-white', { hasText: 'Available across warehouses' }).first();
  await expect(availability).toContainText('1,296 PCS');

  await page.keyboard.press('Control+k');
  const palette = page.locator('input[placeholder="Search products, SKUs or pages..."]');
  await palette.fill('VOY');
  await expect(page.getByText('Heritage Weekend Duffle')).toHaveCount(0);
  await expect(page.getByText(/VOY-1001-KHK/)).toHaveCount(0);

  await palette.fill('AK-9042');
  await expect(page.getByText(/AK-9042-BLK/).first()).toBeVisible();
});

test('revoking and restoring a brand grant updates catalogue, search and statistics', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Cross-role lifecycle evidence runs on desktop');
  await openCatalog(page);
  const availability = page.locator('div.bg-white', { hasText: 'Available across warehouses' }).first();
  await expect(availability).toContainText('1,296 PCS');

  await switchRole(page, /AK000123A/, 'Administrator (Admin Lin)');
  await page.getByRole('button', { name: /客户与账户建档/ }).first().click();
  const aokingGrant = page.getByRole('button', { name: /AOKING/ }).first();
  await expect(aokingGrant).toContainText('已授权');
  await aokingGrant.click();

  await switchRole(page, /Sarah Lin/, 'AK000123A (Apex buyer 1)');
  await expect(page.getByRole('heading', { name: 'Brand authorization required' })).toBeVisible();
  await expect(availability).toContainText('0 PCS');

  await page.keyboard.press('Control+k');
  const palette = page.locator('input[placeholder="Search products, SKUs or pages..."]');
  await palette.fill('AK-9042');
  await expect(page.getByText(/AK-9042-BLK/)).toHaveCount(0);
  await page.keyboard.press('Escape');

  await switchRole(page, /AK000123A/, 'Administrator (Admin Lin)');
  await page.getByRole('button', { name: /客户与账户建档/ }).first().click();
  const revokedGrant = page.getByRole('button', { name: /AOKING/ }).first();
  await expect(revokedGrant).toContainText('未授权');
  await revokedGrant.click();

  await switchRole(page, /Sarah Lin/, 'AK000123A (Apex buyer 1)');
  await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible();
  await expect(availability).toContainText('1,296 PCS');
});

test('sales cannot reach admin-only views or inventory import', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Cross-role lifecycle evidence runs on desktop');
  await openCatalog(page);
  await switchRole(page, /AK000123A/, 'Sales (Tom Miller)');
  await expect(page.getByRole('button', { name: '待确认' })).toBeVisible();
  await expect(page.locator('aside').getByText('商品目录管理')).toHaveCount(0);
  await expect(page.locator('aside').getByText('多仓库存与导入')).toHaveCount(0);
  await expect(page.locator('aside').getByText('促销与等级配置')).toHaveCount(0);

  await page.keyboard.press('Control+k');
  const palette = page.locator('input[placeholder="搜索功能、款号、SKU、客户或订单号..."]');
  await palette.fill('库存');
  await expect(page.getByText('库存管理与 Excel 导入')).toHaveCount(0);
  await expect(page.getByText('促销与等级配置')).toHaveCount(0);
});

test('customer command palette exposes no internal management modules', async ({ page }) => {
  await openCatalog(page);
  await page.keyboard.press('Control+k');
  const palette = page.locator('input[placeholder="Search products, SKUs or pages..."]');
  await palette.fill('商品');
  await expect(page.getByText('商品目录管理')).toHaveCount(0);
  await palette.fill('促销');
  await expect(page.getByText('促销与等级配置')).toHaveCount(0);
  await palette.fill('库存');
  await expect(page.getByText('库存管理与 Excel 导入')).toHaveCount(0);
});

test('customer membership no longer exposes tier simulation controls', async ({ page }) => {
  await openCatalog(page);
  await navTo(page, 'Membership');
  await expect(page.getByText(/Inactivity fast-forward \(Demo\)/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Record \$5,000 purchase/ })).toHaveCount(0);
  await expect(page.getByText(/internal QA control/i)).toBeVisible();
});

test('admin QA panel retains the inactivity simulation outside customer screens', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Cross-role lifecycle evidence runs on desktop');
  await openCatalog(page);
  await switchRole(page, /AK000123A/, 'Administrator (Admin Lin)');
  await page.getByRole('button', { name: /客户与账户建档/ }).first().click();
  const qaPanel = page.getByTestId('tier-qa-panel');
  await expect(qaPanel).toBeVisible();
  await qaPanel.getByRole('button', { name: '+18 months' }).click();
  await expect(qaPanel.getByRole('status')).toContainText('+18 个月');
});

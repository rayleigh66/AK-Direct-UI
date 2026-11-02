import { expect, test, type Page } from '@playwright/test';

async function openSidebarIfNeeded(page: Page) {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1024) {
    await page.getByRole('button', { name: /Open navigation|菜单/ }).first().click();
  }
}

async function switchRole(page: Page, profilePattern: RegExp, option: string) {
  await openSidebarIfNeeded(page);
  const sidebar = page.locator('aside');
  await sidebar.getByRole('button', { name: profilePattern }).first().click();
  await page.getByText(option, { exact: true }).click();
}

async function openAdminProducts(page: Page) {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1024) {
    const sidebarButton = page.locator('aside').getByRole('button', { name: /商品目录管理/ });
    if (await sidebarButton.isVisible()) {
      await sidebarButton.click();
    } else {
      await page.getByRole('button', { name: '商品管理' }).last().click();
    }
  } else {
    await page.getByRole('button', { name: /商品目录管理/ }).first().click();
  }
  await expect(page.getByRole('heading', { name: /商品目录管理/ })).toBeVisible();
}

async function createDraftAndSku(page: Page, code: string, title: string) {
  await page.getByTestId('admin-add-product').click();
  const editor = page.getByTestId('admin-product-editor');
  await editor.getByLabel('款号 / Product code').fill(code);
  await editor.getByLabel('中文名称', { exact: true }).fill(`${title} 中文`);
  await editor.getByLabel('English customer title').fill(title);
  await editor.getByLabel('材质 / Material').fill('Nylon');
  await editor.getByLabel('尺寸/容量 / Size').fill('20 L');
  await editor.getByLabel('中文描述').fill('管理员 E2E 商品');
  await editor.getByLabel('English customer description').fill('Admin E2E product');
  await editor.getByTestId('admin-save-product').click();
  await expect(page.getByText(/商品草稿已创建/)).toBeVisible();

  const row = page.locator('[data-product-id]', { hasText: title }).first();
  await expect(row).toBeVisible();
  await row.getByTestId('admin-add-sku').click();
  const form = page.getByTestId('admin-sku-form');
  await form.getByLabel('SKU 编码').fill(`${code}-BK`);
  await form.getByLabel('颜色名称 (中文)').fill('黑色');
  await form.getByLabel('Colour name (English)').fill('Black');
  await form.getByLabel('基础批发价 (USD)').fill('25');
  await form.getByLabel('初始在库 (PCS)').fill('50');
  await page.getByTestId('admin-save-sku').click();
  await expect(page.getByText('SKU 已创建')).toBeVisible();
  return row;
}

test('admin list is collapsed, expands one product and combines search and series filters', async ({
  page,
}) => {
  await page.goto('/');
  await switchRole(page, /AK000123A/, 'Administrator (Admin Lin)');
  await openAdminProducts(page);
  const rows = page.locator('[data-testid="admin-product-row"]');
  await expect(rows.first()).toBeVisible();
  await expect(rows.locator('[aria-expanded="true"]')).toHaveCount(0);
  await rows.nth(0).getByTestId('admin-product-row-button').click();
  await expect(page.locator('[aria-expanded="true"]')).toHaveCount(1);
  await rows.nth(1).getByTestId('admin-product-row-button').click();
  await expect(page.locator('[aria-expanded="true"]')).toHaveCount(1);
  await expect(rows.nth(1).getByTestId('admin-product-row-button')).toHaveAttribute(
    'aria-expanded',
    'true'
  );

  const search = page.getByPlaceholder('搜索款号、名称、SKU、系列或标签...');
  await search.fill('Urban');
  await page.getByLabel('Filter by series').selectOption('commute');
  await expect(page.locator('[data-testid="admin-product-row"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="admin-product-row"]')).toContainText(
    'Tactical Rolltop Commuter'
  );
});

test('admin creates a product and SKU, lists it and sees it in the customer catalog', async ({
  page,
}) => {
  await page.goto('/');
  await switchRole(page, /AK000123A/, 'Administrator (Admin Lin)');
  await openAdminProducts(page);
  const row = await createDraftAndSku(page, 'AK-ADMIN-E2E', 'Admin E2E Pack');
  await row.getByTestId('admin-toggle-product').click();
  await expect(page.getByText(/商品已上架/)).toBeVisible();
  await expect(row.getByText('已上架')).toBeVisible();

  await row.getByTestId('admin-edit-product').click();
  const editor = page.getByTestId('admin-product-editor');
  await editor.getByLabel('English customer title').fill('Admin E2E Pack Updated');
  await editor.getByTestId('admin-save-product').click();
  await expect(page.getByText(/商品信息已保存/)).toBeVisible();

  await switchRole(page, /Sarah Lin|Admin Lin/, 'AK000123A (Apex buyer 1)');
  await page.goto('/#/');
  await page.getByRole('heading', { name: 'Shop in-stock wholesale' }).waitFor();
  await page.getByPlaceholder('Search products or SKU...').fill('Admin E2E Pack Updated');
  await expect(page.locator('[data-testid="product-card"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="product-card"]')).toContainText('Admin E2E Pack Updated');
});

test('admin listing toggle immediately hides and shows a product for customers', async ({ page }) => {
  await page.goto('/');
  await switchRole(page, /AK000123A/, 'Administrator (Admin Lin)');
  await openAdminProducts(page);
  const row = page.locator('[data-product-id]', { hasText: 'Elite Waterproof Travel Pack' }).first();
  await row.getByRole('button', { name: /Elite Waterproof Travel Pack/ }).click();
  await row.getByTestId('admin-toggle-product').click();
  await expect(page.getByText(/商品已下架/)).toBeVisible();

  await switchRole(page, /Sarah Lin|Admin Lin/, 'AK000123A (Apex buyer 1)');
  await page.goto('/#/');
  await page.getByPlaceholder('Search products or SKU...').fill('Elite Waterproof Travel Pack');
  await expect(page.locator('[data-testid="product-card"]')).toHaveCount(0);
});

test('admin can manage series and tags and customer filters reflect them', async ({ page }) => {
  await page.goto('/');
  await switchRole(page, /AK000123A/, 'Administrator (Admin Lin)');
  await openAdminProducts(page);
  await page.getByRole('button', { name: '系列与标签' }).click();
  const dialog = page.locator('div.fixed.inset-0').last();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '+ 新增系列' }).click();
  const lastSeries = dialog.locator('input[placeholder="id"]').last();
  await lastSeries.fill('studio');
  const row = lastSeries.locator('xpath=ancestor::div[contains(@class,"border")][1]');
  await row.locator('input[placeholder="中文名称"]').fill('工作室');
  await row.locator('input[placeholder="English name"]').fill('Studio Line');
  await dialog.getByTestId('admin-save-taxonomy').click();
  await expect(page.getByRole('heading', { name: /商品目录管理/ })).toBeVisible();

  await page.getByRole('button', { name: '系列与标签' }).click();
  const dialog2 = page.locator('div.fixed.inset-0').last();
  await dialog2.waitFor();
  await dialog2.getByRole('button', { name: '功能标签 / Tags' }).click();
  await dialog2.getByRole('button', { name: '+ 新增标签' }).click();
  const tagCode = dialog2.locator('input[placeholder="CODE"]').last();
  await tagCode.fill('TRAVEL_READY');
  const tagRow = tagCode.locator('xpath=ancestor::div[contains(@class,"border")][1]');
  await tagRow.locator('input[placeholder="中文名称"]').fill('旅行适用');
  await tagRow.locator('input[placeholder="English name"]').fill('Travel ready');
  await dialog2.getByTestId('admin-save-taxonomy').click();
  await expect(page.getByRole('heading', { name: /商品目录管理/ })).toBeVisible();

  await switchRole(page, /Sarah Lin|Admin Lin/, 'AK000123A (Apex buyer 1)');
  await page.goto('/#/');
  await page.getByRole('heading', { name: 'Shop in-stock wholesale' }).waitFor();
  await expect(page.getByTestId('series-filters')).toContainText('Studio Line');
});

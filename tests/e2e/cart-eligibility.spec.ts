import { expect, test, type Page } from '@playwright/test';

async function switchRole(page: Page, profile: RegExp, option: string) {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1024) {
    await page.getByRole('button', { name: /Open navigation|菜单/ }).first().click();
  }
  const sidebar = page.locator('aside');
  await sidebar.getByRole('button', { name: profile }).first().click();
  await page.getByText(option, { exact: true }).click();
}

async function openAdminProducts(page: Page) {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1024) {
    await page.getByRole('button', { name: '商品管理' }).last().click();
  } else {
    await page.getByRole('button', { name: /商品目录管理/ }).first().click();
  }
  await expect(page.getByRole('heading', { name: /商品目录管理/ })).toBeVisible();
}

async function customerOpenCart(page: Page) {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1024) {
    await page.getByTestId('customer-bottom-nav').getByRole('button', { name: 'Order list' }).click();
  } else {
    await page.getByRole('button', { name: /Order list/ }).first().click();
  }
  await expect(page.getByRole('heading', { name: 'Order list' })).toBeVisible();
}

test('customer cart cannot bypass admin unpublish or SKU stop, then works after restoration', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Cross-role lifecycle evidence runs on desktop');
  await page.goto('/');
  await page.getByRole('heading', { name: 'Shop in-stock wholesale' }).waitFor();
  await page.locator('[data-testid="product-card"]').first().click();
  const detail = page.getByTestId('product-detail');
  await detail.locator('[data-testid="add-to-order"]').click();
  await expect(detail.getByText('Added to your order list.')).toBeVisible();
  await detail.getByRole('button', { name: 'View order list' }).click();
  await page.locator('textarea').fill('Keep this packing note.');
  await expect(page.getByRole('heading', { name: 'Order list' })).toBeVisible();

  await switchRole(page, /AK000123A/, 'Administrator (Admin Lin)');
  await openAdminProducts(page);
  const productRow = page.locator('[data-product-id]', { hasText: 'Elite Waterproof Travel Pack' }).first();
  await productRow.getByTestId('admin-product-row-button').click();
  await productRow.getByTestId('admin-toggle-product').click();
  await expect(page.getByText(/商品已下架/)).toBeVisible();

  await switchRole(page, /Sarah Lin|Admin Lin/, 'AK000123A (Apex buyer 1)');
  await customerOpenCart(page);
  await expect(page.getByText('This product is no longer available. Remove it before submitting.')).toBeVisible();
  await expect(page.getByTestId('submit-order')).toBeDisabled();
  await expect(page.locator('textarea')).toHaveValue('Keep this packing note.');

  await switchRole(page, /AK000123A/, 'Administrator (Admin Lin)');
  await openAdminProducts(page);
  await productRow.getByTestId('admin-product-row-button').click();
  await productRow.getByTestId('admin-toggle-product').click();
  await expect(page.getByText(/商品已上架/)).toBeVisible();
  await switchRole(page, /Sarah Lin|Admin Lin/, 'AK000123A (Apex buyer 1)');
  await customerOpenCart(page);
  await expect(page.getByTestId('submit-order')).toBeEnabled();

  await switchRole(page, /AK000123A/, 'Administrator (Admin Lin)');
  await openAdminProducts(page);
  await productRow.getByTestId('admin-product-row-button').click();
  await productRow.getByTestId('admin-edit-sku').first().click();
  const skuForm = page.getByTestId('admin-sku-form');
  await skuForm.getByLabel('可售状态').selectOption('discontinued');
  await page.getByTestId('admin-save-sku').click();
  await expect(page.getByText('SKU 已更新')).toBeVisible();

  await switchRole(page, /Sarah Lin|Admin Lin/, 'AK000123A (Apex buyer 1)');
  await customerOpenCart(page);
  await expect(page.getByText('This SKU is no longer available. Remove it before submitting.')).toBeVisible();
  await expect(page.getByTestId('submit-order')).toBeDisabled();

  await switchRole(page, /AK000123A/, 'Administrator (Admin Lin)');
  await openAdminProducts(page);
  await productRow.getByTestId('admin-product-row-button').click();
  await productRow.getByTestId('admin-edit-sku').first().click();
  await page.getByTestId('admin-sku-form').getByLabel('可售状态').selectOption('active');
  await page.getByTestId('admin-save-sku').click();
  await expect(page.getByText('SKU 已更新')).toBeVisible();

  await switchRole(page, /Sarah Lin|Admin Lin/, 'AK000123A (Apex buyer 1)');
  await customerOpenCart(page);
  await page.getByTestId('submit-order').click();
  await expect(page.getByRole('heading', { name: 'Order request submitted' })).toBeVisible();
  await expect(page.locator('textarea')).toHaveCount(0);
});

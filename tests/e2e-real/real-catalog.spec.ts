import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const ADMIN_EMAIL = process.env.REAL_E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.REAL_E2E_ADMIN_PASSWORD ?? '';
const CUSTOMER_USERNAME = process.env.REAL_E2E_CUSTOMER_USERNAME ?? '';
const CUSTOMER_TEMP_PASSWORD = process.env.REAL_E2E_CUSTOMER_PASSWORD ?? '';
const CUSTOMER_USERNAME_MOBILE = process.env.REAL_E2E_CUSTOMER_USERNAME_MOBILE ?? '';
const CUSTOMER_TEMP_PASSWORD_MOBILE = process.env.REAL_E2E_CUSTOMER_PASSWORD_MOBILE ?? '';
const CUSTOMER_NEW_PASSWORD = 'CustomerPass123!Strong';

const IMAGE_FIXTURE = path.join(process.cwd(), 'tests/e2e-real/fixtures/product.png');

async function screenshot(page: import('@playwright/test').Page, name: string): Promise<void> {
  if (process.env.REAL_E2E_SCREENSHOTS !== '1') return;
  const directory = path.join(process.cwd(), 'docs/ui-review/real-catalog');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
}

test('admin creates catalogue and stock, customer browses authorised products', async ({
  page,
}, testInfo) => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'Real-auth admin credentials are required.');
  test.skip(!CUSTOMER_USERNAME || !CUSTOMER_TEMP_PASSWORD, 'A seeded customer account is required.');
  const mobileProject = testInfo.project.name.includes('mobile');
  const customerUsername = mobileProject ? CUSTOMER_USERNAME_MOBILE : CUSTOMER_USERNAME;
  const customerTempPassword = mobileProject ? CUSTOMER_TEMP_PASSWORD_MOBILE : CUSTOMER_TEMP_PASSWORD;
  test.skip(!customerUsername || !customerTempPassword, 'A seeded customer account is required.');

  const suffix = `${Date.now().toString().slice(-7)}${testInfo.project.name.includes('mobile') ? '9' : '1'}`;
  const warehouseCode = `WH-E2E-${suffix}`;
  const seriesName = `E2E Series ${suffix}`;
  const tagCode = `E2E_TAG_${suffix}`;
  const productCode = `E2E-${suffix}`;
  const skuCode = `E2E-${suffix}-BLK`;
  const productTitle = `E2E Runtime Pack ${suffix}`;

  await page.goto('/');
  await expect(page.getByTestId('real-auth-login')).toBeVisible();
  await page.locator('input[autocomplete="username"]').fill(ADMIN_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /Sign in/ }).click();

  await expect(page.getByTestId('real-tab-setup')).toBeVisible();
  await page.getByTestId('real-tab-setup').click();

  await page.getByTestId('warehouse-code').fill(warehouseCode);
  await page.getByTestId('warehouse-name-zh').fill('E2E 测试仓');
  await page.getByTestId('warehouse-name-en').fill('E2E Test Warehouse');
  await page.getByTestId('warehouse-create-submit').click();
  await expect(page.getByTestId('warehouse-row').filter({ hasText: warehouseCode })).toBeVisible();

  await page.getByTestId('series-name-zh').fill('E2E 系列');
  await page.getByTestId('series-name-en').fill(seriesName);
  await page.getByTestId('series-create-submit').click();
  await expect(page.getByText(seriesName, { exact: true })).toBeVisible();

  await page.getByTestId('tag-code').fill(tagCode);
  await page.getByTestId('tag-name-zh').fill('E2E 标签');
  await page.getByTestId('tag-name-en').fill('E2E Tag');
  await page.getByTestId('tag-create-submit').click();
  await expect(page.getByText(tagCode, { exact: true })).toBeVisible();

  await page.getByTestId('real-tab-products').click();
  await page.getByTestId('product-new').click();
  await page.getByTestId('product-code').fill(productCode);
  await page.getByTestId('product-title-zh').fill('E2E 运行测试背包');
  await page.getByTestId('product-title-en').fill(productTitle);
  await page.locator('form select').nth(1).selectOption({ label: seriesName });
  await page.getByTestId('product-create-submit').click();

  const card = page.locator(`[data-product-code="${productCode}"]`);
  await expect(card).toBeVisible();
  await card.locator('button').first().click();

  await card.locator('input[type="file"]').setInputFiles(IMAGE_FIXTURE);
  await expect(card.getByText('PRIMARY')).toBeVisible({ timeout: 20_000 });

  await card.getByTestId('sku-new').click();
  await card.getByTestId('sku-code').fill(skuCode);
  await card.getByTestId('sku-color-en').fill('Matte Black');
  await card.getByTestId('sku-color-zh').fill('哑光黑');
  await card.getByTestId('sku-price').fill('38.00');
  await card.getByTestId('sku-create-submit').click();
  await expect(card.getByTestId('sku-row').filter({ hasText: skuCode })).toBeVisible();

  await card.getByTestId('product-publish').click();
  await expect(card.getByTestId('product-unpublish')).toBeVisible();

  await page.getByTestId('real-tab-inventory').click();
  await page.getByTestId('inventory-register-open').click();
  const skuSelect = page.getByTestId('inventory-register-sku');
  const skuValue = await skuSelect
    .locator('option', { hasText: skuCode })
    .getAttribute('value');
  await skuSelect.selectOption(skuValue!);
  const warehouseSelect = page.getByTestId('inventory-register-warehouse');
  const warehouseValue = await warehouseSelect
    .locator('option', { hasText: warehouseCode })
    .getAttribute('value');
  await warehouseSelect.selectOption(warehouseValue!);
  await page.getByTestId('inventory-register-onhand').fill('20');
  await page.getByTestId('inventory-register-submit').click();
  await expect(page.getByTestId('inventory-row').filter({ hasText: skuCode })).toBeVisible();
  await screenshot(page, `inventory-${testInfo.project.name}`);

  await page.getByTestId('real-tab-import').click();
  await page.getByTestId('import-file').setInputFiles({
    name: 'stock.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `sku_code,warehouse_code,on_hand,unsellable\n${skuCode},${warehouseCode},25,2\n`
    ),
  });
  const previewRow = page.getByTestId('import-row').filter({ hasText: skuCode });
  await expect(previewRow).toBeVisible({ timeout: 20_000 });
  await expect(previewRow).toContainText('25');
  await screenshot(page, `import-preview-${testInfo.project.name}`);
  await page.getByTestId('import-commit').click();
  await expect(page.getByText(/Import committed|Already imported/)).toBeVisible({
    timeout: 20_000,
  });

  // Sign out and verify the customer experience.
  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page.getByTestId('real-auth-login')).toBeVisible();
  await page.locator('input[autocomplete="username"]').fill(customerUsername);
  await page.locator('input[autocomplete="current-password"]').fill(customerTempPassword);
  await page.getByRole('button', { name: /Sign in/ }).click();

  await expect(page.getByTestId('real-auth-change-password')).toBeVisible();
  const passwordInputs = page.locator('input[type="password"]');
  await passwordInputs.nth(0).fill(customerTempPassword);
  await passwordInputs.nth(1).fill(CUSTOMER_NEW_PASSWORD);
  await passwordInputs.nth(2).fill(CUSTOMER_NEW_PASSWORD);
  await page.getByRole('button', { name: /Save password/ }).click();

  await expect(page.getByTestId('catalog-search')).toBeVisible();
  const productCard = page.getByTestId('catalog-product-card').filter({ hasText: productTitle });
  await expect(productCard).toBeVisible({ timeout: 20_000 });
  await expect(productCard).toContainText('$38.00');
  await screenshot(page, `customer-catalog-${testInfo.project.name}`);

  await productCard.click();
  await expect(page.getByTestId('catalog-detail')).toBeVisible();
  await expect(page.getByTestId('catalog-detail')).toContainText('Add to cart');
  await expect(page.getByTestId('catalog-detail')).toContainText(
    'shared by every account of your company'
  );
  await expect(page.getByTestId('catalog-detail')).toContainText('Matte Black');
  await screenshot(page, `customer-detail-${testInfo.project.name}`);
});

import { mkdir, readFile } from 'node:fs/promises';
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
  const skuCode2 = `E2E-${suffix}-TAN`;
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
  const warehouseRow = page.getByTestId('warehouse-row').filter({ hasText: warehouseCode });
  await expect(warehouseRow).toBeVisible();

  // Real Setup: edit both warehouse names through the existing updateWarehouse API.
  await warehouseRow.getByTestId('warehouse-edit').click();
  await page.getByTestId('warehouse-edit-name-zh').fill('E2E 测试仓（已编辑）');
  await page.getByTestId('warehouse-edit-name-en').fill('E2E Test Warehouse Edited');
  await page.getByTestId('warehouse-edit-save').click();
  await expect(warehouseRow).toContainText('E2E Test Warehouse Edited');
  await expect(warehouseRow).toContainText('E2E 测试仓（已编辑）');
  const editOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(editOverflow).toBeLessThanOrEqual(1);
  await screenshot(page, `warehouse-edit-${testInfo.project.name}`);
  if (testInfo.project.name === 'real-desktop-1440') {
    await page.setViewportSize({ width: 430, height: 900 });
    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(mobileOverflow).toBeLessThanOrEqual(1);
    await screenshot(page, 'warehouse-edit-real-430');
    await page.setViewportSize({ width: 1440, height: 1000 });
  }

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

  // A second colour makes the drawer's independent per-SKU quantity controls real.
  await card.getByTestId('sku-new').click();
  await card.getByTestId('sku-code').fill(skuCode2);
  await card.getByTestId('sku-color-en').fill('Sand Tan');
  await card.getByTestId('sku-color-zh').fill('沙棕');
  await card.getByTestId('sku-price').fill('42.00');
  await card.getByTestId('sku-create-submit').click();
  await expect(card.getByTestId('sku-row').filter({ hasText: skuCode2 })).toBeVisible();

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
  await page.getByTestId('inventory-register-reason').fill('Initial physical count for real E2E');
  await page.getByTestId('inventory-register-submit').click();
  await expect(page.getByTestId('inventory-row').filter({ hasText: skuCode })).toBeVisible();

  await page.getByTestId('inventory-register-open').click();
  const skuSelect2 = page.getByTestId('inventory-register-sku');
  const skuValue2 = await skuSelect2
    .locator('option', { hasText: skuCode2 })
    .getAttribute('value');
  await skuSelect2.selectOption(skuValue2!);
  const warehouseSelect2 = page.getByTestId('inventory-register-warehouse');
  const warehouseValue2 = await warehouseSelect2
    .locator('option', { hasText: warehouseCode })
    .getAttribute('value');
  await warehouseSelect2.selectOption(warehouseValue2!);
  await page.getByTestId('inventory-register-onhand').fill('12');
  await page.getByTestId('inventory-register-reason').fill('Second colour stock for drawer E2E');
  await page.getByTestId('inventory-register-submit').click();
  await expect(page.getByTestId('inventory-row').filter({ hasText: skuCode2 })).toBeVisible();
  await screenshot(page, `inventory-${testInfo.project.name}`);

  await page.getByTestId('real-tab-import').click();
  await expect(page.getByTestId('import-template-guide')).toContainText('sku_code');
  await expect(page.getByTestId('import-template-warning')).toContainText('EXAMPLE-SKU');
  const templateDownloadPromise = page.waitForEvent('download');
  await page.getByTestId('import-template-download').click();
  const templateDownload = await templateDownloadPromise;
  const templatePath = path.join(testInfo.outputDir, 'inventory-template.csv');
  await templateDownload.saveAs(templatePath);
  const template = await readFile(templatePath, 'utf8');
  expect(template.split(/\r?\n/)[0]).toBe('sku_code,warehouse_code,on_hand,unsellable');
  expect(template).toContain('EXAMPLE-SKU,EXAMPLE-WH,100,0');
  const filledTemplate = template.replace(
    'EXAMPLE-SKU,EXAMPLE-WH,100,0',
    `${skuCode},${warehouseCode},25,2`
  );
  await page.getByTestId('import-file').setInputFiles({
    name: 'stock.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(filledTemplate),
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
  await expect(page.getByTestId('real-user-meta')).toContainText(customerUsername);
  await expect(page.getByTestId('real-user-meta')).not.toContainText(/C\d{6}/);
  await expect(page.getByTestId('real-catalog-cart-entry')).toHaveCount(0);
  await expect(page.getByTestId('real-tab-cart')).toBeVisible();
  await expect(page.getByTestId('cart-badge')).toBeVisible();
  const productCard = page.getByTestId('catalog-product-card').filter({ hasText: productTitle });
  await expect(productCard).toBeVisible({ timeout: 20_000 });
  await expect(productCard).toContainText('$38.00');
  await screenshot(page, `customer-catalog-${testInfo.project.name}`);

  // Keep a real filter active while the drawer opens and closes.
  const search = page.getByTestId('catalog-search');
  await search.fill(productCode);
  const seriesFilter = page.getByTestId('catalog-series-filter');
  const seriesValue = await seriesFilter
    .locator('option', { hasText: seriesName })
    .getAttribute('value');
  await seriesFilter.selectOption(seriesValue!);
  await expect(productCard).toBeVisible();
  const scrollBefore = await page.evaluate(() => window.scrollY);

  await productCard.click();
  const drawer = page.getByTestId('catalog-detail');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Add to cart');
  await expect(drawer).toContainText('Shared company cart');
  await expect(drawer).not.toContainText(/C\d{6}/);

  const viewport = page.viewportSize()!;
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox).not.toBeNull();
  if (viewport.width >= 640) {
    expect(drawerBox!.width).toBeGreaterThanOrEqual(480);
    expect(drawerBox!.width).toBeLessThanOrEqual(600);
    expect(drawerBox!.x).toBeGreaterThan(viewport.width / 2);
  } else {
    expect(drawerBox!.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect(drawerBox!.x).toBeLessThanOrEqual(1);
  }

  await expect(drawer.getByTestId('catalog-sku-row')).toHaveCount(2);
  const row1 = drawer.getByTestId('catalog-sku-row').filter({ hasText: skuCode });
  const row2 = drawer.getByTestId('catalog-sku-row').filter({ hasText: skuCode2 });
  await expect(row1).toBeVisible();
  await expect(row2).toBeVisible();
  const qty1 = row1.getByTestId('catalog-add-qty');
  const qty2 = row2.getByTestId('catalog-add-qty');

  // MOQ, stepper, direct input and damped wheel all stay on the shared field.
  await expect(qty1).toHaveValue('10');
  await row1.getByTestId('catalog-qty-decrease').click();
  await expect(qty1).toHaveValue('10');
  await row1.getByTestId('catalog-qty-increase').click();
  await expect(qty1).toHaveValue('11');
  await qty1.fill('12');
  await expect(qty1).toHaveValue('12');
  await qty1.hover();
  await page.mouse.wheel(0, 120);
  await expect(qty1).toHaveValue('13');

  // The stock upper bound is rejected before the cart API is called.
  await qty1.fill('24');
  await row1.getByTestId('catalog-add-submit').click();
  await expect(drawer.getByRole('alert')).toContainText('Only 23 PCS');
  await qty1.fill('12');
  await row1.getByTestId('catalog-add-submit').click();
  await expect(row1).toContainText('Added to the company shared cart');
  await expect(page.getByTestId('cart-badge-count')).toHaveText('12');

  // The second colour has its own draft and does not change the first.
  await expect(qty2).toHaveValue('10');
  await row2.getByTestId('catalog-qty-increase').click();
  await expect(qty2).toHaveValue('11');
  await qty2.fill('10');
  await row2.getByTestId('catalog-add-submit').click();
  await expect(page.getByTestId('cart-badge-count')).toHaveText('22');
  await expect(qty1).toHaveValue('12');

  await page.getByRole('button', { name: 'Shared cart and reservation details help' }).click();
  await expect(page.getByRole('tooltip')).toContainText(
    'shared by every account of your company'
  );
  await expect(drawer).toContainText('Matte Black');
  await screenshot(page, `customer-detail-${testInfo.project.name}`);

  await page.getByTestId('catalog-detail-close').click();
  await expect(drawer).toBeHidden();
  await expect(search).toHaveValue(productCode);
  await expect(seriesFilter).toHaveValue(seriesValue!);
  await expect(productCard).toBeVisible();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThanOrEqual(1);

  // Reopening resets drafts from the shared cart without losing the filter.
  await productCard.click();
  await expect(drawer).toBeVisible();
  await expect(qty1).toHaveValue('12');
  await expect(qty2).toHaveValue('10');

  if (!mobileProject) {
    for (const width of [375, 390, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(drawer).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);
      const box = await drawer.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(width + 1);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await screenshot(page, 'customer-detail-real-1440');
  }
  await page.getByTestId('catalog-detail-close').click();
  await expect(drawer).toBeHidden();
});

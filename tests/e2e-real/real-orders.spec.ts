import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openInternalSidebar, openInternalTab, waitForInternalWorkspace } from './internalNav';

const ADMIN_EMAIL = process.env.REAL_E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.REAL_E2E_ADMIN_PASSWORD ?? '';
const SALES_EMAIL = process.env.REAL_E2E_SALES_EMAIL ?? '';
const SALES_PASSWORD = process.env.REAL_E2E_SALES_PASSWORD ?? '';
const ORDER_USERNAME = process.env.REAL_E2E_ORDER_CUSTOMER_USERNAME ?? '';
const ORDER_TEMP_PASSWORD = process.env.REAL_E2E_ORDER_CUSTOMER_PASSWORD ?? '';
const ORDER_B_USERNAME = process.env.REAL_E2E_ORDER_CUSTOMER_B_USERNAME ?? '';
const ORDER_B_TEMP_PASSWORD = process.env.REAL_E2E_ORDER_CUSTOMER_B_PASSWORD ?? '';
const ORDER_USERNAME_MOBILE = process.env.REAL_E2E_ORDER_CUSTOMER_USERNAME_MOBILE ?? '';
const ORDER_TEMP_PASSWORD_MOBILE = process.env.REAL_E2E_ORDER_CUSTOMER_PASSWORD_MOBILE ?? '';
const ORDER_B_USERNAME_MOBILE = process.env.REAL_E2E_ORDER_CUSTOMER_B_USERNAME_MOBILE ?? '';
const ORDER_B_TEMP_PASSWORD_MOBILE = process.env.REAL_E2E_ORDER_CUSTOMER_B_PASSWORD_MOBILE ?? '';
const ORDER_PASSWORD = 'OrderCustomerPass123!Strong';
const IMAGE_FIXTURE = path.join(process.cwd(), 'tests/e2e-real/fixtures/product.png');

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function screenshot(page: Page, name: string): Promise<void> {
  if (process.env.REAL_E2E_SCREENSHOTS !== '1') return;
  const directory = path.join(process.cwd(), 'docs/ui-review/real-orders');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  await expect(page.getByTestId('real-auth-login')).toBeVisible();
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: /Sign in/ }).click();
}

async function changePasswordIfAsked(page: Page, oldPassword: string): Promise<boolean> {
  const changeScreen = page.getByTestId('real-auth-change-password');
  const visible = await changeScreen
    .waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return false;
  const inputs = page.locator('input[type="password"]');
  await inputs.nth(0).fill(oldPassword);
  await inputs.nth(1).fill(ORDER_PASSWORD);
  await inputs.nth(2).fill(ORDER_PASSWORD);
  await page.getByRole('button', { name: /Save password/ }).click();
  return true;
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page.getByTestId('real-auth-login')).toBeVisible();
}

test('customer A and B share a cart, submit a real order and the salesperson sees it pending', async ({
  page, request,
}, testInfo) => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'Real-auth admin credentials are required.');
  test.skip(!SALES_EMAIL || !SALES_PASSWORD, 'A real salesperson is required.');
  test.skip(!ORDER_USERNAME || !ORDER_TEMP_PASSWORD, 'An order customer is required.');
  test.skip(!ORDER_B_USERNAME || !ORDER_B_TEMP_PASSWORD, 'A second company account is required.');

  const mobile = testInfo.project.name.includes('mobile');
  const customerA = mobile ? ORDER_USERNAME_MOBILE : ORDER_USERNAME;
  const customerATemp = mobile ? ORDER_TEMP_PASSWORD_MOBILE : ORDER_TEMP_PASSWORD;
  const customerB = mobile ? ORDER_B_USERNAME_MOBILE : ORDER_B_USERNAME;
  const customerBTemp = mobile ? ORDER_B_TEMP_PASSWORD_MOBILE : ORDER_B_TEMP_PASSWORD;
  test.skip(!customerA || !customerATemp || !customerB || !customerBTemp, 'Customer credentials missing.');

  const unique = `${Date.now().toString().slice(-7)}${mobile ? '8' : '2'}`;
  const warehouseCode = `WH-ORD-${unique}`;
  const productCode = `ORD-${unique}`;
  const skuCode = `ORD-${unique}-BLK`;
  const productTitle = `Order Runtime Pack ${unique}`;
  const expectedDate = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  // Admin prepares a published product and real stock.
  await page.goto('/');
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await waitForInternalWorkspace(page);
  await openInternalTab(page, 'setup');
  await page.getByTestId('warehouse-code').fill(warehouseCode);
  await page.getByTestId('warehouse-name-zh').fill('订单测试仓');
  await page.getByTestId('warehouse-name-en').fill('Order Test Warehouse');
  await page.getByTestId('warehouse-create-submit').click();
  await expect(page.getByTestId('warehouse-row').filter({ hasText: warehouseCode })).toBeVisible();

  await openInternalTab(page, 'products');
  await page.getByTestId('product-new').click();
  await page.getByTestId('product-code').fill(productCode);
  await page.getByTestId('product-title-zh').fill('订单运行测试背包');
  await page.getByTestId('product-title-en').fill(productTitle);
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
  await card.getByTestId('sku-price').fill('42.00');
  await card.getByTestId('sku-create-submit').click();
  await expect(card.getByTestId('sku-row').filter({ hasText: skuCode })).toBeVisible();
  await card.getByTestId('product-publish').click();
  await expect(card.getByTestId('product-unpublish')).toBeVisible();

  await openInternalTab(page, 'inventory');
  await page.getByTestId('inventory-register-open').click();
  const skuSelect = page.getByTestId('inventory-register-sku');
  const skuValue = await skuSelect.locator('option', { hasText: skuCode }).getAttribute('value');
  await skuSelect.selectOption(skuValue!);
  const warehouseSelect = page.getByTestId('inventory-register-warehouse');
  const warehouseValue = await warehouseSelect
    .locator('option', { hasText: warehouseCode })
    .getAttribute('value');
  await warehouseSelect.selectOption(warehouseValue!);
  await page.getByTestId('inventory-register-onhand').fill('60');
  await page.getByTestId('inventory-register-reason').fill('Initial physical count for real E2E');
  await page.getByTestId('inventory-register-submit').click();
  await expect(page.getByTestId('inventory-row').filter({ hasText: skuCode })).toBeVisible();
  await signOut(page);

  // Customer A adds the SKU to the company shared cart.
  await signIn(page, customerA, customerATemp);
  await changePasswordIfAsked(page, customerATemp);
  await expect(page.getByTestId('catalog-search')).toBeVisible();
  await page.getByTestId('catalog-search').fill(productCode);
  const productCard = page.getByTestId('catalog-product-card').filter({ hasText: productTitle });
  await expect(productCard).toBeVisible({ timeout: 20_000 });
  await productCard.click();
  await expect(page.getByTestId('catalog-detail')).toBeVisible();
  const skuRow = page.getByTestId('catalog-sku-row').filter({ hasText: skuCode });
  await skuRow.getByTestId('catalog-add-qty').fill('10');
  await skuRow.getByTestId('catalog-add-submit').click();
  await expect(skuRow.getByText(/Added to the company shared cart/)).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('catalog-detail')).toBeHidden();
  await signOut(page);

  // Customer B sees the same company cart and changes the quantity.
  await signIn(page, customerB, customerBTemp);
  await changePasswordIfAsked(page, customerBTemp);
  await page.getByTestId('real-tab-cart').click();
  const cartItem = page.getByTestId('cart-item').filter({ hasText: skuCode });
  await expect(cartItem).toBeVisible({ timeout: 20_000 });
  await expect(cartItem.getByTestId('cart-quantity-input')).toHaveValue('10');
  await cartItem.getByTestId('cart-quantity-input').fill('12');
  await cartItem.getByTestId('cart-quantity-save').click();
  await expect(page.getByTestId('cart-pieces')).toContainText('12 PCS');
  await expect(page.getByTestId('cart-badge-count')).toHaveText('12');
  await expect(page.getByTestId('real-user-meta')).toContainText(customerB);
  await expect(page.getByTestId('real-user-meta')).not.toContainText(/C\d{6}/);
  await expectNoHorizontalOverflow(page);
  await screenshot(page, `shared-cart-${testInfo.project.name}`);
  if (!mobile) {
    const original = page.viewportSize();
    for (const width of [375, 430, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      await screenshot(page, `shared-cart-${width}`);
    }
    if (original) await page.setViewportSize(original);
  }
  await signOut(page);

  // Customer A submits the order and receives the real order number.
  await signIn(page, customerA, ORDER_PASSWORD);
  await page.getByTestId('real-tab-cart').click();
  const finalItem = page.getByTestId('cart-item').filter({ hasText: skuCode });
  await expect(finalItem.getByTestId('cart-quantity-input')).toHaveValue('12');
  await expect(page.locator('[data-testid="delivery-method"][data-method="Sea"]')).toHaveClass(
    /border-slate-900/
  );
  // Invalid free text cannot become a destination; the field is a select-only combobox.
  const country = page.getByTestId('delivery-country');
  const destinationError = page.getByText(
    'Select a valid destination country from the ISO alpha-3 list.'
  );
  const chooseUsa = async () => {
    await country.fill('USA');
    const option = page.getByRole('option').filter({ hasText: 'USA' }).first();
    if (mobile) await option.tap();
    else await option.click();
  };
  await country.fill('ZZZ');
  await page.getByTestId('cart-submit-open').click();
  await expect(destinationError).toBeVisible();
  await chooseUsa();
  const dateTrigger = page.getByTestId('delivery-date');
  const expectedDateObject = new Date(`${expectedDate}T00:00:00Z`);
  const expectedDisplay = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(expectedDateObject);
  const expectedMonth = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(expectedDateObject);
  const chooseExpectedDate = async () => {
    await dateTrigger.click();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if ((await page.getByTestId('delivery-date-month').innerText()) === expectedMonth) break;
      await page.getByTestId('delivery-date-next-month').click();
    }
    await page.getByTestId(`delivery-date-day-${expectedDate}`).click();
    await expect(dateTrigger).toHaveAttribute('data-value', expectedDate);
  };
  await chooseExpectedDate();
  await expect(page.getByTestId('delivery-date-display')).toHaveText(expectedDisplay);

  // Clear and re-select through the visible calendar.
  await dateTrigger.click();
  await page.getByTestId('delivery-date-clear').click();
  await expect(page.getByTestId('delivery-date-display')).toHaveText('Select date');
  await chooseExpectedDate();
  await expect(page.getByTestId('delivery-date-display')).toHaveText(expectedDisplay);

  // An abandoned search must clear the saved USA instead of silently reusing it.
  await country.fill('ZZZ');
  await page.getByTestId('cart-submit-open').click();
  await expect(destinationError).toBeVisible();
  await expect(page.getByTestId('cart-submit-confirm')).toHaveCount(0);
  await expect(country).toHaveValue('');
  await chooseUsa();
  await expect(country).toHaveValue(/USA/);

  // Blur also abandons the query and requires an explicit new selection.
  await country.fill('ZZZ');
  await page.getByTestId('delivery-requirements').click();
  await expect(country).toHaveValue('');
  await chooseUsa();

  // A valid saved selection wins over the Sea fallback across a reload.
  await page.locator('[data-testid="delivery-method"][data-method="Air"]').click();
  await page.reload();
  await page.getByTestId('real-tab-cart').click();
  await expect(page.locator('[data-testid="delivery-method"][data-method="Air"]')).toHaveClass(
    /border-slate-900/
  );
  await expect(country).toHaveValue(/USA/);
  await expect(page.getByTestId('delivery-date')).toHaveAttribute('data-value', expectedDate);
  await page.locator('[data-testid="delivery-method"][data-method="Sea"]').click();
  await page
    .getByTestId('delivery-requirements')
    .fill('Fumigation-free pallet with AOKING shipping marks.');
  await page.getByTestId('cart-submit-open').click();
  await expect(page.getByTestId('cart-submit-confirm')).toBeVisible();
  await page.getByTestId('cart-submit-confirm-button').click();
  await expect(page.getByTestId('cart-success')).toBeVisible({ timeout: 20_000 });
  const orderNo = (await page.getByTestId('success-order-no').innerText()).trim();
  expect(orderNo).toMatch(/^OD[0-9]{10}$/);
  await expect(page.getByTestId('success-pcs')).toContainText('12 PCS');
  await expect(page.getByTestId('success-total')).toContainText('$504.00');
  await expectNoHorizontalOverflow(page);
  await screenshot(page, `order-success-${testInfo.project.name}`);
  await signOut(page);

  // Customer B can see the company order from their own account.
  await signIn(page, customerB, ORDER_PASSWORD);
  await page.getByTestId('real-tab-orders').click();
  const customerOrder = page
    .getByTestId('customer-order-card')
    .filter({ hasText: orderNo });
  await expect(customerOrder).toBeVisible({ timeout: 20_000 });
  await customerOrder.click();
  await expect(page.getByTestId('order-detail')).toContainText(orderNo);
  await expect(page.getByTestId('order-detail')).toContainText('Reference');
  await page.getByTestId('order-line-qty').fill('14');
  await page.getByTestId('order-modify-save').click();
  await expect(page.getByTestId('order-detail')).toContainText('$588.00');
  await expectNoHorizontalOverflow(page);
  await screenshot(page, `customer-orders-${testInfo.project.name}`);
  await signOut(page);

  // The assigned salesperson sees the pending order and confirmation is disabled.
  await signIn(page, SALES_EMAIL, SALES_PASSWORD);
  await openInternalTab(page, 'orders');
  await expect(page.getByTestId('real-tab-orders')).toHaveAttribute('aria-current', 'page');
  const internalOrder = page.getByTestId('internal-order-card').filter({ hasText: orderNo });
  await expect(internalOrder).toBeVisible({ timeout: 20_000 });
  await internalOrder.click();
  const salesDrawer = page.getByTestId('order-detail-drawer');
  await expect(salesDrawer).toBeVisible();
  await expect(salesDrawer.getByTestId('order-detail')).toContainText(orderNo);
  await expect(salesDrawer.getByTestId('order-detail')).toContainText('Reference');
  await expect(salesDrawer.getByTestId('sales-confirm-disabled')).toBeVisible();
  await expect(salesDrawer.getByTestId('sales-confirm-disabled')).toContainText('Phase 4B-05');
  await expect(page.getByTestId('order-detail')).toHaveCount(1);
  if (mobile) {
    const drawerBox = await salesDrawer.boundingBox();
    const viewport = page.viewportSize()!;
    expect(drawerBox).not.toBeNull();
    expect(drawerBox!.width).toBeGreaterThanOrEqual(viewport.width - 1);
  }
  if (
    testInfo.project.name === 'real-desktop-1440' &&
    process.env.REAL_E2E_SCREENSHOTS === '1'
  ) {
    const directory = path.join(process.cwd(), 'docs/ui-review/real-admin-shell');
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: path.join(directory, 'sales-orders-1440.png'),
      fullPage: true,
    });
  }

  // Real internal order language mode + shared status badge vocabulary.
  // The modal drawer blocks the topbar, so close and reopen around each toggle.
  await expect(
    salesDrawer.getByTestId('order-detail').locator('[data-order-status="PENDING_CONFIRMATION"]')
  ).toHaveText('Pending confirmation');
  await page.getByTestId('order-drawer-close').click();
  await expect(salesDrawer).toBeHidden();
  await expect(page.getByTestId('order-detail')).toHaveCount(0);
  await expect(internalOrder).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-order-no')))
    .toBe(orderNo);

  await page.getByTestId('internal-language-toggle').getByRole('button', { name: '中文' }).click();
  await internalOrder.click();
  await expect(
    salesDrawer.getByTestId('order-detail').locator('[data-order-status="PENDING_CONFIRMATION"]')
  ).toHaveText('待确认');
  await page.getByTestId('order-drawer-close').click();
  await expect(salesDrawer).toBeHidden();
  await page
    .getByTestId('internal-language-toggle')
    .getByRole('button', { name: 'EN' })
    .click();
  await internalOrder.click();
  await expect(
    salesDrawer.getByTestId('order-detail').locator('[data-order-status="PENDING_CONFIRMATION"]')
  ).toHaveText('Pending confirmation');
  await page.getByTestId('order-drawer-close').click();
  await expect(salesDrawer).toBeHidden();

  // The global toggle applies across sales pages without losing the active tab.
  await page.getByTestId('internal-language-toggle').getByRole('button', { name: '中文' }).click();
  await openInternalSidebar(page);
  await expect(page.getByTestId('real-tab-inventory')).toContainText('库存');
  await openInternalTab(page, 'inventory');
  await expect(
    page.getByText('只读库存视图。业务员不能调整数量或预占库存。')
  ).toBeVisible();
  await openInternalTab(page, 'orders');
  await expect(page.getByTestId('real-tab-orders')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('待确认订单', { exact: true })).toBeVisible();
  await page.getByTestId('internal-language-toggle').getByRole('button', { name: 'EN' }).click();
  await expect(page.getByText('Pending orders', { exact: true })).toBeVisible();
  if (!mobile) {
    await page.setViewportSize({ width: 430, height: 900 });
    await expectNoHorizontalOverflow(page);
    await screenshot(page, 'sales-pending-orders-real-430');
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await expectNoHorizontalOverflow(page);
  await screenshot(page, `sales-pending-orders-${testInfo.project.name}`);
  await signOut(page);

  // Customer B can cancel a pending order; the same company sees the final state.
  await signIn(page, customerB, ORDER_PASSWORD);
  await page.getByTestId('real-tab-orders').click();
  const cancelTarget = page.getByTestId('customer-order-card').filter({ hasText: orderNo });
  await expect(cancelTarget).toBeVisible({ timeout: 20_000 });
  await cancelTarget.click();
  await page.getByTestId('order-cancel-open').click();
  await page.getByTestId('order-cancel-reason').fill('Schedule changed before confirmation.');
  await page.getByTestId('order-cancel-confirm').click();
  await expect(page.getByTestId('order-detail')).toContainText('Cancelled');
  await expectNoHorizontalOverflow(page);
  await screenshot(page, `customer-orders-cancelled-${testInfo.project.name}`);

  // Keep the customer's browser session open while an independent administrator
  // withdraws access. A fresh server DTO must replace the previously visible data.
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const session = await (await page.request.get('/api/auth/session')).json();
  const companyId = session.user.companyId as string;
  const token = (await (await page.request.get('/api/auth/csrf')).json()).csrfToken;
  const beforeCart = (await (await page.request.get('/api/cart')).json()).cart;
  expect((await page.request.put(`/api/cart/items/${skuValue}`, {
    headers: { 'X-CSRF-Token': token }, data: { quantity: 10, expectedRevision: beforeCart.revision },
  })).status()).toBe(200);
  await page.reload();
  await page.getByTestId('real-tab-cart').click();
  await expect(page.getByTestId('cart-item')).toContainText(skuCode);
  const adminToken = (await (await request.get('/api/auth/csrf')).json()).csrfToken;
  expect((await request.post('/api/auth/login', {
    headers: { 'X-CSRF-Token': adminToken }, data: { username: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })).status()).toBe(200);
  const grantUrl = `/api/admin/companies/${companyId}/brands/brand-aoking`;
  const grant = async (granted: boolean) => {
    expect((await request.put(grantUrl, {
      headers: { 'X-CSRF-Token': adminToken }, data: { granted },
    })).status()).toBe(200);
  };
  await grant(false);
  await page.reload();
  await page.getByTestId('real-tab-cart').click();
  const restricted = page.getByTestId('cart-item');
  await expect(restricted).toContainText('Unavailable item');
  await expect(restricted).toContainText('10 PCS');
  await expect(restricted).not.toContainText(skuCode);
  await expect(restricted).not.toContainText('$');
  await expect(restricted.locator('img')).toHaveCount(0);
  await expect(restricted.getByTestId('cart-quantity-input')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  if (process.env.ISSUE11_SCREENSHOT_DIR) {
    await mkdir(process.env.ISSUE11_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.ISSUE11_SCREENSHOT_DIR, `restricted-${testInfo.project.name}.png`), fullPage: true });
  }
  await grant(true);
  await page.reload();
  await page.getByTestId('real-tab-cart').click();
  await expect(page.getByTestId('cart-item')).toContainText(skuCode);
  await expect(page.getByTestId('cart-item')).toContainText('$42.00');
  await grant(false);
  await page.reload();
  await page.getByTestId('real-tab-cart').click();
  await page.getByRole('button', { name: 'Remove unavailable item' }).click();
  await expect(page.getByTestId('cart-empty')).toBeVisible();
  await grant(true);
  expect(errors).toEqual([]);

  // Administrator order/customer drawers share one right-side container.
  await signOut(page);
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openInternalTab(page, 'orders');
  const adminOrder = page.getByTestId('internal-order-card').filter({ hasText: orderNo });
  await expect(adminOrder).toBeVisible({ timeout: 20_000 });
  const customerLink = adminOrder.getByTestId('admin-order-customer-link');
  const companyCode = await customerLink.getAttribute('data-company-code');
  expect(companyCode).toMatch(/^C[0-9]{6}$/);

  await adminOrder.click();
  const orderDrawer = page.getByTestId('order-detail-drawer');
  await expect(orderDrawer).toBeVisible();
  await expect(orderDrawer).toContainText(orderNo);
  await expect(orderDrawer).toContainText('Reference');
  await expect(orderDrawer).toContainText('Cancelled');
  await expect(orderDrawer).toContainText('Administrator supervision is read-only');
  await expect(orderDrawer.getByTestId('sales-confirm-disabled')).toHaveCount(0);
  const orderBox = await orderDrawer.boundingBox();
  const viewport = page.viewportSize()!;
  expect(orderBox).not.toBeNull();
  if (viewport.width >= 640) {
    expect(orderBox!.width).toBeGreaterThanOrEqual(480);
    expect(orderBox!.width).toBeLessThanOrEqual(600);
    expect(orderBox!.x).toBeGreaterThan(viewport.width / 2);
  } else {
    expect(orderBox!.width).toBeGreaterThanOrEqual(viewport.width - 1);
  }
  await screenshot(page, `admin-order-drawer-${testInfo.project.name}`);

  await page.getByTestId('order-drawer-close').click();
  await expect(orderDrawer).toBeHidden();
  expect(
    await page.evaluate(() => document.activeElement?.getAttribute('data-order-no'))
  ).toBe(orderNo);

  // The list customer chip opens Customer Details without opening a second drawer.
  await customerLink.click();
  const customerDrawer = page.getByTestId('customer-detail-drawer');
  await expect(customerDrawer).toBeVisible();
  await expect(orderDrawer).toHaveCount(0);
  await expect(customerDrawer.getByTestId('customer-detail')).toContainText(companyCode!);
  await expect(customerDrawer.getByTestId('customer-detail')).toContainText('USA');
  await expect(customerDrawer.getByTestId('customer-detail-order')).toContainText(orderNo);
  await expect(customerDrawer.getByTestId('customer-detail-order')).toContainText(
    customerA
  );
  await expect(customerDrawer.getByTestId('customer-detail-salesperson')).toContainText(
    'E2E Sales'
  );
  await screenshot(page, `admin-customer-drawer-${testInfo.project.name}`);

  if (!mobile) {
    for (const width of [375, 390, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(customerDrawer).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);
      const box = await customerDrawer.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(width + 1);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  } else {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }

  await customerDrawer.getByTestId('customer-detail-back').click();
  await expect(page.getByTestId('order-detail-drawer')).toContainText(orderNo);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('order-detail-drawer')).toBeHidden();

  // The mobile sidebar and the business drawer share the shell cleanly.
  if (mobile) {
    await page.getByTestId('internal-nav-open').click();
    await expect(page.getByTestId('real-sidebar')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('real-sidebar')).toBeHidden();
  }
});

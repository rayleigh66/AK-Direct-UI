import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { openInternalSidebar, openInternalTab, waitForInternalWorkspace } from './internalNav';

const ADMIN_EMAIL = process.env.REAL_E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.REAL_E2E_ADMIN_PASSWORD ?? '';
const SALES_EMAIL = process.env.REAL_E2E_SALES_EMAIL ?? '';
const SALES_PASSWORD = process.env.REAL_E2E_SALES_PASSWORD ?? '';
const BUSINESS_EMAIL = process.env.REAL_E2E_BUSINESS_ADMIN_EMAIL ?? '';
const BUSINESS_PASSWORD = process.env.REAL_E2E_BUSINESS_ADMIN_PASSWORD ?? '';
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

async function changePasswordIfAsked(page: Page, oldPassword: string): Promise<void> {
  const changeScreen = page.getByTestId('real-auth-change-password');
  const visible = await changeScreen
    .waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return;
  const inputs = page.locator('input[type="password"]');
  await inputs.nth(0).fill(oldPassword);
  await inputs.nth(1).fill(ORDER_PASSWORD);
  await inputs.nth(2).fill(ORDER_PASSWORD);
  await page.getByRole('button', { name: /Save password/ }).click();
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page.getByTestId('real-auth-login')).toBeVisible();
}

async function apiLogin(
  request: APIRequestContext,
  username: string,
  password: string
): Promise<string> {
  const csrfResponse = await request.get('/api/auth/csrf');
  expect(csrfResponse.status()).toBe(200);
  const csrfToken = (await csrfResponse.json()).csrfToken as string;
  const login = await request.post('/api/auth/login', {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { username, password },
  });
  expect(login.status()).toBe(200);
  return csrfToken;
}

async function apiJson<T>(
  request: APIRequestContext,
  csrfToken: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  url: string,
  data?: unknown
): Promise<T> {
  const response = await request.fetch(url, {
    method,
    headers: data === undefined ? {} : { 'X-CSRF-Token': csrfToken },
    data,
  });
  if (response.status() >= 400) {
    throw new Error(`${method} ${url}: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

test('business_admin manages buyer authority, then price approval → buyer acceptance → two-warehouse confirmation → extension → approved release', async ({
  page, request,
}, testInfo) => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'Real-auth admin credentials are required.');
  test.skip(!SALES_EMAIL || !SALES_PASSWORD, 'A real salesperson is required.');
  test.skip(!BUSINESS_EMAIL || !BUSINESS_PASSWORD, 'A real business administrator is required.');

  const mobile = testInfo.project.name.includes('mobile');
  const unique = `${Date.now().toString().slice(-7)}${mobile ? '4' : '1'}`;
  const customerCode = `C${String(Number(unique) % 1_000_000).padStart(6, '0')}`;
  const customerShortName = `Confirmation E2E ${unique}`;
  const warehouse1Code = `WH-CNF1-${unique}`;
  const warehouse2Code = `WH-CNF2-${unique}`;
  const productCode = `CNF-${unique}`;
  const skuCode = `CNF-${unique}-BLK`;
  const productTitle = `Confirmation Runtime Pack ${unique}`;
  const expectedDate = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  // --- API setup: isolated customer, two warehouses, product and order ------
  const adminCsrf = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
  const salesUsers = await apiJson<{ users: Array<{ id: string; email: string }> }>(
    request,
    adminCsrf,
    'GET',
    '/api/admin/sales-users'
  );
  const salesUserId = salesUsers.users.find(user => user.email === SALES_EMAIL)?.id;
  expect(salesUserId, 'The E2E salesperson must exist').toBeTruthy();
  const createdCompany = await apiJson<{
    company: { id: string };
    primaryUsername: string;
    temporaryPassword: string;
  }>(request, adminCsrf, 'POST', '/api/admin/companies', {
    customerCode,
    shortName: customerShortName,
    countryAlpha3: 'USA',
    assignedSalesUserId: salesUserId,
    brandIds: ['brand-aoking'],
  });
  const customerUsername = createdCompany.primaryUsername;
  const customerTemporaryPassword = createdCompany.temporaryPassword;

  const warehouse1 = await apiJson<{ warehouse: { id: string } }>(
    request,
    adminCsrf,
    'POST',
    '/api/admin/warehouses',
    { code: warehouse1Code, name: '确认测试仓一', nameEn: 'Confirmation Warehouse 1' }
  );
  const warehouse2 = await apiJson<{ warehouse: { id: string } }>(
    request,
    adminCsrf,
    'POST',
    '/api/admin/warehouses',
    { code: warehouse2Code, name: '确认测试仓二', nameEn: 'Confirmation Warehouse 2' }
  );
  const product = await apiJson<{ product: { id: string } }>(
    request,
    adminCsrf,
    'POST',
    '/api/admin/catalog/products',
    {
      brandId: 'brand-aoking',
      productCode,
      title: '确认运行测试背包',
      titleEn: productTitle,
      descriptionEn: 'Confirmation flow product',
      category: 'Business Backpacks',
      material: 'Polyester',
      capacityOrSize: '20L',
    }
  );
  const productId = product.product.id;
  const imageResponse = await request.post(
    `/api/admin/catalog/products/${productId}/images`,
    {
      headers: { 'X-CSRF-Token': adminCsrf, 'Content-Type': 'image/png' },
      data: await readFile(IMAGE_FIXTURE),
    }
  );
  expect(imageResponse.status()).toBe(201);
  const sku = await apiJson<{ sku: { id: string } }>(
    request,
    adminCsrf,
    'POST',
    `/api/admin/catalog/products/${productId}/skus`,
    {
      skuCode,
      colorName: '哑光黑',
      colorNameEn: 'Matte Black',
      colorHex: '#1c1c1e',
      basePriceCents: 4200,
      initialInventory: {
        warehouseId: warehouse1.warehouse.id,
        onHand: 100,
        unsellable: 0,
      },
    }
  );
  const skuId = sku.sku.id;
  await apiJson(request, adminCsrf, 'POST', '/api/admin/inventory/register', {
    skuId,
    warehouseId: warehouse2.warehouse.id,
    onHand: 40,
    unsellable: 0,
    reason: 'Second warehouse for the confirmation E2E',
  });
  await apiJson(request, adminCsrf, 'POST', `/api/admin/catalog/products/${productId}/publish`, {});

  // This test owns its customer account, so first-login password change cannot
  // disturb the shared accounts used by the older real-orders suite.
  const customerCsrf = await apiLogin(request, customerUsername, customerTemporaryPassword);
  await apiJson(request, customerCsrf, 'POST', '/api/auth/change-password', {
    currentPassword: customerTemporaryPassword,
    newPassword: ORDER_PASSWORD,
  });
  const cart = await apiJson<{ cart: { revision: number } }>(
    request,
    customerCsrf,
    'GET',
    '/api/cart'
  );
  await apiJson(request, customerCsrf, 'PUT', `/api/cart/items/${skuId}`, {
    quantity: 20,
    expectedRevision: cart.cart.revision,
  });
  const submitted = await apiJson<{ order: { id: string; orderNo: string; revision: number } }>(
    request,
    customerCsrf,
    'POST',
    '/api/orders',
    {
      idempotencyKey: `e2e-confirm-${unique}`,
      expectedCartRevision: cart.cart.revision + 1,
      shippingMethod: 'Sea',
      destinationCountryAlpha3: 'USA',
      expectedShipDate: expectedDate,
      shippingRequirements: 'Confirmation E2E cartons.',
    }
  );
  const orderNo = submitted.order.orderNo;

  // --- Business administrator: confirmer management is a real UI entry -----
  await page.goto('/');
  await signIn(page, BUSINESS_EMAIL, BUSINESS_PASSWORD);
  await waitForInternalWorkspace(page);
  await openInternalTab(page, 'approvals');
  const companySelect = page.getByTestId('confirmer-company');
  await expect(companySelect).toBeVisible({ timeout: 20_000 });
  const companyOption = companySelect.locator('option', { hasText: customerCode });
  await expect(companyOption).toHaveCount(1, { timeout: 20_000 });
  await companySelect.selectOption((await companyOption.getAttribute('value'))!);
  const accountRow = page
    .getByTestId('confirmer-account')
    .filter({ hasText: customerUsername });
  await expect(accountRow).toBeVisible();
  // Grant -> revoke -> re-grant, all through the business-admin UI.
  await expect(accountRow.getByTestId('confirmer-grant')).toBeVisible();
  await accountRow.getByTestId('confirmer-grant').click();
  await expect(accountRow.getByTestId('confirmer-revoke')).toBeVisible({ timeout: 20_000 });
  await accountRow.getByTestId('confirmer-revoke').click();
  await expect(accountRow.getByTestId('confirmer-grant')).toBeVisible({ timeout: 20_000 });
  await accountRow.getByTestId('confirmer-grant').click();
  await expect(accountRow.getByTestId('confirmer-revoke')).toBeVisible({ timeout: 20_000 });
  await screenshot(page, `approvals-confirmers-${testInfo.project.name}`);
  await expectNoHorizontalOverflow(page);
  await signOut(page);

  // --- Salesperson builds a changed-price plan -----------------------------
  await signIn(page, SALES_EMAIL, SALES_PASSWORD);
  await openInternalTab(page, 'orders');
  const salesOrder = page.getByTestId('internal-order-card').filter({ hasText: orderNo });
  await expect(salesOrder).toBeVisible({ timeout: 20_000 });
  await salesOrder.click();
  const salesDrawer = page.getByTestId('order-detail-drawer');
  await expect(salesDrawer.getByTestId('sales-plan-editor')).toBeVisible();
  await salesDrawer.getByTestId(`plan-price-${skuCode}`).fill('41.00');
  await salesDrawer.getByTestId(`plan-qty-${skuCode}`).fill('20');
  await salesDrawer.getByTestId('sales-plan-save').click();
  await expect(salesDrawer.getByTestId('order-plan')).toContainText('PENDING');
  await screenshot(page, `sales-plan-pending-${testInfo.project.name}`);
  await page.getByTestId('order-drawer-close').click();
  await signOut(page);

  // --- Business administrator approves the price change -------------------
  await signIn(page, BUSINESS_EMAIL, BUSINESS_PASSWORD);
  await openInternalTab(page, 'approvals');
  await page.getByTestId('approval-tab-price').click();
  const priceRow = page.getByTestId('approval-row').filter({ hasText: orderNo });
  await expect(priceRow).toBeVisible({ timeout: 20_000 });
  await priceRow.click();
  await expect(page.getByTestId('approval-detail')).toContainText(orderNo);
  await page.getByTestId('approval-note').fill('E2E price approval');
  await page.getByTestId('approval-approve').click();
  await expect(page.getByTestId('approval-detail-drawer')).toBeHidden();
  await signOut(page);

  // --- Customer accepts the approved plan ----------------------------------
  await signIn(page, customerUsername, ORDER_PASSWORD);
  await page.getByTestId('real-tab-orders').click();
  const customerOrder = page.getByTestId('customer-order-card').filter({ hasText: orderNo });
  await expect(customerOrder).toBeVisible({ timeout: 20_000 });
  await customerOrder.click();
  await expect(page.getByTestId('order-plan')).toBeVisible();
  await expect(page.getByTestId('order-plan-accept')).toBeVisible();
  await page.getByTestId('order-plan-accept').click();
  await expect(page.getByTestId('order-plan')).toContainText('ACCEPTED');
  await screenshot(page, `customer-plan-accepted-${testInfo.project.name}`);
  await signOut(page);

  // --- Salesperson confirms with a warehouse allocation --------------------
  await signIn(page, SALES_EMAIL, SALES_PASSWORD);
  await openInternalTab(page, 'orders');
  const confirmOrderCard = page.getByTestId('internal-order-card').filter({ hasText: orderNo });
  await confirmOrderCard.click();
  const confirmDrawer = page.getByTestId('order-detail-drawer');
  await expect(confirmDrawer.getByTestId('sales-confirm')).toBeVisible({ timeout: 20_000 });
  const warehouseSelect = confirmDrawer.getByTestId(`alloc-warehouse-${skuCode}-0`);
  const warehouseValue = await warehouseSelect
    .locator('option', { hasText: warehouse1Code })
    .getAttribute('value');
  await warehouseSelect.selectOption(warehouseValue!);
  await confirmDrawer.getByTestId(`alloc-qty-${skuCode}-0`).fill('12');
  await confirmDrawer.getByTestId(`alloc-add-${skuCode}`).click();
  const warehouse2Select = confirmDrawer.getByTestId(`alloc-warehouse-${skuCode}-1`);
  const warehouse2Value = await warehouse2Select
    .locator('option', { hasText: warehouse2Code })
    .getAttribute('value');
  await warehouse2Select.selectOption(warehouse2Value!);
  await confirmDrawer.getByTestId(`alloc-qty-${skuCode}-1`).fill('8');
  await confirmDrawer.getByTestId('sales-confirm-submit').click();
  await expect(confirmDrawer.getByTestId('order-confirmation')).toBeVisible({ timeout: 20_000 });
  await expect(confirmDrawer.getByTestId('reservation-status')).toHaveText('ACTIVE');
  await screenshot(page, `sales-confirmed-${testInfo.project.name}`);
  await expectNoHorizontalOverflow(page);

  // --- Salesperson requests an extension ----------------------------------
  await confirmDrawer.getByTestId('extension-hours').fill('24');
  // A missing reason must produce a visible in-drawer error, not a silent API
  // call. Then the corrected form succeeds and the notice is visible.
  await confirmDrawer.getByTestId('extension-submit').click();
  await expect(confirmDrawer.getByTestId('order-drawer-error')).toBeVisible();
  await confirmDrawer.getByTestId('extension-reason').fill('E2E extension request');
  await confirmDrawer.getByTestId('extension-submit').click();
  await expect(confirmDrawer.getByTestId('order-drawer-notice')).toBeVisible();
  await expect(confirmDrawer.getByTestId('order-drawer-notice')).toContainText(
    'Extension request submitted'
  );
  await page.getByTestId('order-drawer-close').click();
  await signOut(page);

  // --- Business administrator approves the extension ----------------------
  await signIn(page, BUSINESS_EMAIL, BUSINESS_PASSWORD);
  await openInternalTab(page, 'approvals');
  await page.getByTestId('approval-tab-extension').click();
  const extensionRow = page.getByTestId('approval-row').filter({ hasText: orderNo });
  await expect(extensionRow).toBeVisible({ timeout: 20_000 });
  await extensionRow.click();
  await page.getByTestId('approval-approve').click();
  await expect(page.getByTestId('approval-detail-drawer')).toBeHidden();
  await signOut(page);

  // --- Salesperson requests a verified full release -----------------------
  await signIn(page, SALES_EMAIL, SALES_PASSWORD);
  await openInternalTab(page, 'orders');
  const releaseOrderCard = page.getByTestId('internal-order-card').filter({ hasText: orderNo });
  await releaseOrderCard.click();
  const releaseDrawer = page.getByTestId('order-detail-drawer');
  await expect(releaseDrawer.getByTestId('sales-reservation-actions')).toBeVisible();
  await releaseDrawer.getByTestId('release-reason').fill('E2E verified cancellation');
  await releaseDrawer
    .getByTestId('release-verification-note')
    .fill('Checked unpaid ledger and not-shipped warehouse log');
  // The explicit unpaid / not-shipped affirmations are required.
  await releaseDrawer.getByTestId('release-submit').click();
  await expect(releaseDrawer.getByTestId('order-drawer-error')).toBeVisible();
  await releaseDrawer.getByTestId('release-verify-unpaid').check();
  await releaseDrawer.getByTestId('release-verify-not-shipped').check();
  await releaseDrawer.getByTestId('release-submit').click();
  await expect(releaseDrawer.getByTestId('order-drawer-notice')).toBeVisible();
  await expect(releaseDrawer.getByTestId('order-drawer-notice')).toContainText(
    'Release request submitted'
  );
  await page.getByTestId('order-drawer-close').click();
  await signOut(page);

  // --- Business administrator approves the release ------------------------
  await signIn(page, BUSINESS_EMAIL, BUSINESS_PASSWORD);
  await openInternalTab(page, 'approvals');
  await page.getByTestId('approval-tab-release').click();
  const releaseRow = page.getByTestId('approval-row').filter({ hasText: orderNo });
  await expect(releaseRow).toBeVisible({ timeout: 20_000 });
  await releaseRow.click();
  await page.getByTestId('approval-approve').click();
  await expect(page.getByTestId('approval-detail-drawer')).toBeHidden();
  await signOut(page);

  // --- Customer sees the confirmed-then-cancelled final state -------------
  await signIn(page, customerUsername, ORDER_PASSWORD);
  await page.getByTestId('real-tab-orders').click();
  const cancelledOrder = page.getByTestId('customer-order-card').filter({ hasText: orderNo });
  await expect(cancelledOrder).toBeVisible({ timeout: 20_000 });
  await cancelledOrder.click();
  await expect(page.getByTestId('order-detail')).toContainText('Cancelled');
  await expect(page.getByTestId('order-confirmation')).toContainText('RELEASED');
  await screenshot(page, `customer-released-${testInfo.project.name}`);
  await expectNoHorizontalOverflow(page);
  await signOut(page);

  // Mobile navigation remains usable in the approval workspace.
  if (mobile) {
    await signIn(page, BUSINESS_EMAIL, BUSINESS_PASSWORD);
    await page.getByTestId('internal-nav-open').click();
    await expect(page.getByTestId('real-sidebar')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('real-sidebar')).toBeHidden();
  }
  void openInternalSidebar;
});

test('ordinary buyer accounts cannot accept and revocation forces a fresh buyer acceptance', async ({
  page,
  request,
}, testInfo) => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'Real-auth admin credentials are required.');
  test.skip(!SALES_EMAIL || !SALES_PASSWORD, 'A real salesperson is required.');
  test.skip(!BUSINESS_EMAIL || !BUSINESS_PASSWORD, 'A real business administrator is required.');

  const mobile = testInfo.project.name.includes('mobile');
  const unique = `${Date.now().toString().slice(-7)}${mobile ? '6' : '2'}`;
  const customerCode = `C${String(Number(unique) % 1_000_000).padStart(6, '0')}`;
  const warehouseCode = `WH-CNF-${unique}`;
  const productCode = `CNFR-${unique}`;
  const skuCode = `CNFR-${unique}-BLK`;
  const expectedDate = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  // This test owns its company and both accounts, so its first-login password
  // changes cannot disturb the shared accounts used by the 4B-04 suites.
  const adminCsrf = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
  const salesUsers = await apiJson<{ users: Array<{ id: string; email: string }> }>(
    request,
    adminCsrf,
    'GET',
    '/api/admin/sales-users'
  );
  const salesUserId = salesUsers.users.find(user => user.email === SALES_EMAIL)?.id;
  expect(salesUserId, 'The E2E salesperson must exist').toBeTruthy();
  const createdCompany = await apiJson<{
    company: { id: string };
    primaryUsername: string;
    temporaryPassword: string;
  }>(request, adminCsrf, 'POST', '/api/admin/companies', {
    customerCode,
    shortName: `Revocation E2E ${unique}`,
    countryAlpha3: 'USA',
    assignedSalesUserId: salesUserId,
    brandIds: ['brand-aoking'],
  });
  const orderCompanyId = createdCompany.company.id;
  const customerUsername = createdCompany.primaryUsername;
  const customerTempPassword = createdCompany.temporaryPassword;
  const subaccount = await apiJson<{ username: string; temporaryPassword: string }>(
    request,
    adminCsrf,
    'POST',
    `/api/admin/companies/${orderCompanyId}/accounts`,
    {}
  );
  const ordinaryUsername = subaccount.username;
  const ordinaryTempPassword = subaccount.temporaryPassword;
  const companyCode = customerCode;
  const confirmerCompanies = await apiJson<{
    companies: Array<{
      companyId: string;
      customerCode: string;
      accounts: Array<{ customerUserId: string; username: string }>;
    }>;
  }>(request, adminCsrf, 'GET', '/api/admin/buyer-confirmation-accounts');
  const ownedCompany = confirmerCompanies.companies.find(
    company => company.customerCode === customerCode
  );
  const authorizedAccount = ownedCompany?.accounts.find(
    account => account.username === customerUsername
  );
  expect(authorizedAccount, 'The primary account must exist').toBeTruthy();
  await apiJson(
    request,
    adminCsrf,
    'POST',
    `/api/admin/companies/${ownedCompany!.companyId}/buyer-authorizations`,
    {
      customerUserId: authorizedAccount!.customerUserId,
      idempotencyKey: `e2e-grant-${unique}`,
    }
  );
  const warehouse = await apiJson<{ warehouse: { id: string } }>(
    request,
    adminCsrf,
    'POST',
    '/api/admin/warehouses',
    { code: warehouseCode, name: '认可测试仓', nameEn: 'Acceptance Warehouse' }
  );
  const product = await apiJson<{ product: { id: string } }>(
    request,
    adminCsrf,
    'POST',
    '/api/admin/catalog/products',
    {
      brandId: 'brand-aoking',
      productCode,
      title: '认可撤销测试背包',
      titleEn: `Acceptance Revocation Pack ${unique}`,
      descriptionEn: 'Ordinary buyer and revocation E2E product',
      category: 'Business Backpacks',
      material: 'Polyester',
      capacityOrSize: '20L',
    }
  );
  const productId = product.product.id;
  const imageResponse = await request.post(
    `/api/admin/catalog/products/${productId}/images`,
    {
      headers: { 'X-CSRF-Token': adminCsrf, 'Content-Type': 'image/png' },
      data: await readFile(IMAGE_FIXTURE),
    }
  );
  expect(imageResponse.status()).toBe(201);
  const sku = await apiJson<{ sku: { id: string } }>(
    request,
    adminCsrf,
    'POST',
    `/api/admin/catalog/products/${productId}/skus`,
    {
      skuCode,
      colorName: '哑光黑',
      colorNameEn: 'Matte Black',
      colorHex: '#1c1c1e',
      basePriceCents: 4200,
      initialInventory: {
        warehouseId: warehouse.warehouse.id,
        onHand: 40,
        unsellable: 0,
      },
    }
  );
  const skuId = sku.sku.id;
  await apiJson(request, adminCsrf, 'POST', `/api/admin/catalog/products/${productId}/publish`, {});

  const customerCsrf = await apiLogin(request, customerUsername, customerTempPassword);
  await apiJson(request, customerCsrf, 'POST', '/api/auth/change-password', {
    currentPassword: customerTempPassword,
    newPassword: ORDER_PASSWORD,
  });
  const cart = await apiJson<{ cart: { revision: number } }>(
    request,
    customerCsrf,
    'GET',
    '/api/cart'
  );
  await apiJson(request, customerCsrf, 'PUT', `/api/cart/items/${skuId}`, {
    quantity: 10,
    expectedRevision: cart.cart.revision,
  });
  const submitted = await apiJson<{
    order: { id: string; orderNo: string; revision: number };
  }>(request, customerCsrf, 'POST', '/api/orders', {
    idempotencyKey: `e2e-revocation-${unique}`,
    expectedCartRevision: cart.cart.revision + 1,
    shippingMethod: 'Sea',
    destinationCountryAlpha3: 'USA',
    expectedShipDate: expectedDate,
    shippingRequirements: 'Acceptance revocation E2E.',
  });
  const orderNo = submitted.order.orderNo;

  // A reference-price plan needs no price approval, so this scenario focuses
  // on buyer authority and acceptance invalidation.
  const salesCsrf = await apiLogin(request, SALES_EMAIL, SALES_PASSWORD);
  await apiJson(request, salesCsrf, 'POST', `/api/sales/orders/${submitted.order.id}/plans`, {
    expectedRevision: submitted.order.revision,
    expectedPlanVersion: 0,
    lines: [{ skuId, quantity: 10, unitPriceCents: 4200 }],
    idempotencyKey: `e2e-revocation-plan-${unique}`,
  });

  // --- The ordinary account has no acceptance control ---------------------
  await page.goto('/');
  await signIn(page, ordinaryUsername, ordinaryTempPassword);
  await changePasswordIfAsked(page, ordinaryTempPassword);
  await page.getByTestId('real-tab-orders').click();
  const ordinaryOrder = page.getByTestId('customer-order-card').filter({ hasText: orderNo });
  await expect(ordinaryOrder).toBeVisible({ timeout: 20_000 });
  await ordinaryOrder.click();
  await expect(page.getByTestId('order-plan')).toBeVisible();
  await expect(page.getByTestId('order-plan')).toContainText(skuCode);
  await expect(page.getByTestId('order-plan-accept')).toHaveCount(0);
  await expect(page.getByTestId('order-plan-reject')).toHaveCount(0);
  await signOut(page);

  // --- The designated account accepts -------------------------------------
  await signIn(page, customerUsername, ORDER_PASSWORD);
  await page.getByTestId('real-tab-orders').click();
  const authorizedOrder = page.getByTestId('customer-order-card').filter({ hasText: orderNo });
  await expect(authorizedOrder).toBeVisible({ timeout: 20_000 });
  await authorizedOrder.click();
  await expect(page.getByTestId('order-plan-accept')).toBeVisible();
  await page.getByTestId('order-plan-accept').click();
  await expect(page.getByTestId('order-plan')).toContainText('ACCEPTED');
  await signOut(page);

  // --- Revocation invalidates the acceptance ------------------------------
  await signIn(page, BUSINESS_EMAIL, BUSINESS_PASSWORD);
  await waitForInternalWorkspace(page);
  await openInternalTab(page, 'approvals');
  const companySelect = page.getByTestId('confirmer-company');
  await expect(companySelect).toBeVisible({ timeout: 20_000 });
  const companyOption = companySelect.locator('option', { hasText: companyCode! });
  await expect(companyOption).toHaveCount(1, { timeout: 20_000 });
  await companySelect.selectOption((await companyOption.getAttribute('value'))!);
  const accountRow = page
    .getByTestId('confirmer-account')
    .filter({ hasText: customerUsername });
  await expect(accountRow.getByTestId('confirmer-revoke')).toBeVisible({ timeout: 20_000 });
  await accountRow.getByTestId('confirmer-revoke').click();
  await expect(accountRow.getByTestId('confirmer-grant')).toBeVisible({ timeout: 20_000 });
  await expectNoHorizontalOverflow(page);
  await signOut(page);

  // The plan is returned to SUBMITTED and the revoked account cannot accept.
  await signIn(page, customerUsername, ORDER_PASSWORD);
  await page.getByTestId('real-tab-orders').click();
  const revokedOrder = page.getByTestId('customer-order-card').filter({ hasText: orderNo });
  await expect(revokedOrder).toBeVisible({ timeout: 20_000 });
  await revokedOrder.click();
  await expect(page.getByTestId('order-plan')).toContainText('SUBMITTED');
  await expect(page.getByTestId('order-plan-accept')).toHaveCount(0);
  await signOut(page);

  // --- Re-granting creates a new instance and requires a fresh acceptance --
  await signIn(page, BUSINESS_EMAIL, BUSINESS_PASSWORD);
  await waitForInternalWorkspace(page);
  await openInternalTab(page, 'approvals');
  const regrantSelect = page.getByTestId('confirmer-company');
  await expect(regrantSelect).toBeVisible({ timeout: 20_000 });
  const regrantOption = regrantSelect.locator('option', { hasText: companyCode! });
  await regrantSelect.selectOption((await regrantOption.getAttribute('value'))!);
  const regrantRow = page
    .getByTestId('confirmer-account')
    .filter({ hasText: customerUsername });
  await expect(regrantRow.getByTestId('confirmer-grant')).toBeVisible({ timeout: 20_000 });
  await regrantRow.getByTestId('confirmer-grant').click();
  await expect(regrantRow.getByTestId('confirmer-revoke')).toBeVisible({ timeout: 20_000 });
  await signOut(page);

  await signIn(page, customerUsername, ORDER_PASSWORD);
  await page.getByTestId('real-tab-orders').click();
  const reGrantedOrder = page.getByTestId('customer-order-card').filter({ hasText: orderNo });
  await expect(reGrantedOrder).toBeVisible({ timeout: 20_000 });
  await reGrantedOrder.click();
  await expect(page.getByTestId('order-plan-accept')).toBeVisible();
  await page.getByTestId('order-plan-accept').click();
  await expect(page.getByTestId('order-plan')).toContainText('ACCEPTED');
  await screenshot(page, `customer-reaccepted-${testInfo.project.name}`);
  await expectNoHorizontalOverflow(page);
  await signOut(page);
});

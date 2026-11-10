import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.REAL_E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.REAL_E2E_ADMIN_PASSWORD ?? '';
const ADMIN_COMPANY_CODE = process.env.REAL_E2E_ADMIN_COMPANY_CODE ?? '';
const SALES_EMAIL = process.env.REAL_E2E_SALES_EMAIL ?? '';
const SALES_PASSWORD = process.env.REAL_E2E_SALES_PASSWORD ?? '';
const IMAGE_FIXTURE = path.join(process.cwd(), 'tests/e2e-real/fixtures/product.png');
const CUSTOMER_PASSWORD = 'ImpactPass123!Strong';

async function signIn(page: Page, email: string, password: string, landing: string) {
  await page.goto('/');
  await page.locator('input[autocomplete="username"]').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: /Sign in/ }).click();
  await expect(page.getByTestId(landing)).toBeVisible();
}

function companyRow(page: Page, code: string) {
  return page.locator(`[data-testid="customer-company-row"][data-customer-code="${code}"]`);
}

async function openCompany(page: Page, code: string) {
  await page.getByTestId('customer-company-search').fill(code);
  const row = companyRow(page, code);
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByTestId('company-status')).toBeVisible();
}

async function csrfToken(page: Page): Promise<string> {
  const response = await page.request.get('/api/auth/csrf');
  expect(response.status()).toBe(200);
  return (await response.json()).csrfToken as string;
}

async function apiPost(
  page: Page,
  pathName: string,
  token: string,
  data: Record<string, unknown>
): Promise<Record<string, any>> {
  const response = await page.request.post(pathName, {
    headers: { 'X-CSRF-Token': token },
    data,
  });
  if (!response.ok()) {
    throw new Error(`${pathName} failed: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page.getByTestId('real-auth-login')).toBeVisible();
}

async function signInCustomer(page: Page, username: string, temporaryPassword: string) {
  await page.goto('/');
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(temporaryPassword);
  await page.getByRole('button', { name: /Sign in/ }).click();
  const changePassword = page.getByTestId('real-auth-change-password');
  const catalog = page.getByTestId('catalog-search');
  // The login response may need longer than a short visibility probe on CI.
  await expect(changePassword.or(catalog)).toBeVisible({ timeout: 20_000 });
  if (await changePassword.isVisible()) {
    const inputs = page.locator('input[type="password"]');
    await inputs.nth(0).fill(temporaryPassword);
    await inputs.nth(1).fill(CUSTOMER_PASSWORD);
    await inputs.nth(2).fill(CUSTOMER_PASSWORD);
    await page.getByRole('button', { name: /Save password/ }).click();
  }
  await expect(catalog).toBeVisible({ timeout: 20_000 });
}

async function submitPendingOrder(page: Page, skuId: string): Promise<Record<string, any>> {
  const token = await csrfToken(page);
  const before = await (await page.request.get('/api/cart')).json();
  const add = await page.request.put(`/api/cart/items/${skuId}`, {
    headers: { 'X-CSRF-Token': token },
    data: { quantity: 10, expectedRevision: before.cart.revision },
  });
  if (!add.ok()) throw new Error(`cart add failed: ${add.status()} ${await add.text()}`);
  const after = await (await page.request.get('/api/cart')).json();
  const expectedShipDate = new Date(Date.now() + 14 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const created = await apiPost(page, '/api/orders', token, {
    idempotencyKey: randomUUID(),
    expectedCartRevision: after.cart.revision,
    shippingMethod: 'Sea',
    destinationCountryAlpha3: 'USA',
    expectedShipDate,
    shippingRequirements: 'E2E impact test cartons.',
  });
  return created.order;
}

async function adminOrderStatus(page: Page, orderId: string): Promise<string> {
  const response = await page.request.get(`/api/admin/orders/${orderId}`);
  expect(response.status()).toBe(200);
  return (await response.json()).order.status as string;
}

test('admin manages accounts, brands, sales assignment and status through real APIs', async ({
  page,
}, testInfo) => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD || !ADMIN_COMPANY_CODE,
    'Real-auth admin credentials are required.'
  );
  test.skip(testInfo.project.name !== 'real-desktop-1440', 'One management pass at desktop 1440.');

  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD, 'real-tab-products');
  await page.getByTestId('real-tab-customers').click();
  await expect(page.getByTestId('admin-customers')).toBeVisible();

  const companiesResponse = await page.request.get('/api/admin/companies');
  expect(companiesResponse.status()).toBe(200);

  await openCompany(page, ADMIN_COMPANY_CODE);

  const primaryUsername = `AK${ADMIN_COMPANY_CODE.slice(1)}A`;
  const primaryRow = page.locator(
    `[data-testid="customer-account-row"][data-username="${primaryUsername}"]`
  );
  await expect(primaryRow).toBeVisible();
  await expect(primaryRow.getByTestId('account-status')).toHaveText('Active');

  // The script grants AOKING to this company at creation. Normalise the
  // starting state so rerunning this test against the same database is safe.
  const brand = page.getByTestId('customer-brand-brand-aoking');
  if (!(await brand.isChecked())) await brand.check();
  await expect(brand).toBeChecked();

  // Sales assignment persists across a reload.
  await page.getByTestId('company-sales-select').selectOption({
    label: `E2E Sales · ${SALES_EMAIL}`,
  });
  await page.getByTestId('company-sales-save').click();
  await expect(page.getByTestId('admin-notice')).toContainText('Sales assignment saved.');
  await page.reload();
  await expect(page.getByTestId('real-tab-products')).toBeVisible();
  await page.getByTestId('real-tab-customers').click();
  await openCompany(page, ADMIN_COMPANY_CODE);
  await expect(
    page.getByTestId('company-sales-select').locator('option:checked')
  ).toHaveText(`E2E Sales · ${SALES_EMAIL}`);

  // Brand revoke/grant round-trips against the real grants table.
  await brand.click();
  await expect(brand).not.toBeChecked();
  await brand.click();
  await expect(brand).toBeChecked();

  // This company has no pending-confirmation orders, so status changes apply
  // without the destructive-impact dialog (covered by API tests). Reactivate
  // first if an earlier interrupted run left it suspended.
  const companyStatus = page.getByTestId('company-status');
  if ((await companyStatus.innerText()).trim() !== 'Active') {
    await page.getByTestId('company-status-toggle').click();
    await expect(companyStatus).toHaveText('Active');
  }
  await page.getByTestId('company-status-toggle').click();
  await expect(companyStatus).toHaveText('Suspended');
  await page.getByTestId('company-status-toggle').click();
  await expect(companyStatus).toHaveText('Active');
});

test('admin creates a company from the UI with a one-time credential', async ({ page }, testInfo) => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'Real-auth admin credentials are required.');
  test.skip(testInfo.project.name !== 'real-desktop-1440', 'One create pass at desktop 1440.');

  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD, 'real-tab-products');
  await page.getByTestId('real-tab-customers').click();
  await page.getByTestId('customer-company-new').click();
  await expect(page.getByTestId('company-create-form')).toBeVisible();

  const code = `C${String(Math.floor(100000 + Math.random() * 900000))}`;
  await page.getByTestId('company-code').fill(code);
  await page.getByTestId('company-short-name').fill(`E2E UI ${code}`);
  await page.getByTestId('company-country').fill('United States');
  await page.getByRole('option', { name: 'USA — United States of America', exact: true }).click();
  await page.getByTestId('company-sales').selectOption({ label: `E2E Sales · ${SALES_EMAIL}` });
  await page.getByTestId('company-brand-brand-aoking').check();
  await page.getByTestId('company-create-submit').click();

  await expect(page.getByTestId('temp-credential')).toBeVisible();
  const username = await page.getByTestId('temp-credential-username').innerText();
  const password = await page.getByTestId('temp-credential-password').innerText();
  expect(username).toBe(`AK${code.slice(1)}A`);
  expect(password.length).toBeGreaterThanOrEqual(16);
  await page.getByTestId('temp-credential-close').click();

  // Create a real secondary account on the fresh company, then round-trip its
  // status. A new company per run keeps this safe without deleting data.
  await page.getByTestId('company-add-account').click();
  await expect(page.getByTestId('temp-credential')).toBeVisible();
  const createdUsername = await page.getByTestId('temp-credential-username').innerText();
  const createdPassword = await page.getByTestId('temp-credential-password').innerText();
  expect(createdUsername).toBe(`AK${code.slice(1)}B`);
  expect(createdPassword.length).toBeGreaterThanOrEqual(16);
  await page.getByTestId('temp-credential-close').click();
  await expect(page.getByTestId('temp-credential')).toBeHidden();

  const secondaryRow = page.locator(
    `[data-testid="customer-account-row"][data-username="${createdUsername}"]`
  );
  await expect(secondaryRow).toBeVisible();
  await expect(secondaryRow.getByTestId('account-status')).toHaveText('Active');
  await secondaryRow.getByTestId('customer-account-toggle').click();
  await page.getByTestId('customer-account-confirm').click();
  await expect(secondaryRow.getByTestId('account-status')).toHaveText('Suspended');
  await secondaryRow.getByTestId('customer-account-toggle').click();
  await page.getByTestId('customer-account-confirm').click();
  await expect(secondaryRow.getByTestId('account-status')).toHaveText('Active');

  await expect(page.getByTestId('company-status')).toHaveText('Active');
  await page.getByTestId('customer-company-search').fill(code);
  await expect(companyRow(page, code)).toBeVisible();
  await expect(page.getByTestId('customer-company-detail')).toContainText(code);
});

test('admin previews and confirms brand and company actions with pending orders', async ({
  page,
}, testInfo) => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'Real-auth admin credentials are required.');
  test.skip(testInfo.project.name !== 'real-desktop-1440', 'One destructive-impact pass at desktop 1440.');

  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD, 'real-tab-products');
  const adminToken = await csrfToken(page);
  const stamp = Date.now().toString().slice(-7);

  const warehouse = await apiPost(page, '/api/admin/warehouses', adminToken, {
    code: `WH-IMP-${stamp}`,
    name: '影响测试仓',
    nameEn: 'Impact Test Warehouse',
  });
  const product = await apiPost(page, '/api/admin/catalog/products', adminToken, {
    brandId: 'brand-aoking',
    productCode: `IMP-${stamp}`,
    title: '影响测试商品',
    titleEn: `Impact Test Product ${stamp}`,
    category: 'Business Backpacks',
    material: 'Nylon',
    capacityOrSize: '20L',
    seriesId: null,
    tagIds: [],
  });
  const productId = product.product.id as string;
  const image = await page.request.post(`/api/admin/catalog/products/${productId}/images`, {
    headers: { 'X-CSRF-Token': adminToken, 'Content-Type': 'image/png' },
    data: await readFile(IMAGE_FIXTURE),
  });
  if (!image.ok()) throw new Error(`image upload failed: ${image.status()} ${await image.text()}`);
  const sku = await apiPost(page, `/api/admin/catalog/products/${productId}/skus`, adminToken, {
    skuCode: `IMP-${stamp}-BLK`,
    colorName: '黑色',
    colorNameEn: 'Black',
    colorHex: '#222222',
    basePriceCents: 4200,
  });
  const skuId = sku.sku.id as string;
  await apiPost(page, `/api/admin/catalog/products/${productId}/publish`, adminToken, {});
  await apiPost(page, '/api/admin/inventory/register', adminToken, {
    skuId,
    warehouseId: warehouse.warehouse.id,
    onHand: 100,
    unsellable: 0,
    reason: 'E2E destructive-impact test stock',
  });

  const sixDigits = () => String(Math.floor(100000 + Math.random() * 900000));
  const codeA = `C${sixDigits()}`;
  let codeB = `C${sixDigits()}`;
  while (codeB === codeA) codeB = `C${sixDigits()}`;
  const companyA = await apiPost(page, '/api/admin/companies', adminToken, {
    customerCode: codeA,
    shortName: `Impact A ${codeA}`,
    countryAlpha3: 'USA',
    brandIds: ['brand-aoking'],
  });
  const companyB = await apiPost(page, '/api/admin/companies', adminToken, {
    customerCode: codeB,
    shortName: `Impact B ${codeB}`,
    countryAlpha3: 'USA',
    brandIds: ['brand-aoking'],
  });

  await signOut(page);
  await signInCustomer(page, companyA.primaryUsername, companyA.temporaryPassword);
  const orderA = await submitPendingOrder(page, skuId);
  await signOut(page);
  await signInCustomer(page, companyB.primaryUsername, companyB.temporaryPassword);
  const orderB = await submitPendingOrder(page, skuId);
  await signOut(page);

  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD, 'real-tab-products');
  await page.getByTestId('real-tab-customers').click();

  // Brand revoke: cancel must not write; confirm must use the impact token.
  await openCompany(page, codeA);
  const brand = page.getByTestId('customer-brand-brand-aoking');
  await expect(brand).toBeChecked();
  await brand.click();
  const impact = page.getByTestId('customer-impact-dialog');
  await expect(impact).toBeVisible();
  await expect(impact).toContainText(orderA.orderNo);
  await page.getByTestId('customer-impact-cancel').click();
  await expect(impact).toBeHidden();
  await expect(brand).toBeChecked();
  expect(await adminOrderStatus(page, orderA.id)).toBe('PENDING_CONFIRMATION');

  await brand.click();
  await expect(impact).toBeVisible();
  await page.getByTestId('customer-impact-confirm').click();
  await expect(page.getByTestId('admin-notice')).toContainText('Brand access revoked');
  await expect(brand).not.toBeChecked();
  expect(await adminOrderStatus(page, orderA.id)).toBe('CANCELLED');
  await brand.click();
  await expect(brand).toBeChecked();

  // Company suspend: the same preview, cancel and token-confirmation flow.
  await openCompany(page, codeB);
  const status = page.getByTestId('company-status');
  await expect(status).toHaveText('Active');
  await page.getByTestId('company-status-toggle').click();
  await expect(impact).toBeVisible();
  await expect(impact).toContainText(orderB.orderNo);
  await page.getByTestId('customer-impact-cancel').click();
  await expect(impact).toBeHidden();
  await expect(status).toHaveText('Active');
  expect(await adminOrderStatus(page, orderB.id)).toBe('PENDING_CONFIRMATION');

  await page.getByTestId('company-status-toggle').click();
  await expect(impact).toBeVisible();
  await page.getByTestId('customer-impact-confirm').click();
  await expect(page.getByTestId('admin-notice')).toContainText('Company suspended');
  await expect(status).toHaveText('Suspended');
  expect(await adminOrderStatus(page, orderB.id)).toBe('CANCELLED');
  await page.getByTestId('company-status-toggle').click();
  await expect(status).toHaveText('Active');
});

test('sales staff cannot reach customer administration', async ({ page }, testInfo) => {
  test.skip(!SALES_EMAIL || !SALES_PASSWORD, 'Real-auth sales credentials are required.');
  test.skip(testInfo.project.name !== 'real-desktop-1440', 'One permission pass at desktop 1440.');

  await signIn(page, SALES_EMAIL, SALES_PASSWORD, 'real-tab-orders');
  await expect(page.getByTestId('real-tab-customers')).toHaveCount(0);

  expect((await page.request.get('/api/admin/companies')).status()).toBe(403);
  expect((await page.request.get('/api/admin/sales-users')).status()).toBe(403);
  expect((await page.request.get('/api/admin/audit-logs')).status()).toBe(403);
});

test('mobile admin can open a customer without horizontal overflow', async ({ page }, testInfo) => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD || !ADMIN_COMPANY_CODE, 'Real-auth admin required.');
  test.skip(testInfo.project.name !== 'real-mobile-390', 'One mobile check at 390 px.');

  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD, 'real-tab-products');
  await page.getByTestId('real-tab-customers').click();
  await openCompany(page, ADMIN_COMPANY_CODE);
  await expect(page.getByTestId('company-accounts')).toBeVisible();
  await expect(page.getByTestId('customer-account-row').first()).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

import { expect, test, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.REAL_E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.REAL_E2E_ADMIN_PASSWORD ?? '';
const ADMIN_COMPANY_CODE = process.env.REAL_E2E_ADMIN_COMPANY_CODE ?? '';
const SALES_EMAIL = process.env.REAL_E2E_SALES_EMAIL ?? '';
const SALES_PASSWORD = process.env.REAL_E2E_SALES_PASSWORD ?? '';

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

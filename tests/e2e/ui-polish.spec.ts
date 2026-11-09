import { expect, test, type Page } from '@playwright/test';

async function switchRole(page: Page, profile: RegExp, option: string) {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1024) {
    await page.getByRole('button', { name: /Open navigation|菜单/ }).first().click();
  }
  await page.locator('aside').getByRole('button', { name: profile }).first().click();
  await page.getByText(option, { exact: true }).click();
  const aside = page.locator('aside');
  if (await aside.isVisible()) {
    const backdrop = page.locator('div.fixed.inset-0.bg-black\\/50');
    if ((await backdrop.count()) > 0) await page.mouse.click(width - 20, 300);
  }
}

async function openCatalog(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Shop in-stock wholesale' })).toBeVisible();
}

async function submitCustomerOrder(page: Page) {
  await page.locator('[data-testid="product-card"]').first().click();
  const detail = page.getByTestId('product-detail');
  await detail.locator('[data-testid="add-to-order"]').click();
  await expect(detail.getByText('Added to your order list.')).toBeVisible();
  await detail.getByRole('button', { name: 'View order list' }).click();
  await page.locator('[data-testid="submit-order"]').click();
  await expect(page.getByRole('heading', { name: 'Order request submitted' })).toBeVisible();
}

async function closeOverlayNavigation(page: Page) {
  const aside = page.locator('aside');
  if (!(await aside.isVisible())) return;
  const width = page.viewportSize()?.width ?? 1440;
  const backdrop = page.locator('div.fixed.inset-0.bg-black\\/50');
  if ((await backdrop.count()) > 0) {
    await page.mouse.click(width - 20, 300);
  }
  await expect(aside).not.toBeInViewport();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test('customer catalogue exposes the cart badge, help tooltip and direct quantity editing', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'One pass with explicit viewport resizing.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openCatalog(page);

  await expect(page.getByTestId('catalog-cart-entry')).toBeVisible();
  await expect(page.getByTestId('catalog-cart-count')).toHaveCount(0);

  // Tooltip opens on hover and closes with Escape.
  const help = page.getByRole('button', { name: 'Catalogue and MOQ guidance help' });
  await help.hover();
  await expect(page.getByRole('tooltip')).toContainText('10 PCS minimum order quantity');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await help.click();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  // The first focus selects the default quantity, so typing replaces it.
  const quantity = page.getByTestId('quick-quantity').first();
  await quantity.click();
  await page.keyboard.type('12');
  await expect(quantity).toHaveValue('12');

  // Wheel adjustment is damped but still changes one step while focused.
  await quantity.evaluate(element => element.focus());
  await quantity.dispatchEvent('wheel', { deltaY: 120 });
  await expect(quantity).toHaveValue('13');

  await page.locator('[data-testid="quick-add"]').first().click();
  await expect(page.getByTestId('catalog-cart-count')).toHaveText('13');
  await expect(page.getByTestId('catalog-cart-entry')).toContainText('Order list');
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('main').screenshot({
    path: 'docs/ui-review/ui-polish/customer-catalog-1440.png',
  });

  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await closeOverlayNavigation(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectNoHorizontalOverflow(page);
    await page.locator('main').screenshot({
      path: `docs/ui-review/ui-polish/customer-catalog-${width}.png`,
    });
  }
});

test('customer cart entry is keyboard reachable and scrolls independently on mobile', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'One pass with explicit viewport resizing.');
  await page.setViewportSize({ width: 390, height: 844 });
  await openCatalog(page);
  await page.getByTestId('catalog-cart-entry').focus();
  await expect(page.getByTestId('catalog-cart-entry')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Your order list is empty')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 430, height: 900 });
  await expectNoHorizontalOverflow(page);
});

test('promotion SKU search, ISO country search, tier tags and Chinese audit display', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Admin interaction pass at 1440.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openCatalog(page);
  await switchRole(page, /AK000123A/, 'Administrator (Admin Lin)');

  await page.getByRole('button', { name: /促销与等级配置|等级与促销配置/ }).first().click();
  await expect(
    page.getByRole('heading', { name: /限时促销与客户等级规则配置/ })
  ).toBeVisible();
  const promo = page.getByTestId('promo-sku-combobox');
  await promo.fill('AK-9042-BLK');
  await expect(page.getByRole('option').filter({ hasText: 'AK-9042-BLK' })).toBeVisible();
  await page.getByRole('option').filter({ hasText: 'AK-9042-BLK' }).first().click();
  await expect(promo).toHaveValue(/AK-9042-BLK.*AK-9042/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('main').screenshot({
    path: 'docs/ui-review/ui-polish/admin-promotions-1440.png',
  });

  await page.getByRole('button', { name: /客户与账户建档|客户公司与账户建档/ }).first().click();
  const country = page.getByTestId('company-country-combobox');
  await country.fill('日本');
  await page.getByRole('option').filter({ hasText: 'JPN — Japan / 日本' }).click();
  await expect(country).toHaveValue(/JPN/);
  await country.fill('Germany');
  await page.getByRole('option').filter({ hasText: 'DEU — Germany / 德国' }).click();
  await expect(country).toHaveValue(/DEU/);

  await expect(page.getByTestId('company-tier-C000123')).toHaveText('Gold');
  await expect(page.getByTestId('company-tier-C000456')).toHaveText('Bronze');
  await expect(page.getByTestId('company-tier-C000789')).toHaveText('Diamond');
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('main').screenshot({
    path: 'docs/ui-review/ui-polish/admin-accounts-1440.png',
  });

  await page.getByRole('button', { name: /敏感操作审计日志|审计日志/ }).first().click();
  const auditAction = page.locator('[data-action-code="CREATE_COMPANY"]').first();
  await expect(auditAction).toHaveText('创建客户公司');
  await expect(page.locator('table').getByText(/已登记客户公司/).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('main').screenshot({
    path: 'docs/ui-review/ui-polish/admin-audit-1440.png',
  });

  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await closeOverlayNavigation(page);
    await expectNoHorizontalOverflow(page);
  }
});

test('sales order status badges and internal language mode stay consistent', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'One pass with explicit viewport resizing.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openCatalog(page);
  await submitCustomerOrder(page);
  await switchRole(page, /AK000123A/, 'Sales (Tom Miller)');
  await page.getByRole('button', { name: '待确认', exact: true }).click();

  const status = page.locator('[data-order-status="PENDING_CONFIRMATION"]').first();
  await expect(status).toHaveText('待确认');
  await expect(status).toHaveClass(/bg-amber-50/);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('main').screenshot({
    path: 'docs/ui-review/ui-polish/sales-orders-zh-1440.png',
  });
  await page.getByTestId('sales-order-language').getByRole('button', { name: 'EN' }).click();
  await expect(status).toHaveText('Pending confirmation');
  await expect(page.getByRole('button', { name: 'Pending', exact: true })).toBeVisible();
  await expect(page.getByTestId('confirm-order')).toContainText(
    'Confirm order and create 72h demo reservation'
  );
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('main').screenshot({
    path: 'docs/ui-review/ui-polish/sales-orders-en-1440.png',
  });

  await page.getByTestId('sales-order-language').getByRole('button', { name: '中文' }).click();
  await expect(status).toHaveText('待确认');
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await closeOverlayNavigation(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectNoHorizontalOverflow(page);
    await page.locator('main').screenshot({
      path: `docs/ui-review/ui-polish/sales-orders-${width}.png`,
    });
  }
});

import { expect, test, type Page } from '@playwright/test';

// This file deliberately uses a touch-capable context at the two customer
// review widths. It is a focused regression pass, so only one project runs it.
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

async function openAdminView(page: Page, label: RegExp) {
  const aside = page.locator('aside');
  const width = page.viewportSize()?.width ?? 390;
  const menu = page.getByRole('button', { name: /Open navigation|菜单/ }).first();

  // Start from a known closed state so a role-menu transition cannot leave the
  // drawer half-open when the next tap lands.
  const box = await aside.boundingBox();
  if (box && box.x >= 0 && box.x < width) {
    await page.mouse.click(width - 20, 300);
    await expect(aside).not.toBeInViewport();
  }

  await menu.tap();
  await expect(aside).toBeInViewport();
  const navItem = aside.getByRole('button', { name: label }).first();
  await expect(navItem).toBeInViewport();
  await navItem.tap();
  await expect(aside).not.toBeInViewport();
}

async function switchToAdmin(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Shop in-stock wholesale' })).toBeVisible();
  await page.getByRole('button', { name: /Open navigation|菜单/ }).first().tap();
  const aside = page.locator('aside');
  await aside.getByRole('button', { name: /AK000123A/ }).first().tap();
  await page.getByText('Administrator (Admin Lin)', { exact: true }).tap();
  await expect(aside).toBeVisible();
}

test('touch selection works in the ISO3 and promotion SKU comboboxes at 390 and 430', async ({
  page,
}, testInfo) => {
  const allowedProjects = new Set(['desktop-1440', 'mobile-390-webkit']);
  test.skip(
    !allowedProjects.has(testInfo.project.name),
    'Touch-only pass; runs once in Chromium and once in WebKit.'
  );

  await switchToAdmin(page);

  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 900 });

    await openAdminView(page, /客户与账户建档|客户公司和账户建档/);
    const country = page.getByTestId('company-country-combobox');
    await country.tap();
    await country.fill('日本');
    const countryOption = page.getByRole('option').filter({ hasText: 'JPN — Japan / 日本' });
    await expect(countryOption).toBeVisible();
    await countryOption.tap();
    await expect(country).toHaveValue(/JPN/);

    await openAdminView(page, /促销与等级配置|等级与促销配置/);
    const promo = page.getByTestId('promo-sku-combobox');
    await promo.tap();
    await promo.fill('AK-9042-BLK');
    const promoOption = page.getByRole('option').filter({ hasText: 'AK-9042-BLK' });
    await expect(promoOption).toBeVisible();
    await promoOption.tap();
    await expect(promo).toHaveValue(/AK-9042-BLK.*AK-9042/);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

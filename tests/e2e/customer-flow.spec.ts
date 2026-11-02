import { expect, test, type Page } from '@playwright/test';

async function navTo(page: Page, label: string) {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1024) {
    await page.getByTestId('customer-bottom-nav').getByRole('button', { name: label }).click();
  } else {
    const desktopLabel = label === 'Orders' ? 'My orders' : label;
    await page.getByRole('button', { name: desktopLabel, exact: true }).first().click();
  }
}

async function openCatalog(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Shop in-stock wholesale' })).toBeVisible();
}

async function addFirstProduct(page: Page, quantity = 12) {
  await page.locator('[data-testid="product-card"]').first().click();
  const detail = page.getByTestId('product-detail');
  await expect(detail).toBeVisible();
  await detail.locator('[data-testid="sku-color"]').nth(1).click();
  await expect(detail.getByText('AK-9042-GRY · Charcoal Grey')).toBeVisible();
  await detail.locator('[data-testid="quantity-input"]').fill(String(quantity));
  await detail.locator('[data-testid="add-to-order"]').click();
  await expect(detail.getByText('Added to your order list.')).toBeVisible();
  await detail.getByRole('button', { name: 'View order list' }).click();
  await expect(page.getByRole('heading', { name: 'Order list' })).toBeVisible();
}

test('customer can browse, choose a colour, edit quantity, submit and view the order', async ({
  page,
}) => {
  await openCatalog(page);
  await addFirstProduct(page);

  const quantity = page.locator('[data-testid="cart-quantity-sku-9042-gry"]');
  await expect(quantity).toHaveValue('12');
  await quantity.fill('14');
  await quantity.blur();
  await expect(page.getByText('14 PCS').first()).toBeVisible();

  await page.locator('[data-testid="submit-order"]').click();
  await expect(page.getByRole('heading', { name: 'Order request submitted' })).toBeVisible();
  await page.getByRole('button', { name: 'View my orders' }).click();
  await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible();
  await expect(page.getByText('Pending confirmation').first()).toBeVisible();
  await expect(page.getByText(/ORD-\d{8}-\d{3}/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Expand order details' }).first().click();
  await expect(page.getByText('Order progress')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[\u4e00-\u9fff]/);
});

test('customer membership and notification surfaces remain in English', async ({ page }) => {
  await openCatalog(page);
  await navTo(page, 'Membership');
  await expect(page.getByText('Historical cumulative spend').first()).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[\u4e00-\u9fff]/);

  await page.getByRole('button', { name: 'Notifications', exact: true }).first().click();
  await page.getByRole('button', { name: 'View all notifications' }).click();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[\u4e00-\u9fff]/);
});

test('customer flow uses English copy without horizontal overflow', async ({ page }) => {
  await openCatalog(page);
  await addFirstProduct(page);
  await page.locator('[data-testid="submit-order"]').click();
  await expect(page.getByRole('heading', { name: 'Order request submitted' })).toBeVisible();
  await page.getByRole('button', { name: 'View my orders' }).click();
  await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible();

  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/[一-鿿]/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('invalid cart quantity keeps the line and blocks submission', async ({ page }) => {
  await openCatalog(page);
  await addFirstProduct(page, 10);
  const quantity = page.locator('[data-testid="cart-quantity-sku-9042-gry"]');
  await quantity.fill('5');
  await quantity.blur();
  await expect(page.getByText(/Minimum 10 whole PCS/)).toBeVisible();
  await expect(page.getByText('Charcoal Grey').first()).toBeVisible();
  await page.locator('[data-testid="submit-order"]').click();
  await expect(page.getByText('Resolve the quantity errors before submitting.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Order request submitted' })).toHaveCount(0);
});

test('duplicate submit click creates only one pending order', async ({ page }) => {
  await openCatalog(page);
  await addFirstProduct(page, 10);
  await page.locator('[data-testid="submit-order"]').evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('heading', { name: 'Order request submitted' })).toBeVisible();
  await page.getByRole('button', { name: 'View my orders' }).click();
  await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible();
  await expect(page.getByText('Pending confirmation')).toHaveCount(1);
});

test('responsive viewports have no horizontal overflow and keep navigation usable', async ({
  page,
}) => {
  for (const [width, height] of [
    [375, 844],
    [390, 844],
    [430, 900],
    [768, 1024],
    [1440, 1000],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Shop in-stock wholesale' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(0);
    if (width < 1024) {
      await expect(page.getByTestId('customer-bottom-nav')).toBeVisible();
    }
  }
});

test('customer can inspect shipment tracking and permitted change actions', async ({ page }) => {
  await openCatalog(page);
  await navTo(page, 'Orders');
  await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible();

  const shipped = page.locator('div.bg-white.rounded-2xl', { hasText: 'ORD-20261010-003' }).first();
  await shipped.locator('div.cursor-pointer').first().click();
  await expect(shipped.getByText('Shipment tracking')).toBeVisible();
  await expect(shipped.getByText('DHL-8890214300')).toBeVisible();

  const confirmed = page.locator('div.bg-white.rounded-2xl', { hasText: 'ORD-20261028-001' }).first();
  await confirmed.locator('div.cursor-pointer').first().click();
  await expect(confirmed.getByRole('button', { name: 'Request quantity change' })).toBeVisible();
  await expect(confirmed.getByRole('button', { name: 'Request cancellation' })).toBeVisible();
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('disables non-essential transitions', async ({ page }) => {
    await openCatalog(page);
    const durations = await page.locator('[data-testid="product-card"]').first().evaluate((el) =>
      getComputedStyle(el)
        .transitionDuration.split(',')
        .map((value) => Number.parseFloat(value))
    );
    expect(durations.every((value) => value <= 0.01)).toBe(true);
  });
});

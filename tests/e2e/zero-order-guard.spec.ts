import { expect, test, type Page } from '@playwright/test';

async function switchRole(page: Page, profile: RegExp, option: string) {
  await page.locator('aside').getByRole('button', { name: profile }).first().click();
  await page.getByText(option, { exact: true }).click();
}

test('sales sees a clear error when confirming a USD $0.00 order', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-1440',
    'Cross-role zero-amount evidence runs on desktop'
  );

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Shop in-stock wholesale' })).toBeVisible();

  // Admin sets the seeded Tier 3 discount to 100%, creating a zero-total order path.
  await switchRole(page, /AK000123A/, 'Administrator (Admin Lin)');
  await page.getByRole('button', { name: /促销与等级配置/ }).first().click();
  await expect(page.getByRole('heading', { name: /限时促销与客户等级规则配置/ })).toBeVisible();
  const tier3 = page.locator('tr', { hasText: 'Tier 3' }).first();
  await tier3.getByRole('button', { name: '编辑' }).click();
  await tier3.locator('input[type="number"]').nth(1).fill('100');
  await tier3.getByRole('button', { name: '保存' }).click();
  await expect(tier3).toContainText('100% OFF');

  // Customer submits a PENDING order whose reference total is USD $0.00.
  await switchRole(page, /Sarah Lin/, 'AK000123A (Apex buyer 1)');
  await expect(page.getByRole('heading', { name: 'Shop in-stock wholesale' })).toBeVisible();
  await page.locator('[data-testid="product-card"]').first().click();
  const detail = page.getByTestId('product-detail');
  await detail.getByTestId('add-to-order').click();
  await detail.getByRole('button', { name: 'View order list' }).click();
  await page.getByTestId('submit-order').click();
  await expect(page.getByRole('heading', { name: 'Order request submitted' })).toBeVisible();
  await expect(page.getByTestId('success-total-usd')).toHaveText('USD $0.00');
  const orderNo = (await page.getByTestId('success-order-no').textContent())!.trim();

  // Sales can see the pending order but confirmation must show the guard reason.
  await switchRole(page, /AK000123A/, 'Sales (Tom Miller)');
  await page.getByRole('button', { name: '待确认' }).click();
  const pending = page.locator('div.bg-white.rounded-2xl', { hasText: orderNo }).first();
  await expect(pending).toBeVisible();
  let dialogMessage = '';
  page.once('dialog', async dialog => {
    dialogMessage = dialog.message();
    await dialog.dismiss();
  });
  await pending.getByTestId('confirm-order').click();
  expect(dialogMessage).toContain('USD $0.00');
  expect(dialogMessage).toContain('暂不允许确认或预占库存');
  await expect(pending.locator('[data-order-status="PENDING_CONFIRMATION"]')).toHaveCount(1);
});

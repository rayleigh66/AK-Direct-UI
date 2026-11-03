import { expect, test, type Page } from '@playwright/test';

async function closeMobileSidebarIfOpen(page: Page) {
  const width = page.viewportSize()?.width ?? 1440;
  if (width >= 1024) return;
  const aside = page.locator('aside');
  const inViewport = await aside.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return rect.right > 0 && rect.left < window.innerWidth;
  });
  if (!inViewport) return;
  const backdrop = page.locator('div.fixed.inset-0.bg-black\\/50');
  if ((await backdrop.count()) > 0) {
    await page.mouse.click(width - 20, 300);
  }
  await expect(aside).not.toBeInViewport();
}

async function switchRole(page: Page, profile: RegExp, option: string) {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1024) {
    await page.getByRole('button', { name: /Open navigation|菜单/ }).first().click();
  }
  await page.locator('aside').getByRole('button', { name: profile }).first().click();
  await page.getByText(option, { exact: true }).click();
  await closeMobileSidebarIfOpen(page);
}

async function openInventory(page: Page) {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1024) {
    await page.getByRole('button', { name: /Open navigation|菜单/ }).first().click();
    await page.locator('aside').getByRole('button', { name: /多仓库存与导入/ }).first().click();
  } else {
    await page.getByRole('button', { name: /多仓库存与导入/ }).first().click();
  }
  await expect(page.getByRole('heading', { name: /多仓现货库存与文件导入/ })).toBeVisible();
}

async function customerOrder(page: Page) {
  await page.goto('/');
  await page.getByRole('heading', { name: 'Shop in-stock wholesale' }).waitFor();
  await page.locator('[data-testid="product-card"]').first().click();
  const detail = page.getByTestId('product-detail');
  await detail.locator('[data-testid="add-to-order"]').click();
  await expect(detail.getByText('Added to your order list.')).toBeVisible();
  await detail.getByRole('button', { name: 'View order list' }).click();
  await page.locator('[data-testid="submit-order"]').click();
  await expect(page.getByRole('heading', { name: 'Order request submitted' })).toBeVisible();
  return (await page.getByTestId('success-order-no').textContent())!.trim();
}

test('sales can confirm, record payment and ship a customer order on mobile or desktop', async ({
  page,
}) => {
  const orderNo = await customerOrder(page);
  await switchRole(page, /AK000123A/, 'Sales (Tom Miller)');
  await page.getByRole('button', { name: '待确认核准 (Pending)' }).click();
  const pending = page.locator('div.bg-white.rounded-2xl', { hasText: orderNo }).first();
  await expect(pending).toBeVisible();
  await pending.getByTestId('confirm-order').click();
  await expect(page.getByText(/订单确认成功/)).toBeVisible();

  await page.getByRole('button', { name: '已确认·预占中 (Reserved)' }).click();
  const confirmed = page.locator('div.bg-white.rounded-2xl', { hasText: orderNo }).first();
  await confirmed.getByRole('button', { name: /登记到账入账/ }).click();
  await page.getByTestId('payment-amount').fill('342');
  await page.getByTestId('payment-reference').fill('WIRE-MOBILE-E2E');
  await page.getByTestId('submit-payment').click();
  await expect(page.getByText(/付款核验登记成功/)).toBeVisible();

  await page.getByRole('button', { name: '已收款待发货 (Paid)' }).click();
  const paid = page.locator('div.bg-white.rounded-2xl', { hasText: orderNo }).first();
  await paid.getByRole('button', { name: /录入整单发货物流/ }).click();
  await page.getByTestId('shipment-carrier').fill('DHL Express');
  await page.getByTestId('shipment-tracking').fill('DHL-MOBILE-001');
  await page.getByTestId('shipment-date').fill('2026-11-06');
  await page.getByTestId('shipment-eta').fill('2026-11-10');
  await page.getByTestId('submit-shipment').click();
  await expect(page.getByText(/整单发货记录更新成功/)).toBeVisible();
  await page.getByRole('button', { name: '已整单发货 (Shipped)' }).click();
  await expect(page.locator('div.bg-white.rounded-2xl', { hasText: orderNo }).first()).toContainText(
    'DHL-MOBILE-001'
  );
});

test('admin previews a valid CSV before committing Mock inventory', async ({ page }) => {
  await page.goto('/');
  await switchRole(page, /AK000123A/, 'Administrator (Admin Lin)');
  await openInventory(page);
  const download = page.waitForEvent('download');
  await page.getByTestId('download-inventory-template').click();
  expect((await download).suggestedFilename()).toBe('aoking-inventory-template.csv');

  await page.getByLabel('Choose inventory file').setInputFiles({
    name: 'valid-inventory.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'sku_code,warehouse_code,on_hand,unsellable\nAK-9042-BLK,WH-SH,100,5\n'
    ),
  });
  await expect(page.getByRole('heading', { name: /库存导入预览/ })).toBeVisible();
  expect(
    await page.getByText(/160 → 100/).evaluateAll(elements =>
      elements.some(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
    )
  ).toBe(true);
  await expect(page.getByTestId('commit-inventory-import')).toBeEnabled();
  await page.getByTestId('commit-inventory-import').click();
  await expect(page.getByText(/已提交 1 条 Mock 库存记录/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /库存导入预览/ })).toHaveCount(0);

  await page.getByLabel('Choose inventory file').setInputFiles('tests/fixtures/inventory-import.xlsx');
  await expect(page.getByRole('heading', { name: /库存导入预览/ })).toBeVisible();
  expect(
    await page.getByText('AK-7710-SLV').evaluateAll(elements =>
      elements.some(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
    )
  ).toBe(true);
  await expect(page.getByTestId('commit-inventory-import')).toBeEnabled();
  await page.getByRole('button', { name: '取消', exact: true }).click();
});

test('admin sees validation failures and cannot commit an inconsistent CSV', async ({ page }) => {
  await page.goto('/');
  await switchRole(page, /AK000123A/, 'Administrator (Admin Lin)');
  await openInventory(page);
  await page.getByLabel('Choose inventory file').setInputFiles({
    name: 'invalid-inventory.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'sku_code,warehouse_code,on_hand,unsellable\nUNKNOWN-SKU,WH-SH,10,0\nAK-9042-BLK,WH-SH,10,0\nAK-9042-BLK,WH-SH,10,0\nAK-9042-BLK,WH-SH,10,-2\n'
    ),
  });
  await expect(page.getByRole('heading', { name: /库存导入预览/ })).toBeVisible();
  await expect(page.getByText(/Unknown SKU code/).first()).toBeVisible();
  await expect(page.getByText(/Duplicate SKU \+ warehouse/).first()).toBeVisible();
  await expect(page.getByText(/reserved quantity/).first()).toBeVisible();
  await expect(page.getByTestId('commit-inventory-import')).toBeDisabled();
});

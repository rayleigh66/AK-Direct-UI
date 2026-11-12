import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openInternalTab, waitForInternalWorkspace } from './internalNav';

async function capture(page: Page, name: string) {
  const directory = process.env.WAREHOUSE_SCREENSHOT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: false });
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test('warehouse directory: explicit registration by drag, mobile selection and keyboard', async ({ page }, info) => {
  const email = process.env.REAL_E2E_ADMIN_EMAIL;
  const password = process.env.REAL_E2E_ADMIN_PASSWORD;
  test.skip(!email || !password, 'Requires the isolated real-auth stack and admin.');
  const mobile = info.project.name.includes('mobile');
  const viewportName = mobile ? `mobile-${page.viewportSize()!.width}` : 'desktop-1440';
  const suffix = `${Date.now()}${mobile ? 'M' : 'D'}`;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('input[autocomplete="username"]').fill(email!);
  await page.locator('input[autocomplete="current-password"]').fill(password!);
  await page.getByRole('button', { name: /Sign in/ }).click();
  await waitForInternalWorkspace(page);
  await page.getByTestId('internal-language-toggle').getByRole('button', { name: '中文' }).click();
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const write = async (url: string, data: Record<string, unknown>) => {
    const response = await page.request.post(url, { data, headers: { 'X-CSRF-Token': csrfToken } });
    expect(response.status(), await response.text()).toBe(201); return response.json();
  };
  const source = (await write('/api/admin/warehouses', { code: `SRC-${suffix}`, name: '上海主仓', nameEn: 'Shanghai warehouse' })).warehouse;
  const target = (await write('/api/admin/warehouses', { code: `DST-${suffix}`, name: '广州仓', nameEn: 'Guangzhou warehouse' })).warehouse;
  const closed = (await write('/api/admin/warehouses', { code: `OFF-${suffix}`, name: '停用仓', nameEn: 'Closed warehouse', active: false })).warehouse;
  const product = (await write('/api/admin/catalog/products', { brandId: 'brand-aoking', productCode: `WH-${suffix}`, title: '城市通勤背包', titleEn: 'City commuter pack', category: 'Backpacks' })).product;
  const sku = (await write(`/api/admin/catalog/products/${product.id}/skus`, { skuCode: `WH-${suffix}-BLK`, colorName: '哑光黑', colorNameEn: 'Matte black', colorHex: '#222222', basePriceCents: 3800 })).sku;
  await write('/api/admin/inventory/register', { skuId: sku.id, warehouseId: source.id, onHand: 18, unsellable: 2, reason: 'Source physical count' });
  await openInternalTab(page, 'inventory');
  await page.getByRole('button', { name: '仓库视图', exact: true }).click();
  const skuCombo = page.getByRole('combobox', { name: '搜索并选择 SKU' });
  await skuCombo.fill(sku.skuCode);
  await skuCombo.press('Enter');
  const targetCombo = page.getByRole('combobox', { name: '选择登记仓库' });
  await targetCombo.fill(target.code);
  if (mobile) await page.getByRole('option', { name: new RegExp(target.code) }).click();
  else await targetCombo.press('Enter');
  let registrations = 0, patches = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/api/admin/inventory/register')) registrations++;
    if (request.method() === 'PATCH' && request.url().includes('/api/admin/inventory/')) patches++;
  });
  await fits(page);
  await capture(page, `warehouse-${viewportName}`);
  if (!mobile) {
    const dragSource = page.getByTestId('warehouse-sku-drag');
    const dropTarget = page.getByTestId(`warehouse-card-${target.id}`);
    await dragSource.hover({ position: { x: 15, y: 15 } });
    const box = await dragSource.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.down();
    // Start dragging before target auto-scroll, then issue dragover twice.
    await page.mouse.move(box!.x + 35, box!.y + 15, { steps: 4 });
    await dropTarget.hover({ position: { x: 35, y: 35 } });
    await dropTarget.hover({ position: { x: 40, y: 35 } });
    await page.mouse.up();
  } else await page.getByRole('button', { name: '准备登记' }).click();
  let dialog = page.getByRole('dialog', { name: '确认库存登记' });
  await expect(dialog.getByLabel('登记后在手数量', { exact: true })).toBeVisible();
  expect(registrations).toBe(0); expect(patches).toBe(0);
  await expect(dialog.getByLabel('登记后在手数量', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('登记原因', { exact: true })).toHaveValue('');
  await capture(page, `warehouse-confirm-${viewportName}`);
  // Escape cancels without any POST; selection opens the exact same dialog again.
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible(); expect(registrations).toBe(0);
  const prepare = page.getByRole('button', { name: '准备登记' });
  if (mobile) await prepare.click(); else { await prepare.focus(); await prepare.press('Enter'); }
  dialog = page.getByRole('dialog', { name: '确认库存登记' });
  await expect(dialog.getByLabel('登记后在手数量', { exact: true })).toBeVisible();
  // Focus stays inside the modal, including backwards Tab from the first action.
  await dialog.getByRole('button', { name: '关闭登记窗口' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '确认登记', exact: true })).toBeFocused();
  await dialog.getByLabel('登记后在手数量', { exact: true }).fill('7');
  await dialog.getByLabel('其中不可售数量', { exact: true }).fill('1');
  await dialog.getByLabel('登记原因', { exact: true }).fill('目标仓首次实物盘点');
  await fits(page);
  await capture(page, `warehouse-filled-${viewportName}`);
  await dialog.getByRole('button', { name: '确认登记', exact: true }).click();
  await expect(dialog).not.toBeVisible(); expect(registrations).toBe(1); expect(patches).toBe(0);
  const read = async () => (await (await page.request.get(`/api/admin/inventory?skuId=${sku.id}`)).json()).inventory;
  const rows = await read();
  expect(rows.find((row: { warehouseId: string }) => row.warehouseId === target.id)).toMatchObject({ onHand: 7, unsellable: 1, reserved: 0, available: 6, version: 1 });
  expect(rows.find((row: { warehouseId: string }) => row.warehouseId === source.id)).toMatchObject({ onHand: 18, unsellable: 2, reserved: 0, version: 1 });
  expect(rows.some((row: { warehouseId: string }) => row.warehouseId === closed.id)).toBe(false);
  // The same pair now has an existing-only branch; no overwrite or automatic PATCH.
  await page.getByRole('button', { name: '准备登记' }).click();
  await expect(dialog).toContainText('此 SKU 已在该仓库登记');
  await expect(dialog.getByRole('button', { name: '确认登记', exact: true })).toHaveCount(0);
  expect(registrations).toBe(1); expect(patches).toBe(0);
  await dialog.getByRole('button', { name: '查看／调整已有库存' }).click();
  await expect(page.getByTestId('inventory-adjust-onhand')).toHaveValue('7');
  // A concurrent count advances the version; the old form must fail rather than overwrite it.
  const concurrent = await page.request.patch(`/api/admin/inventory/${sku.id}/${target.id}`, {
    headers: { 'X-CSRF-Token': csrfToken }, data: { onHand: 9, unsellable: 1, expectedVersion: 1, reason: 'Concurrent independent count' },
  });
  expect(concurrent.status()).toBe(200);
  await page.getByTestId('inventory-adjust-onhand').fill('10');
  const conflict = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes(`/api/admin/inventory/${sku.id}/`));
  await page.getByTestId('inventory-adjust-submit').click();
  expect((await conflict).status()).toBe(409);
  expect((await read()).find((row: { warehouseId: string }) => row.warehouseId === target.id)).toMatchObject({ onHand: 9, version: 2 });
  await page.getByRole('button', { name: /Retry|重试/ }).click();
  await expect(page.getByTestId('inventory-row').filter({ hasText: sku.skuCode })).toHaveCount(2);
  await expect(page.getByTestId('inventory-adjust-onhand')).toHaveValue('9');
  await page.getByTestId('inventory-adjust-onhand').fill('10');
  const adjusted = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes(`/api/admin/inventory/${sku.id}/`));
  await page.getByTestId('inventory-adjust-submit').click();
  expect((await adjusted).status()).toBe(200);
  await expect(page.getByTestId('inventory-adjust-onhand')).not.toBeVisible();
  expect((await read()).find((row: { warehouseId: string }) => row.warehouseId === target.id)).toMatchObject({ onHand: 10, version: 3 });
  // Names reuse the name-only API; immutable identifiers and inventory stay intact.
  await page.getByRole('button', { name: '仓库视图', exact: true }).click();
  const card = page.getByTestId(`warehouse-card-${target.id}`);
  await card.getByTestId('warehouse-edit').click();
  for (const language of ['zh', 'en']) {
    const field = card.getByTestId(`warehouse-edit-name-${language}`);
    const selection = () => field.evaluate((element: HTMLInputElement) => ({ start: element.selectionStart, end: element.selectionEnd, length: element.value.length }));
    await card.getByTestId('warehouse-edit-save').focus();
    if (mobile) await field.tap(); else await field.click();
    await expect.poll(selection).toMatchObject({ start: 0, end: (await selection()).length });
    // Another click in the same focus session can place a normal caret.
    if (mobile) await field.tap({ position: { x: 15, y: 20 } });
    else await field.click({ position: { x: 15, y: 20 } });
    await expect.poll(async () => { const range = await selection(); return range.start === range.end; }).toBe(true);
    await card.getByTestId('warehouse-edit-cancel').focus();
    await field.focus();
    await expect.poll(selection).toMatchObject({ start: 0, end: (await selection()).length });
  }
  await fits(page);
  await capture(page, `warehouse-name-editor-${viewportName}`);
  await card.getByTestId('warehouse-edit-name-zh').fill('广州盘点仓');
  await card.getByTestId('warehouse-edit-name-en').fill('Guangzhou counted');
  await card.getByTestId('warehouse-edit-save').click();
  await expect(card).toContainText('Guangzhou counted');
  await expect(card).toContainText(target.code);
  await fits(page);
  if (!mobile) {
    for (const width of [768, 430]) {
      await page.setViewportSize({ width, height: 1000 }); await fits(page);
      await capture(page, `warehouse-responsive-${width}`);
    }
  }
  expect(errors).toEqual([]);
});

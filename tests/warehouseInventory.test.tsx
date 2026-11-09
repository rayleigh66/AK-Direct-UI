// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { InventoryView } from '../src/real/views/InventoryView';
import * as api from '../src/real/api';
import { AuthApiError } from '../src/auth/api';
import { InternalLanguageProvider } from '../src/real/internalLanguage';
import type { InventoryRowDto, ProductDto, WarehouseDto } from '../src/real/types';

vi.mock('../src/real/api');
const stamp = '2026-11-09T08:00:00.000Z';
const warehouses: WarehouseDto[] = [
  { id: 'wh-a', code: 'WH-A', name: '上海仓', nameEn: 'Shanghai', active: true, createdAt: stamp, updatedAt: stamp },
  { id: 'wh-b', code: 'WH-B', name: '广州仓', nameEn: 'Guangzhou', active: true, createdAt: stamp, updatedAt: stamp },
  { id: 'wh-c', code: 'WH-C', name: '停用仓', nameEn: 'Closed', active: false, createdAt: stamp, updatedAt: stamp },
];
const products: ProductDto[] = [{
  id: 'product-1', brandId: 'brand-aoking', brandCode: 'AOKING', brandName: 'AOKING', productCode: 'AK-WH',
  title: '旅行背包', titleEn: 'Travel pack', description: '', descriptionEn: '', category: 'Backpacks',
  material: '', capacityOrSize: '', seriesId: null, tagIds: [], published: false, publishedAt: null,
  skus: [
    { id: 'sku-1', productId: 'product-1', skuCode: 'AK-WH-BLK', colorName: '黑色', colorNameEn: 'Black', colorHex: '#000000', basePriceCents: 3000, sellableStatus: 'active', imageId: null, imageUrl: null },
    { id: 'sku-2', productId: 'product-1', skuCode: 'AK-WH-GRY', colorName: '灰色', colorNameEn: 'Grey', colorHex: '#888888', basePriceCents: 3000, sellableStatus: 'discontinued', imageId: null, imageUrl: null },
  ], images: [], createdAt: stamp, updatedAt: stamp,
}];
const existing: InventoryRowDto = {
  skuId: 'sku-1', skuCode: 'AK-WH-BLK', productId: 'product-1', productCode: 'AK-WH', productTitle: '旅行背包', colorHex: '#000000',
  warehouseId: 'wh-a', warehouseCode: 'WH-A', warehouseName: '上海仓', onHand: 14, reserved: 3, unsellable: 2, available: 9, version: 4, updatedAt: stamp,
};
let serverRows: InventoryRowDto[];
let serverWarehouses: WarehouseDto[];
beforeEach(() => {
  window.localStorage.setItem('aoking.internal.language.warehouse-test', 'zh');
  vi.resetAllMocks(); serverRows = [existing]; serverWarehouses = warehouses.map(item => ({ ...item }));
  vi.mocked(api.listAdminProducts).mockResolvedValue(products);
  vi.mocked(api.listWarehouses).mockImplementation(async () => serverWarehouses);
  vi.mocked(api.updateWarehouse).mockImplementation(async (id, input) => {
    serverWarehouses = serverWarehouses.map(item => item.id === id ? { ...item, ...input } as WarehouseDto : item);
    return serverWarehouses.find(item => item.id === id)!;
  });
  vi.mocked(api.listAdminInventory).mockImplementation(async filters => {
    if (typeof filters === 'object' && filters) return serverRows.filter(row => row.skuId === filters.skuId && row.warehouseId === filters.warehouseId);
    return serverRows;
  });
  vi.mocked(api.listInventory).mockResolvedValue([existing]);
  vi.mocked(api.registerInventory).mockImplementation(async input => {
    const row = { ...existing, skuId: String(input.skuId), skuCode: input.skuId === 'sku-2' ? 'AK-WH-GRY' : 'AK-WH-BLK', warehouseId: String(input.warehouseId), warehouseCode: 'WH-B', warehouseName: '广州仓',
      onHand: Number(input.onHand), reserved: 0, unsellable: Number(input.unsellable), available: Number(input.onHand) - Number(input.unsellable), version: 1 };
    serverRows = [...serverRows, row]; return row;
  });
});
afterEach(cleanup);
async function openBoard() {
  render(<InternalLanguageProvider userKey="warehouse-test"><InventoryView canManage canRead internal /></InternalLanguageProvider>);
  await screen.findAllByTestId('inventory-row');
  fireEvent.click(screen.getByRole('button', { name: '仓库视图' }));
  return screen.findByTestId('warehouse-view');
}
async function chooseSku(code = 'AK-WH-GRY') {
  const combo = screen.getByRole('combobox', { name: '搜索并选择 SKU' });
  fireEvent.focus(combo); fireEvent.change(combo, { target: { value: code } });
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(code) }));
}
async function chooseTarget(code = 'WH-B') {
  const combo = screen.getByRole('combobox', { name: '选择登记仓库' });
  fireEvent.focus(combo); fireEvent.change(combo, { target: { value: code } });
  fireEvent.click(await within(screen.getByRole('listbox', { name: '选择登记仓库' })).findByRole('option', { name: new RegExp(code) }));
  fireEvent.click(screen.getByRole('button', { name: '准备登记' }));
  return screen.findByRole('dialog', { name: '确认库存登记' });
}
async function fillRegistration(dialog: HTMLElement, quantity = '7', reason = '首次盘点，明确登记数量') {
  fireEvent.change(within(dialog).getByLabelText('登记后在手数量'), { target: { value: quantity } });
  fireEvent.change(within(dialog).getByLabelText('登记原因'), { target: { value: reason } });
}

describe('administrator warehouse registration', () => {
  it('finds directory SKUs with no inventory record and lets keyboard/mobile selection cancel without writing', async () => {
    await openBoard();
    const combo = screen.getByRole('combobox', { name: '搜索并选择 SKU' });
    fireEvent.focus(combo); fireEvent.change(combo, { target: { value: '灰色' } });
    fireEvent.keyDown(combo, { key: 'Enter' });
    expect((combo as HTMLInputElement).value).toContain('AK-WH-GRY');
    expect(api.registerInventory).not.toHaveBeenCalled();
    const dialog = await chooseTarget();
    expect(within(dialog).getByText(/AK-WH-GRY/)).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.registerInventory).not.toHaveBeenCalled(); expect(api.adjustInventory).not.toHaveBeenCalled();
  });

  it('drop only opens confirmation; quantities and reason must be explicitly confirmed once', async () => {
    await openBoard(); await chooseSku();
    const values = new Map<string, string>();
    const dataTransfer = { setData: (key: string, value: string) => values.set(key, value), getData: (key: string) => values.get(key) ?? '', effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(screen.getByTestId('warehouse-sku-drag'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('warehouse-card-wh-b'), { dataTransfer });
    const dialog = await screen.findByRole('dialog', { name: '确认库存登记' });
    await waitFor(() => expect(within(dialog).getByLabelText('登记后在手数量')).toBeTruthy());
    expect(api.registerInventory).not.toHaveBeenCalled();
    expect((within(dialog).getByLabelText('登记后在手数量') as HTMLInputElement).value).toBe('');
    expect((within(dialog).getByLabelText('登记原因') as HTMLInputElement).value).toBe('');
    await fillRegistration(dialog);
    await act(async () => {
      const button = within(dialog).getByRole('button', { name: '确认登记' });
      fireEvent.click(button); fireEvent.click(button);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.registerInventory).toHaveBeenCalledTimes(1);
    expect(api.registerInventory).toHaveBeenCalledWith({ skuId: 'sku-2', warehouseId: 'wh-b', onHand: 7, unsellable: 0, reason: '首次盘点，明确登记数量' });
    expect(serverRows.find(row => row.warehouseId === 'wh-a')).toMatchObject({ onHand: 14, reserved: 3, version: 4 });
    expect(api.adjustInventory).not.toHaveBeenCalled();
  });

  it.each(['', '-1', '1.5', '100000001'])('rejects invalid on-hand input %j without stock writes', async value => {
    await openBoard(); await chooseSku(); const dialog = await chooseTarget();
    await fillRegistration(dialog, value);
    fireEvent.submit(within(dialog).getByTestId('warehouse-registration-form'));
    expect(api.registerInventory).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toBeTruthy();
  });

  it('allows explicitly confirmed zero stock without customer MOQ or stock clamping', async () => {
    await openBoard(); await chooseSku(); const dialog = await chooseTarget();
    await fillRegistration(dialog, '0'); fireEvent.submit(within(dialog).getByTestId('warehouse-registration-form'));
    await waitFor(() => expect(api.registerInventory).toHaveBeenCalledTimes(1));
    expect(api.registerInventory).toHaveBeenCalledWith(expect.objectContaining({ onHand: 0, unsellable: 0 }));
  });

  it('rejects missing reason and an impossible unsellable quantity', async () => {
    await openBoard(); await chooseSku(); const dialog = await chooseTarget();
    await fillRegistration(dialog, '2', ''); fireEvent.submit(within(dialog).getByTestId('warehouse-registration-form'));
    expect(api.registerInventory).not.toHaveBeenCalled();
    await fillRegistration(dialog, '2');
    fireEvent.change(within(dialog).getByLabelText('其中不可售数量'), { target: { value: '3' } });
    fireEvent.submit(within(dialog).getByTestId('warehouse-registration-form'));
    expect(api.registerInventory).not.toHaveBeenCalled();
  });

  it('shows an existing tuple and links to versioned adjustment without registering or auto-adjusting', async () => {
    await openBoard(); await chooseSku('AK-WH-BLK'); const dialog = await chooseTarget('WH-A');
    await within(dialog).findByText(/此 SKU 已在该仓库登记/);
    expect(within(dialog).queryByRole('button', { name: '确认登记' })).toBeNull();
    expect(api.registerInventory).not.toHaveBeenCalled(); expect(api.adjustInventory).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '查看／调整已有库存' }));
    const adjust = await screen.findByTestId('inventory-adjust-onhand');
    fireEvent.change(adjust, { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('inventory-adjust-submit'));
    await waitFor(() => expect(api.adjustInventory).toHaveBeenCalledWith('sku-1', 'wh-a', expect.objectContaining({ onHand: 15, expectedVersion: 4 })));
  });

  it('retains quantity and reason on server validation failure', async () => {
    vi.mocked(api.registerInventory).mockRejectedValue(new AuthApiError(422, 'invalid_inventory', 'Inventory rejected.'));
    await openBoard(); await chooseSku(); const dialog = await chooseTarget(); await fillRegistration(dialog);
    fireEvent.submit(within(dialog).getByTestId('warehouse-registration-form'));
    await within(dialog).findByText('Inventory rejected.');
    expect((within(dialog).getByLabelText('登记后在手数量') as HTMLInputElement).value).toBe('7');
    expect((within(dialog).getByLabelText('登记原因') as HTMLInputElement).value).toBe('首次盘点，明确登记数量');
  });

  it('resolves a concurrent inventory_exists with a fresh read, never an automatic PATCH', async () => {
    vi.mocked(api.registerInventory).mockImplementation(async () => {
      serverRows.push({ ...existing, skuId: 'sku-2', skuCode: 'AK-WH-GRY', warehouseId: 'wh-b', warehouseCode: 'WH-B' });
      throw new AuthApiError(409, 'inventory_exists', 'Already exists.');
    });
    await openBoard(); await chooseSku(); const dialog = await chooseTarget(); await fillRegistration(dialog);
    fireEvent.submit(within(dialog).getByTestId('warehouse-registration-form'));
    await within(dialog).findByText(/此 SKU 已在该仓库登记/);
    expect(api.registerInventory).toHaveBeenCalledTimes(1); expect(api.adjustInventory).not.toHaveBeenCalled();
  });

  it('does not resubmit after a successful write if the subsequent list refresh fails', async () => {
    await openBoard(); await chooseSku(); const dialog = await chooseTarget(); await fillRegistration(dialog);
    vi.mocked(api.listAdminInventory).mockRejectedValueOnce(new Error('Refresh failed.'));
    fireEvent.submit(within(dialog).getByTestId('warehouse-registration-form'));
    await within(dialog).findByText(/已登记成功.*刷新/);
    expect(within(dialog).queryByRole('button', { name: '确认登记' })).toBeNull();
    expect(api.registerInventory).toHaveBeenCalledTimes(1);
  });

  it('requires status lookup before retrying an unknown network result', async () => {
    vi.mocked(api.registerInventory).mockRejectedValue(new TypeError('Network unavailable.'));
    await openBoard(); await chooseSku(); const dialog = await chooseTarget(); await fillRegistration(dialog);
    fireEvent.submit(within(dialog).getByTestId('warehouse-registration-form'));
    await within(dialog).findByText(/提交结果尚未确认/);
    expect((within(dialog).getByRole('button', { name: '确认登记' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: '查询最新状态' }));
    await waitFor(() => expect((within(dialog).getByRole('button', { name: '确认登记' }) as HTMLButtonElement).disabled).toBe(false));
    expect(api.registerInventory).toHaveBeenCalledTimes(1);
  });

  it('reconciles a lost response with the committed row instead of sending another POST', async () => {
    vi.mocked(api.registerInventory).mockImplementation(async input => {
      serverRows.push({ ...existing, skuId: String(input.skuId), warehouseId: String(input.warehouseId), warehouseCode: 'WH-B', onHand: 7, version: 1 });
      throw new TypeError('Response lost after commit');
    });
    await openBoard(); await chooseSku(); const dialog = await chooseTarget(); await fillRegistration(dialog);
    fireEvent.submit(within(dialog).getByTestId('warehouse-registration-form'));
    await within(dialog).findByText(/提交结果尚未确认/);
    fireEvent.click(within(dialog).getByRole('button', { name: '查询最新状态' }));
    await within(dialog).findByText(/此 SKU 已在该仓库登记/);
    expect(within(dialog).queryByRole('button', { name: '确认登记' })).toBeNull();
    expect(api.registerInventory).toHaveBeenCalledTimes(1); expect(api.adjustInventory).not.toHaveBeenCalled();
  });

  it('blocks inactive or forged drop targets', async () => {
    await openBoard(); await chooseSku();
    fireEvent.drop(screen.getByTestId('warehouse-card-wh-c'), { dataTransfer: { getData: () => 'sku-2' } });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.drop(screen.getByTestId('warehouse-card-wh-b'), { dataTransfer: { getData: () => 'forged-sku' } });
    expect(screen.queryByRole('dialog')).toBeNull(); expect(api.registerInventory).not.toHaveBeenCalled();
  });

  it('ignores a pending lookup after cancelling the dialog', async () => {
    await openBoard(); await chooseSku();
    let release!: (rows: InventoryRowDto[]) => void;
    vi.mocked(api.listAdminInventory).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const dialog = await chooseTarget();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await act(async () => release([]));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.registerInventory).not.toHaveBeenCalled();
  });

  it('edits warehouse names through the existing API while preserving its code and ID', async () => {
    await openBoard();
    const card = screen.getByTestId('warehouse-card-wh-b');
    fireEvent.click(within(card).getByTestId('warehouse-edit'));
    fireEvent.change(within(card).getByTestId('warehouse-edit-name-zh'), { target: { value: '广州新仓' } });
    fireEvent.change(within(card).getByTestId('warehouse-edit-name-en'), { target: { value: 'Guangzhou new' } });
    fireEvent.click(within(card).getByTestId('warehouse-edit-save'));
    await within(card).findByText('广州新仓');
    expect(api.updateWarehouse).toHaveBeenCalledWith('wh-b', { name: '广州新仓', nameEn: 'Guangzhou new' });
    expect(serverWarehouses[1]).toMatchObject({ id: 'wh-b', code: 'WH-B', active: true });
    expect(api.registerInventory).not.toHaveBeenCalled(); expect(api.adjustInventory).not.toHaveBeenCalled();
  });

  it('views only the selected warehouse ID when warehouse codes share a prefix', async () => {
    serverWarehouses.push({ ...warehouses[1], id: 'wh-d', code: 'WH-A2' });
    serverRows.push({ ...existing, warehouseId: 'wh-d', warehouseCode: 'WH-A2' });
    await openBoard();
    fireEvent.click(within(screen.getByTestId('warehouse-card-wh-a')).getByRole('button', { name: '查看该仓库全部记录' }));
    expect(screen.getAllByTestId('inventory-row')).toHaveLength(1);
    expect(within(screen.getByTestId('inventory-row')).getByText('WH-A')).toBeTruthy();
  });

  it.each(['zh', 'en'])('selects the warehouse %s name on each new focus, preserving a focused caret', async language => {
    await openBoard();
    const card = screen.getByTestId('warehouse-card-wh-b');
    fireEvent.click(within(card).getByTestId('warehouse-edit'));
    const field = within(card).getByTestId(`warehouse-edit-name-${language}`) as HTMLInputElement;
    const other = within(card).getByTestId(`warehouse-edit-name-${language === 'zh' ? 'en' : 'zh'}`) as HTMLInputElement;
    act(() => field.focus());
    expect(field.selectionStart).toBe(0); expect(field.selectionEnd).toBe(field.value.length);
    field.setSelectionRange(1, 1);
    fireEvent.pointerDown(field); fireEvent.pointerUp(field); fireEvent.mouseUp(field);
    expect(field.selectionStart).toBe(1); expect(field.selectionEnd).toBe(1);
    act(() => other.focus()); act(() => field.focus());
    expect(field.selectionStart).toBe(0); expect(field.selectionEnd).toBe(field.value.length);
    expect(api.updateWarehouse).not.toHaveBeenCalled();
  });

  it('preserves warehouse validation, failed-save feedback and cancellation without changing identity', async () => {
    await openBoard(); const card = screen.getByTestId('warehouse-card-wh-b');
    fireEvent.click(within(card).getByTestId('warehouse-edit'));
    const name = within(card).getByTestId('warehouse-edit-name-zh');
    fireEvent.change(name, { target: { value: '  ' } });
    fireEvent.click(within(card).getByTestId('warehouse-edit-save'));
    expect(api.updateWarehouse).not.toHaveBeenCalled();
    expect(within(card).getByRole('alert').textContent).toContain('required');
    fireEvent.change(name, { target: { value: '未保存名称' } });
    vi.mocked(api.updateWarehouse).mockRejectedValueOnce(new Error('Name update rejected.'));
    fireEvent.click(within(card).getByTestId('warehouse-edit-save'));
    await within(card).findByText('Name update rejected.');
    expect((name as HTMLInputElement).value).toBe('未保存名称');
    fireEvent.click(within(card).getByTestId('warehouse-edit-cancel'));
    expect(within(card).queryByTestId('warehouse-edit-name-zh')).toBeNull();
    expect(serverWarehouses[1]).toMatchObject({ id: 'wh-b', code: 'WH-B', name: '广州仓', nameEn: 'Guangzhou' });
    fireEvent.click(within(card).getByTestId('warehouse-edit'));
    expect((within(card).getByTestId('warehouse-edit-name-zh') as HTMLInputElement).value).toBe('广州仓');
  });

  it('does not expose warehouse management or drag controls to read-only users', async () => {
    render(<InternalLanguageProvider userKey="warehouse-test"><InventoryView canManage={false} canRead internal /></InternalLanguageProvider>);
    await screen.findAllByTestId('inventory-row');
    expect(screen.queryByRole('button', { name: '仓库视图' })).toBeNull();
    expect(screen.queryByTestId('warehouse-sku-drag')).toBeNull();
    expect(api.listAdminProducts).not.toHaveBeenCalled(); expect(api.registerInventory).not.toHaveBeenCalled();
  });
});

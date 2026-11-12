// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InternalLanguageProvider } from '../src/real/internalLanguage';
import type { CustomerOrderDto, InternalOrderDto } from '../src/real/types';

vi.mock('../src/real/RealWorkspace', () => ({
  ErrorBlock: ({ message }: { message: string }) => message,
  LoadingBlock: () => null,
}));

vi.mock('../src/real/api', () => ({
  cancelCustomerOrder: vi.fn(),
  confirmSalesOrder: vi.fn(),
  decidePlanAcceptance: vi.fn(),
  getAdminCompany: vi.fn(),
  getAdminOrder: vi.fn(),
  getCustomerOrder: vi.fn(),
  getSalesOrder: vi.fn(),
  listAdminOrders: vi.fn(),
  listCustomerOrders: vi.fn(),
  listSalesOrders: vi.fn(),
  listSalesUsers: vi.fn(),
  listSalesWarehouses: vi.fn(),
  modifyOrderLines: vi.fn(),
  requestOrderExtension: vi.fn(),
  requestOrderRelease: vi.fn(),
  saveSalesPlan: vi.fn(),
}));

import { OrdersView } from '../src/real/views/OrdersView';
import * as api from '../src/real/api';

const line = {
  id: 'line-1',
  lineNumber: 1,
  skuId: 'sku-1',
  productId: 'product-1',
  productCode: 'UAT-PR18-001',
  productTitle: 'PR18 UAT 旅行背包',
  productTitleEn: 'PR18 UAT Travel Pack',
  skuCode: 'UAT-PR18-001-BLK',
  colorName: '曜石黑',
  colorNameEn: 'Obsidian Black',
  colorHex: '#23272B',
  quantity: 12,
  baseUnitPriceCents: 4200,
  referenceUnitPriceCents: 4200,
  lineReferenceCents: 50400,
  priceSource: 'base_price' as const,
  pricingVersion: 'pricing-v1',
};

function internalOrder(overrides: Partial<InternalOrderDto> = {}): InternalOrderDto {
  return {
    id: 'order-1',
    orderNo: 'OD2611100001',
    status: 'PENDING_CONFIRMATION',
    statusLabel: 'Pending confirmation',
    revision: 1,
    lines: [line],
    referenceTotalCents: 50400,
    finalTotalCents: null,
    pricingMode: 'base_reference',
    pricingVersion: 'pricing-v1',
    isReferenceQuote: true,
    priceNote: 'Reference prices only.',
    shippingMethod: 'Sea',
    destinationCountryAlpha3: 'USA',
    expectedShipDate: '2026-12-01',
    shippingRequirements: '',
    customerVisibleNote: 'Awaiting sales confirmation.',
    submittedAt: '2026-11-10T08:00:00.000Z',
    updatedAt: '2026-11-10T08:00:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    cancellationKind: null,
    currentPlan: null,
    planHistory: [],
    acceptance: null,
    canAcceptPlan: false,
    buyerAuthorized: false,
    confirmation: null,
    history: [
      {
        eventType: 'SUBMITTED',
        fromStatus: null,
        toStatus: 'PENDING_CONFIRMATION',
        reason: 'Submitted',
        createdAt: '2026-11-10T08:00:00.000Z',
        actorType: 'customer',
        actorLabel: 'UAT Customer',
        details: {},
      },
    ],
    company: { id: 'company-1', customerCode: 'C180018', shortName: 'PR18 UAT Customer' },
    submittedByUsername: 'AK180018A',
    assignedSalesUserId: 'sales-1',
    currentAssignedSalesUserId: 'sales-1',
    pendingPriceApproval: false,
    pendingExtensionRequest: false,
    pendingReleaseRequest: false,
    ...overrides,
  };
}

function customerOrder(overrides: Partial<CustomerOrderDto> = {}): CustomerOrderDto {
  return {
    id: 'order-2',
    orderNo: 'OD2611100002',
    status: 'PENDING_CONFIRMATION',
    statusLabel: 'Pending confirmation',
    revision: 1,
    lines: [line],
    referenceTotalCents: 50400,
    finalTotalCents: null,
    pricingMode: 'base_reference',
    pricingVersion: 'pricing-v1',
    isReferenceQuote: true,
    priceNote: 'Reference prices only.',
    shippingMethod: 'Sea',
    destinationCountryAlpha3: 'USA',
    expectedShipDate: '2026-12-01',
    shippingRequirements: '',
    customerVisibleNote: 'Awaiting sales confirmation.',
    submittedAt: '2026-11-10T08:00:00.000Z',
    updatedAt: '2026-11-10T08:00:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    cancellationKind: null,
    currentPlan: null,
    planHistory: [],
    acceptance: null,
    canAcceptPlan: false,
    buyerAuthorized: false,
    confirmation: null,
    history: [
      {
        eventType: 'SUBMITTED',
        fromStatus: null,
        toStatus: 'PENDING_CONFIRMATION',
        reason: 'Submitted',
        createdAt: '2026-11-10T08:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function renderOrders(scope: 'customer' | 'sales' | 'admin') {
  return render(
    <InternalLanguageProvider userKey={`orders-drawer-${scope}`}>
      <OrdersView scope={scope} />
    </InternalLanguageProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  vi.mocked(api.listSalesUsers).mockResolvedValue([]);
  vi.mocked(api.listSalesWarehouses).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('internal order details', () => {
  it('opens salesperson order details in the shared drawer, not under the list', async () => {
    const order = internalOrder();
    vi.mocked(api.listSalesOrders).mockResolvedValue([order]);
    vi.mocked(api.getSalesOrder).mockResolvedValue(order);
    const scrollTo = vi.mocked(window.scrollTo);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 420 });

    renderOrders('sales');
    const card = await screen.findByTestId('internal-order-card');
    fireEvent.click(card);

    const drawer = await screen.findByTestId('order-detail-drawer');
    expect(drawer.textContent).toContain(order.orderNo);
    expect(drawer.textContent).toContain('Reference');
    expect(screen.getAllByTestId('order-detail')).toHaveLength(1);
    expect(drawer.className).toContain('w-full');
    expect(screen.getByTestId('sales-plan-editor')).toBeTruthy();
    expect(screen.getByTestId('sales-plan-save')).toBeTruthy();

    fireEvent.click(screen.getByTestId('order-drawer-close'));
    await waitFor(() => expect(screen.queryByTestId('order-detail-drawer')).toBeNull(), {
      timeout: 2_000,
    });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 420), { timeout: 2_000 });
  });

  it('keeps customer order details inline with no drawer', async () => {
    const order = customerOrder();
    vi.mocked(api.listCustomerOrders).mockResolvedValue([order]);
    vi.mocked(api.getCustomerOrder).mockResolvedValue(order);

    renderOrders('customer');
    const card = await screen.findByTestId('customer-order-card');
    fireEvent.click(card);

    const detail = await screen.findByTestId('order-detail');
    expect(detail.textContent).toContain(order.orderNo);
    expect(screen.queryByTestId('order-detail-drawer')).toBeNull();
    expect(screen.getByTestId('order-modify-save')).toBeTruthy();
  });

  it('keeps administrator order details in the shared drawer', async () => {
    const order = internalOrder();
    vi.mocked(api.listAdminOrders).mockResolvedValue([order]);
    vi.mocked(api.getAdminOrder).mockResolvedValue(order);

    renderOrders('admin');
    fireEvent.click(await screen.findByTestId('internal-order-card'));

    const drawer = await screen.findByTestId('order-detail-drawer');
    expect(drawer.textContent).toContain(order.orderNo);
    expect(screen.getAllByTestId('order-detail')).toHaveLength(1);
  });

  it('names the sales drawer close button in the current internal language', async () => {
    const order = internalOrder();
    vi.mocked(api.listSalesOrders).mockResolvedValue([order]);
    vi.mocked(api.getSalesOrder).mockResolvedValue(order);

    window.localStorage.setItem('aoking.internal.language.orders-drawer-sales', 'zh');
    renderOrders('sales');
    fireEvent.click(await screen.findByTestId('internal-order-card'));
    const zhClose = await screen.findByTestId('order-drawer-close');
    await waitFor(() => expect(zhClose.getAttribute('aria-label')).toBe('关闭'), {
      timeout: 2_000,
    });

    fireEvent.click(zhClose);
    await waitFor(() => expect(screen.queryByTestId('order-detail-drawer')).toBeNull(), {
      timeout: 2_000,
    });
    cleanup();

    window.localStorage.removeItem('aoking.internal.language.orders-drawer-sales');
    renderOrders('sales');
    fireEvent.click(await screen.findByTestId('internal-order-card'));
    const enClose = await screen.findByTestId('order-drawer-close');
    expect(enClose.getAttribute('aria-label')).toBe('Close');
  });

  it('closes the sales drawer with Escape and restores scroll lock and focus', async () => {
    const order = internalOrder();
    vi.mocked(api.listSalesOrders).mockResolvedValue([order]);
    vi.mocked(api.getSalesOrder).mockResolvedValue(order);
    const scrollTo = vi.mocked(window.scrollTo);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 });

    renderOrders('sales');
    const card = await screen.findByTestId('internal-order-card');
    (card as HTMLElement).focus({ preventScroll: true });
    expect(document.activeElement).toBe(card);
    fireEvent.click(card);
    await screen.findByTestId('order-detail-drawer');

    // The body is frozen at the current offset while the drawer is open.
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-640px');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('order-detail-drawer')).toBeNull(), {
      timeout: 2_000,
    });
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
    expect(document.body.style.top).toBe('');
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 640), { timeout: 2_000 });
    expect(document.activeElement).toBe(card);
  });

  it('closes the sales drawer when the overlay is clicked', async () => {
    const order = internalOrder();
    vi.mocked(api.listSalesOrders).mockResolvedValue([order]);
    vi.mocked(api.getSalesOrder).mockResolvedValue(order);

    renderOrders('sales');
    fireEvent.click(await screen.findByTestId('internal-order-card'));
    await screen.findByTestId('order-detail-drawer');

    fireEvent.click(screen.getByTestId('order-detail-drawer-overlay'));
    await waitFor(() => expect(screen.queryByTestId('order-detail-drawer')).toBeNull(), {
      timeout: 2_000,
    });
    expect(screen.queryByTestId('order-detail')).toBeNull();
  });
});

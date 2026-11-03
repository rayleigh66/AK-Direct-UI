// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { AppProvider, useApp } from '../src/context/AppContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);
const setup = () => renderHook(() => useApp(), { wrapper });
const as = (result: { current: ReturnType<typeof useApp> }, role: 'customer' | 'sales' | 'admin') => {
  act(() => {
    result.current.switchRole(role, role === 'customer' ? 'user-001a' : undefined);
  });
};

const shipping = {
  shippingMethod: 'Sea' as const,
  destinationCountryAlpha3: 'USA',
  expectedShipDate: '2026-12-15',
  shippingRequirements: 'Standard export carton.',
};

afterEach(cleanup);

describe('frontend business-operation role checks', () => {
  it('blocks customer ordering operations for internal roles', () => {
    const { result } = setup();
    as(result, 'sales');
    act(() => {
      expect(result.current.addToCart('sku-9042-blk', 10).success).toBe(false);
      expect(result.current.submitOrder(shipping).success).toBe(false);
      expect(result.current.customerCancelOrder('ord-001', 'test').success).toBe(false);
      expect(
        result.current.customerRequestChange('ord-001', 'test', [
          { sku_id: 'sku-9042-blk', new_qty: 30 },
        ]).success
      ).toBe(false);
    });

    as(result, 'admin');
    act(() => {
      expect(result.current.addToCart('sku-9042-blk', 10).success).toBe(false);
      expect(result.current.submitOrder(shipping).success).toBe(false);
    });
    as(result, 'customer');
    act(() => {
      expect(result.current.addToCart('sku-9042-blk', 10).success).toBe(true);
    });
  });

  it('blocks admin configuration and inventory import for sales and customers', () => {
    const { result } = setup();
    const tierBefore = result.current.tierRules.find(tier => tier.id === 'tier-3')!;
    const promotionCount = result.current.promotions.length;
    const companyCount = result.current.companies.length;

    for (const role of ['customer', 'sales'] as const) {
      as(result, role);
      act(() => {
        expect(result.current.adminUpdateTierRule('tier-3', 50000, 0.2).success).toBe(false);
        expect(
          result.current.adminAddOrUpdatePromotion({
            sku_id: 'sku-9042-blk',
            promo_price_usd: 20,
            start_at: '2026-11-01',
            end_at: '2026-12-01',
            stack_tier_discount: false,
            status: 'active',
          }).success
        ).toBe(false);
        expect(
          result.current.adminCreateCompany({
            customerCode: 'C009999',
            shortName: 'Blocked Co',
            countryAlpha3: 'USA',
          }).success
        ).toBe(false);
        expect(result.current.adminSetProductActive('prod-9042', false).success).toBe(false);
        expect(result.current.adminToggleBrandGrant('comp-001', 'brand-aoking').success).toBe(false);
        expect(
          result.current.excelImportStock([
            { sku_code: 'AK-9042-BLK', warehouse_code: 'WH-SH', on_hand: 100, unsellable: 0 },
          ]).success
        ).toBe(false);
      });
    }

    expect(result.current.tierRules.find(tier => tier.id === 'tier-3')).toEqual(tierBefore);
    expect(result.current.promotions).toHaveLength(promotionCount);
    expect(result.current.companies).toHaveLength(companyCount);
    expect(result.current.products.find(product => product.id === 'prod-9042')?.active).toBe(true);

    as(result, 'admin');
    act(() => {
      expect(result.current.adminUpdateTierRule('tier-3', 50000, 0.2).success).toBe(true);
      expect(
        result.current.excelImportStock([
          { sku_code: 'AK-9042-BLK', warehouse_code: 'WH-SH', on_hand: 100, unsellable: 0 },
        ]).success
      ).toBe(true);
    });
  });

  it('keeps sales operations available to sales and admin but not customers', () => {
    const customer = setup();
    as(customer.result, 'customer');
    act(() => {
      expect(customer.result.current.salesExtendReservation('ord-001', 48).success).toBe(false);
    });

    const sales = setup();
    as(sales.result, 'sales');
    act(() => {
      expect(sales.result.current.salesExtendReservation('ord-001', 48).success).toBe(true);
    });

    const admin = setup();
    as(admin.result, 'admin');
    act(() => {
      expect(admin.result.current.salesExtendReservation('ord-001', 48).success).toBe(true);
    });
  });

  it('keeps inactivity simulation admin-only and preserves the customer tier otherwise', () => {
    const { result } = setup();
    const before = result.current.companies.find(company => company.id === 'comp-001')!
      .months_inactive;
    as(result, 'customer');
    act(() => {
      expect(result.current.simulateTimeTravelInactivity('comp-001', 18).success).toBe(false);
    });
    expect(
      result.current.companies.find(company => company.id === 'comp-001')!.months_inactive
    ).toBe(before);

    as(result, 'sales');
    act(() => {
      expect(result.current.simulateTimeTravelInactivity('comp-001', 18).success).toBe(false);
    });
    expect(
      result.current.companies.find(company => company.id === 'comp-001')!.months_inactive
    ).toBe(before);

    as(result, 'admin');
    act(() => {
      expect(result.current.simulateTimeTravelInactivity('comp-001', 18).success).toBe(true);
    });
    expect(
      result.current.companies.find(company => company.id === 'comp-001')!.months_inactive
    ).toBe(before + 18);
  });
});

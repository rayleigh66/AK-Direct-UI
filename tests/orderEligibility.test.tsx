// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { AppProvider, useApp } from '../src/context/AppContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);
const setup = () => renderHook(() => useApp(), { wrapper });
const shipping = {
  shippingMethod: 'Sea' as const,
  destinationCountryAlpha3: 'USA',
  expectedShipDate: '2026-12-15',
  shippingRequirements: 'Standard export carton.',
};

afterEach(cleanup);

describe('customer order eligibility', () => {
  it('blocks an old cart after the product is unpublished and allows it after relisting', () => {
    const { result } = setup();
    act(() => {
      expect(result.current.addToCart('sku-9042-blk', 10).success).toBe(true);
    });
    const orderCount = result.current.orders.length;
    act(() => {
      expect(result.current.adminSetProductActive('prod-9042', false).success).toBe(true);
    });
    act(() => {
      const rejected = result.current.submitOrder(shipping);
      expect(rejected.success).toBe(false);
      expect(rejected.error).toMatch(/product is no longer available/i);
    });
    expect(result.current.cart).toEqual([{ sku_id: 'sku-9042-blk', quantity: 10 }]);
    expect(result.current.orders).toHaveLength(orderCount);

    act(() => {
      expect(result.current.adminSetProductActive('prod-9042', true).success).toBe(true);
    });
    act(() => {
      const accepted = result.current.submitOrder(shipping);
      expect(accepted.success).toBe(true);
    });
    expect(result.current.cart).toHaveLength(0);
    expect(result.current.orders).toHaveLength(orderCount + 1);
  });

  it('blocks an old cart after the SKU is discontinued and allows it after reactivation', () => {
    const { result } = setup();
    const product = result.current.products.find(item => item.id === 'prod-9042')!;
    const sku = product.skus.find(item => item.id === 'sku-9042-blk')!;
    act(() => {
      expect(result.current.addToCart(sku.id, 10).success).toBe(true);
      const stopped = result.current.adminUpdateSku('prod-9042', sku.id, {
        skuCode: sku.sku_code,
        colorName: sku.color_name,
        colorNameEn: sku.color_name_en ?? '',
        colorHex: sku.color_hex,
        basePriceUsd: sku.base_price_usd,
        sellableStatus: 'discontinued',
      });
      expect(stopped.success).toBe(true);
    });
    act(() => {
      const rejected = result.current.submitOrder(shipping);
      expect(rejected.success).toBe(false);
      expect(rejected.error).toMatch(/SKU is no longer available/i);
    });
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.orders).toHaveLength(3);

    act(() => {
      expect(
        result.current.adminUpdateSku('prod-9042', sku.id, {
          skuCode: sku.sku_code,
          colorName: sku.color_name,
          colorNameEn: sku.color_name_en ?? '',
          colorHex: sku.color_hex,
          basePriceUsd: sku.base_price_usd,
          sellableStatus: 'active',
        }).success
      ).toBe(true);
    });
    act(() => {
      expect(result.current.submitOrder(shipping).success).toBe(true);
    });
    expect(result.current.cart).toHaveLength(0);
  });

  it('blocks an old cart after brand authorization is revoked and allows it after restoration', () => {
    const { result } = setup();
    act(() => {
      expect(result.current.addToCart('sku-9042-blk', 10).success).toBe(true);
    });
    act(() => {
      result.current.adminToggleBrandGrant('comp-001', 'brand-aoking');
    });
    expect(
      result.current.brandGrants.some(
        grant => grant.company_id === 'comp-001' && grant.brand_id === 'brand-aoking'
      )
    ).toBe(false);
    act(() => {
      const rejected = result.current.submitOrder(shipping);
      expect(rejected.success).toBe(false);
      expect(rejected.error).toMatch(/no longer authorized for this brand/i);
    });
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.orders).toHaveLength(3);

    act(() => {
      result.current.adminToggleBrandGrant('comp-001', 'brand-aoking');
    });
    act(() => {
      expect(result.current.submitOrder(shipping).success).toBe(true);
    });
    expect(result.current.cart).toHaveLength(0);
  });

  it('rejects adding a newly unavailable SKU while keeping the existing cart untouched', () => {
    const { result } = setup();
    act(() => {
      expect(result.current.addToCart('sku-9042-gry', 10).success).toBe(true);
      expect(result.current.adminSetProductActive('prod-9042', false).success).toBe(true);
    });
    act(() => {
      const rejected = result.current.addToCart('sku-9042-blk', 10);
      expect(rejected.success).toBe(false);
      expect(rejected.message).toMatch(/product is no longer available/i);
    });
    expect(result.current.cart).toEqual([{ sku_id: 'sku-9042-gry', quantity: 10 }]);
  });
});

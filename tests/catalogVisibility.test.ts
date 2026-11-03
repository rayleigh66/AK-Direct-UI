import { describe, expect, it } from 'vitest';
import {
  customerVisibleSkus,
  filterCustomerVisibleProducts,
  isProductVisibleToCustomer,
  isSkuVisibleToCustomer,
} from '../src/utils/catalogVisibility';
import { INITIAL_BRAND_GRANTS, INITIAL_PRODUCTS } from '../src/data/mockData';

const aokingProducts = INITIAL_PRODUCTS.filter(product => product.brand_id === 'brand-aoking');
const voyagerProduct = INITIAL_PRODUCTS.find(product => product.brand_id === 'brand-voyager')!;

describe('customer catalogue visibility', () => {
  it('hides a brand that is not granted to the company', () => {
    expect(voyagerProduct).toBeTruthy();
    expect(isProductVisibleToCustomer(voyagerProduct, 'comp-001', INITIAL_BRAND_GRANTS)).toBe(
      false
    );
    const visible = filterCustomerVisibleProducts(
      INITIAL_PRODUCTS,
      'comp-001',
      INITIAL_BRAND_GRANTS
    );
    expect(visible.map(product => product.id)).not.toContain('prod-voy-1001');
    expect(visible).toHaveLength(aokingProducts.length);
  });

  it('hides prices and stock after a brand grant is revoked, then restores after re-grant', () => {
    const withoutAoking = INITIAL_BRAND_GRANTS.filter(
      grant => !(grant.company_id === 'comp-001' && grant.brand_id === 'brand-aoking')
    );
    expect(
      filterCustomerVisibleProducts(INITIAL_PRODUCTS, 'comp-001', withoutAoking)
    ).toHaveLength(0);

    const restored = [
      ...withoutAoking,
      { company_id: 'comp-001', brand_id: 'brand-aoking', granted_at: '2026-11-03' },
    ];
    expect(
      filterCustomerVisibleProducts(INITIAL_PRODUCTS, 'comp-001', restored)
    ).toHaveLength(aokingProducts.length);
  });

  it('supports a cross-brand grant without changing the brand model', () => {
    const withVoyager = [
      ...INITIAL_BRAND_GRANTS,
      { company_id: 'comp-001', brand_id: 'brand-voyager', granted_at: '2026-11-03' },
    ];
    expect(isProductVisibleToCustomer(voyagerProduct, 'comp-001', withVoyager)).toBe(true);
    expect(
      isSkuVisibleToCustomer(voyagerProduct, voyagerProduct.skus[0], 'comp-001', withVoyager)
    ).toBe(true);
  });

  it('hides unlisted products and discontinued SKUs', () => {
    const inactive = { ...aokingProducts[0], active: false };
    expect(isProductVisibleToCustomer(inactive, 'comp-001', INITIAL_BRAND_GRANTS)).toBe(false);

    const discontinued = {
      ...aokingProducts[0],
      skus: aokingProducts[0].skus.map(sku => ({
        ...sku,
        sellable_status: 'discontinued' as const,
      })),
    };
    expect(
      isProductVisibleToCustomer(discontinued, 'comp-001', INITIAL_BRAND_GRANTS)
    ).toBe(false);
    expect(customerVisibleSkus(discontinued)).toHaveLength(0);

    const mixed = {
      ...aokingProducts[0],
      skus: [
        { ...aokingProducts[0].skus[0], sellable_status: 'discontinued' as const },
        { ...aokingProducts[0].skus[1], sellable_status: 'active' as const },
      ],
    };
    expect(customerVisibleSkus(mixed)).toHaveLength(1);
    expect(
      isSkuVisibleToCustomer(mixed, mixed.skus[0], 'comp-001', INITIAL_BRAND_GRANTS)
    ).toBe(false);
    expect(
      isSkuVisibleToCustomer(mixed, mixed.skus[1], 'comp-001', INITIAL_BRAND_GRANTS)
    ).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  canAccessTab,
  defaultTabForRole,
  isInternalRole,
} from '../src/utils/roles';

describe('frontend role tab boundaries', () => {
  it('keeps customers inside customer tabs', () => {
    expect(canAccessTab('customer', 'catalog')).toBe(true);
    expect(canAccessTab('customer', 'cart')).toBe(true);
    expect(canAccessTab('customer', 'orders')).toBe(true);
    expect(canAccessTab('customer', 'admin_products')).toBe(false);
    expect(canAccessTab('customer', 'inventory_import')).toBe(false);
    expect(canAccessTab('customer', 'sales_orders')).toBe(false);
    expect(defaultTabForRole('customer')).toBe('catalog');
  });

  it('keeps sales out of admin tabs but allows sales operations', () => {
    expect(canAccessTab('sales', 'sales_orders')).toBe(true);
    expect(canAccessTab('sales', 'restock_manage')).toBe(true);
    expect(canAccessTab('sales', 'internal_mailbox')).toBe(true);
    expect(canAccessTab('sales', 'inventory_import')).toBe(false);
    expect(canAccessTab('sales', 'promo_tier')).toBe(false);
    expect(canAccessTab('sales', 'admin_companies')).toBe(false);
    expect(canAccessTab('sales', 'catalog')).toBe(false);
    expect(defaultTabForRole('sales')).toBe('sales_orders');
  });

  it('gives admin admin and sales oversight tabs, but not customer ordering tabs', () => {
    expect(canAccessTab('admin', 'admin_products')).toBe(true);
    expect(canAccessTab('admin', 'inventory_import')).toBe(true);
    expect(canAccessTab('admin', 'sales_orders')).toBe(true);
    expect(canAccessTab('admin', 'catalog')).toBe(false);
    expect(canAccessTab('admin', 'cart')).toBe(false);
    expect(canAccessTab('admin', 'orders')).toBe(false);
    expect(defaultTabForRole('admin')).toBe('admin_companies');
  });

  it('identifies internal roles', () => {
    expect(isInternalRole('customer')).toBe(false);
    expect(isInternalRole('sales')).toBe(true);
    expect(isInternalRole('admin')).toBe(true);
  });
});

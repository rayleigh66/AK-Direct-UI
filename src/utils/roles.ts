import type { Role } from '../types';

export const CUSTOMER_TABS = ['catalog', 'cart', 'orders', 'membership', 'notifications'] as const;
export const SALES_TABS = ['sales_orders', 'restock_manage', 'internal_mailbox'] as const;
export const ADMIN_TABS = [
  'admin_products',
  'admin_companies',
  'inventory_import',
  'promo_tier',
  'audit_logs',
] as const;

export const FRONTEND_ROLE_NOTICE =
  '这是前端角色模拟保护，不是服务端 RBAC；正式权限必须在后端再次校验。';

const CUSTOMER_TAB_SET = new Set<string>(CUSTOMER_TABS);
const SALES_TAB_SET = new Set<string>(SALES_TABS);
const ADMIN_TAB_SET = new Set<string>(ADMIN_TABS);

export function isInternalRole(role: Role): boolean {
  return role === 'sales' || role === 'admin';
}

export function canViewSalesOperations(role: Role): boolean {
  return role === 'sales' || role === 'admin';
}

export function canAccessTab(role: Role, tab: string): boolean {
  if (role === 'customer') return CUSTOMER_TAB_SET.has(tab);
  if (role === 'sales') return SALES_TAB_SET.has(tab);
  // Admin keeps oversight access to sales operations, but not customer ordering.
  return ADMIN_TAB_SET.has(tab) || SALES_TAB_SET.has(tab);
}

export function defaultTabForRole(role: Role): string {
  if (role === 'customer') return 'catalog';
  if (role === 'sales') return 'sales_orders';
  return 'admin_companies';
}

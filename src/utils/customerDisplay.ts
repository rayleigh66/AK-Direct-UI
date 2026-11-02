import type { Brand, Order, OrderStatus, Product, ProductSKU, TierRule } from '../types';

const CATEGORY_LABELS: Record<Product['category'], string> = {
  'Business Backpacks': 'Business Backpacks',
  'Travel Luggage': 'Travel Luggage',
  'Urban Commuter': 'Urban Commuter',
  'Executive Briefcases': 'Executive Briefcases',
};

export const CUSTOMER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: 'Draft',
  PENDING_CONFIRMATION: 'Pending confirmation',
  CONFIRMED: 'Confirmed · stock reserved',
  PAYMENT_RECORDED: 'Payment received',
  PREPARING_SHIPMENT: 'Preparing shipment',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  RESERVATION_EXPIRED: 'Reservation expired',
};

export const customerProductTitle = (product: Product | null | undefined) =>
  product?.title_en ?? product?.title ?? '';

export const customerSkuColor = (sku: ProductSKU | null | undefined) =>
  sku?.color_name_en ?? sku?.color_name ?? '';

export const customerBrandName = (brand: Brand | undefined) =>
  brand?.name_en ?? brand?.name ?? '';

export const customerTierName = (tier: TierRule | undefined) =>
  tier?.name_en ?? tier?.name ?? '';

export const customerCategory = (category: Product['category']) =>
  CATEGORY_LABELS[category] ?? category;

export const customerStatus = (status: OrderStatus) => CUSTOMER_STATUS_LABELS[status] ?? status;

export function findSkuByCode(products: Product[], skuCode: string) {
  for (const product of products) {
    const sku = product.skus.find((item) => item.sku_code === skuCode);
    if (sku) return { product, sku };
  }
  return null;
}

export function customerOrderLineTitle(line: Order['lines'][number], products: Product[]) {
  const found = findSkuByCode(products, line.sku_code);
  return found ? customerProductTitle(found.product) : line.product_title;
}

export function customerOrderLineColor(line: Order['lines'][number], products: Product[]) {
  const found = findSkuByCode(products, line.sku_code);
  return found ? customerSkuColor(found.sku) : line.color_name;
}

import type { BrandGrant, Product, ProductSKU } from '../types';

/**
 * Frontend-only catalogue visibility helpers.
 * These do not replace server-side authorisation; they keep the Demo UI from
 * showing another brand's prices or stock.
 */
export function isProductAuthorizedForCompany(
  product: Product,
  companyId: string | null | undefined,
  brandGrants: BrandGrant[]
): boolean {
  if (!companyId) return false;
  return brandGrants.some(
    grant => grant.company_id === companyId && grant.brand_id === product.brand_id
  );
}

export function customerVisibleSkus(product: Product): ProductSKU[] {
  return product.skus.filter(sku => sku.sellable_status === 'active');
}

export function isProductVisibleToCustomer(
  product: Product,
  companyId: string | null | undefined,
  brandGrants: BrandGrant[]
): boolean {
  if (product.active === false) return false;
  if (!isProductAuthorizedForCompany(product, companyId, brandGrants)) return false;
  return customerVisibleSkus(product).length > 0;
}

export function isSkuVisibleToCustomer(
  product: Product,
  sku: ProductSKU,
  companyId: string | null | undefined,
  brandGrants: BrandGrant[]
): boolean {
  return (
    isProductVisibleToCustomer(product, companyId, brandGrants) &&
    sku.sellable_status === 'active'
  );
}

export function filterCustomerVisibleProducts(
  products: Product[],
  companyId: string | null | undefined,
  brandGrants: BrandGrant[],
  brandId?: string
): Product[] {
  return products.filter(
    product =>
      (!brandId || product.brand_id === brandId) &&
      isProductVisibleToCustomer(product, companyId, brandGrants)
  );
}

import { apiJson, apiUpload } from '../auth/api';
import type {
  AdminCustomerAccountDto,
  AdminCustomerCompanyDto,
  AdminSalesUserDto,
  BrandDto,
  CartDto,
  CommitImportResultDto,
  CustomerBrandDto,
  CustomerOrderDto,
  CustomerProductDto,
  ImportPreviewDto,
  ImportPreviewRowDto,
  InternalOrderDto,
  InventoryRowDto,
  OrderImpactDto,
  OrderImpactKind,
  ProductDto,
  SeriesDto,
  ShippingMethod,
  SkuDto,
  TagDto,
  WarehouseDto,
} from './types';

export async function listAdminBrands(): Promise<BrandDto[]> {
  return (await apiJson<{ brands: BrandDto[] }>('GET', '/api/admin/catalog/brands')).brands;
}

export async function listAdminProducts(): Promise<ProductDto[]> {
  return (await apiJson<{ products: ProductDto[] }>('GET', '/api/admin/catalog/products')).products;
}

export async function getAdminProduct(id: string): Promise<ProductDto> {
  return (await apiJson<{ product: ProductDto }>('GET', `/api/admin/catalog/products/${id}`)).product;
}

export async function createProduct(input: Record<string, unknown>): Promise<ProductDto> {
  return (await apiJson<{ product: ProductDto }>('POST', '/api/admin/catalog/products', input)).product;
}

export async function updateProduct(id: string, input: Record<string, unknown>): Promise<ProductDto> {
  return (await apiJson<{ product: ProductDto }>('PATCH', `/api/admin/catalog/products/${id}`, input))
    .product;
}

export async function setPublished(
  id: string,
  published: boolean,
  options: { confirmAffectedOrders?: boolean; impactToken?: string } = {}
): Promise<ProductDto> {
  const action = published ? 'publish' : 'unpublish';
  return (
    await apiJson<{ product: ProductDto }>(
      'POST',
      `/api/admin/catalog/products/${id}/${action}`,
      options
    )
  ).product;
}

export async function createSku(productId: string, input: Record<string, unknown>): Promise<SkuDto> {
  return (await apiJson<{ sku: SkuDto }>('POST', `/api/admin/catalog/products/${productId}/skus`, input))
    .sku;
}

export async function updateSku(skuId: string, input: Record<string, unknown>): Promise<SkuDto> {
  return (await apiJson<{ sku: SkuDto }>('PATCH', `/api/admin/catalog/skus/${skuId}`, input)).sku;
}

export async function uploadProductImage(productId: string, file: File) {
  return (
    await apiUpload<{ image: ProductDto['images'][number] }>(
      `/api/admin/catalog/products/${productId}/images`,
      file
    )
  ).image;
}

export async function reorderImages(productId: string, imageIds: string[]) {
  return (
    await apiJson<{ images: ProductDto['images'] }>(
      'PATCH',
      `/api/admin/catalog/products/${productId}/images/order`,
      { imageIds }
    )
  ).images;
}

export async function setPrimaryImage(productId: string, imageId: string) {
  return (
    await apiJson<{ images: ProductDto['images'] }>(
      'PUT',
      `/api/admin/catalog/products/${productId}/images/${imageId}/primary`,
      {}
    )
  ).images;
}

export async function removeImage(productId: string, imageId: string) {
  return (
    await apiJson<{ images: ProductDto['images'] }>(
      'DELETE',
      `/api/admin/catalog/products/${productId}/images/${imageId}`
    )
  ).images;
}

export async function listSeries(): Promise<SeriesDto[]> {
  return (await apiJson<{ series: SeriesDto[] }>('GET', '/api/admin/catalog/series')).series;
}

export async function createSeries(input: Record<string, unknown>): Promise<SeriesDto> {
  return (await apiJson<{ series: SeriesDto }>('POST', '/api/admin/catalog/series', input)).series;
}

export async function updateSeries(id: string, input: Record<string, unknown>): Promise<SeriesDto> {
  return (await apiJson<{ series: SeriesDto }>('PATCH', `/api/admin/catalog/series/${id}`, input)).series;
}

export async function listTags(): Promise<TagDto[]> {
  return (await apiJson<{ tags: TagDto[] }>('GET', '/api/admin/catalog/tags')).tags;
}

export async function createTag(input: Record<string, unknown>): Promise<TagDto> {
  return (await apiJson<{ tag: TagDto }>('POST', '/api/admin/catalog/tags', input)).tag;
}

export async function updateTag(id: string, input: Record<string, unknown>): Promise<TagDto> {
  return (await apiJson<{ tag: TagDto }>('PATCH', `/api/admin/catalog/tags/${id}`, input)).tag;
}

export async function listWarehouses(): Promise<WarehouseDto[]> {
  return (await apiJson<{ warehouses: WarehouseDto[] }>('GET', '/api/admin/warehouses')).warehouses;
}

export async function createWarehouse(input: Record<string, unknown>): Promise<WarehouseDto> {
  return (await apiJson<{ warehouse: WarehouseDto }>('POST', '/api/admin/warehouses', input)).warehouse;
}

export async function updateWarehouse(id: string, input: Record<string, unknown>): Promise<WarehouseDto> {
  return (await apiJson<{ warehouse: WarehouseDto }>('PATCH', `/api/admin/warehouses/${id}`, input))
    .warehouse;
}

export async function listInventory(search?: string): Promise<InventoryRowDto[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  return (await apiJson<{ inventory: InventoryRowDto[] }>('GET', `/api/sales/inventory${query}`))
    .inventory;
}

export async function listAdminInventory(
  filters?: string | { search?: string; skuId?: string; warehouseId?: string }
): Promise<InventoryRowDto[]> {
  const values = typeof filters === 'string' ? { search: filters } : filters;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values ?? {})) if (value) params.set(key, value);
  const query = params.size ? `?${params}` : '';
  return (await apiJson<{ inventory: InventoryRowDto[] }>('GET', `/api/admin/inventory${query}`))
    .inventory;
}

export async function registerInventory(input: Record<string, unknown>): Promise<InventoryRowDto> {
  return (await apiJson<{ inventory: InventoryRowDto }>('POST', '/api/admin/inventory/register', input))
    .inventory;
}

export async function adjustInventory(
  skuId: string,
  warehouseId: string,
  input: Record<string, unknown>
): Promise<InventoryRowDto> {
  return (
    await apiJson<{ inventory: InventoryRowDto }>(
      'PATCH',
      `/api/admin/inventory/${skuId}/${warehouseId}`,
      input
    )
  ).inventory;
}

export async function previewImport(input: {
  sourceName: string;
  idempotencyKey: string;
  rows: Array<{
    rowNumber: number;
    skuCode: string;
    warehouseCode: string;
    onHand: number;
    unsellable: number;
  }>;
}): Promise<ImportPreviewDto> {
  return (await apiJson<{ preview: ImportPreviewDto }>('POST', '/api/admin/inventory/import/preview', input))
    .preview;
}

export async function commitImport(batchId: string): Promise<CommitImportResultDto> {
  return (
    await apiJson<{ result: CommitImportResultDto }>(
      'POST',
      `/api/admin/inventory/import/${batchId}/commit`,
      {}
    )
  ).result;
}

export async function listCustomerProducts(query: Record<string, string> = {}): Promise<CustomerProductDto[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return (await apiJson<{ products: CustomerProductDto[] }>('GET', `/api/catalog/products${suffix}`))
    .products;
}

export async function getCustomerProduct(id: string): Promise<CustomerProductDto> {
  return (await apiJson<{ product: CustomerProductDto }>('GET', `/api/catalog/products/${id}`)).product;
}

export async function listCustomerBrands(): Promise<CustomerBrandDto[]> {
  return (await apiJson<{ brands: CustomerBrandDto[] }>('GET', '/api/catalog/brands')).brands;
}

export async function listCustomerSeries(): Promise<SeriesDto[]> {
  return (await apiJson<{ series: SeriesDto[] }>('GET', '/api/catalog/series')).series;
}

export async function listCustomerTags(): Promise<TagDto[]> {
  return (await apiJson<{ tags: TagDto[] }>('GET', '/api/catalog/tags')).tags;
}

export type PreviewRow = ImportPreviewRowDto;

// --- Company shared cart ----------------------------------------------------

export async function getCart(): Promise<CartDto> {
  return (await apiJson<{ cart: CartDto }>('GET', '/api/cart')).cart;
}

export async function setCartItem(
  skuId: string,
  quantity: number,
  expectedRevision: number
): Promise<CartDto> {
  return (
    await apiJson<{ cart: CartDto }>('PUT', `/api/cart/items/${skuId}`, {
      quantity,
      expectedRevision,
    })
  ).cart;
}

export async function removeCartItem(
  skuId: string,
  expectedRevision: number
): Promise<CartDto> {
  return (
    await apiJson<{ cart: CartDto }>('DELETE', `/api/cart/items/${skuId}`, {
      expectedRevision,
    })
  ).cart;
}

export async function clearCart(expectedRevision: number): Promise<CartDto> {
  return (
    await apiJson<{ cart: CartDto }>('DELETE', '/api/cart/items', { expectedRevision })
  ).cart;
}

// --- Orders -----------------------------------------------------------------

export interface DeliveryPayload {
  shippingMethod: ShippingMethod;
  destinationCountryAlpha3: string;
  expectedShipDate: string;
  shippingRequirements: string;
}

export async function submitOrder(
  input: DeliveryPayload & { idempotencyKey: string; expectedCartRevision: number }
): Promise<{ order: CustomerOrderDto; alreadySubmitted: boolean }> {
  return apiJson<{ order: CustomerOrderDto; alreadySubmitted: boolean }>(
    'POST',
    '/api/orders',
    input
  );
}

export async function listCustomerOrders(): Promise<CustomerOrderDto[]> {
  return (await apiJson<{ orders: CustomerOrderDto[] }>('GET', '/api/orders')).orders;
}

export async function getCustomerOrder(id: string): Promise<CustomerOrderDto> {
  return (await apiJson<{ order: CustomerOrderDto }>('GET', `/api/orders/${id}`)).order;
}

export async function modifyOrderLines(
  id: string,
  expectedRevision: number,
  lines: Array<{ skuId: string; quantity: number }>
): Promise<CustomerOrderDto> {
  return (
    await apiJson<{ order: CustomerOrderDto }>('PATCH', `/api/orders/${id}/lines`, {
      expectedRevision,
      lines,
    })
  ).order;
}

export async function cancelCustomerOrder(
  id: string,
  expectedRevision: number,
  reason: string
): Promise<CustomerOrderDto> {
  return (
    await apiJson<{ order: CustomerOrderDto }>('POST', `/api/orders/${id}/cancel`, {
      expectedRevision,
      reason,
    })
  ).order;
}

export async function listSalesOrders(): Promise<InternalOrderDto[]> {
  return (await apiJson<{ orders: InternalOrderDto[] }>('GET', '/api/sales/orders')).orders;
}

export async function getSalesOrder(id: string): Promise<InternalOrderDto> {
  return (await apiJson<{ order: InternalOrderDto }>('GET', `/api/sales/orders/${id}`)).order;
}

export async function listAdminOrders(): Promise<InternalOrderDto[]> {
  return (await apiJson<{ orders: InternalOrderDto[] }>('GET', '/api/admin/orders')).orders;
}

export async function getAdminOrder(id: string): Promise<InternalOrderDto> {
  return (await apiJson<{ order: InternalOrderDto }>('GET', `/api/admin/orders/${id}`)).order;
}

export async function getPendingOrderImpact(
  kind: OrderImpactKind,
  targetId: string,
  companyId?: string
): Promise<OrderImpactDto> {
  const params = new URLSearchParams({ kind, targetId });
  if (companyId) params.set('companyId', companyId);
  return (
    await apiJson<{ impact: OrderImpactDto }>(
      'GET',
      `/api/admin/orders/impact?${params.toString()}`
    )
  ).impact;
}

export async function listAdminCompanies(): Promise<AdminCustomerCompanyDto[]> {
  return (await apiJson<{ companies: AdminCustomerCompanyDto[] }>('GET', '/api/admin/companies'))
    .companies;
}

/** Admin-only company projection behind the existing `companies.manage` permission. */
export async function getAdminCompany(id: string): Promise<AdminCustomerCompanyDto> {
  return (
    await apiJson<{ company: AdminCustomerCompanyDto }>('GET', `/api/admin/companies/${id}`)
  ).company;
}

export async function createAdminCompany(input: Record<string, unknown>): Promise<{
  company: AdminCustomerCompanyDto;
  primaryUsername: string;
  temporaryPassword: string;
}> {
  return apiJson('POST', '/api/admin/companies', input);
}

export async function listCompanyAccounts(
  companyId: string
): Promise<AdminCustomerAccountDto[]> {
  return (
    await apiJson<{ accounts: AdminCustomerAccountDto[] }>(
      'GET',
      `/api/admin/companies/${companyId}/accounts`
    )
  ).accounts;
}

export async function createCompanyAccount(companyId: string): Promise<{
  username: string;
  temporaryPassword: string;
}> {
  return apiJson('POST', `/api/admin/companies/${companyId}/accounts`, {});
}

export async function setCompanyStatus(
  companyId: string,
  status: 'active' | 'suspended',
  options: { confirmAffectedOrders?: boolean; impactToken?: string } = {}
): Promise<AdminCustomerCompanyDto> {
  return (
    await apiJson<{ company: AdminCustomerCompanyDto }>(
      'PATCH',
      `/api/admin/companies/${companyId}/status`,
      { status, ...options }
    )
  ).company;
}

export async function setCustomerStatus(
  customerId: string,
  status: 'active' | 'suspended'
): Promise<void> {
  await apiJson('PATCH', `/api/admin/customers/${customerId}/status`, { status });
}

export async function listCompanyBrandIds(companyId: string): Promise<string[]> {
  return (
    await apiJson<{ brandIds: string[] }>('GET', `/api/admin/companies/${companyId}/brands`)
  ).brandIds;
}

export async function setCompanyBrandGrant(
  companyId: string,
  brandId: string,
  granted: boolean,
  options: { confirmAffectedOrders?: boolean; impactToken?: string } = {}
): Promise<void> {
  await apiJson('PUT', `/api/admin/companies/${companyId}/brands/${brandId}`, {
    granted,
    ...options,
  });
}

export async function setCompanySalesAssignment(
  companyId: string,
  salesUserId: string | null
): Promise<AdminCustomerCompanyDto> {
  return (
    await apiJson<{ company: AdminCustomerCompanyDto }>(
      'PATCH',
      `/api/admin/companies/${companyId}/sales-assignment`,
      { salesUserId }
    )
  ).company;
}

/** Active salespeople for the assignment display; existing `companies.manage` route. */
export async function listSalesUsers(): Promise<AdminSalesUserDto[]> {
  return (await apiJson<{ users: AdminSalesUserDto[] }>('GET', '/api/admin/sales-users')).users;
}

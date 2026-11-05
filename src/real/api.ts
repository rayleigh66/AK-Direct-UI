import { apiJson, apiUpload } from '../auth/api';
import type {
  BrandDto,
  CommitImportResultDto,
  CustomerBrandDto,
  CustomerProductDto,
  ImportPreviewDto,
  ImportPreviewRowDto,
  InventoryRowDto,
  ProductDto,
  SeriesDto,
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

export async function setPublished(id: string, published: boolean): Promise<ProductDto> {
  const action = published ? 'publish' : 'unpublish';
  return (await apiJson<{ product: ProductDto }>('POST', `/api/admin/catalog/products/${id}/${action}`, {}))
    .product;
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

export async function listAdminInventory(search?: string): Promise<InventoryRowDto[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
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

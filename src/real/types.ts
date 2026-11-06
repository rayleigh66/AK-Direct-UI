export interface ProductImageDto {
  id: string;
  productId: string;
  url: string;
  mimeType: string;
  byteSize: number;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: string;
}

export interface SkuDto {
  id: string;
  productId: string;
  skuCode: string;
  colorName: string;
  colorNameEn: string;
  colorHex: string;
  basePriceCents: number;
  sellableStatus: 'active' | 'discontinued';
  imageId: string | null;
  imageUrl: string | null;
}

export interface CustomerSkuDto extends SkuDto {
  available: number;
}

export interface ProductDto {
  id: string;
  brandId: string;
  brandCode: string;
  brandName: string;
  productCode: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  category: string;
  material: string;
  capacityOrSize: string;
  seriesId: string | null;
  tagIds: string[];
  published: boolean;
  publishedAt: string | null;
  skus: SkuDto[];
  images: ProductImageDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProductDto extends Omit<ProductDto, 'skus'> {
  skus: CustomerSkuDto[];
}

export interface SeriesDto {
  id: string;
  nameZh: string;
  nameEn: string;
  sortOrder: number;
  active: boolean;
  productCount: number;
}

export interface TagDto {
  id: string;
  nameZh: string;
  nameEn: string;
  tone: string;
  sortOrder: number;
  active: boolean;
  productCount: number;
}

export interface WarehouseDto {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryRowDto {
  skuId: string;
  skuCode: string;
  productId: string;
  productCode: string;
  productTitle: string;
  colorHex: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  onHand: number;
  reserved: number;
  unsellable: number;
  available: number;
  version: number;
  updatedAt: string;
}

export interface ImportPreviewRowDto {
  rowNumber: number;
  skuId: string;
  skuCode: string;
  warehouseId: string;
  warehouseCode: string;
  onHandBefore: number;
  unsellableBefore: number;
  reserved: number;
  onHandNew: number;
  unsellableNew: number;
  versionBefore: number;
}

export interface ImportPreviewDto {
  batchId: string;
  idempotencyKey: string;
  status: 'previewed' | 'committed' | 'failed';
  sourceName: string | null;
  createdAt: string;
  rows: ImportPreviewRowDto[];
}

export interface CommitImportResultDto {
  batchId: string;
  status: 'committed';
  alreadyCommitted: boolean;
  committedAt: string;
  rows: Array<{
    skuCode: string;
    warehouseCode: string;
    onHand: number;
    unsellable: number;
    version: number;
  }>;
}

export interface CustomerBrandDto {
  id: string;
  code: string;
  name: string;
  nameEn: string;
}

export interface VisibleCartItemDto {
  detailsRestricted?: false;
  skuId: string;
  productId: string;
  productCode: string;
  productTitle: string;
  productTitleEn: string;
  brandId: string;
  skuCode: string;
  colorName: string;
  colorNameEn: string;
  colorHex: string;
  imageUrl: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  available: number;
  isAvailable: boolean;
  issues: string[];
  updatedAt: string;
}

/** Only cart-owned identifiers/state survive withdrawal of catalogue access. */
export interface RestrictedCartItemDto {
  detailsRestricted: true;
  skuId: string;
  quantity: number;
  isAvailable: false;
  issues: string[];
  updatedAt: string;
}

export type CartItemDto = VisibleCartItemDto | RestrictedCartItemDto;

export interface CartDto {
  revision: number;
  updatedAt: string | null;
  items: CartItemDto[];
  itemCount: number;
  totalQuantity: number;
  referenceTotalCents: number;
  hasUnavailableItems: boolean;
  pricingMode: 'base_reference';
  isReferenceQuote: true;
  priceNote: string;
}

export type ShippingMethod = 'Express' | 'Air' | 'Sea' | 'Customer Pickup' | 'Other';

export interface OrderLineDto {
  id: string;
  lineNumber: number;
  skuId: string;
  productId: string;
  productCode: string;
  productTitle: string;
  productTitleEn: string;
  skuCode: string;
  colorName: string;
  colorNameEn: string;
  colorHex: string;
  quantity: number;
  baseUnitPriceCents: number;
  referenceUnitPriceCents: number;
  lineReferenceCents: number;
  priceSource: 'base_price';
  pricingVersion: string;
}

export interface CustomerOrderHistoryDto {
  eventType: 'SUBMITTED' | 'LINES_MODIFIED' | 'CANCELLED' | 'ADMIN_CANCELLED';
  fromStatus: string | null;
  toStatus: string;
  reason: string;
  createdAt: string;
}

export interface InternalOrderHistoryDto extends CustomerOrderHistoryDto {
  actorType: 'customer' | 'internal' | 'system';
  actorLabel: string;
  details: Record<string, unknown>;
}

export interface CustomerOrderDto {
  id: string;
  orderNo: string;
  status: string;
  statusLabel: string;
  revision: number;
  lines: OrderLineDto[];
  referenceTotalCents: number;
  pricingMode: 'base_reference';
  pricingVersion: string;
  isReferenceQuote: true;
  priceNote: string;
  shippingMethod: ShippingMethod;
  destinationCountryAlpha3: string;
  expectedShipDate: string;
  shippingRequirements: string;
  customerVisibleNote: string;
  submittedAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  history: CustomerOrderHistoryDto[];
}

export interface InternalOrderDto extends Omit<CustomerOrderDto, 'history'> {
  company: { id: string; customerCode: string; shortName: string };
  submittedByUsername: string;
  /** Immutable submission-time snapshot. */
  assignedSalesUserId: string | null;
  /** Current company owner used for access and notifications. */
  currentAssignedSalesUserId: string | null;
  history: InternalOrderHistoryDto[];
}

export type OrderImpactKind =
  | 'product_unpublish'
  | 'sku_discontinue'
  | 'brand_revoke'
  | 'company_suspend';

export interface AffectedOrderSummaryDto {
  id: string;
  orderNo: string;
  companyId: string;
  companyCode: string;
  status: string;
  revision: number;
  referenceTotalCents: number;
  submittedAt: string;
}

export interface OrderImpactDto {
  kind: OrderImpactKind;
  targetId: string;
  companyId: string | null;
  affectedOrders: AffectedOrderSummaryDto[];
  impactToken: string;
}

export interface BrandDto {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  active: boolean;
}

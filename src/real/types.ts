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

export interface BrandDto {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  active: boolean;
}

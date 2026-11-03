// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { AppProvider, useApp, type AdminProductInput } from '../src/context/AppContext';
import { DEMO_IMAGE_LIBRARY } from '../src/data/demoImageLibrary';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);
const setup = () => {
  const rendered = renderHook(() => useApp(), { wrapper });
  act(() => {
    rendered.result.current.switchRole('admin');
  });
  return rendered;
};

const baseProduct = (overrides: Partial<AdminProductInput> = {}): AdminProductInput => ({
  brandId: 'brand-aoking',
  productCode: 'AK-ADMIN-01',
  title: '管理员测试背包',
  titleEn: 'Admin Test Pack',
  category: 'Business Backpacks',
  description: '管理员测试商品',
  descriptionEn: 'Admin test product',
  material: 'Nylon',
  capacityOrSize: '20 L',
  seriesId: 'core',
  tagCodes: ['LAPTOP'],
  primaryImage: DEMO_IMAGE_LIBRARY[0].url,
  galleryImages: [DEMO_IMAGE_LIBRARY[0].url, DEMO_IMAGE_LIBRARY[2].url],
  ...overrides,
});

const createProduct = (result: ReturnType<typeof setup>['result'], overrides = {}) => {
  let productId = '';
  act(() => {
    const created = result.current.adminCreateProduct(baseProduct(overrides));
    expect(created.success).toBe(true);
    productId = created.productId!;
  });
  return productId;
};

const createSku = (
  result: ReturnType<typeof setup>['result'],
  productId: string,
  skuCode = 'AK-ADMIN-01-BK',
  onHand = 30
) => {
  act(() => {
    const created = result.current.adminCreateSku(
      productId,
      {
        skuCode,
        colorName: '黑色',
        colorNameEn: 'Black',
        colorHex: '#222222',
        basePriceUsd: 25,
        sellableStatus: 'active',
      },
      onHand
    );
    expect(created.success).toBe(true);
  });
};

afterEach(cleanup);

describe('admin catalog management', () => {
  it('creates a draft with taxonomy and rejects duplicate codes/invalid images', () => {
    const { result } = setup();
    const productId = createProduct(result);
    const product = result.current.products.find(item => item.id === productId)!;
    expect(product.active).toBe(false);
    expect(product.title_en).toBe('Admin Test Pack');
    expect(product.series_id).toBe('core');
    expect(product.tag_codes).toEqual(['LAPTOP']);
    expect(product.skus).toEqual([]);

    act(() => {
      const duplicate = result.current.adminCreateProduct(baseProduct());
      expect(duplicate.success).toBe(false);
      expect(duplicate.error).toMatch(/already exists/i);
      const invalidImage = result.current.adminCreateProduct(
        baseProduct({ productCode: 'AK-ADMIN-02', primaryImage: '/tmp/not-local.jpg' })
      );
      expect(invalidImage.success).toBe(false);
      expect(invalidImage.error).toMatch(/demo image library/i);
    });
  });

  it('creates unique SKUs, preserves internal IDs and adds initial inventory', () => {
    const { result } = setup();
    const productId = createProduct(result);
    createSku(result, productId);
    const product = result.current.products.find(item => item.id === productId)!;
    const sku = product.skus[0];
    expect(sku.sku_code).toBe('AK-ADMIN-01-BK');
    expect(sku.sellable_status).toBe('active');
    expect(result.current.inventory.find(item => item.sku_id === sku.id)).toMatchObject({
      warehouse_id: 'wh-sh',
      on_hand: 30,
      reserved: 0,
    });

    act(() => {
      const duplicate = result.current.adminCreateSku(
        productId,
        {
          skuCode: 'AK-ADMIN-01-BK',
          colorName: '重复',
          colorNameEn: 'Duplicate',
          colorHex: '#333333',
          basePriceUsd: 20,
          sellableStatus: 'active',
        },
        10
      );
      expect(duplicate.success).toBe(false);
      expect(duplicate.error).toMatch(/already exists/i);
    });

    const beforeOrders = JSON.stringify(result.current.orders);
    act(() => {
      const updated = result.current.adminUpdateSku(productId, sku.id, {
        skuCode: 'AK-ADMIN-01-BLACK',
        colorName: '曜石黑',
        colorNameEn: 'Obsidian Black',
        colorHex: '#111111',
        basePriceUsd: 28.5,
        sellableStatus: 'discontinued',
        imageUrl: DEMO_IMAGE_LIBRARY[2].url,
      });
      expect(updated.success).toBe(true);
    });
    const saved = result.current.products
      .find(item => item.id === productId)!
      .skus.find(item => item.id === sku.id)!;
    expect(saved.id).toBe(sku.id);
    expect(saved.sku_code).toBe('AK-ADMIN-01-BLACK');
    expect(saved.base_price_usd).toBe(28.5);
    expect(saved.sellable_status).toBe('discontinued');
    expect(saved.image_url).toBe(DEMO_IMAGE_LIBRARY[2].url);
    expect(JSON.stringify(result.current.orders)).toBe(beforeOrders);
  });

  it('requires an active SKU and a valid image before listing', () => {
    const { result } = setup();
    const productId = createProduct(result, { primaryImage: '', galleryImages: [] });
    act(() => {
      const noSku = result.current.adminSetProductActive(productId, true);
      expect(noSku.success).toBe(false);
      expect(noSku.error).toMatch(/active SKU/i);
    });
    createSku(result, productId);
    act(() => {
      const noImage = result.current.adminSetProductActive(productId, true);
      expect(noImage.success).toBe(false);
      expect(noImage.error).toMatch(/image/i);
    });
    act(() => {
      const updated = result.current.adminUpdateProduct(productId, baseProduct());
      expect(updated.success).toBe(true);
    });
    act(() => {
      const listed = result.current.adminSetProductActive(productId, true);
      expect(listed.success).toBe(true);
    });
    expect(result.current.products.find(item => item.id === productId)?.active).toBe(true);

    act(() => {
      const removed = result.current.adminUpdateProduct(
        productId,
        baseProduct({ primaryImage: '', galleryImages: [] })
      );
      expect(removed.success).toBe(false);
      expect(removed.error).toMatch(/valid primary image/i);
    });
  });

  it('updates product gallery order and primary image without touching SKU references', () => {
    const { result } = setup();
    const productId = createProduct(result);
    const second = DEMO_IMAGE_LIBRARY[2].url;
    act(() => {
      const update = result.current.adminUpdateProduct(
        productId,
        baseProduct({
          primaryImage: second,
          galleryImages: [DEMO_IMAGE_LIBRARY[1].url, second, DEMO_IMAGE_LIBRARY[0].url],
        })
      );
      expect(update.success).toBe(true);
    });
    const product = result.current.products.find(item => item.id === productId)!;
    expect(product.primary_image).toBe(second);
    expect(product.gallery_images).toEqual([
      DEMO_IMAGE_LIBRARY[1].url,
      second,
      DEMO_IMAGE_LIBRARY[0].url,
    ]);
    expect(product.skus).toEqual([]);
  });

  it('rejects changing a SKU code referenced by a historical order but allows price/name edits', () => {
    const { result } = setup();
    const product = result.current.products.find(item => item.id === 'prod-9042')!;
    const sku = product.skus.find(item => item.id === 'sku-9042-blk')!;
    const orderSnapshot = JSON.stringify(result.current.orders);
    act(() => {
      const rejected = result.current.adminUpdateSku('prod-9042', sku.id, {
        skuCode: 'AK-9042-RENAMED',
        colorName: sku.color_name,
        colorNameEn: sku.color_name_en ?? '',
        colorHex: sku.color_hex,
        basePriceUsd: sku.base_price_usd,
        sellableStatus: sku.sellable_status,
      });
      expect(rejected.success).toBe(false);
      expect(rejected.error).toMatch(/historical order/i);
    });
    act(() => {
      const accepted = result.current.adminUpdateSku('prod-9042', sku.id, {
        skuCode: sku.sku_code,
        colorName: '曜石黑',
        colorNameEn: 'Obsidian Black',
        colorHex: sku.color_hex,
        basePriceUsd: 39,
        sellableStatus: sku.sellable_status,
      });
      expect(accepted.success).toBe(true);
    });
    const updated = result.current.products
      .find(item => item.id === 'prod-9042')!
      .skus.find(item => item.id === 'sku-9042-blk')!;
    expect(updated.sku_code).toBe('AK-9042-BLK');
    expect(updated.color_name_en).toBe('Obsidian Black');
    expect(updated.base_price_usd).toBe(39);
    expect(JSON.stringify(result.current.orders)).toBe(orderSnapshot);
  });

  it('requires unpublishing before the last active SKU can be discontinued', () => {
    const { result } = setup();
    const productId = createProduct(result);
    createSku(result, productId);
    act(() => {
      expect(result.current.adminSetProductActive(productId, true).success).toBe(true);
    });
    const sku = result.current.products.find(item => item.id === productId)!.skus[0];
    const input = {
      skuCode: sku.sku_code,
      colorName: sku.color_name,
      colorNameEn: sku.color_name_en ?? '',
      colorHex: sku.color_hex,
      basePriceUsd: sku.base_price_usd,
      sellableStatus: 'discontinued' as const,
    };
    act(() => {
      const rejected = result.current.adminUpdateSku(productId, sku.id, input);
      expect(rejected.success).toBe(false);
      expect(rejected.error).toMatch(/unpublish/i);
    });
    expect(result.current.products.find(item => item.id === productId)?.active).toBe(true);
    act(() => {
      expect(result.current.adminSetProductActive(productId, false).success).toBe(true);
    });
    act(() => {
      expect(result.current.adminUpdateSku(productId, sku.id, input).success).toBe(true);
    });
    expect(
      result.current.products
        .find(item => item.id === productId)!
        .skus.find(item => item.id === sku.id)?.sellable_status
    ).toBe('discontinued');
  });

  it('rejects a taxonomy batch when any removed series or tag is still in use', async () => {
    const { result } = setup();
    const productId = createProduct(result);
    act(() => {
      expect(
        result.current.adminSaveSeries([
          ...result.current.series,
          { id: 'studio', nameZh: '工作室', nameEn: 'Studio', order: 9, active: true },
          { id: 'temporary', nameZh: '临时', nameEn: 'Temporary', order: 10, active: true },
        ]).success
      ).toBe(true);
    });
    act(() => {
      expect(
        result.current.adminUpdateProduct(
          productId,
          baseProduct({ productCode: 'AK-ADMIN-04', seriesId: 'studio' })
        ).success
      ).toBe(true);
    });
    await Promise.resolve();
    const seriesBefore = JSON.stringify(result.current.series);
    const productBefore = JSON.stringify(
      result.current.products.find(item => item.id === productId)
    );
    act(() => {
      const rejected = result.current.adminSaveSeries(
        result.current.series.filter(item => item.id !== 'studio' && item.id !== 'temporary')
      );
      expect(rejected.success).toBe(false);
      expect(rejected.error).toMatch(/batch was rejected/i);
    });
    expect(JSON.stringify(result.current.series)).toBe(seriesBefore);
    expect(
      JSON.stringify(result.current.products.find(item => item.id === productId))
    ).toBe(productBefore);

    act(() => {
      expect(
        result.current.adminSaveFeatureTags([
          ...result.current.featureTags,
          { code: 'TRAVEL_READY', nameZh: '旅行适用', nameEn: 'Travel ready', tone: 'grey', order: 9, active: true },
          { code: 'TEMP_TAG', nameZh: '临时标签', nameEn: 'Temporary tag', tone: 'grey', order: 10, active: true },
        ]).success
      ).toBe(true);
    });
    act(() => {
      expect(
        result.current.adminUpdateProduct(
          productId,
          baseProduct({
            productCode: 'AK-ADMIN-04',
            seriesId: 'studio',
            tagCodes: ['TRAVEL_READY'],
          })
        ).success
      ).toBe(true);
    });
    await Promise.resolve();
    const tagsBefore = JSON.stringify(result.current.featureTags);
    act(() => {
      const rejected = result.current.adminSaveFeatureTags(
        result.current.featureTags.filter(
          item => item.code !== 'TRAVEL_READY' && item.code !== 'TEMP_TAG'
        )
      );
      expect(rejected.success).toBe(false);
      expect(rejected.error).toMatch(/batch was rejected/i);
    });
    expect(JSON.stringify(result.current.featureTags)).toBe(tagsBefore);
  });

  it('edits series and tags with stable IDs and protects in-use values', async () => {
    const { result } = setup();
    const productId = createProduct(result);
    act(() => {
      const addedSeries = result.current.adminSaveSeries([
        ...result.current.series,
        { id: 'studio', nameZh: '工作室', nameEn: 'Studio', order: 9, active: true },
      ]);
      expect(addedSeries.success).toBe(true);
    });
    expect(result.current.series.some(item => item.id === 'studio')).toBe(true);
    act(() => {
      const update = result.current.adminUpdateProduct(
        productId,
        baseProduct({ productCode: 'AK-ADMIN-03', seriesId: 'studio' })
      );
      expect(update.success).toBe(true);
    });
    await Promise.resolve();
    act(() => {
      const removeInUse = result.current.adminSaveSeries(
        result.current.series.filter(item => item.id !== 'studio')
      );
      expect(removeInUse.success).toBe(false);
      expect(removeInUse.error).toMatch(/assigned/i);
    });
    act(() => {
      const addedTag = result.current.adminSaveFeatureTags([
        ...result.current.featureTags,
        { code: 'TRAVEL_READY', nameZh: '旅行适用', nameEn: 'Travel ready', tone: 'grey', order: 9, active: true },
      ]);
      expect(addedTag.success).toBe(true);
    });
    expect(result.current.featureTags.some(item => item.code === 'TRAVEL_READY')).toBe(true);
    act(() => {
      const update = result.current.adminUpdateProduct(
        productId,
        baseProduct({ productCode: 'AK-ADMIN-03', seriesId: 'studio', tagCodes: ['TRAVEL_READY'] })
      );
      expect(update.success).toBe(true);
    });
    await Promise.resolve();
    act(() => {
      const removeTag = result.current.adminSaveFeatureTags(
        result.current.featureTags.filter(item => item.code !== 'TRAVEL_READY')
      );
      expect(removeTag.success).toBe(false);
      expect(removeTag.error).toMatch(/assigned/i);
    });
  });
});

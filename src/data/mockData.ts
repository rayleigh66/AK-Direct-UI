/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEMO_IMAGE_LIBRARY } from './demoImageLibrary';
import {
  Brand,
  BrandGrant,
  CustomerCompany,
  CustomerUser,
  InternalUser,
  Product,
  Warehouse,
  InventoryBalance,
  TierRule,
  Promotion,
  Order,
  RestockRequest,
  CustomerNotification,
  InternalEmailTemplate,
  AuditLog,
  SeriesDefinition,
  FeatureTagDefinition,
} from '../types';

export const INITIAL_SERIES: SeriesDefinition[] = [
  { id: 'core', nameZh: '日常核心', nameEn: 'Everyday Core', order: 1, active: true },
  { id: 'commute', nameZh: '城市通勤', nameEn: 'City Commute', order: 2, active: true },
  { id: 'travel', nameZh: '旅行周末', nameEn: 'Travel & Weekender', order: 3, active: true },
  { id: 'outdoor', nameZh: '户外探索', nameEn: 'Trail & Outdoor', order: 4, active: true },
  { id: 'compact', nameZh: '轻便随身', nameEn: 'Compact Carry', order: 5, active: true },
];

export const INITIAL_FEATURE_TAGS: FeatureTagDefinition[] = [
  { code: 'WATERPROOF', nameZh: '防水', nameEn: 'Waterproof', tone: 'blue', order: 1, active: true },
  {
    code: 'WATER_RESISTANT',
    nameZh: '防泼水',
    nameEn: 'Water-resistant',
    tone: 'sky',
    order: 2,
    active: true,
  },
  { code: 'LAPTOP', nameZh: '电脑保护仓', nameEn: 'Laptop compartment', tone: 'purple', order: 3, active: true },
  { code: 'RECYCLED', nameZh: '再生材料', nameEn: 'Recycled materials', tone: 'green', order: 4, active: true },
  { code: 'LIGHTWEIGHT', nameZh: '轻量化', nameEn: 'Lightweight', tone: 'grey', order: 5, active: true },
  { code: 'ANTI_THEFT', nameZh: '防盗设计', nameEn: 'Anti-theft', tone: 'orange', order: 6, active: true },
];

export const INITIAL_BRANDS: Brand[] = [
  {
    id: 'brand-aoking',
    code: 'AOKING',
    name: 'AOKING (奥王)',
    name_en: 'AOKING',
    is_default_granted: true,
  },
  {
    id: 'brand-voyager',
    code: 'VOYAGER',
    name: 'VOYAGER Outdoor (领航者)',
    name_en: 'VOYAGER Outdoor',
    is_default_granted: false,
  },
];

export const INITIAL_WAREHOUSES: Warehouse[] = [
  { id: 'wh-sh', code: 'WH-SH', name: '上海港出口主仓 (Shanghai Main Port)' },
  { id: 'wh-gz', code: 'WH-GZ', name: '广州华南分拨仓 (Guangzhou Hub)' },
  { id: 'wh-nb', code: 'WH-NB', name: '宁波保税中转仓 (Ningbo Bonded)' },
];

export const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'prod-9042',
    brand_id: 'brand-aoking',
    product_code: 'AK-9042',
    title: 'AOKING 商务防水精英双肩包 (Elite Waterproof Travel Pack)',
    title_en: 'Elite Waterproof Travel Pack',
    category: 'Business Backpacks',
    active: true,
    series_id: 'core',
    tag_codes: ['WATER_RESISTANT', 'LAPTOP'],
    description_en:
      'A clean everyday backpack with a padded 17-inch laptop compartment, water-resistant shell and thoughtful internal organisation.',
    description: '采用高强度哑光防水面料与防割防泼水涂层，内置 17.3 英寸加厚防震独立电脑舱与 USB 快速充能端口。人体工学 S 型蜂窝减压肩带与隐形防盗后袋。',
    material: '900D Matte High-Density Polyester / Water-Resistant YKK Zippers',
    capacity_or_size: '32L (48 x 33 x 18 cm)',
    primary_image: DEMO_IMAGE_LIBRARY[0].url,
    gallery_images: [DEMO_IMAGE_LIBRARY[0].url],
    skus: [
      {
        id: 'sku-9042-blk',
        product_id: 'prod-9042',
        sku_code: 'AK-9042-BLK',
        color_name: '哑光暗夜黑 (Matte Black)',
        color_name_en: 'Matte Black',
        color_hex: '#1c1c1e',
        base_price_usd: 38.0,
        sellable_status: 'active',
      },
      {
        id: 'sku-9042-gry',
        product_id: 'prod-9042',
        sku_code: 'AK-9042-GRY',
        color_name: '深空炭灰 (Charcoal Grey)',
        color_name_en: 'Charcoal Grey',
        color_hex: '#3a3a3c',
        base_price_usd: 38.0,
        sellable_status: 'active',
      },
      {
        id: 'sku-9042-nav',
        product_id: 'prod-9042',
        sku_code: 'AK-9042-NAV',
        color_name: '深海湛蓝 (Deep Navy)',
        color_name_en: 'Deep Navy',
        color_hex: '#1b2a47',
        base_price_usd: 38.0,
        sellable_status: 'active', // Stock = 0, for testing D08 / T06 Restock
      },
      {
        id: 'sku-9042-olv',
        product_id: 'prod-9042',
        sku_code: 'AK-9042-OLV',
        color_name: '战术军绿 (Olive Green)',
        color_name_en: 'Olive Green',
        color_hex: '#3e4a3d',
        base_price_usd: 38.0,
        sellable_status: 'active', // Stock = 6 (< 10 MOQ), for testing low stock restock
      },
    ],
  },
  {
    id: 'prod-7710',
    brand_id: 'brand-aoking',
    product_code: 'AK-7710',
    title: 'AOKING 航空级全铝镁框防爆登机箱 20" (AeroLite Polycarbonate Spinner)',
    title_en: 'AeroLite Polycarbonate Spinner',
    category: 'Travel Luggage',
    active: true,
    series_id: 'travel',
    tag_codes: [],
    description_en:
      'A lightweight cabin spinner with a flexible polycarbonate shell, aluminium frame and smooth dual-wheel mobility.',
    description: '德国拜耳三层复合 PC 韧性箱壳，航空级加厚铝镁合金防撞防爆中框与四角包边。静音万向双排万向轮，内嵌式海关 TSA 双重锁。',
    material: '100% Bayer Makrolon Polycarbonate / Aviation Aluminum Alloy Frame',
    capacity_or_size: '20 Inch Cabin Size (38L, 3.4kg)',
    primary_image: DEMO_IMAGE_LIBRARY[1].url,
    gallery_images: [
      DEMO_IMAGE_LIBRARY[1].url,
    ],
    skus: [
      {
        id: 'sku-7710-slv',
        product_id: 'prod-7710',
        sku_code: 'AK-7710-SLV',
        color_name: '石墨钛银 (Graphite Silver)',
        color_name_en: 'Graphite Silver',
        color_hex: '#5a5d62',
        base_price_usd: 65.0,
        sellable_status: 'active',
      },
      {
        id: 'sku-7710-blk',
        product_id: 'prod-7710',
        sku_code: 'AK-7710-BLK',
        color_name: '曜石酷黑 (Obsidian Black)',
        color_name_en: 'Obsidian Black',
        color_hex: '#111215',
        base_price_usd: 65.0,
        sellable_status: 'active',
      },
      {
        id: 'sku-7710-gld',
        product_id: 'prod-7710',
        sku_code: 'AK-7710-GLD',
        color_name: '香槟浅金 (Champagne Gold)',
        color_name_en: 'Champagne Gold',
        color_hex: '#b39d7b',
        base_price_usd: 68.0,
        sellable_status: 'active', // Active promo: $55.00, non-stackable
      },
    ],
  },
  {
    id: 'prod-8015',
    brand_id: 'brand-aoking',
    product_code: 'AK-8015',
    title: 'AOKING 城市机能战术卷顶双肩包 (Tactical Rolltop Commuter)',
    title_en: 'Tactical Rolltop Commuter',
    category: 'Urban Commuter',
    active: true,
    series_id: 'commute',
    tag_codes: ['RECYCLED', 'LIGHTWEIGHT', 'LAPTOP'],
    description_en:
      'An expandable rolltop commuter with modular webbing, a padded laptop sleeve and a separate shoe compartment.',
    description: '灵动可扩容卷顶闭合架构，模块化战术织带外挂系统，两侧深口弹性保温水壶兜，下沉式独立鞋仓/脏衣仓。',
    material: '1000D Ballistic Cordura / Duraflex High-Strength Buckles',
    capacity_or_size: '28L - 35L Expandable (50 x 30 x 16 cm)',
    primary_image: DEMO_IMAGE_LIBRARY[2].url,
    gallery_images: [
      DEMO_IMAGE_LIBRARY[2].url,
    ],
    skus: [
      {
        id: 'sku-8015-nvy',
        product_id: 'prod-8015',
        sku_code: 'AK-8015-NVY',
        color_name: '战术海军蓝 (Tactical Navy)',
        color_name_en: 'Tactical Navy',
        color_hex: '#1a2639',
        base_price_usd: 32.0,
        sellable_status: 'active', // Active promo: $28.00, STACKABLE with tier discount!
      },
      {
        id: 'sku-8015-blk',
        product_id: 'prod-8015',
        sku_code: 'AK-8015-BLK',
        color_name: '暗夜战术黑 (Stealth Black)',
        color_name_en: 'Stealth Black',
        color_hex: '#212224',
        base_price_usd: 32.0,
        sellable_status: 'active',
      },
    ],
  },
  {
    id: 'prod-3028',
    brand_id: 'brand-aoking',
    product_code: 'AK-3028',
    title: 'AOKING 尊享头层牛皮公文包 (Executive Leather Laptop Briefcase)',
    title_en: 'Executive Leather Laptop Briefcase',
    category: 'Executive Briefcases',
    active: true,
    series_id: 'commute',
    tag_codes: ['LAPTOP'],
    description_en:
      'A refined full-grain leather briefcase with a padded laptop section, detachable shoulder strap and polished hardware.',
    description: '甄选进口头层植鞣纳帕牛皮，细腻触感经久耐磨。定制精抛光银色金属卡扣，可拆卸真皮减压垫宽肩带，背后设有拉杆箱固定插带。',
    material: 'Full-Grain Tuscan Calfskin / Brushed Alloy Hardware',
    capacity_or_size: '15L (40 x 30 x 9 cm)',
    primary_image: DEMO_IMAGE_LIBRARY[3].url,
    gallery_images: [
      DEMO_IMAGE_LIBRARY[3].url,
    ],
    skus: [
      {
        id: 'sku-3028-brn',
        product_id: 'prod-3028',
        sku_code: 'AK-3028-BRN',
        color_name: '意式浓缩棕 (Espresso Brown)',
        color_name_en: 'Espresso Brown',
        color_hex: '#3b2219',
        base_price_usd: 52.0,
        sellable_status: 'active',
      },
      {
        id: 'sku-3028-blk',
        product_id: 'prod-3028',
        sku_code: 'AK-3028-BLK',
        color_name: '经典商务黑 (Classic Black)',
        color_name_en: 'Classic Black',
        color_hex: '#171717',
        base_price_usd: 52.0,
        sellable_status: 'active',
      },
    ],
  },
  {
    id: 'prod-voy-1001',
    brand_id: 'brand-voyager',
    product_code: 'VOY-1001',
    title: 'VOYAGER 复古粗帆布周末旅行包 (Heritage Weekend Duffle)',
    title_en: 'Heritage Weekend Duffle',
    category: 'Travel Luggage',
    active: true,
    series_id: 'travel',
    tag_codes: [],
    description_en:
      'A heritage-inspired weekend duffle in washed canvas and leather trim, sized for short trips.',
    description: '非 AOKING 授权品牌测试商品，用于验证 T02 未授权品牌访问拒绝机制。',
    material: '16oz Washed Canvas & Crazy Horse Leather',
    capacity_or_size: '45L',
    primary_image: DEMO_IMAGE_LIBRARY[2].url,
    gallery_images: [],
    skus: [
      {
        id: 'sku-voy-1001-khk',
        product_id: 'prod-voy-1001',
        sku_code: 'VOY-1001-KHK',
        color_name: '卡其大地 (Khaki)',
        color_name_en: 'Khaki',
        color_hex: '#a38f6b',
        base_price_usd: 45.0,
        sellable_status: 'active',
      },
    ],
  },
];

export const INITIAL_INVENTORY: InventoryBalance[] = [
  // AK-9042-BLK (Matte Black) - Total available: 230
  { warehouse_id: 'wh-sh', sku_id: 'sku-9042-blk', on_hand: 160, reserved: 20, unsellable: 0, updated_at: '2026-10-31' },
  { warehouse_id: 'wh-gz', sku_id: 'sku-9042-blk', on_hand: 90, reserved: 0, unsellable: 0, updated_at: '2026-10-31' },

  // AK-9042-GRY (Charcoal Grey) - Total available: 85
  { warehouse_id: 'wh-sh', sku_id: 'sku-9042-gry', on_hand: 90, reserved: 5, unsellable: 0, updated_at: '2026-10-31' },

  // AK-9042-NAV (Deep Navy) - Total available: 0 (Out of Stock -> D08/T06 Request Restock)
  { warehouse_id: 'wh-sh', sku_id: 'sku-9042-nav', on_hand: 0, reserved: 0, unsellable: 0, updated_at: '2026-10-31' },
  { warehouse_id: 'wh-gz', sku_id: 'sku-9042-nav', on_hand: 0, reserved: 0, unsellable: 0, updated_at: '2026-10-31' },

  // AK-9042-OLV (Olive Green) - Total available: 6 (< 10 MOQ -> Cannot place order, allow Restock Request)
  { warehouse_id: 'wh-sh', sku_id: 'sku-9042-olv', on_hand: 6, reserved: 0, unsellable: 0, updated_at: '2026-10-31' },

  // AK-7710-SLV (Graphite Silver) - Total available: 140
  { warehouse_id: 'wh-sh', sku_id: 'sku-7710-slv', on_hand: 150, reserved: 10, unsellable: 0, updated_at: '2026-10-31' },

  // AK-7710-BLK (Obsidian Black) - Total available: 90
  { warehouse_id: 'wh-gz', sku_id: 'sku-7710-blk', on_hand: 90, reserved: 0, unsellable: 0, updated_at: '2026-10-31' },

  // AK-7710-GLD (Champagne Gold) - Total available: 120
  { warehouse_id: 'wh-sh', sku_id: 'sku-7710-gld', on_hand: 120, reserved: 0, unsellable: 0, updated_at: '2026-10-31' },

  // AK-8015-NVY (Tactical Navy) - 100 PCS reserved for paid order ord-002; available: 200
  { warehouse_id: 'wh-sh', sku_id: 'sku-8015-nvy', on_hand: 200, reserved: 100, unsellable: 0, updated_at: '2026-10-31' },
  { warehouse_id: 'wh-nb', sku_id: 'sku-8015-nvy', on_hand: 100, reserved: 0, unsellable: 0, updated_at: '2026-10-31' },

  // AK-8015-BLK (Stealth Black) - Total available: 175
  { warehouse_id: 'wh-sh', sku_id: 'sku-8015-blk', on_hand: 180, reserved: 5, unsellable: 0, updated_at: '2026-10-31' },

  // AK-3028-BRN (Espresso Brown) - Total available: 110
  { warehouse_id: 'wh-sh', sku_id: 'sku-3028-brn', on_hand: 110, reserved: 0, unsellable: 0, updated_at: '2026-10-31' },

  // AK-3028-BLK (Classic Black) - Total available: 140
  { warehouse_id: 'wh-gz', sku_id: 'sku-3028-blk', on_hand: 140, reserved: 0, unsellable: 0, updated_at: '2026-10-31' },

  // VOY-1001-KHK
  { warehouse_id: 'wh-sh', sku_id: 'sku-voy-1001-khk', on_hand: 80, reserved: 0, unsellable: 0, updated_at: '2026-10-31' },
];

export const INITIAL_TIER_RULES: TierRule[] = [
  { id: 'tier-1', tier_level: 1, name: 'Tier 1 基础批发 (Bronze)', name_en: 'Tier 1 Standard (Bronze)', threshold_usd: 0, discount_rate: 0.0 },
  { id: 'tier-2', tier_level: 2, name: 'Tier 2 银牌批发 (Silver)', name_en: 'Tier 2 Silver', threshold_usd: 10000, discount_rate: 0.05 },
  { id: 'tier-3', tier_level: 3, name: 'Tier 3 金牌伙伴 (Gold)', name_en: 'Tier 3 Gold Partner', threshold_usd: 50000, discount_rate: 0.10 },
  { id: 'tier-4', tier_level: 4, name: 'Tier 4 铂金核心 (Platinum)', name_en: 'Tier 4 Platinum Core', threshold_usd: 150000, discount_rate: 0.15 },
  { id: 'tier-5', tier_level: 5, name: 'Tier 5 钻石分销 (Diamond)', name_en: 'Tier 5 Diamond Distributor', threshold_usd: 350000, discount_rate: 0.20 },
];

export const INITIAL_PROMOTIONS: Promotion[] = [
  {
    id: 'promo-1',
    sku_id: 'sku-7710-gld',
    promo_price_usd: 55.0,
    start_at: '2026-10-15',
    end_at: '2026-11-30',
    stack_tier_discount: false, // Default: Do not stack tier discount
    status: 'active',
  },
  {
    id: 'promo-2',
    sku_id: 'sku-8015-nvy',
    promo_price_usd: 28.0,
    start_at: '2026-10-01',
    end_at: '2026-11-20',
    stack_tier_discount: true, // Configured to STACK tier discount!
    status: 'active',
  },
];

export const INITIAL_COMPANIES: CustomerCompany[] = [
  {
    id: 'comp-001',
    customer_code: 'C000123',
    short_name: 'Apex Luggage Distribution',
    country_alpha3: 'USA',
    internal_nickname: '美西特级分销-Apex',
    assigned_sales_id: 'sales-1',
    status: 'active',
    tier_id: 'tier-3',
    base_tier_id: 'tier-3',
    cumulative_spend_usd: 68400, // Meets Tier 3 ($50,000 threshold)
    last_effective_purchase_date: '2026-05-15', // 6 months ago -> No downgrade
    months_inactive: 6,
    created_at: '2025-01-10',
  },
  {
    id: 'comp-002',
    customer_code: 'C000456',
    short_name: 'EuroBag Logistics GmbH',
    country_alpha3: 'DEU',
    internal_nickname: '德国法兰克福批发商',
    assigned_sales_id: 'sales-1',
    status: 'active',
    tier_id: 'tier-1', // Downgraded from Tier 2 to Tier 1 due to 26 months inactivity!
    base_tier_id: 'tier-2', // Spend was $18,500
    cumulative_spend_usd: 18500,
    last_effective_purchase_date: '2024-09-01', // 26 months ago! (>=18 months, down 1 level)
    months_inactive: 26,
    created_at: '2024-03-01',
  },
  {
    id: 'comp-003',
    customer_code: 'C000789',
    short_name: 'Nippon Travel Gear KK',
    country_alpha3: 'JPN',
    internal_nickname: '日本东京关东总代',
    assigned_sales_id: 'sales-1',
    status: 'active',
    tier_id: 'tier-5',
    base_tier_id: 'tier-5',
    cumulative_spend_usd: 390000,
    last_effective_purchase_date: '2026-09-20',
    months_inactive: 1,
    created_at: '2023-11-15',
  },
];

export const INITIAL_CUSTOMER_USERS: CustomerUser[] = [
  {
    id: 'user-001a',
    company_id: 'comp-001',
    username: 'AK000123A',
    account_letter: 'A',
    must_change_password: false,
    status: 'active',
    created_at: '2025-01-10',
  },
  {
    id: 'user-001b',
    company_id: 'comp-001',
    username: 'AK000123B',
    account_letter: 'B',
    must_change_password: false,
    status: 'active',
    created_at: '2025-03-20',
  },
  {
    id: 'user-002a',
    company_id: 'comp-002',
    username: 'AK000456A',
    account_letter: 'A',
    must_change_password: true, // For testing first login mandatory password reset!
    status: 'active',
    created_at: '2026-10-30',
  },
];

export const INITIAL_INTERNAL_USERS: InternalUser[] = [
  {
    id: 'sales-1',
    name: 'Tom Miller (汤姆)',
    internal_email: 'tom.m@aoking-direct.internal',
    role: 'sales',
  },
  {
    id: 'admin-1',
    name: 'Sarah Lin (林总管)',
    internal_email: 'admin.lin@aoking-direct.internal',
    role: 'admin',
  },
];

export const INITIAL_BRAND_GRANTS: BrandGrant[] = [
  { company_id: 'comp-001', brand_id: 'brand-aoking', granted_at: '2025-01-10' },
  { company_id: 'comp-002', brand_id: 'brand-aoking', granted_at: '2024-03-01' },
  { company_id: 'comp-003', brand_id: 'brand-aoking', granted_at: '2023-11-15' },
  // Notice: 'brand-voyager' is NOT granted to comp-001 (testing T02)
];

export const INITIAL_ORDERS: Order[] = [
  {
    id: 'ord-001',
    order_no: 'ORD-20261028-001',
    company_id: 'comp-001',
    created_by_user_id: 'user-001a',
    created_by_username: 'AK000123A',
    status: 'CONFIRMED',
    lines: [
      {
        sku_id: 'sku-9042-blk',
        sku_code: 'AK-9042-BLK',
        product_title: 'AOKING 商务防水精英双肩包',
        color_name: '哑光暗夜黑',
        quantity: 20,
        quoted_unit_price: 34.2, // 38 * 0.9 (10% Tier 3 discount)
        confirmed_unit_price: 34.2,
        line_subtotal: 684.0,
      },
      {
        sku_id: 'sku-7710-slv',
        sku_code: 'AK-7710-SLV',
        product_title: 'AOKING 航空级全铝镁框防爆登机箱 20"',
        color_name: '石墨钛银',
        quantity: 10,
        quoted_unit_price: 58.5, // 65 * 0.9
        confirmed_unit_price: 58.5,
        line_subtotal: 585.0,
      },
    ],
    total_quoted_usd: 1269.0,
    total_confirmed_usd: 1269.0,
    shipping_method: 'Sea',
    destination_country_alpha3: 'USA',
    expected_ship_date: '2026-11-20',
    shipping_requirements: 'Standard palletized packing, export carton with AOKING barcode stickers.',
    assigned_sales_id: 'sales-1',
    reservation_expires_at: '2026-11-04T12:00:00Z',
    reservation_extended_count: 0,
    reservation_allocations: [
      { sku_id: 'sku-9042-blk', warehouse_id: 'wh-sh', quantity: 20 },
      { sku_id: 'sku-7710-slv', warehouse_id: 'wh-sh', quantity: 10 },
    ],
    customer_visible_note: 'Your order has been confirmed and a demo reservation was created in the Shanghai warehouse. The reservation is valid for 72 hours; please complete the offline T/T payment.',
    internal_note: '客户拟拼整柜海运，订金待查。预占到期前若未见水单需邮件跟进。',
    created_at: '2026-10-28 14:22:00',
    updated_at: '2026-10-28 15:10:00',
  },
  {
    id: 'ord-002',
    order_no: 'ORD-20261020-002',
    company_id: 'comp-001',
    created_by_user_id: 'user-001b',
    created_by_username: 'AK000123B',
    status: 'PAYMENT_RECORDED',
    lines: [
      {
        sku_id: 'sku-8015-nvy',
        sku_code: 'AK-8015-NVY',
        product_title: 'AOKING 城市机能战术卷顶双肩包',
        color_name: '战术海军蓝',
        quantity: 100,
        quoted_unit_price: 25.2, // Promo $28 * 0.9 (stackable!)
        confirmed_unit_price: 25.2,
        line_subtotal: 2520.0,
      },
    ],
    total_quoted_usd: 2520.0,
    total_confirmed_usd: 2520.0,
    shipping_method: 'Air',
    destination_country_alpha3: 'USA',
    expected_ship_date: '2026-11-10',
    shipping_requirements: 'Air freight carton packaging, custom label for West Coast warehouse.',
    assigned_sales_id: 'sales-1',
    payment_recorded_at: '2026-10-22 10:15:00',
    payment_amount_usd: 2520.0,
    payment_reference: 'WIRE-20261021-BOA9981',
    reservation_allocations: [
      { sku_id: 'sku-8015-nvy', warehouse_id: 'wh-sh', quantity: 100 },
    ],
    customer_visible_note: 'Full payment of USD $2,520.00 has been verified. The warehouse is preparing the air-freight pallet.',
    internal_note: '招行美金账户已收到，水单齐全，已计入客户历史累计采购额。',
    created_at: '2026-10-20 09:30:00',
    updated_at: '2026-10-22 10:15:00',
  },
  {
    id: 'ord-003',
    order_no: 'ORD-20261010-003',
    company_id: 'comp-001',
    created_by_user_id: 'user-001a',
    created_by_username: 'AK000123A',
    status: 'SHIPPED',
    lines: [
      {
        sku_id: 'sku-3028-brn',
        sku_code: 'AK-3028-BRN',
        product_title: 'AOKING 尊享头层牛皮公文包',
        color_name: '意式浓缩棕',
        quantity: 30,
        quoted_unit_price: 46.8, // 52 * 0.9
        confirmed_unit_price: 46.8,
        line_subtotal: 1404.0,
      },
    ],
    total_quoted_usd: 1404.0,
    total_confirmed_usd: 1404.0,
    shipping_method: 'Express',
    destination_country_alpha3: 'USA',
    expected_ship_date: '2026-10-15',
    shipping_requirements: 'Handle with care leather items, moisture barrier bags inside each carton.',
    assigned_sales_id: 'sales-1',
    payment_recorded_at: '2026-10-12 16:00:00',
    payment_amount_usd: 1404.0,
    payment_reference: 'WIRE-20261012-CITI442',
    carrier: 'DHL Express Worldwide',
    tracking_no: 'DHL-8890214300',
    actual_ship_date: '2026-10-15',
    estimated_delivery_date: '2026-10-22',
    customer_visible_note: 'The entire order has been dispatched with DHL Express and is expected to arrive at the destination port in 5–7 business days.',
    internal_note: 'DHL 提货完毕，面单复印件已归档。',
    created_at: '2026-10-10 11:00:00',
    updated_at: '2026-10-15 17:30:00',
  },
];

export const INITIAL_RESTOCK_REQUESTS: RestockRequest[] = [
  {
    id: 'restock-001',
    company_id: 'comp-001',
    sku_id: 'sku-9042-nav',
    sku_code: 'AK-9042-NAV',
    product_title: 'AOKING 商务防水精英双肩包',
    color_name: '深海湛蓝',
    requested_qty: 60,
    status: 'pending',
    created_at: '2026-10-29 16:45:00',
  },
];

export const INITIAL_NOTIFICATIONS: CustomerNotification[] = [
  {
    id: 'notif-001',
    company_id: 'comp-001',
    title: 'Order ORD-20261028-001 confirmed',
    message: 'Your order request was confirmed and demo stock was reserved for 72 hours.',
    event_type: 'ORDER_CONFIRMED',
    related_id: 'ord-001',
    is_read: false,
    created_at: '2026-10-28 15:10:00',
  },
  {
    id: 'notif-002',
    company_id: 'comp-001',
    title: 'Payment received: ORD-20261020-002',
    message: 'USD $2,520.00 has been verified and added to your company\'s historical purchase total.',
    event_type: 'PAYMENT_RECEIVED',
    related_id: 'ord-002',
    is_read: true,
    created_at: '2026-10-22 10:15:00',
  },
  {
    id: 'notif-003',
    company_id: 'comp-001',
    title: 'Shipment update: ORD-20261010-003',
    message: 'The entire order has shipped with DHL Express. Tracking: DHL-8890214300.',
    event_type: 'SHIPMENT_DISPATCHED',
    related_id: 'ord-003',
    is_read: true,
    created_at: '2026-10-15 17:30:00',
  },
];

export const INITIAL_EMAIL_TEMPLATES: InternalEmailTemplate[] = [
  {
    id: 'mail-001',
    event_type: 'ORDER_CONFIRMATION',
    sales_rep_email: 'tom.m@aoking-direct.internal',
    recipient_company_code: 'C000123',
    recipient_company_name: 'Apex Luggage Distribution',
    subject: '[AOKING Direct] Order Confirmed & Inventory Reserved — Order #ORD-20261028-001',
    body_text: `Dear Partner,

Your wholesale spot-order #ORD-20261028-001 has been reviewed and officially confirmed by AOKING Direct Sales Division.

All items have been reserved for this frontend demo (not a database transaction) in our Shanghai export warehouse:
- AK-9042-BLK (Matte Black): 20 PCS @ USD $34.20
- AK-7710-SLV (Graphite Silver): 10 PCS @ USD $58.50
Total Order Value: USD $1,269.00

Inventory Reservation Period: 72 Hours (Expires: Nov 04, 2026 12:00 UTC).
Please remit the payment via wire transfer (T/T) according to our proforma invoice. Once wire payment is completed, kindly reply to this email with your bank payment swift voucher.

Best regards,
Tom Miller | International Sales Division
AOKING Direct B2B Platform`,
    created_at: '2026-10-28 15:10:00',
    status: 'ready_to_send',
  },
];

export const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'audit-001',
    timestamp: '2026-10-31 09:12:00',
    actor: 'Admin Lin (Admin)',
    action: 'CREATE_COMPANY',
    target: 'C000123 (Apex Luggage Distribution)',
    details: 'Company registered with ISO: USA. Default brand AOKING granted.',
  },
  {
    id: 'audit-002',
    timestamp: '2026-10-31 09:14:00',
    actor: 'Admin Lin (Admin)',
    action: 'CREATE_USER',
    target: 'AK000123A',
    details: 'Primary buyer account generated with one-time temporary password.',
  },
  {
    id: 'audit-003',
    timestamp: '2026-10-28 15:10:00',
    actor: 'Tom Miller (Sales)',
    action: 'CONFIRM_ORDER',
    target: 'ORD-20261028-001',
    details: 'Frontend mock reservation: 20 pcs AK-9042-BLK, 10 pcs AK-7710-SLV. Expiry 72h.',
  },
  {
    id: 'audit-004',
    timestamp: '2026-10-22 10:15:00',
    actor: 'Tom Miller (Sales)',
    action: 'RECORD_PAYMENT',
    target: 'ORD-20261020-002',
    details: 'Recorded USD $2,520.00 via WIRE-20261021-BOA9981. Updated cumulative spend.',
  },
];

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { OrderLanguage } from '../utils/orderStatus';

const STORAGE_PREFIX = 'aoking.internal.language.';

const EN_TO_ZH: Record<string, string> = {
  'AOKING Direct': 'AOKING Direct',
  Products: '商品',
  Inventory: '库存',
  Import: '导入',
  Setup: '基础设置',
  Orders: '订单',
  Catalogue: '商品目录',
  Cart: '购物车',
  'Customer tiers': '客户等级与折扣',
  'Sign out': '退出登录',
  'Loading…': '加载中…',
  'Loading products…': '正在加载商品…',
  'Loading inventory…': '正在加载库存…',
  'Loading setup…': '正在加载基础设置…',
  'Loading orders…': '正在加载订单…',
  'No products yet. Create the first draft product.': '暂无商品，请先创建第一个草稿商品。',
  'No inventory rows. Register stock explicitly for a SKU and warehouse.':
    '暂无库存记录。请为 SKU 与仓库明确登记库存。',
  'No warehouses yet.': '暂无仓库。',
  'No series yet.': '暂无系列。',
  'No tags yet.': '暂无功能标签。',
  'No match': '没有匹配项',
  'No matches': '没有匹配项',
  'Search product code, name or brand': '搜索商品款号、名称或品牌',
  'Search SKU, product or warehouse': '搜索 SKU、商品或仓库',
  'Search SKU、商品或颜色': '搜索 SKU、商品或颜色',
  'Refresh': '刷新',
  'Register stock': '登记库存',
  'Adjust': '调整库存',
  'Save': '保存',
  'Save product': '保存商品',
  'Cancel': '取消',
  'Close': '关闭',
  'Retry': '重试',
  'Create': '创建',
  'Create warehouse': '创建仓库',
  'Create series': '创建系列',
  'Create tag': '创建功能标签',
  'New product': '新建商品',
  'Published': '已上架',
  'Draft': '草稿',
  'Active': '启用',
  'Inactive': '停用',
  'Deactivate': '停用',
  'Activate': '启用',
  'Upload': '上传',
  'Images': '图片',
  'Product code': '商品款号',
  'Product name': '商品名称',
  'Chinese name': '中文名称',
  'English name': '英文名称',
  'Category': '分类',
  'Series': '系列',
  'Material': '材质',
  'Size / capacity': '尺寸 / 容量',
  'English description': '英文描述',
  'Brand': '品牌',
  'Primary image set.': '主图已设置。',
  'Image uploaded.': '图片已上传。',
  'Product saved.': '商品已保存。',
  'Product created as a draft.': '商品已创建为草稿。',
  'Product published.': '商品已上架。',
  'Product unpublished and affected pending orders cancelled.': '商品已下架，受影响的待确认订单已取消。',
  'Publishing requires at least one active SKU and one image.': '上架至少需要一个启用 SKU 和一张图片。',
  'Keep current state': '保持当前状态',
  'Pending orders will be cancelled': '待确认订单将被取消',
  'Stock import': '库存导入',
  'Choose file': '选择文件',
  'Download CSV template': '下载 CSV 模板',
  'Download template': '下载模板',
  'Server preview': '服务端预览',
  'Confirm import': '确认导入',
  'Import committed': '导入已提交',
  'Already imported (idempotent)': '已导入（幂等）',
  'Import another file': '导入另一个文件',
  'Row': '行',
  'Warehouse': '仓库',
  'On hand': '在手',
  'Reserved': '预占',
  'Unsellable': '不可售',
  'Available': '可用',
  'Version': '版本',
  'Product': '商品',
  'Warehouses': '仓库',
  'Feature tags': '功能标签',
  'Code': '编码',
  'Create a warehouse before registering stock.': '请先创建仓库再登记库存。',
  'Read-only stock view. Sales cannot adjust quantities or reserved stock.':
    '只读库存视图。业务员不能调整数量或预占库存。',
  'Administrator view: on hand, reserved and unsellable per SKU and warehouse.':
    '管理员视图：按 SKU 与仓库显示在手、预占与不可售库存。',
  'Inventory registered.': '库存已登记。',
  'Inventory adjusted and audited.': '库存已调整并记录审计。',
  'The request failed.': '请求失败。',
  'You do not have inventory access.': '你没有库存查看权限。',
  'Warehouse view': '仓库视图',
  'Inventory list': '库存列表',
  'Search and select SKU': '搜索并选择 SKU',
  'Select registration warehouse': '选择登记仓库',
  'Select an active warehouse': '选择启用仓库',
  'Prepare registration': '准备登记',
  'Warehouse and inventory records': '仓库与库存记录',
  'No inventory records.': '尚无库存记录。',
  'View all records in this warehouse': '查看该仓库全部记录',
  'View / adjust existing inventory': '查看／调整已有库存',
  'Confirm inventory registration': '确认库存登记',
  'On hand after registration': '登记后在手数量',
  'Unsellable quantity': '其中不可售数量',
  'Registration reason': '登记原因',
  'Confirm registration': '确认登记',
  'Cancel registration': '取消',
  'Registration saved.': '库存登记已保存。',
  'Checking existing inventory…': '正在核对已有库存记录…',
  'Query latest status': '查询最新状态',
  'This SKU is already registered in this warehouse. View or adjust it separately.':
    '此 SKU 已在该仓库登记，请查看或独立调整已有库存。',
  'Search SKU, product or colour': '搜索 SKU、商品或颜色',
  'Drag to an active warehouse on the right, or select a warehouse below. Quantities and a reason are still confirmed in the dialog.':
    '拖至右侧启用仓库，或在下方选择仓库。放下后仍需确认数量及原因。',
  'Search an existing catalogue SKU, including SKUs with no inventory record.':
    '搜索商品目录中的 SKU，包括尚无库存记录的 SKU。',
  'Mobile and keyboard users can select a warehouse; dragging is optional.':
    '手机与键盘均可通过选择操作，无需拖拽。',
  'records · PCS': '条库存记录 · PCS',
  'Active warehouses accept first registration; existing records open the view/adjust flow.':
    '启用仓库可接收 SKU 登记；已有记录将进入查看或独立调整。',
  'Inactive warehouses reject first registration. Existing records remain viewable.':
    '停用仓库不接受首次登记。已有库存记录仍可查看。',
  'Create the first real warehouse in Setup before registering stock.':
    '请先在基础设置中创建真实仓库。',
  'Customer tier and discount preview': '客户等级与折扣预览',
  'This is a UI preview only. It is not persisted and is not applied to real orders.':
    '界面预览，尚未应用于真实订单。',
  'Tier preview workspace': '等级预览工作区',
  'Edit': '编辑',
  'Apply preview': '应用预览',
  'Reset preview': '重置预览',
  'Preview updated in this browser only. Nothing was written to the database or applied to orders.':
    '仅在本浏览器更新预览。未写入数据库，也未应用于真实订单。',
  'Threshold (USD)': '门槛 (USD)',
  'Discount': '折扣率',
  'Validation': '数据校验',
  'Sample price': '示例价格',
  'Preview price': '预览价格',
};

const ZH_TO_EN: Record<string, string> = {
  "商品": 'Products',
  "库存": 'Inventory',
  "导入": 'Import',
  "基础设置": 'Setup',
  "订单": 'Orders',
  "商品目录": 'Catalogue',
  "购物车": 'Cart',
  "客户等级与折扣": 'Customer tiers',
  "客户等级与折扣预览": 'Customer tier and discount preview',
  "退出登录": 'Sign out',
  "加载中": 'Loading…',
  "刷新": 'Refresh',
  "登记库存": 'Register stock',
  "调整库存": 'Adjust',
  "保存": 'Save',
  "取消": 'Cancel',
  "关闭": 'Close',
  "重试": 'Retry',
  "创建": 'Create',
  "启用": 'Active',
  "停用": 'Inactive',
  "已停用": 'Inactive',
  "已上架": 'Published',
  "草稿": 'Draft',
  "图片": 'Images',
  "商品款号": 'Product code',
  "中文名称": 'Chinese name',
  "英文名称": 'English name',
  "分类": 'Category',
  "系列": 'Series',
  "材质": 'Material',
  "尺寸 / 容量": 'Size / capacity',
  "英文描述": 'English description',
  "品牌": 'Brand',
  "仓库": 'Warehouse',
  "仓库视图": 'Warehouse view',
  "库存列表": 'Inventory list',
  "选择需要登记的 SKU": 'Select a SKU to register',
  "搜索并选择 SKU": 'Search and select SKU',
  "搜索 SKU、商品或颜色": 'Search SKU, product or colour',
  "没有匹配的 SKU": 'No matching SKU',
  "登记至": 'Register to',
  "选择登记仓库": 'Select registration warehouse',
  "选择启用仓库": 'Select an active warehouse',
  "没有启用仓库": 'No active warehouse',
  "准备登记": 'Prepare registration',
  "手机与键盘均可通过选择操作，无需拖拽。": 'Mobile and keyboard users can select a warehouse; dragging is optional.',
  "拖至右侧启用仓库，或在下方选择仓库。放下后仍需确认数量及原因。":
    'Drag to an active warehouse on the right, or select a warehouse below. Quantities and a reason are still confirmed in the dialog.',
  "搜索商品目录中的 SKU，包括尚无库存记录的 SKU。":
    'Search an existing catalogue SKU, including SKUs with no inventory record.',
  "仓库与库存记录": 'Warehouse and inventory records',
  "个仓库": 'warehouses',
  "条 SKU 库存记录": 'SKU inventory records',
  "在手": 'On hand',
  "预占": 'Reserved',
  "不可售": 'Unsellable',
  "可用": 'Available',
  "查看／独立调整": 'View / adjust',
  "尚无库存记录。": 'No inventory records.',
  "查看该仓库全部记录": 'View all records in this warehouse',
  "可接收 SKU 登记；已有记录将进入查看或独立调整。":
    'Active warehouses accept first registration; existing records open the view/adjust flow.',
  "停用仓库不接受首次登记。已有库存记录仍可查看。":
    'Inactive warehouses reject first registration. Existing records remain viewable.',
  "尚无仓库。请先在基础设置中创建真实仓库。":
    'No warehouses yet. Create the first real warehouse in Setup before registering stock.',
  "确认库存登记": 'Confirm inventory registration',
  "登记后在手数量": 'On hand after registration',
  "其中不可售数量": 'Unsellable quantity',
  "登记原因": 'Registration reason',
  "确认登记": 'Confirm registration',
  "正在登记…": 'Registering…',
  "库存登记已保存。": 'Registration saved.',
  "正在核对已有库存记录…": 'Checking existing inventory…',
  "此 SKU 已在该仓库登记，请查看或独立调整已有库存。":
    'This SKU is already registered in this warehouse. View or adjust it separately.',
  "查看／调整已有库存": 'View / adjust existing inventory',
  "查询最新状态": 'Query latest status',
  "库存已登记，流水与审计由服务器记录。": 'Inventory registered; movements and audit were recorded by the server.',
  "库存登记": 'Inventory registration',
  "界面预览，尚未应用于真实订单。": 'This is a UI preview only. It is not applied to real orders.',
  "应用预览": 'Apply preview',
  "重置预览": 'Reset preview',
  "预览更新仅在本浏览器生效，未写入数据库或真实订单。":
    'Preview updated in this browser only. Nothing was written to the database or applied to orders.',
};

function hasCjk(value: string): boolean {
  return /[㐀-鿿]/.test(value);
}

function splitBilingual(value: string): { en: string; zh: string } | null {
  const match = /^(.*?)\s+\/\s+(.*)$/.exec(value);
  if (!match) return null;
  const left = match[1].trim();
  const right = match[2].trim();
  if (left && right && !hasCjk(left) && hasCjk(right)) return { en: left, zh: right };
  if (left && right && hasCjk(left) && !hasCjk(right)) return { en: right, zh: left };
  return null;
}

export function translateInternalText(value: string, language: OrderLanguage): string {
  if (!value.trim()) return value;
  const split = splitBilingual(value);
  if (split) return language === 'zh' ? split.zh : split.en;
  if (language === 'zh') return EN_TO_ZH[value] ?? value;
  return ZH_TO_EN[value] ?? value;
}

const TEXT_ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt'] as const;
const COMPONENT_TEXT_PROPS = [
  'ariaLabel',
  'label',
  'placeholder',
  'emptyText',
  'submitLabel',
  'description',
] as const;

function translateNode(node: React.ReactNode, language: OrderLanguage): React.ReactNode {
  if (typeof node === 'string') return translateInternalText(node, language);
  if (typeof node === 'number' || node === null || node === undefined || typeof node === 'boolean') {
    return node;
  }
  if (Array.isArray(node)) return node.map(item => translateNode(item, language));
  if (!React.isValidElement(node)) return node;
  const element = node as React.ReactElement<Record<string, unknown>>;

  if (element.type === React.Fragment) {
    return React.cloneElement(element, {
      ...element.props,
      children: translateNode(element.props.children as React.ReactNode, language),
    });
  }

  const original = element.props;
  const props: Record<string, unknown> = { ...original };
  let changed = false;
  if (typeof element.type === 'string') {
    for (const attribute of TEXT_ATTRIBUTES) {
      const value = original[attribute];
      if (typeof value === 'string') {
        const translated = translateInternalText(value, language);
        if (translated !== value) {
          props[attribute] = translated;
          changed = true;
        }
      }
    }
  } else {
    for (const attribute of COMPONENT_TEXT_PROPS) {
      const value = original[attribute];
      if (typeof value === 'string') {
        const translated = translateInternalText(value, language);
        if (translated !== value) {
          props[attribute] = translated;
          changed = true;
        }
      }
    }
  }
  if (original.children !== undefined && !['input', 'textarea'].includes(String(element.type))) {
    const children = translateNode(original.children as React.ReactNode, language);
    if (children !== original.children) {
      props.children = children;
      changed = true;
    }
  }
  return changed ? React.cloneElement(element, props) : element;
}

interface InternalLanguageContextValue {
  language: OrderLanguage;
  setLanguage: (language: OrderLanguage) => void;
  t: (en: string, zh?: string) => string;
}

const InternalLanguageContext = createContext<InternalLanguageContextValue | null>(null);

export const InternalLanguageProvider: React.FC<{
  userKey: string;
  children: React.ReactNode;
}> = ({ userKey, children }) => {
  const storageKey = `${STORAGE_PREFIX}${userKey}`;
  const [language, setLanguageState] = useState<OrderLanguage>(() => {
    try {
      return window.localStorage.getItem(storageKey) === 'zh' ? 'zh' : 'en';
    } catch {
      return 'en';
    }
  });

  const setLanguage = useCallback(
    (next: OrderLanguage) => {
      setLanguageState(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* preference is a convenience */
      }
    },
    [storageKey]
  );

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === 'zh' || stored === 'en') setLanguageState(stored);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: (en: string, zh?: string) =>
        language === 'zh' ? zh ?? translateInternalText(en, 'zh') : en,
    }),
    [language, setLanguage]
  );

  return (
    <InternalLanguageContext.Provider value={value}>{children}</InternalLanguageContext.Provider>
  );
};

export function useInternalLanguage(): InternalLanguageContextValue {
  const context = useContext(InternalLanguageContext);
  if (!context) {
    return {
      language: 'en',
      setLanguage: () => undefined,
      t: (en: string) => en,
    };
  }
  return context;
}

/** Translates host text/attributes without touching user data or input values. */
export const Localized: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { language } = useInternalLanguage();
  return <>{translateNode(children, language)}</>;
};

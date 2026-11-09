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
  '% OFF': '% 折扣',
  // Round 2 review: remaining internal static labels and feedback.
  'SKU DIRECTORY': 'SKU 目录',
  'No series': '无系列',
  'Creating…': '正在创建…',
  'Uploading…': '正在上传…',
  'Reading…': '正在读取…',
  'Committing…': '正在提交…',
  'Registering…': '正在登记…',
  'Loading order detail…': '正在加载订单详情…',
  'PRIMARY': '主图',
  'Set primary': '设为主图',
  'Move up': '上移',
  'Remove': '移除',
  'Reason': '原因',
  'Register': '登记',
  'Save adjustment': '保存调整',
  'On hand (old → new)': '在手（旧 → 新）',
  'Unsellable (old → new)': '不可售（旧 → 新）',
  'No warehouse or stock is seeded. Create the real warehouse code before registering stock.':
    '未预置仓库或库存。请先创建真实仓库编码，再登记库存。',
  'Warehouse bilingual names updated.': '仓库中英文名称已更新。',
  'Warehouse updated.': '仓库已更新。',
  'Code (e.g. WH-SH)': '编码（如 WH-SH）',
  'Code (e.g. WATERPROOF)': '编码（如 WATERPROOF）',
  'Warehouse created.': '仓库已创建。',
  'Series updated.': '系列已更新。',
  'Series created.': '系列已创建。',
  'Tags and series cannot be deleted; deactivate them instead. Existing product links remain.':
    '功能标签与系列不可删除，请改为停用；已有商品关联保持不变。',
  'Tag updated.': '功能标签已更新。',
  'Tag created.': '功能标签已创建。',
  'SKU code': 'SKU 编码',
  'Colour EN': '颜色英文',
  'Colour ZH': '颜色中文',
  'USD price': '美元价格',
  'Colour hex': '颜色色值',
  'SKU image': 'SKU 图片',
  'Use product image': '使用商品图片',
  'SKU created.': 'SKU 已创建。',
  'SKU saved.': 'SKU 已保存。',
  'Price USD': '价格（美元）',
  'Discontinue': '停用',
  'Reactivate': '重新启用',
  'SKU status updated.': 'SKU 状态已更新。',
  'SKU discontinued and affected pending orders cancelled.':
    'SKU 已停用，受影响的待确认订单已取消。',
  'Discontinuing this SKU cancels every pending-confirmation order that contains it.':
    '停用此 SKU 将取消所有包含它的待确认订单。',
  'The order-impact preview failed.': '待确认订单影响预览失败。',
  'Unpublishing this product cancels every pending-confirmation order that contains it.':
    '下架此商品将取消所有包含它的待确认订单。',
  'No images yet. Publishing requires at least one image.':
    '暂无图片。上架至少需要一张图片。',
  'Image order saved.': '图片顺序已保存。',
  'Image removed.': '图片已移除。',
  'The backend re-checks this exact set inside the transaction. If another order is submitted or cancelled first, the action is rejected and you must review again. Customers and their assigned salesperson receive a pending notification record; no email is sent in this phase.':
    '后端会在事务内重新校验这一组订单。若期间有其他订单被提交或取消，操作将被拒绝，需重新查看后确认。客户及其业务员会收到一条待处理通知记录；本阶段不发送邮件。',
  'CSV or XLSX with sku_code, warehouse_code, on_hand, unsellable. Maximum 500 rows and 1 MB. The server re-validates every row and commits all-or-nothing.':
    'CSV 或 XLSX，列包含 sku_code、warehouse_code、on_hand、unsellable。最多 500 行、1 MB。服务器会重新校验每一行并整批提交。',
  'Header-only file, ready for Excel. Downloading never writes inventory.':
    '仅表头文件，可直接用 Excel 打开。下载不会写入库存。',
  'Values below come from PostgreSQL. Confirming locks each row and rejects the whole batch if anything changed.':
    '以下数值来自 PostgreSQL。确认时会锁定每一行；如任一数据已变化，整批将被拒绝。',
  'Clear file': '清除文件',
  'Import preview failed.': '导入预览失败。',
  'Import commit failed.': '导入提交失败。',
  'Repeated confirmation with the same preview does not change stock again.':
    '使用同一预览重复确认不会再次变更库存。',
  'Create a product with an SKU and an active warehouse before registering stock.':
    '请先创建带 SKU 的商品与启用仓库，再登记库存。',
  'Refresh failed.': '刷新失败。',
  'Edit names': '编辑名称',
  'Both the Chinese and English warehouse names are required.':
    '中英文仓库名称均为必填。',
  'Unable to save warehouse names.': '无法保存仓库名称。',
  'Close registration dialog': '关闭登记窗口',
  'Reference pricing details': '参考价格说明',
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
  // Round 2 review: remaining internal Chinese labels and feedback.
  "库存视图": 'Inventory view',
  "清除仓库筛选": 'Clear warehouse filter',
  "颜色中文": 'Colour ZH',
  "关闭登记窗口": 'Close registration dialog',
  "查询失败，请重试。": 'The lookup failed. Please retry.',
  "请填写 0–100000000 的整数数量、有效不可售数量及登记原因。":
    'Enter whole quantities from 0–100000000, a valid unsellable quantity, and a registration reason.',
  "提交结果尚未确认。请查询最新状态后再决定是否重新登记。":
    'The submission result is unconfirmed. Query the latest status before deciding whether to register again.',
  "已登记成功，列表刷新失败。请关闭后刷新查看，请勿重复登记。":
    'Registration succeeded but the list refresh failed. Close and refresh to verify; do not register again.',
  "登记该仓库实际盘点后的绝对库存数量。此操作不代表仓间调拨，也不会扣减其他仓库。":
    'Register the absolute stock counted in this warehouse. This is not a warehouse transfer and does not deduct stock from other warehouses.',
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

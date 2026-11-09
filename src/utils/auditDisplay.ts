import type { AuditLog } from '../types';

/**
 * Presentation-only dictionaries for the Mock audit view. The stored action
 * code, target, actor and raw details are never rewritten; the view translates
 * them for Chinese display so the underlying audit trail remains unchanged.
 */
const ACTION_LABELS: Record<string, string> = {
  SWITCH_ROLE: '切换演示角色',
  SUBMIT_ORDER: '提交订单',
  CANCEL_ORDER: '取消订单',
  REQUEST_CANCEL: '申请取消',
  MODIFY_ORDER: '修改订单数量',
  REQUEST_CHANGE: '申请数量变更',
  CONFIRM_ORDER: '确认订单',
  EXTEND_RESERVATION: '延长预占',
  RELEASE_RESERVATION: '释放预占',
  RECORD_PAYMENT: '登记付款',
  SHIP_ORDER: '整单发货',
  REJECT_CHANGE_REQUEST: '驳回变更申请',
  APPROVE_CHANGE_REQUEST: '核准变更申请',
  REQUEST_RESTOCK: '申请补货',
  REPLENISH_STOCK: '补货入库',
  CREATE_COMPANY_AND_USER: '创建客户公司与账号',
  CREATE_SECONDARY_USER: '新增子账号',
  TOGGLE_BRAND_GRANT: '变更品牌授权',
  UPDATE_TIER_RULE: '更新等级规则',
  CREATE_PROMOTION: '创建促销',
  EXCEL_IMPORT_STOCK: '导入库存',
  CREATE_PRODUCT: '创建商品',
  UPDATE_PRODUCT: '更新商品',
  PUBLISH_PRODUCT: '上架商品',
  UNPUBLISH_PRODUCT: '下架商品',
  CREATE_SKU: '创建 SKU',
  UPDATE_SKU: '更新 SKU',
  COMPLETE_PASSWORD_RESET: '完成首次改密',
  SIMULATE_TIME_TRAVEL: '模拟未采购时间',
  MARK_EMAIL_SENT: '标记邮件已发送',
  CREATE_COMPANY: '创建客户公司',
  CREATE_USER: '创建登录账号',
  SAVE_SERIES: '保存系列',
  SAVE_FEATURE_TAGS: '保存功能标签',
};

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? '其他业务操作';
}

interface DetailPattern {
  match: RegExp;
  render: (match: RegExpMatchArray) => string;
}

const DETAIL_PATTERNS: DetailPattern[] = [
  {
    match: /^Switched to view role:\s*(.+)$/,
    render: m => `切换到演示角色：${m[1]}`,
  },
  {
    match: /^Order submitted with (\d+) lines, total quote USD \$([\d.]+)\. No stock locked yet\.$/,
    render: m => `提交订单，共 ${m[1]} 行，参考总额 USD $${m[2]}，尚未锁定库存。`,
  },
  {
    match: /^Customer cancelled unconfirmed order\. Reason:\s*(.*)$/,
    render: m => `客户取消未确认订单，原因：${m[1]}`,
  },
  {
    match: /^Submitted cancellation approval request for confirmed order\.$/,
    render: () => '已提交已确认订单的取消申请。',
  },
  {
    match: /^Modified unconfirmed order quantities directly\.$/,
    render: () => '客户直接修改未确认订单数量。',
  },
  {
    match: /^Submitted quantity change approval request for confirmed order\.$/,
    render: () => '已提交已确认订单的数量变更申请。',
  },
  {
    match:
      /^Frontend mock reservation completed \(not a database transaction\)\. Reserved (\d+) PCS\. Expiry 72h\.$/,
    render: m => `前端模拟预占完成（非数据库事务），预占 ${m[1]} PCS，有效期 72 小时。`,
  },
  {
    match: /^Extended inventory reservation by (\d+) hours\.$/,
    render: m => `预占期延长 ${m[1]} 小时。`,
  },
  {
    match: /^Released stock reservation\. Reason:\s*(.*)$/,
    render: m => `释放库存预占，原因：${m[1]}`,
  },
  {
    match: /^Recorded USD \$([\d.]+) payment\. Reference:\s*(.*)\. Updated customer spend and tier\.$/,
    render: m => `登记付款 USD $${m[1]}，水单 ${m[2]}，并更新客户累计采购额与等级。`,
  },
  {
    match: /^Shipped full order via (.*)\. Tracking:\s*(.*)\.$/,
    render: m => `整单发货，承运商 ${m[1]}，运单号 ${m[2]}。`,
  },
  {
    match: /^Rejected change request\. Order and reserved inventory were not changed\.$/,
    render: () => '驳回变更申请，订单与预占库存均未改变。',
  },
  {
    match: /^Approved cancellation\. Released the order.s exact warehouse allocations\.$/,
    render: () => '核准取消，并按原仓库分配释放预占。',
  },
  {
    match: /^Approved quantity change\. New total USD \$([\d.]+); reservation reallocated\.$/,
    render: m => `核准数量变更，新总额 USD $${m[1]}，并重新分配预占。`,
  },
  {
    match: /^Customer requested restock of (\d+) PCS\.$/,
    render: m => `客户申请补货 ${m[1]} PCS。`,
  },
  {
    match: /^Replenished \+(\d+) PCS in warehouse (.*)\. Notified (\d+) customers\.$/,
    render: m => `仓库 ${m[2]} 补货 +${m[1]} PCS，已通知 ${m[3]} 位客户。`,
  },
  {
    match:
      /^Created company (.*) \((.*)\)\. Generated initial user (.*)\. Temporary password shown once\.$/,
    render: m =>
      `创建客户公司 ${m[1]}（${m[2]}），生成初始账号 ${m[3]}，一次性临时密码仅展示一次。`,
  },
  {
    match: /^Added secondary user for company (.*)\. Shares tier and orders\.$/,
    render: m => `为 ${m[1]} 新增子账号，共享等级与订单。`,
  },
  {
    match: /^Updated brand authorization status\.$/,
    render: () => '更新品牌分销授权状态。',
  },
  {
    match: /^Updated threshold to \$([\d.]+), discount to (\d+)%\.$/,
    render: m => `等级门槛更新为 $${m[1]}，折扣更新为 ${m[2]}%。`,
  },
  {
    match: /^Created promo price \$([\d.]+)\. Stack tier discount:\s*(true|false)\.$/,
    render: m => `创建促销价 $${m[1]}，叠加等级折扣：${m[2] === 'true' ? '是' : '否'}。`,
  },
  {
    match: /^Imported (\d+) balance records from a validated local Mock batch\.$/,
    render: m => `从已校验的 Mock 批次导入 ${m[1]} 条库存记录。`,
  },
  {
    match: /^Created product (.*) as an unlisted draft with no SKUs\.$/,
    render: m => `创建商品 ${m[1]}，作为未上架草稿且暂无 SKU。`,
  },
  {
    match: /^Updated product fields; historical order snapshots were not changed\.$/,
    render: () => '更新商品字段，历史订单快照未改变。',
  },
  {
    match: /^Listed product in the customer catalog\.$/,
    render: () => '商品已上架至客户目录。',
  },
  {
    match: /^Unlisted product from the customer catalog\.$/,
    render: () => '商品已从客户目录下架。',
  },
  {
    match: /^Created SKU for (.*) with initial on-hand (\d+)\.$/,
    render: m => `为 ${m[1]} 创建 SKU，初始实存 ${m[2]}。`,
  },
  {
    match: /^Updated SKU (.*); order snapshots and reservation IDs were preserved\.$/,
    render: m => `更新 SKU ${m[1]}，订单快照与预占 ID 保持不变。`,
  },
  {
    match: /^User completed mandatory first-time password change\.$/,
    render: () => '用户已完成首次强制改密。',
  },
  {
    match: /^Advanced inactivity clock by \+(\d+) months\.$/,
    render: m => `未采购计时推进 +${m[1]} 个月。`,
  },
  {
    match: /^Salesperson verified and marked email template as sent to client via corporate email\.$/,
    render: () => '业务员已核验并通过企业邮箱标记模板为已发送。',
  },
  {
    match: /^Updated series dictionary\.$/,
    render: () => '更新系列字典。',
  },
  {
    match: /^Updated feature tag dictionary\.$/,
    render: () => '更新功能标签字典。',
  },
  {
    match: /^Company registered with ISO:\s*([A-Z]{3})\. Default brand AOKING granted\.$/,
    render: m => `已登记客户公司，国家代码 ${m[1]}，默认授予 AOKING 品牌。`,
  },
  {
    match: /^Primary buyer account generated with one-time temporary password\.$/,
    render: () => '已生成首位采购账号及一次性临时密码。',
  },
  {
    match: /^Frontend mock reservation:\s*(.*)\. Expiry 72h\.$/,
    render: m => `前端模拟预占：${m[1]}，有效期 72 小时。`,
  },
  {
    match: /^Recorded USD \$([\d,.]+) via (.*)\. Updated cumulative spend\.$/,
    render: m => `已登记付款 USD $${m[1]}（水单 ${m[2]}），并更新累计采购额。`,
  },
];

export function auditDetailsLabel(details: string): string {
  for (const pattern of DETAIL_PATTERNS) {
    const match = details.match(pattern.match);
    if (match) return pattern.render(match);
  }
  if (/[一-鿿]/.test(details)) return details;
  return '业务明细已记录（原始审计字段保留）。';
}

export function auditSearchText(log: AuditLog): string {
  return [
    log.actor,
    log.action,
    log.target,
    log.details,
    auditActionLabel(log.action),
    auditDetailsLabel(log.details),
  ]
    .join(' ')
    .toLowerCase();
}

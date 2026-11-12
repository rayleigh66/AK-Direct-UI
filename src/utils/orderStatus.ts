import type { OrderStatus } from '../types';

export type OrderLanguage = 'zh' | 'en';

interface OrderStatusMeta {
  zh: string;
  en: string;
  /** Tailwind classes shared by Mock and Real status badges. */
  badge: string;
}

/**
 * One status vocabulary for every order surface. The underlying status values
 * and the order state machine are unchanged; only the label and colour differ.
 */
export const ORDER_STATUS_META: Record<OrderStatus, OrderStatusMeta> = {
  DRAFT: {
    zh: '草稿',
    en: 'Draft',
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  PENDING_CONFIRMATION: {
    zh: '待确认',
    en: 'Pending confirmation',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  CONFIRMED: {
    zh: '已确认',
    en: 'Confirmed',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  PAYMENT_RECORDED: {
    zh: '已收款',
    en: 'Payment recorded',
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  PREPARING_SHIPMENT: {
    zh: '备货中',
    en: 'Preparing shipment',
    badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  SHIPPED: {
    zh: '已发货',
    en: 'Shipped',
    badge: 'bg-violet-50 text-violet-700 border-violet-200',
  },
  DELIVERED: {
    zh: '已送达',
    en: 'Delivered',
    badge: 'bg-teal-50 text-teal-700 border-teal-200',
  },
  COMPLETED: {
    zh: '已完成',
    en: 'Completed',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  CANCELLED: {
    zh: '已取消',
    en: 'Cancelled',
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
  },
  RESERVATION_EXPIRED: {
    zh: '预占已过期',
    en: 'Reservation expired',
    badge: 'bg-orange-50 text-orange-800 border-orange-200',
  },
};

export function orderStatusMeta(status: OrderStatus): OrderStatusMeta {
  return (
    ORDER_STATUS_META[status] ?? {
      zh: status,
      en: status,
      badge: 'bg-slate-100 text-slate-700 border-slate-200',
    }
  );
}

export function orderStatusLabel(status: OrderStatus, language: OrderLanguage): string {
  return orderStatusMeta(status)[language];
}

export function shippingMethodLabel(method: string, language: OrderLanguage): string {
  const labels: Record<string, { zh: string; en: string }> = {
    Express: { zh: '快递', en: 'Express' },
    Air: { zh: '空运', en: 'Air' },
    Sea: { zh: '海运', en: 'Sea' },
    'Customer Pickup': { zh: '客户自提', en: 'Customer pickup' },
    Other: { zh: '其他', en: 'Other' },
  };
  return labels[method]?.[language] ?? method;
}

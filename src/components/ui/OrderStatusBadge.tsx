import React from 'react';
import type { OrderStatus } from '../../types';
import { orderStatusLabel, orderStatusMeta, type OrderLanguage } from '../../utils/orderStatus';

interface OrderStatusBadgeProps {
  status: OrderStatus;
  language: OrderLanguage;
  testId?: string;
}

export const OrderStatusBadge: React.FC<OrderStatusBadgeProps> = ({
  status,
  language,
  testId,
}) => {
  const meta = orderStatusMeta(status);
  return (
    <span
      data-testid={testId}
      data-order-status={status}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold leading-4 ${meta.badge}`}
      title={language === 'zh' ? meta.en : meta.zh}
    >
      {orderStatusLabel(status, language)}
    </span>
  );
};

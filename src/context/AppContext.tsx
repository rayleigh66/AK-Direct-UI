/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useMemo, useCallback, useRef } from 'react';
import {
  Role,
  CustomerCompany,
  CustomerUser,
  InternalUser,
  Brand,
  BrandGrant,
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
} from '../types';
import {
  INITIAL_BRANDS,
  INITIAL_WAREHOUSES,
  INITIAL_PRODUCTS,
  INITIAL_INVENTORY,
  INITIAL_TIER_RULES,
  INITIAL_PROMOTIONS,
  INITIAL_COMPANIES,
  INITIAL_CUSTOMER_USERS,
  INITIAL_INTERNAL_USERS,
  INITIAL_BRAND_GRANTS,
  INITIAL_ORDERS,
  INITIAL_RESTOCK_REQUESTS,
  INITIAL_NOTIFICATIONS,
  INITIAL_EMAIL_TEMPLATES,
  INITIAL_AUDIT_LOGS,
} from '../data/mockData';
import {
  calculateSKUAvailableStock,
  calculateEffectiveUnitPrice,
  evaluateCustomerTier,
  validateSKUQuantity,
  isValidCustomerCode,
  deriveUsername,
  generateTemporaryPassword,
  checkPrivacyViolations,
  planOrderReservation,
  applyReservationAllocations,
  releaseReservationAllocations,
  consumeReservationAllocations,
} from '../utils/rules';

interface CartLine {
  sku_id: string;
  quantity: number;
}

interface AppContextType {
  // Authentication & Role
  currentRole: Role;
  currentCustomerUser: CustomerUser | null;
  currentCompany: CustomerCompany | null;
  currentSalesUser: InternalUser;
  currentAdminUser: InternalUser;
  isMobileSimulator: boolean;
  activeTab: string;

  // Data
  companies: CustomerCompany[];
  customerUsers: CustomerUser[];
  brands: Brand[];
  brandGrants: BrandGrant[];
  products: Product[];
  warehouses: Warehouse[];
  inventory: InventoryBalance[];
  tierRules: TierRule[];
  promotions: Promotion[];
  orders: Order[];
  restockRequests: RestockRequest[];
  notifications: CustomerNotification[];
  internalEmailTemplates: InternalEmailTemplate[];
  auditLogs: AuditLog[];
  cart: CartLine[];

  // Computed
  currentCompanyTierInfo: ReturnType<typeof evaluateCustomerTier> | null;
  unreadNotificationCount: number;

  // Actions
  switchRole: (role: Role, userId?: string) => void;
  toggleMobileSimulator: () => void;
  setActiveTab: (tab: string) => void;
  
  // Cart & Order
  addToCart: (skuId: string, quantity: number) => { success: boolean; message?: string };
  updateCartQuantity: (skuId: string, quantity: number) => { success: boolean; message?: string };
  removeFromCart: (skuId: string) => void;
  clearCart: () => void;
  submitOrder: (data: {
    shippingMethod: Order['shipping_method'];
    destinationCountryAlpha3: string;
    expectedShipDate: string;
    shippingRequirements: string;
  }) => { success: boolean; orderId?: string; error?: string };
  customerCancelOrder: (orderId: string, reason: string) => { success: boolean; message: string };
  customerRequestChange: (orderId: string, reason: string, modifiedLines?: { sku_id: string; new_qty: number }[]) => { success: boolean; message: string };
  
  // Sales Actions
  salesConfirmOrder: (orderId: string) => { success: boolean; error?: string };
  salesExtendReservation: (orderId: string, additionalHours: number) => { success: boolean; error?: string };
  salesReleaseReservation: (orderId: string, reason: string) => { success: boolean; error?: string };
  salesRecordPayment: (orderId: string, amountUsd: number, reference: string) => { success: boolean; error?: string };
  salesUpdateShipment: (
    orderId: string,
    shipmentData: {
      carrier: string;
      trackingNo: string;
      actualShipDate: string;
      estimatedDeliveryDate: string;
      customerVisibleNote: string;
      internalNote: string;
    }
  ) => { success: boolean; error?: string };
  salesHandleChangeRequest: (orderId: string, approve: boolean) => { success: boolean; error?: string };
  markEmailTemplateSent: (templateId: string) => void;

  // Restock Actions
  submitRestockRequest: (skuId: string, requestedQty: number) => { success: boolean; message?: string };
  replenishStock: (skuId: string, warehouseId: string, addQty: number) => void;

  // Admin Actions
  adminCreateCompany: (data: {
    customerCode: string;
    shortName: string;
    countryAlpha3: string;
    internalNickname?: string;
  }) => { success: boolean; companyId?: string; primaryUsername?: string; tempPassword?: string; error?: string };
  adminCreateSecondaryAccount: (companyId: string) => { success: boolean; username?: string; tempPassword?: string; error?: string };
  adminToggleBrandGrant: (companyId: string, brandId: string) => void;
  adminUpdateTierRule: (tierId: string, thresholdUsd: number, discountRate: number) => void;
  adminAddOrUpdatePromotion: (promo: Omit<Promotion, 'id'>) => void;
  excelImportStock: (rows: { sku_code: string; warehouse_code: string; on_hand: number; unsellable: number }[]) => { success: boolean; count: number; error?: string };

  // Drawer & Modals
  activeDrawer: { type: 'order' | 'sku' | 'material' | 'restock' | 'mail'; id: string } | null;
  openDrawer: (type: 'order' | 'sku' | 'material' | 'restock' | 'mail', id: string) => void;
  closeDrawer: () => void;
  toasts: { id: string; message: string; type?: 'success' | 'warn' | 'info' }[];
  addToast: (message: string, type?: 'success' | 'warn' | 'info') => void;
  removeToast: (id: string) => void;
  isCommandSearchOpen: boolean;
  setIsCommandSearchOpen: (open: boolean) => void;

  // Password & Simulation
  completePasswordReset: (newPassword: string) => void;
  simulateTimeTravelInactivity: (companyId: string, monthsToAdd: number) => void;
  markNotificationAsRead: (notificationId: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentRole, setCurrentRole] = useState<Role>('customer');
  const [currentCustomerUserId, setCurrentCustomerUserId] = useState<string>('user-001a');
  const [isMobileSimulator, setIsMobileSimulator] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('catalog');

  // FactoryOS Drawer, Command, and Toast States
  const [activeDrawer, setActiveDrawer] = useState<{ type: 'order' | 'sku' | 'material' | 'restock' | 'mail'; id: string } | null>(null);
  const [toasts, setToasts] = useState<{ id: string; message: string; type?: 'success' | 'warn' | 'info' }[]>([]);
  const [isCommandSearchOpen, setIsCommandSearchOpen] = useState(false);

  const openDrawer = useCallback((type: 'order' | 'sku' | 'material' | 'restock' | 'mail', id: string) => {
    setActiveDrawer({ type, id });
  }, []);

  const closeDrawer = useCallback(() => {
    setActiveDrawer(null);
  }, []);

  const addToast = useCallback((message: string, type: 'success' | 'warn' | 'info' = 'success') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3200);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // State Entities
  const [companies, setCompanies] = useState<CustomerCompany[]>(INITIAL_COMPANIES);
  const [customerUsers, setCustomerUsers] = useState<CustomerUser[]>(INITIAL_CUSTOMER_USERS);
  const [brands] = useState<Brand[]>(INITIAL_BRANDS);
  const [brandGrants, setBrandGrants] = useState<BrandGrant[]>(INITIAL_BRAND_GRANTS);
  const [products] = useState<Product[]>(INITIAL_PRODUCTS);
  const [warehouses] = useState<Warehouse[]>(INITIAL_WAREHOUSES);
  const [inventory, setInventory] = useState<InventoryBalance[]>(INITIAL_INVENTORY);
  const [tierRules, setTierRules] = useState<TierRule[]>(INITIAL_TIER_RULES);
  const [promotions, setPromotions] = useState<Promotion[]>(INITIAL_PROMOTIONS);
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);
  const [restockRequests, setRestockRequests] = useState<RestockRequest[]>(INITIAL_RESTOCK_REQUESTS);
  const [notifications, setNotifications] = useState<CustomerNotification[]>(INITIAL_NOTIFICATIONS);
  const [internalEmailTemplates, setInternalEmailTemplates] = useState<InternalEmailTemplate[]>(INITIAL_EMAIL_TEMPLATES);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(INITIAL_AUDIT_LOGS);
  const [cart, setCart] = useState<CartLine[]>([]);
  const orderActionLocks = useRef(new Set<string>());

  const beginOrderAction = (key: string) => {
    if (orderActionLocks.current.has(key)) return false;
    orderActionLocks.current.add(key);
    // Hold only for the current synchronous handler; a rapid double-click is rejected,
    // while a later retry still reaches the normal status/stock checks.
    queueMicrotask(() => orderActionLocks.current.delete(key));
    return true;
  };
  const endOrderAction = (key: string) => {
    orderActionLocks.current.delete(key);
  };

  // Current User / Company
  const currentCustomerUser = useMemo(() => {
    return customerUsers.find(u => u.id === currentCustomerUserId) || null;
  }, [customerUsers, currentCustomerUserId]);

  const currentCompany = useMemo(() => {
    if (!currentCustomerUser) return null;
    return companies.find(c => c.id === currentCustomerUser.company_id) || null;
  }, [companies, currentCustomerUser]);

  const currentSalesUser = INITIAL_INTERNAL_USERS[0];
  const currentAdminUser = INITIAL_INTERNAL_USERS[1];

  // Helper for audit logs
  const addAuditLog = useCallback((actor: string, action: string, target: string, details: string) => {
    const newLog: AuditLog = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toISOString().replace('T', ' ').substr(0, 19),
      actor,
      action,
      target,
      details,
    };
    setAuditLogs(prev => [newLog, ...prev]);
  }, []);

  // Customer Tier computation
  const currentCompanyTierInfo = useMemo(() => {
    if (!currentCompany) return null;
    return evaluateCustomerTier(
      currentCompany.cumulative_spend_usd,
      currentCompany.months_inactive,
      tierRules
    );
  }, [currentCompany, tierRules]);

  const unreadNotificationCount = useMemo(() => {
    if (!currentCompany) return 0;
    return notifications.filter(n => n.company_id === currentCompany.id && !n.is_read).length;
  }, [notifications, currentCompany]);

  // Switch role handler
  const switchRole = useCallback((role: Role, userId?: string) => {
    setCurrentRole(role);
    if (role === 'customer') {
      if (userId) {
        setCurrentCustomerUserId(userId);
      } else {
        setCurrentCustomerUserId('user-001a');
      }
      setActiveTab('catalog');
    } else if (role === 'sales') {
      setActiveTab('sales_orders');
    } else if (role === 'admin') {
      setActiveTab('admin_companies');
    }
    addAuditLog(
      role === 'customer' ? `User ${userId || currentCustomerUserId}` : role.toUpperCase(),
      'SWITCH_ROLE',
      'System Session',
      `Switched to view role: ${role}`
    );
  }, [currentCustomerUserId, addAuditLog]);

  const toggleMobileSimulator = useCallback(() => {
    setIsMobileSimulator(prev => !prev);
  }, []);

  // Cart operations
  const addToCart = useCallback((skuId: string, quantity: number) => {
    const check = validateSKUQuantity(quantity);
    if (!check.valid) {
      return { success: false, message: check.error };
    }

    // Check available stock
    const { totalAvailable } = calculateSKUAvailableStock(skuId, inventory);
    if (quantity > totalAvailable) {
      return {
        success: false,
        message: `订购数量 (${quantity} PCS) 超出当前精确可订库存 (${totalAvailable} PCS)`,
      };
    }

    setCart(prev => {
      const idx = prev.findIndex(item => item.sku_id === skuId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity };
        return next;
      }
      return [...prev, { sku_id: skuId, quantity }];
    });

    return { success: true };
  }, [inventory]);

  const updateCartQuantity = useCallback((skuId: string, quantity: number) => {
    if (quantity === 0) {
      setCart(prev => prev.filter(i => i.sku_id !== skuId));
      return { success: true };
    }

    const check = validateSKUQuantity(quantity);
    if (!check.valid) {
      return { success: false, message: check.error };
    }

    const { totalAvailable } = calculateSKUAvailableStock(skuId, inventory);
    if (quantity > totalAvailable) {
      return {
        success: false,
        message: `订购数量 (${quantity} PCS) 超出当前精确可订库存 (${totalAvailable} PCS)`,
      };
    }

    setCart(prev =>
      prev.map(item => (item.sku_id === skuId ? { ...item, quantity } : item))
    );
    return { success: true };
  }, [inventory]);

  const removeFromCart = useCallback((skuId: string) => {
    setCart(prev => prev.filter(i => i.sku_id !== skuId));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
  }, []);

  // Submit Order
  const submitOrder = useCallback((data: {
    shippingMethod: Order['shipping_method'];
    destinationCountryAlpha3: string;
    expectedShipDate: string;
    shippingRequirements: string;
  }) => {
    if (!currentCompany || !currentCustomerUser) {
      return { success: false, error: '请先登录客户账号' };
    }

    if (cart.length === 0) {
      return { success: false, error: '订购清单为空，请先选择商品 SKU' };
    }

    // Privacy check on remarks
    const privacyCheck = checkPrivacyViolations(data.shippingRequirements);
    if (privacyCheck.hasViolation) {
      return { success: false, error: privacyCheck.message };
    }

    // Re-verify MOQ and Stock for each line
    const tierDiscount = currentCompanyTierInfo?.currentTier.discount_rate ?? 0;
    const lines = [];
    let totalQuoted = 0;

    for (const item of cart) {
      const val = validateSKUQuantity(item.quantity);
      if (!val.valid) {
        return { success: false, error: val.error };
      }

      const { totalAvailable } = calculateSKUAvailableStock(item.sku_id, inventory);
      if (item.quantity > totalAvailable) {
        return {
          success: false,
          error: `SKU ${item.sku_id} 可订库存已变更为 ${totalAvailable} PCS，无法订购 ${item.quantity} PCS`,
        };
      }

      // Find product & sku info
      let foundSku = null;
      let foundProduct = null;
      for (const p of products) {
        const s = p.skus.find(sk => sk.id === item.sku_id);
        if (s) {
          foundSku = s;
          foundProduct = p;
          break;
        }
      }

      if (!foundSku || !foundProduct) continue;

      const priceInfo = calculateEffectiveUnitPrice(
        foundSku.base_price_usd,
        foundSku.id,
        tierDiscount,
        promotions
      );

      const lineSubtotal = Number((priceInfo.effectivePrice * item.quantity).toFixed(2));
      totalQuoted += lineSubtotal;

      lines.push({
        sku_id: foundSku.id,
        sku_code: foundSku.sku_code,
        product_title: foundProduct.title,
        color_name: foundSku.color_name,
        quantity: item.quantity,
        quoted_unit_price: priceInfo.effectivePrice,
        line_subtotal: lineSubtotal,
      });
    }

    const orderNo = `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;

    const newOrder: Order = {
      id: `ord-${Date.now()}`,
      order_no: orderNo,
      company_id: currentCompany.id,
      created_by_user_id: currentCustomerUser.id,
      created_by_username: currentCustomerUser.username,
      status: 'PENDING_CONFIRMATION',
      lines,
      total_quoted_usd: Number(totalQuoted.toFixed(2)),
      shipping_method: data.shippingMethod,
      destination_country_alpha3: data.destinationCountryAlpha3,
      expected_ship_date: data.expectedShipDate,
      shipping_requirements: data.shippingRequirements.trim(),
      assigned_sales_id: currentCompany.assigned_sales_id,
      customer_visible_note: '订购申请已提交。正在等待负责业务员人工核实数量与库存并为您预占。提交申请不立即锁库。',
      created_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
      updated_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
    };

    setOrders(prev => [newOrder, ...prev]);
    setCart([]);

    addAuditLog(
      currentCustomerUser.username,
      'SUBMIT_ORDER',
      orderNo,
      `Order submitted with ${lines.length} lines, total quote USD $${newOrder.total_quoted_usd}. No stock locked yet.`
    );

    return { success: true, orderId: newOrder.id };
  }, [
    currentCompany,
    currentCustomerUser,
    cart,
    inventory,
    currentCompanyTierInfo,
    products,
    promotions,
    addAuditLog,
  ]);

  // Customer Cancel Order
  const customerCancelOrder = useCallback((orderId: string, reason: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return { success: false, message: '订单不存在' };

    if (order.status === 'PENDING_CONFIRMATION') {
      // Direct cancellation allowed before sales confirmation
      setOrders(prev =>
        prev.map(o =>
          o.id === orderId
            ? {
                ...o,
                status: 'CANCELLED',
                customer_visible_note: `客户已主动取消订购单。原因: ${reason}`,
                updated_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
              }
            : o
        )
      );

      addAuditLog(
        order.created_by_username,
        'CANCEL_ORDER',
        order.order_no,
        `Customer cancelled unconfirmed order. Reason: ${reason}`
      );

      return { success: true, message: '订单已成功取消' };
    }

    if (order.status === 'CONFIRMED') {
      // Must submit a change request for review by sales rep
      setOrders(prev =>
        prev.map(o =>
          o.id === orderId
            ? {
                ...o,
                change_request: {
                  id: `cr-${Date.now()}`,
                  request_type: 'cancel_order',
                  requested_by_user_id: currentCustomerUser?.id || '',
                  reason,
                  status: 'pending',
                  requested_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
                },
                customer_visible_note: `已提交取消申请，等待业务员核准并释放预占库存。原因: ${reason}`,
                updated_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
              }
            : o
        )
      );

      addAuditLog(
        currentCustomerUser?.username || 'Buyer',
        'REQUEST_CANCEL',
        order.order_no,
        `Submitted cancellation approval request for confirmed order.`
      );

      return {
        success: true,
        message: '订单已确认锁定库存，已向负责业务员提交取消审核申请。',
      };
    }

    return {
      success: false,
      message: '已进入付款或备货阶段的订单不允许直接取消，请线下联系业务员处理。',
    };
  }, [orders, currentCustomerUser, addAuditLog]);

  // Customer Request Change
  const customerRequestChange = useCallback((
    orderId: string,
    reason: string,
    modifiedLines?: { sku_id: string; new_qty: number }[]
  ) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return { success: false, message: '订单不存在' };

    if (order.status === 'PENDING_CONFIRMATION') {
      // If pending confirmation, apply modifications directly
      if (modifiedLines) {
        const updatedLines = order.lines.map(l => {
          const m = modifiedLines.find(x => x.sku_id === l.sku_id);
          if (m) {
            const check = validateSKUQuantity(m.new_qty);
            if (!check.valid) throw new Error(check.error);
            return {
              ...l,
              quantity: m.new_qty,
              line_subtotal: Number((l.quoted_unit_price * m.new_qty).toFixed(2)),
            };
          }
          return l;
        });

        const newTotal = updatedLines.reduce((acc, l) => acc + l.line_subtotal, 0);

        setOrders(prev =>
          prev.map(o =>
            o.id === orderId
              ? {
                  ...o,
                  lines: updatedLines,
                  total_quoted_usd: Number(newTotal.toFixed(2)),
                  updated_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
                }
              : o
          )
        );

        addAuditLog(
          order.created_by_username,
          'MODIFY_ORDER',
          order.order_no,
          `Modified unconfirmed order quantities directly.`
        );

        return { success: true, message: '订购数量已直接更新' };
      }
    }

    if (order.status === 'CONFIRMED') {
      setOrders(prev =>
        prev.map(o =>
          o.id === orderId
            ? {
                ...o,
                change_request: {
                  id: `cr-${Date.now()}`,
                  request_type: 'modify_quantity',
                  requested_by_user_id: currentCustomerUser?.id || '',
                  reason,
                  modified_lines: modifiedLines,
                  status: 'pending',
                  requested_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
                },
                updated_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
              }
            : o
        )
      );

      return { success: true, message: '已向业务员提交订单修改申请' };
    }

    return { success: false, message: '当前订单状态不支持修改申请' };
  }, [orders, currentCustomerUser, addAuditLog]);

  // Salesperson: Confirm Order (Atomic Stock Reservation)
  const salesConfirmOrder = useCallback((orderId: string) => {
    const lockKey = `confirm:${orderId}`;
    if (!beginOrderAction(lockKey)) {
      return { success: false, error: '该订单确认操作正在进行，请勿重复提交。' };
    }
    const order = orders.find(o => o.id === orderId);
    if (!order) {
      endOrderAction(lockKey);
      return { success: false, error: '订单不存在' };
    }
    if (order.status !== 'PENDING_CONFIRMATION') {
      return { success: false, error: '订单不在待确认状态' };
    }

    // Plan the whole order across warehouses first; a short SKU fails the entire reservation.
    const plan = planOrderReservation(order.lines, inventory);
    if (!plan.success) {
      const line = order.lines.find((item) => item.sku_id === plan.sku_id);
      return {
        success: false,
        error: `库存不足：SKU ${line?.sku_code ?? plan.sku_id} 需求 ${plan.required} PCS，当前实无可订量 ${plan.available} PCS。整单预占失败，未产生部分预占。`,
      };
    }
    const nextInventory = applyReservationAllocations(inventory, plan.allocations);
    if (!nextInventory) {
      return {
        success: false,
        error: '库存数据在本次前端模拟预占前发生变化，整单预占失败，未产生部分预占。请刷新后重试。',
      };
    }
    setInventory(nextInventory);

    const expiryDate = new Date(Date.now() + 72 * 3600 * 1000).toISOString();

    // Update order status
    setOrders(prev =>
      prev.map(o =>
        o.id === orderId
          ? {
              ...o,
              status: 'CONFIRMED',
              total_confirmed_usd: o.total_quoted_usd,
              reservation_expires_at: expiryDate,
              reservation_extended_count: 0,
              reservation_allocations: plan.allocations,
              customer_visible_note: `业务员 Tom 已确认订购单，并在本次前端 Demo 中完成整单模拟预占。库存预占期为 72 小时（截止 ${expiryDate.slice(0, 16).replace('T', ' ')} UTC）。该预占不是数据库事务。请按发票指引进行电汇结算。`,
              internal_note: '整单前端 Mock 预占完成（非数据库事务）。预占计时 72h 启动。',
              updated_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
            }
          : o
      )
    );

    // Customer In-App Notification
    const notif: CustomerNotification = {
      id: `notif-${Date.now()}`,
      company_id: order.company_id,
      title: `订单 ${order.order_no} 确认与库存预占`,
      message: `业务员已确认您的订购申请，为您成功预占现货库存，预占期限为 72 小时。`,
      event_type: 'ORDER_CONFIRMED',
      related_id: order.id,
      is_read: false,
      created_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
    };
    setNotifications(prev => [notif, ...prev]);

    // Generate English customer email draft for salesperson's internal mailbox
    const company = companies.find(c => c.id === order.company_id);
    const emailDraft: InternalEmailTemplate = {
      id: `mail-${Date.now()}`,
      event_type: 'ORDER_CONFIRMATION',
      sales_rep_email: currentSalesUser.internal_email,
      recipient_company_code: company?.customer_code || '',
      recipient_company_name: company?.short_name || '',
      subject: `[AOKING Direct] Order Confirmed & Stock Reserved — #${order.order_no}`,
      body_text: `Dear Partner (${company?.short_name}),

We are pleased to inform you that your spot-order #${order.order_no} has been confirmed.
All requested items have been locked in our export warehouse:
${order.lines.map(l => `- ${l.sku_code} (${l.color_name}): ${l.quantity} PCS @ USD $${l.quoted_unit_price}`).join('\n')}

Total Amount: USD $${order.total_quoted_usd}
Reservation Validity: 72 Hours (Expires: ${expiryDate.slice(0, 16).replace('T', ' ')} UTC).

Please arrange wire transfer (T/T) to our corporate bank account. Once processed, kindly reply with the remittance bank slip.

Best regards,
${currentSalesUser.name} | International Sales
AOKING Direct B2B Platform`,
      created_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
      status: 'ready_to_send',
    };
    setInternalEmailTemplates(prev => [emailDraft, ...prev]);

    addAuditLog(
      currentSalesUser.name,
      'CONFIRM_ORDER',
      order.order_no,
      `Frontend mock reservation completed (not a database transaction). Reserved ${order.lines.reduce((s, l) => s + l.quantity, 0)} PCS. Expiry 72h.`
    );

    return { success: true };
  }, [orders, inventory, companies, currentSalesUser, addAuditLog]);

  // Salesperson: Extend Reservation
  const salesExtendReservation = useCallback((orderId: string, additionalHours: number) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return { success: false, error: '订单不存在' };
    if (order.status !== 'CONFIRMED') {
      return { success: false, error: '只有已确认且预占中的订单可以延期。' };
    }
    if (!order.reservation_expires_at) {
      return { success: false, error: '订单没有有效的预占到期时间，无法延期。' };
    }
    if (!Number.isInteger(additionalHours) || additionalHours <= 0 || additionalHours > 720) {
      return { success: false, error: '延期小时数必须是 1–720 的整数。' };
    }

    const currentExp = new Date(order.reservation_expires_at).getTime();
    const newExp = new Date(currentExp + additionalHours * 3600 * 1000).toISOString();
    setOrders(prev =>
      prev.map(o =>
        o.id === orderId
          ? {
              ...o,
              reservation_expires_at: newExp,
              reservation_extended_count: (o.reservation_extended_count || 0) + 1,
              customer_visible_note: `业务员已为您延长库存预占期限 +${additionalHours} 小时，新到期时间: ${newExp.slice(0, 16).replace('T', ' ')} UTC。`,
              updated_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
            }
          : o
      )
    );

    addAuditLog(
      currentSalesUser.name,
      'EXTEND_RESERVATION',
      order.order_no,
      `Extended inventory reservation by ${additionalHours} hours.`
    );

    return { success: true };
  }, [orders, currentSalesUser, addAuditLog]);

  // Salesperson: Release Reservation
  const salesReleaseReservation = useCallback((orderId: string, reason: string) => {
    const lockKey = `release:${orderId}`;
    if (!beginOrderAction(lockKey)) {
      return { success: false, error: '该订单释放操作正在进行，请勿重复提交。' };
    }
    const order = orders.find(o => o.id === orderId);
    if (!order) {
      endOrderAction(lockKey);
      return { success: false, error: '订单不存在' };
    }
    if (order.status !== 'CONFIRMED') {
      return { success: false, error: '只有已确认且预占中的订单可以释放预占。' };
    }
    if (!reason.trim()) return { success: false, error: '请填写释放预占的原因。' };

    const nextInventory = releaseReservationAllocations(
      inventory,
      order.reservation_allocations ?? [],
      order.lines
    );
    if (!nextInventory) {
      return {
        success: false,
        error: '预占分配与当前仓库库存不一致，整单释放已拒绝，订单和库存均未改变。',
      };
    }
    setInventory(nextInventory);

    setOrders(prev =>
      prev.map(o =>
        o.id === orderId
          ? {
              ...o,
              status: 'RESERVATION_EXPIRED',
              customer_visible_note: `库存预占已解除并释放回现货大池。原因: ${reason}`,
              updated_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
            }
          : o
      )
    );

    addAuditLog(
      currentSalesUser.name,
      'RELEASE_RESERVATION',
      order.order_no,
      `Released stock reservation. Reason: ${reason}`
    );

    return { success: true };
  }, [orders, inventory, currentSalesUser, addAuditLog]);

  // Salesperson: Record Payment (Updates Customer Cumulative Spend & Tier)
  const salesRecordPayment = useCallback((orderId: string, amountUsd: number, reference: string) => {
    const lockKey = `payment:${orderId}`;
    if (!beginOrderAction(lockKey)) {
      return { success: false, error: '该订单付款操作正在进行，请勿重复提交。' };
    }
    const order = orders.find(o => o.id === orderId);
    if (!order) {
      endOrderAction(lockKey);
      return { success: false, error: '订单不存在' };
    }
    if (order.status !== 'CONFIRMED') {
      return {
        success: false,
        error:
          order.status === 'PAYMENT_RECORDED'
            ? '该订单已登记付款，不能重复入账。'
            : '只有已确认且预占中的订单可以登记付款。',
      };
    }
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return { success: false, error: '付款金额必须大于 0。' };
    }
    if (!reference.trim()) return { success: false, error: '请填写付款凭证索引。' };

    const paymentTime = new Date().toISOString().replace('T', ' ').substr(0, 19);

    // Update order status
    setOrders(prev =>
      prev.map(o =>
        o.id === orderId
          ? {
              ...o,
              status: 'PAYMENT_RECORDED',
              payment_recorded_at: paymentTime,
              payment_amount_usd: amountUsd,
              payment_reference: reference,
              customer_visible_note: `实收货款 USD $${amountUsd} 已核验入账（凭证: ${reference}）。订单进入发货备料阶段。根据规则，已付款订单不可取消。`,
              internal_note: `财务核验已到账，已入账客户历史有效采购额。`,
              updated_at: paymentTime,
            }
          : o
      )
    );

    // Update Customer Company's cumulative spend & reset inactivity timer! (PRD 7.1)
    setCompanies(prev =>
      prev.map(c => {
        if (c.id !== order.company_id) return c;
        const newSpend = c.cumulative_spend_usd + amountUsd;
        // Evaluate new base tier and current tier
        const evalResult = evaluateCustomerTier(newSpend, 0, tierRules);
        return {
          ...c,
          cumulative_spend_usd: newSpend,
          base_tier_id: evalResult.baseTier.id,
          tier_id: evalResult.currentTier.id,
          last_effective_purchase_date: paymentTime.slice(0, 10),
          months_inactive: 0, // Reset inactivity timer!
        };
      })
    );

    // Add In-App notification
    setNotifications(prev => [
      {
        id: `notif-${Date.now()}`,
        company_id: order.company_id,
        title: `货款到账确认：${order.order_no}`,
        message: `USD $${amountUsd} 货款已核对入账，已全额计入公司历史有效采购累计额，并重置采购计时。`,
        event_type: 'PAYMENT_RECEIVED',
        related_id: order.id,
        is_read: false,
        created_at: paymentTime,
      },
      ...prev,
    ]);

    // Internal Email Draft to Sales Rep
    const company = companies.find(c => c.id === order.company_id);
    setInternalEmailTemplates(prev => [
      {
        id: `mail-${Date.now()}`,
        event_type: 'PAYMENT_RECEIVED',
        sales_rep_email: currentSalesUser.internal_email,
        recipient_company_code: company?.customer_code || '',
        recipient_company_name: company?.short_name || '',
        subject: `[AOKING Direct] Payment Acknowledged — Order #${order.order_no}`,
        body_text: `Dear Partner (${company?.short_name}),

We acknowledge receipt of your wire transfer of USD $${amountUsd} (Ref: ${reference}) for Order #${order.order_no}.

Your order status is now updated to PAYMENT_RECORDED. Our logistics warehouse has initiated final inspection and pallet preparation.
Furthermore, this purchase has been credited to your historical cumulative purchasing volume.

Thank you for your continued partnership!

Best regards,
${currentSalesUser.name} | AOKING Direct Sales`,
        created_at: paymentTime,
        status: 'ready_to_send',
      },
      ...prev,
    ]);

    addAuditLog(
      currentSalesUser.name,
      'RECORD_PAYMENT',
      order.order_no,
      `Recorded USD $${amountUsd} payment. Reference: ${reference}. Updated customer spend and tier.`
    );

    return { success: true };
  }, [orders, companies, tierRules, currentSalesUser, addAuditLog]);

  // Salesperson: Update Shipment (Whole Order Fulfillment)
  const salesUpdateShipment = useCallback((
    orderId: string,
    shipmentData: {
      carrier: string;
      trackingNo: string;
      actualShipDate: string;
      estimatedDeliveryDate: string;
      customerVisibleNote: string;
      internalNote: string;
    }
  ) => {
    const lockKey = `ship:${orderId}`;
    if (!beginOrderAction(lockKey)) {
      return { success: false, error: '该订单发货操作正在进行，请勿重复提交。' };
    }
    const order = orders.find(o => o.id === orderId);
    if (!order) {
      endOrderAction(lockKey);
      return { success: false, error: '订单不存在' };
    }
    if (order.status !== 'PAYMENT_RECORDED') {
      return {
        success: false,
        error:
          order.status === 'SHIPPED'
            ? '该订单已发货，不能重复发货。'
            : '只有已登记全额付款的订单可以整单发货。',
      };
    }

    const nextInventory = consumeReservationAllocations(
      inventory,
      order.reservation_allocations ?? [],
      order.lines
    );
    if (!nextInventory) {
      return {
        success: false,
        error: '订单预占分配与当前仓库库存不一致，整单发货已拒绝，订单和库存均未改变。',
      };
    }
    setInventory(nextInventory);

    const updateTime = new Date().toISOString().replace('T', ' ').substr(0, 19);

    setOrders(prev =>
      prev.map(o =>
        o.id === orderId
          ? {
              ...o,
              status: 'SHIPPED',
              carrier: shipmentData.carrier,
              tracking_no: shipmentData.trackingNo,
              actual_ship_date: shipmentData.actualShipDate,
              estimated_delivery_date: shipmentData.estimatedDeliveryDate,
              customer_visible_note: shipmentData.customerVisibleNote,
              internal_note: shipmentData.internalNote,
              updated_at: updateTime,
            }
          : o
      )
    );

    // In-app notification
    setNotifications(prev => [
      {
        id: `notif-${Date.now()}`,
        company_id: order.company_id,
        title: `订单 ${order.order_no} 已整单发货`,
        message: `承运商: ${shipmentData.carrier}, 运单号: ${shipmentData.trackingNo}。`,
        event_type: 'SHIPMENT_DISPATCHED',
        related_id: order.id,
        is_read: false,
        created_at: updateTime,
      },
      ...prev,
    ]);

    // Email Draft
    const company = companies.find(c => c.id === order.company_id);
    setInternalEmailTemplates(prev => [
      {
        id: `mail-${Date.now()}`,
        event_type: 'SHIPMENT_DISPATCHED',
        sales_rep_email: currentSalesUser.internal_email,
        recipient_company_code: company?.customer_code || '',
        recipient_company_name: company?.short_name || '',
        subject: `[AOKING Direct] Shipment Notice: Order #${order.order_no} Dispatched`,
        body_text: `Dear Partner (${company?.short_name}),

Your wholesale spot order #${order.order_no} has been dispatched in full from our export hub.

Shipping Details:
- Carrier: ${shipmentData.carrier}
- Tracking Number: ${shipmentData.trackingNo}
- Ship Date: ${shipmentData.actualShipDate}
- Estimated Arrival: ${shipmentData.estimatedDeliveryDate}

${shipmentData.customerVisibleNote}

Best regards,
${currentSalesUser.name} | Logistics & Sales Operations
AOKING Direct`,
        created_at: updateTime,
        status: 'ready_to_send',
      },
      ...prev,
    ]);

    addAuditLog(
      currentSalesUser.name,
      'SHIP_ORDER',
      order.order_no,
      `Shipped full order via ${shipmentData.carrier}. Tracking: ${shipmentData.trackingNo}.`
    );

    return { success: true };
  }, [orders, inventory, companies, currentSalesUser, addAuditLog]);

  // Salesperson: Handle Change Request (all-or-nothing)
  const salesHandleChangeRequest = useCallback((orderId: string, approve: boolean) => {
    const lockKey = `change:${orderId}`;
    if (!beginOrderAction(lockKey)) {
      return { success: false, error: '该订单变更申请正在处理中，请勿重复提交。' };
    }
    const order = orders.find(o => o.id === orderId);
    if (!order) {
      endOrderAction(lockKey);
      return { success: false, error: '订单不存在' };
    }
    const cr = order.change_request;
    if (!cr) return { success: false, error: '该订单没有变更申请' };
    if (order.status !== 'CONFIRMED') {
      return { success: false, error: '只有已确认且预占中的订单可以处理变更申请。' };
    }
    if (cr.status !== 'pending') {
      return { success: false, error: '该变更申请已处理，不能重复操作。' };
    }

    const reviewedAt = new Date().toISOString();
    const updateTime = new Date().toISOString().replace('T', ' ').substr(0, 19);

    if (!approve) {
      setOrders(prev =>
        prev.map(o =>
          o.id === orderId
            ? {
                ...o,
                change_request: { ...cr, status: 'rejected', reviewed_at: reviewedAt },
                customer_visible_note: '变更申请被业务员驳回。订单与库存预占维持原状。',
                updated_at: updateTime,
              }
            : o
        )
      );
      addAuditLog(
        currentSalesUser.name,
        'REJECT_CHANGE_REQUEST',
        order.order_no,
        'Rejected change request. Order and reserved inventory were not changed.'
      );
      return { success: true };
    }

    if (cr.request_type === 'cancel_order') {
      const nextInventory = releaseReservationAllocations(
        inventory,
        order.reservation_allocations ?? [],
        order.lines
      );
      if (!nextInventory) {
        return {
          success: false,
          error: '订单预占分配与当前仓库库存不一致，取消申请未通过，订单和库存均未改变。',
        };
      }
      setInventory(nextInventory);
      setOrders(prev =>
        prev.map(o =>
          o.id === orderId
            ? {
                ...o,
                status: 'CANCELLED',
                change_request: { ...cr, status: 'approved', reviewed_at: reviewedAt },
                customer_visible_note: '业务员已核准您的订单取消申请，原仓库预占库存已释放。',
                updated_at: updateTime,
              }
            : o
        )
      );
      addAuditLog(
        currentSalesUser.name,
        'APPROVE_CHANGE_REQUEST',
        order.order_no,
        "Approved cancellation. Released the order\'s exact warehouse allocations."
      );
      return { success: true };
    }

    if (cr.request_type !== 'modify_quantity') {
      return { success: false, error: '不支持的变更申请类型。' };
    }

    const modified = cr.modified_lines ?? [];
    if (!modified.length) {
      return { success: false, error: '数量修改申请缺少有效的订单行。' };
    }
    const modifiedBySku = new Map<string, number>();
    for (const line of modified) {
      if (modifiedBySku.has(line.sku_id)) {
        return { success: false, error: `数量修改申请包含重复 SKU：${line.sku_id}` };
      }
      if (!order.lines.some((item) => item.sku_id === line.sku_id)) {
        return { success: false, error: `数量修改申请包含订单之外的 SKU：${line.sku_id}` };
      }
      const check = validateSKUQuantity(line.new_qty);
      if (!check.valid) {
        return { success: false, error: check.error ?? '数量修改不合法。' };
      }
      modifiedBySku.set(line.sku_id, line.new_qty);
    }

    const newLines = order.lines.map((line) => {
      const newQty = modifiedBySku.get(line.sku_id);
      if (newQty === undefined) return { ...line };
      return {
        ...line,
        quantity: newQty,
        line_subtotal: Number((line.quoted_unit_price * newQty).toFixed(2)),
      };
    });
    const newTotal = Number(newLines.reduce((sum, line) => sum + line.line_subtotal, 0).toFixed(2));

    const releasedInventory = releaseReservationAllocations(
      inventory,
      order.reservation_allocations ?? [],
      order.lines
    );
    if (!releasedInventory) {
      return {
        success: false,
        error: '订单原预占分配与当前仓库库存不一致，数量修改未通过，订单和库存均未改变。',
      };
    }
    const plan = planOrderReservation(newLines, releasedInventory);
    if (!plan.success) {
      const line = newLines.find((item) => item.sku_id === plan.sku_id);
      return {
        success: false,
        error: `数量修改后库存不足：SKU ${line?.sku_code ?? plan.sku_id} 需求 ${plan.required} PCS，可订 ${plan.available} PCS。整单未修改。`,
      };
    }
    const nextInventory = applyReservationAllocations(releasedInventory, plan.allocations);
    if (!nextInventory) {
      return {
        success: false,
        error: '数量修改的仓库分配复核失败，整单未修改。',
      };
    }

    setInventory(nextInventory);
    setOrders(prev =>
      prev.map(o =>
        o.id === orderId
          ? {
              ...o,
              lines: newLines,
              total_quoted_usd: newTotal,
              total_confirmed_usd: newTotal,
              reservation_allocations: plan.allocations,
              change_request: { ...cr, status: 'approved', reviewed_at: reviewedAt },
              customer_visible_note: `业务员已核准数量修改申请，订单总额更新为 USD $${newTotal.toFixed(2)}，原仓库预占已按新数量重新分配。`,
              updated_at: updateTime,
            }
          : o
      )
    );
    addAuditLog(
      currentSalesUser.name,
      'APPROVE_CHANGE_REQUEST',
      order.order_no,
      `Approved quantity change. New total USD $${newTotal.toFixed(2)}; reservation reallocated.`
    );
    return { success: true };
  }, [orders, inventory, currentSalesUser, addAuditLog]);

  // Submit Restock Request
  const submitRestockRequest = useCallback((skuId: string, requestedQty: number) => {
    if (!currentCompany) return { success: false, message: '请先登录客户账号' };

    let foundSku = null;
    let foundProduct = null;
    for (const p of products) {
      const s = p.skus.find(sk => sk.id === skuId);
      if (s) {
        foundSku = s;
        foundProduct = p;
        break;
      }
    }
    if (!foundSku || !foundProduct) return { success: false, message: 'SKU 不存在' };

    const newReq: RestockRequest = {
      id: `restock-${Date.now()}`,
      company_id: currentCompany.id,
      sku_id: skuId,
      sku_code: foundSku.sku_code,
      product_title: foundProduct.title,
      color_name: foundSku.color_name,
      requested_qty: requestedQty,
      status: 'pending',
      created_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
    };

    setRestockRequests(prev => [newReq, ...prev]);

    addAuditLog(
      currentCompany.customer_code,
      'REQUEST_RESTOCK',
      foundSku.sku_code,
      `Customer requested restock of ${requestedQty} PCS.`
    );

    return { success: true, message: '补货需求已登记并通知业务员！到货后将收到提醒通知。' };
  }, [currentCompany, products, addAuditLog]);

  // Replenish stock & Notify customer if available >= 10 (PRD D09, T24)
  const replenishStock = useCallback((skuId: string, warehouseId: string, addQty: number) => {
    setInventory(prev => {
      const next = [...prev];
      const idx = next.findIndex(b => b.sku_id === skuId && b.warehouse_id === warehouseId);
      if (idx >= 0) {
        next[idx] = {
          ...next[idx],
          on_hand: next[idx].on_hand + addQty,
          updated_at: new Date().toISOString().slice(0, 10),
        };
      } else {
        next.push({
          warehouse_id: warehouseId,
          sku_id: skuId,
          on_hand: addQty,
          reserved: 0,
          unsellable: 0,
          updated_at: new Date().toISOString().slice(0, 10),
        });
      }
      return next;
    });

    // Check if new stock >= MOQ (10)
    // Find pending requests for this SKU
    const pendingReqs = restockRequests.filter(r => r.sku_id === skuId && r.status === 'pending');
    if (pendingReqs.length > 0) {
      setRestockRequests(prev =>
        prev.map(r =>
          r.sku_id === skuId && r.status === 'pending'
            ? {
                ...r,
                status: 'notified',
                notified_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
              }
            : r
        )
      );

      // Create in-app notifications and email template for sales
      for (const req of pendingReqs) {
        setNotifications(prev => [
          {
            id: `notif-${Date.now()}-${Math.random()}`,
            company_id: req.company_id,
            title: `到货通知：${req.sku_code} 现货已恢复`,
            message: `您之前登记的 ${req.product_title} (${req.color_name}) 现货可订库存已达到起订量，请尽快选购。温馨提示：到货提醒不自动锁定库存。`,
            event_type: 'RESTOCK_AVAILABLE',
            is_read: false,
            created_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
          },
          ...prev,
        ]);

        const comp = companies.find(c => c.id === req.company_id);
        setInternalEmailTemplates(prev => [
          {
            id: `mail-${Date.now()}-${Math.random()}`,
            event_type: 'RESTOCK_AVAILABLE',
            sales_rep_email: currentSalesUser.internal_email,
            recipient_company_code: comp?.customer_code || '',
            recipient_company_name: comp?.short_name || '',
            subject: `[AOKING Direct] Stock Restocked: ${req.sku_code} Now Available`,
            body_text: `Dear Partner (${comp?.short_name}),

We are pleased to inform you that SKU ${req.sku_code} (${req.product_title} - ${req.color_name}), for which you requested restock, is now back in stock and available for order.

Please note that restock notifications do not automatically reserve inventory. Stock is allocated on a first-come, confirmed basis.

Best regards,
${currentSalesUser.name} | AOKING Direct Sales`,
            created_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
            status: 'ready_to_send',
          },
          ...prev,
        ]);
      }
    }

    addAuditLog(
      'Inventory System',
      'REPLENISH_STOCK',
      skuId,
      `Replenished +${addQty} PCS in warehouse ${warehouseId}. Notified ${pendingReqs.length} customers.`
    );
  }, [restockRequests, companies, currentSalesUser, addAuditLog]);

  // Admin: 2-Step Company & Account Creation (PRD 9.1, D24, D25, D26)
  const adminCreateCompany = useCallback((data: {
    customerCode: string;
    shortName: string;
    countryAlpha3: string;
    internalNickname?: string;
  }) => {
    const code = data.customerCode.trim().toUpperCase();
    if (!isValidCustomerCode(code)) {
      return { success: false, error: '内部客户编号必须为 C + 6 位数字格式（例如 C000123）' };
    }

    if (companies.some(c => c.customer_code === code)) {
      return { success: false, error: `客户编号 ${code} 已存在，不可重复` };
    }

    const country = data.countryAlpha3.trim().toUpperCase();
    if (country.length !== 3) {
      return { success: false, error: '国家代码必须为 ISO 3166-1 alpha-3 标准 3 位代码（如 USA, DEU, JPN）' };
    }

    const companyId = `comp-${Date.now()}`;
    const newCompany: CustomerCompany = {
      id: companyId,
      customer_code: code,
      short_name: data.shortName.trim(),
      country_alpha3: country,
      internal_nickname: data.internalNickname?.trim() || undefined,
      assigned_sales_id: 'sales-1',
      status: 'active',
      tier_id: 'tier-1',
      base_tier_id: 'tier-1',
      cumulative_spend_usd: 0,
      last_effective_purchase_date: new Date().toISOString().slice(0, 10),
      months_inactive: 0,
      created_at: new Date().toISOString().slice(0, 10),
    };

    // Step 2: Auto-create primary login account AK + last 6 digits + A
    const primaryUsername = deriveUsername(code, 'A');
    const tempPassword = generateTemporaryPassword();

    const newUser: CustomerUser = {
      id: `user-${Date.now()}`,
      company_id: companyId,
      username: primaryUsername,
      account_letter: 'A',
      must_change_password: true, // First login must change password!
      status: 'active',
      created_at: new Date().toISOString().slice(0, 10),
    };

    // Default grant AOKING brand
    const newGrant: BrandGrant = {
      company_id: companyId,
      brand_id: 'brand-aoking',
      granted_at: new Date().toISOString().slice(0, 10),
    };

    setCompanies(prev => [...prev, newCompany]);
    setCustomerUsers(prev => [...prev, newUser]);
    setBrandGrants(prev => [...prev, newGrant]);

    addAuditLog(
      currentAdminUser.name,
      'CREATE_COMPANY_AND_USER',
      `${code} / ${primaryUsername}`,
      `Created company ${newCompany.short_name} (${country}). Generated initial user ${primaryUsername}. Temporary password shown once.`
    );

    return {
      success: true,
      companyId,
      primaryUsername,
      tempPassword,
    };
  }, [companies, currentAdminUser, addAuditLog]);

  // Admin: Create secondary account for existing company (e.g. AK000123B)
  const adminCreateSecondaryAccount = useCallback((companyId: string) => {
    const comp = companies.find(c => c.id === companyId);
    if (!comp) return { success: false, error: '客户公司不存在' };

    const existingUsers = customerUsers.filter(u => u.company_id === companyId);
    const existingLetters = existingUsers.map(u => u.account_letter);
    
    // Pick next letter
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let nextLetter = '';
    for (let i = 0; i < alphabet.length; i++) {
      if (!existingLetters.includes(alphabet[i])) {
        nextLetter = alphabet[i];
        break;
      }
    }

    if (!nextLetter) {
      return { success: false, error: '该客户公司已达到 26 个账户上限（A-Z），需申请扩展方案' };
    }

    const username = deriveUsername(comp.customer_code, nextLetter);
    const tempPassword = generateTemporaryPassword();

    const newUser: CustomerUser = {
      id: `user-${Date.now()}`,
      company_id: companyId,
      username,
      account_letter: nextLetter,
      must_change_password: true,
      status: 'active',
      created_at: new Date().toISOString().slice(0, 10),
    };

    setCustomerUsers(prev => [...prev, newUser]);

    addAuditLog(
      currentAdminUser.name,
      'CREATE_SECONDARY_USER',
      username,
      `Added secondary user for company ${comp.short_name}. Shares tier and orders.`
    );

    return { success: true, username, tempPassword };
  }, [companies, customerUsers, currentAdminUser, addAuditLog]);

  // Admin: Toggle Brand Grant
  const adminToggleBrandGrant = useCallback((companyId: string, brandId: string) => {
    setBrandGrants(prev => {
      const exists = prev.some(g => g.company_id === companyId && g.brand_id === brandId);
      if (exists) {
        return prev.filter(g => !(g.company_id === companyId && g.brand_id === brandId));
      } else {
        return [...prev, { company_id: companyId, brand_id: brandId, granted_at: new Date().toISOString().slice(0, 10) }];
      }
    });

    addAuditLog(
      currentAdminUser.name,
      'TOGGLE_BRAND_GRANT',
      `${companyId} / ${brandId}`,
      `Updated brand authorization status.`
    );
  }, [currentAdminUser, addAuditLog]);

  // Admin: Update Tier Rules
  const adminUpdateTierRule = useCallback((tierId: string, thresholdUsd: number, discountRate: number) => {
    setTierRules(prev =>
      prev.map(t =>
        t.id === tierId
          ? { ...t, threshold_usd: thresholdUsd, discount_rate: discountRate }
          : t
      )
    );
    addAuditLog(
      currentAdminUser.name,
      'UPDATE_TIER_RULE',
      tierId,
      `Updated threshold to $${thresholdUsd}, discount to ${(discountRate * 100).toFixed(0)}%.`
    );
  }, [currentAdminUser, addAuditLog]);

  // Admin: Add or update promotion
  const adminAddOrUpdatePromotion = useCallback((promo: Omit<Promotion, 'id'>) => {
    const newPromo: Promotion = {
      id: `promo-${Date.now()}`,
      ...promo,
    };
    setPromotions(prev => [newPromo, ...prev]);

    addAuditLog(
      currentAdminUser.name,
      'CREATE_PROMOTION',
      promo.sku_id,
      `Created promo price $${promo.promo_price_usd}. Stack tier discount: ${promo.stack_tier_discount}.`
    );
  }, [currentAdminUser, addAuditLog]);

  // Admin: Excel bulk import
  const excelImportStock = useCallback((rows: { sku_code: string; warehouse_code: string; on_hand: number; unsellable: number }[]) => {
    const resolved = rows.flatMap((row) => {
      const wh = warehouses.find(w => w.code === row.warehouse_code);
      if (!wh) return [];
      let skuId: string | null = null;
      for (const p of products) {
        const s = p.skus.find(sk => sk.sku_code === row.sku_code);
        if (s) {
          skuId = s.id;
          break;
        }
      }
      if (!skuId) return [];
      const exists = inventory.some(b => b.sku_id === skuId && b.warehouse_id === wh.id);
      return exists ? [{ ...row, skuId, warehouseId: wh.id }] : [];
    });
    const successCount = resolved.length;
    if (resolved.length) {
      setInventory(prev => {
        const next = [...prev];
        for (const row of resolved) {
          const idx = next.findIndex(b => b.sku_id === row.skuId && b.warehouse_id === row.warehouseId);
          if (idx >= 0) {
            next[idx] = {
              ...next[idx],
              on_hand: row.on_hand,
              unsellable: row.unsellable,
              updated_at: new Date().toISOString().slice(0, 10),
            };
          }
        }
        return next;
      });
    }

    addAuditLog(
      currentAdminUser.name,
      'EXCEL_IMPORT_STOCK',
      'Multi-Warehouse Inventory',
      `Imported ${successCount} balance records from Excel batch.`
    );

    return { success: true, count: successCount };
  }, [warehouses, products, inventory, currentAdminUser, addAuditLog]);

  // Complete first-time password reset
  const completePasswordReset = useCallback((_newPassword: string) => {
    if (!currentCustomerUser) return;
    setCustomerUsers(prev =>
      prev.map(u =>
        u.id === currentCustomerUser.id ? { ...u, must_change_password: false } : u
      )
    );
    addAuditLog(
      currentCustomerUser.username,
      'COMPLETE_PASSWORD_RESET',
      currentCustomerUser.username,
      `User completed mandatory first-time password change.`
    );
  }, [currentCustomerUser, addAuditLog]);

  // Inactivity simulation (time-travel for T21 testing)
  const simulateTimeTravelInactivity = useCallback((companyId: string, monthsToAdd: number) => {
    setCompanies(prev =>
      prev.map(c => {
        if (c.id !== companyId) return c;
        const newInactive = c.months_inactive + monthsToAdd;
        const evalRes = evaluateCustomerTier(c.cumulative_spend_usd, newInactive, tierRules);
        return {
          ...c,
          months_inactive: newInactive,
          tier_id: evalRes.currentTier.id,
        };
      })
    );

    addAuditLog(
      'System Simulation Engine',
      'SIMULATE_TIME_TRAVEL',
      companyId,
      `Advanced inactivity clock by +${monthsToAdd} months.`
    );
  }, [tierRules, addAuditLog]);

  const markNotificationAsRead = useCallback((notificationId: string) => {
    setNotifications(prev =>
      prev.map(n => (n.id === notificationId ? { ...n, is_read: true } : n))
    );
  }, []);

  const markEmailTemplateSent = useCallback((templateId: string) => {
    setInternalEmailTemplates(prev =>
      prev.map(t =>
        t.id === templateId
          ? {
              ...t,
              status: 'sent_offline',
              sent_by_sales_at: new Date().toISOString().replace('T', ' ').substr(0, 19),
            }
          : t
      )
    );

    addAuditLog(
      currentSalesUser.name,
      'MARK_EMAIL_SENT',
      templateId,
      `Salesperson verified and marked email template as sent to client via corporate email.`
    );
  }, [currentSalesUser, addAuditLog]);

  return (
    <AppContext.Provider
      value={{
        currentRole,
        currentCustomerUser,
        currentCompany,
        currentSalesUser,
        currentAdminUser,
        isMobileSimulator,
        activeTab,
        companies,
        customerUsers,
        brands,
        brandGrants,
        products,
        warehouses,
        inventory,
        tierRules,
        promotions,
        orders,
        restockRequests,
        notifications,
        internalEmailTemplates,
        auditLogs,
        cart,
        currentCompanyTierInfo,
        unreadNotificationCount,
        switchRole,
        toggleMobileSimulator,
        setActiveTab,
        addToCart,
        updateCartQuantity,
        removeFromCart,
        clearCart,
        submitOrder,
        customerCancelOrder,
        customerRequestChange,
        salesConfirmOrder,
        salesExtendReservation,
        salesReleaseReservation,
        salesRecordPayment,
        salesUpdateShipment,
        salesHandleChangeRequest,
        markEmailTemplateSent,
        submitRestockRequest,
        replenishStock,
        adminCreateCompany,
        adminCreateSecondaryAccount,
        adminToggleBrandGrant,
        adminUpdateTierRule,
        adminAddOrUpdatePromotion,
        excelImportStock,
        activeDrawer,
        openDrawer,
        closeDrawer,
        toasts,
        addToast,
        removeToast,
        isCommandSearchOpen,
        setIsCommandSearchOpen,
        completePasswordReset,
        simulateTimeTravelInactivity,
        markNotificationAsRead,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

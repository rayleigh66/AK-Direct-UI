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
  SeriesDefinition,
  FeatureTagDefinition,
  ProductSKU,
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
  INITIAL_SERIES,
  INITIAL_FEATURE_TAGS,
} from '../data/mockData';
import { isDemoImageUrl } from '../data/demoImageLibrary';
import {
  inventoryImportHeaders,
  isPreviewSnapshotStale,
  parseInventoryTable,
  validateInventoryImport,
  type InventoryImportExpectedRow,
} from '../utils/inventoryImport';
import {
  calculateSKUAvailableStock,
  calculateEffectiveUnitPrice,
  evaluateCustomerTier,
  validateConfirmableOrderTotal,
  validateDiscountRate,
  validateOrderAmount,
  validateSKUQuantity,
  validateTierThreshold,
  validateUnitPrice,
  isValidCustomerCode,
  deriveUsername,
  generateTemporaryPassword,
  checkPrivacyViolations,
  planOrderReservation,
  applyReservationAllocations,
  releaseReservationAllocations,
  consumeReservationAllocations,
  usdToCents,
  centsToUsd,
} from '../utils/rules';
import { canViewSalesOperations } from '../utils/roles';

interface CartLine {
  sku_id: string;
  quantity: number;
}

export interface AdminProductInput {
  brandId: string;
  productCode: string;
  title: string;
  titleEn: string;
  category: Product['category'];
  description: string;
  descriptionEn: string;
  material: string;
  capacityOrSize: string;
  seriesId?: string;
  tagCodes: string[];
  primaryImage: string;
  galleryImages: string[];
}

export interface AdminSkuInput {
  skuCode: string;
  colorName: string;
  colorNameEn: string;
  colorHex: string;
  basePriceUsd: number;
  sellableStatus: ProductSKU['sellable_status'];
  imageUrl?: string;
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
  series: SeriesDefinition[];
  featureTags: FeatureTagDefinition[];
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
  }) => { success: boolean; orderId?: string; order?: Order; error?: string };
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
  adminToggleBrandGrant: (companyId: string, brandId: string) => { success: boolean; error?: string };
  adminUpdateTierRule: (tierId: string, thresholdUsd: number, discountRate: number) => { success: boolean; error?: string };
  adminAddOrUpdatePromotion: (promo: Omit<Promotion, 'id'>) => { success: boolean; error?: string };
  excelImportStock: (
    rows: { sku_code: string; warehouse_code: string; on_hand: number; unsellable: number }[],
    expected?: InventoryImportExpectedRow[]
  ) => { success: boolean; count: number; error?: string; stale?: boolean };

  // Admin product catalogue
  adminCreateProduct: (input: AdminProductInput) => { success: boolean; productId?: string; error?: string };
  adminUpdateProduct: (productId: string, input: AdminProductInput) => { success: boolean; error?: string };
  adminSetProductActive: (productId: string, active: boolean) => { success: boolean; error?: string };
  adminCreateSku: (productId: string, input: AdminSkuInput, initialOnHand?: number) => { success: boolean; skuId?: string; error?: string };
  adminUpdateSku: (productId: string, skuId: string, input: AdminSkuInput) => { success: boolean; error?: string };
  adminSaveSeries: (series: SeriesDefinition[]) => { success: boolean; error?: string };
  adminSaveFeatureTags: (tags: FeatureTagDefinition[]) => { success: boolean; error?: string };

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
  simulateTimeTravelInactivity: (companyId: string, monthsToAdd: number) => { success: boolean; error?: string };
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
  const [products, setProducts] = useState<Product[]>(INITIAL_PRODUCTS);
  const [series, setSeries] = useState<SeriesDefinition[]>(INITIAL_SERIES);
  const [featureTags, setFeatureTags] = useState<FeatureTagDefinition[]>(INITIAL_FEATURE_TAGS);
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
  const pendingChangeError = (order: Order) =>
    order.change_request?.status === 'pending'
      ? '该订单有待审核的取消/数量修改申请，请先处理审批，不能直接付款或释放预占。'
      : null;

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

  const orderEligibilityError = (product: Product, sku: ProductSKU) => {
    if (!currentCustomerUser || currentCustomerUser.status !== 'active')
      return 'Your customer account is inactive. Please contact your administrator.';
    if (!currentCompany || currentCompany.status !== 'active')
      return 'Your customer company is inactive. Please contact your administrator.';
    if (product.active === false) return 'This product is no longer available.';
    if (sku.sellable_status !== 'active') return 'This SKU is no longer available.';
    if (
      !brandGrants.some(
        grant =>
          grant.company_id === currentCompany.id && grant.brand_id === product.brand_id
      )
    )
      return 'Your company is no longer authorized for this brand.';
    return null;
  };

  // Cart operations
  const addToCart = useCallback((skuId: string, quantity: number) => {
    if (currentRole !== 'customer') {
      return {
        success: false,
        message: 'Customer ordering is only available in the customer demo role.',
      };
    }
    const check = validateSKUQuantity(quantity);
    if (!check.valid) {
      return { success: false, message: check.error };
    }
    let product: Product | undefined;
    let sku: ProductSKU | undefined;
    for (const item of products) {
      const found = item.skus.find(entry => entry.id === skuId);
      if (found) {
        product = item;
        sku = found;
        break;
      }
    }
    if (!product || !sku) return { success: false, message: 'SKU not found.' };
    const eligibility = orderEligibilityError(product, sku);
    if (eligibility) return { success: false, message: eligibility };

    // Check available stock
    const { totalAvailable } = calculateSKUAvailableStock(skuId, inventory);
    if (quantity > totalAvailable) {
      return {
        success: false,
        message: `Requested ${quantity} PCS exceeds current available stock (${totalAvailable} PCS).`,
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
  }, [currentRole, inventory, products, currentCustomerUser, currentCompany, brandGrants]);

  const updateCartQuantity = useCallback((skuId: string, quantity: number) => {
    if (currentRole !== 'customer') {
      return {
        success: false,
        message: 'Customer ordering is only available in the customer demo role.',
      };
    }
    if (quantity === 0) {
      setCart(prev => prev.filter(i => i.sku_id !== skuId));
      return { success: true };
    }

    const check = validateSKUQuantity(quantity);
    if (!check.valid) {
      return { success: false, message: check.error };
    }
    let product: Product | undefined;
    let sku: ProductSKU | undefined;
    for (const item of products) {
      const found = item.skus.find(entry => entry.id === skuId);
      if (found) {
        product = item;
        sku = found;
        break;
      }
    }
    if (!product || !sku) return { success: false, message: 'SKU not found.' };
    const eligibility = orderEligibilityError(product, sku);
    if (eligibility) return { success: false, message: eligibility };

    const { totalAvailable } = calculateSKUAvailableStock(skuId, inventory);
    if (quantity > totalAvailable) {
      return {
        success: false,
        message: `Requested ${quantity} PCS exceeds current available stock (${totalAvailable} PCS).`,
      };
    }

    setCart(prev =>
      prev.map(item => (item.sku_id === skuId ? { ...item, quantity } : item))
    );
    return { success: true };
  }, [currentRole, inventory, products, currentCustomerUser, currentCompany, brandGrants]);

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
    if (currentRole !== 'customer') {
      return {
        success: false,
        error: 'Customer ordering is only available in the customer demo role.',
      };
    }
    if (!currentCompany || !currentCustomerUser) {
      return { success: false, error: 'Please sign in to a customer account.' };
    }
    if (currentCustomerUser.status !== 'active') {
      return { success: false, error: 'Your customer account is inactive. Please contact your administrator.' };
    }
    if (currentCompany.status !== 'active') {
      return { success: false, error: 'Your customer company is inactive. Please contact your administrator.' };
    }

    if (cart.length === 0) {
      return { success: false, error: 'Your order list is empty. Add a SKU first.' };
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

      // Find product & sku info before eligibility and stock checks.
      let foundSku: ProductSKU | undefined;
      let foundProduct: Product | undefined;
      for (const p of products) {
        const s = p.skus.find(sk => sk.id === item.sku_id);
        if (s) {
          foundSku = s;
          foundProduct = p;
          break;
        }
      }
      if (!foundSku || !foundProduct) {
        return {
          success: false,
          error: `SKU ${item.sku_id} is no longer available. Your order list was kept.`,
        };
      }
      const eligibility = orderEligibilityError(foundProduct, foundSku);
      if (eligibility) {
        return {
          success: false,
          error: `${eligibility} Your order list and shipping details were kept.`,
        };
      }

      const { totalAvailable } = calculateSKUAvailableStock(item.sku_id, inventory);
      if (item.quantity > totalAvailable) {
        return {
          success: false,
          error: `SKU ${item.sku_id} now has ${totalAvailable} PCS available; ${item.quantity} PCS cannot be ordered.`,
        };
      }

      let priceInfo: ReturnType<typeof calculateEffectiveUnitPrice>;
      try {
        priceInfo = calculateEffectiveUnitPrice(
          foundSku.base_price_usd,
          foundSku.id,
          tierDiscount,
          promotions
        );
      } catch (error) {
        return {
          success: false,
          error: `Pricing configuration is invalid: ${(error as Error).message} Order was not submitted.`,
        };
      }

      const lineSubtotal = Number((priceInfo.effectivePrice * item.quantity).toFixed(2));
      const lineAmountCheck = validateOrderAmount(lineSubtotal, 'Line subtotal');
      if (!lineAmountCheck.valid) {
        return {
          success: false,
          error: `${lineAmountCheck.error} Order was not submitted.`,
        };
      }
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

    const totalAmountCheck = validateOrderAmount(totalQuoted, 'Order total');
    if (!totalAmountCheck.valid) {
      return {
        success: false,
        error: `${totalAmountCheck.error} Order was not submitted.`,
      };
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
      customer_visible_note: 'Order request submitted. Your sales representative will verify quantities and stock before creating a reservation. Submitting does not lock stock.',
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

    return { success: true, orderId: newOrder.id, order: newOrder };
  }, [
    currentRole,
    currentCompany,
    currentCustomerUser,
    cart,
    inventory,
    currentCompanyTierInfo,
    products,
    promotions,
    brandGrants,
    addAuditLog,
  ]);

  // Customer Cancel Order
  const customerCancelOrder = useCallback((orderId: string, reason: string) => {
    if (currentRole !== 'customer') {
      return {
        success: false,
        message: 'Customer order actions are only available in the customer demo role.',
      };
    }
    const order = orders.find(o => o.id === orderId);
    if (!order) return { success: false, message: 'Order not found.' };
    if (!currentCompany || order.company_id !== currentCompany.id) {
      return { success: false, message: 'You can only change orders from your own company.' };
    }

    if (order.status === 'PENDING_CONFIRMATION') {
      // Direct cancellation allowed before sales confirmation
      setOrders(prev =>
        prev.map(o =>
          o.id === orderId
            ? {
                ...o,
                status: 'CANCELLED',
                customer_visible_note: `The customer cancelled this pending request. Reason: ${reason}`,
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

      return { success: true, message: 'Order cancelled.' };
    }

    if (order.status === 'CONFIRMED') {
      if (order.change_request?.status === 'pending') {
        return {
          success: false,
          message: 'A cancellation or quantity change request is already pending review.',
        };
      }
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
                customer_visible_note: `Cancellation requested; awaiting sales review and release of reserved stock. Reason: ${reason}`,
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
        message: 'A cancellation request has been sent to your sales representative for review.',
      };
    }

    return {
      success: false,
      message: 'Paid or preparing orders cannot be cancelled here. Please contact your sales representative.',
    };
  }, [currentRole, currentCompany, orders, currentCustomerUser, addAuditLog]);

  // Customer Request Change
  const customerRequestChange = useCallback((
    orderId: string,
    reason: string,
    modifiedLines?: { sku_id: string; new_qty: number }[]
  ) => {
    if (currentRole !== 'customer') {
      return {
        success: false,
        message: 'Customer order actions are only available in the customer demo role.',
      };
    }
    const order = orders.find(o => o.id === orderId);
    if (!order) return { success: false, message: 'Order not found.' };
    if (!currentCompany || order.company_id !== currentCompany.id) {
      return { success: false, message: 'You can only change orders from your own company.' };
    }

    if (order.status === 'PENDING_CONFIRMATION') {
      if (!modifiedLines?.length) {
        return { success: false, message: 'No quantity changes were supplied.' };
      }

      const seen = new Set<string>();
      for (const change of modifiedLines) {
        if (!order.lines.some(line => line.sku_id === change.sku_id)) {
          return {
            success: false,
            message: `SKU ${change.sku_id} is not part of this order.`,
          };
        }
        if (seen.has(change.sku_id)) {
          return {
            success: false,
            message: `Quantity change contains a duplicate SKU: ${change.sku_id}.`,
          };
        }
        seen.add(change.sku_id);
      }

      const updatedLines: typeof order.lines = [];
      for (const line of order.lines) {
        const change = modifiedLines.find(item => item.sku_id === line.sku_id);
        if (!change) {
          updatedLines.push({ ...line });
          continue;
        }

        const check = validateSKUQuantity(change.new_qty);
        if (!check.valid) {
          return { success: false, message: check.error ?? 'Invalid quantity.' };
        }

        let foundSku: ProductSKU | undefined;
        let foundProduct: Product | undefined;
        for (const product of products) {
          const sku = product.skus.find(item => item.id === line.sku_id);
          if (sku) {
            foundSku = sku;
            foundProduct = product;
            break;
          }
        }
        if (!foundSku || !foundProduct) {
          return {
            success: false,
            message: `SKU ${line.sku_code} is no longer available.`,
          };
        }

        const eligibility = orderEligibilityError(foundProduct, foundSku);
        if (eligibility) return { success: false, message: eligibility };

        const { totalAvailable } = calculateSKUAvailableStock(foundSku.id, inventory);
        if (change.new_qty > totalAvailable) {
          return {
            success: false,
            message: `Requested ${change.new_qty} PCS exceeds current available stock (${totalAvailable} PCS).`,
          };
        }

        const lineSubtotal = Number((line.quoted_unit_price * change.new_qty).toFixed(2));
        const lineAmountCheck = validateOrderAmount(lineSubtotal, 'Line subtotal');
        if (!lineAmountCheck.valid) {
          return { success: false, message: lineAmountCheck.error ?? 'Invalid line amount.' };
        }

        updatedLines.push({
          ...line,
          quantity: change.new_qty,
          line_subtotal: lineSubtotal,
        });
      }

      const newTotal = updatedLines.reduce((acc, line) => acc + line.line_subtotal, 0);
      const totalAmountCheck = validateOrderAmount(newTotal, 'Order total');
      if (!totalAmountCheck.valid) {
        return { success: false, message: totalAmountCheck.error ?? 'Invalid order total.' };
      }

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

      return { success: true, message: 'Order quantities updated.' };
    }

    if (order.status === 'CONFIRMED') {
      if (order.change_request?.status === 'pending') {
        return {
          success: false,
          message: 'A cancellation or quantity change request is already pending review.',
        };
      }

      if (modifiedLines) {
        const seen = new Set<string>();
        for (const change of modifiedLines) {
          if (!order.lines.some(line => line.sku_id === change.sku_id)) {
            return {
              success: false,
              message: `SKU ${change.sku_id} is not part of this order.`,
            };
          }
          if (seen.has(change.sku_id)) {
            return {
              success: false,
              message: `Quantity change contains a duplicate SKU: ${change.sku_id}.`,
            };
          }
          seen.add(change.sku_id);
          const check = validateSKUQuantity(change.new_qty);
          if (!check.valid) {
            return { success: false, message: check.error ?? 'Invalid quantity.' };
          }
        }
      }

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

      addAuditLog(
        currentCustomerUser?.username || 'Buyer',
        'REQUEST_CHANGE',
        order.order_no,
        'Submitted quantity change approval request for confirmed order.'
      );

      return { success: true, message: 'Quantity change request sent to sales.' };
    }

    return { success: false, message: 'This order status does not allow a change request.' };
  }, [
    currentRole,
    currentCompany,
    orders,
    currentCustomerUser,
    products,
    inventory,
    brandGrants,
    addAuditLog,
  ]);

  // Salesperson: Confirm Order (Atomic Stock Reservation)
  const salesConfirmOrder = useCallback((orderId: string) => {
    if (!canViewSalesOperations(currentRole)) {
      return { success: false, error: 'Sales operations are only available to sales or admin demo roles.' };
    }
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
    const confirmTotalCheck = validateConfirmableOrderTotal(order.total_quoted_usd);
    if (!confirmTotalCheck.valid) {
      const cents = Number.isFinite(order.total_quoted_usd)
        ? usdToCents(order.total_quoted_usd)
        : null;
      if (cents === 0) {
        return {
          success: false,
          error: '订单确认金额为 USD $0.00，暂不允许确认或预占库存。请先调整报价或折扣。',
        };
      }
      const amountText = Number.isFinite(order.total_quoted_usd)
        ? `USD $${order.total_quoted_usd.toFixed(2)}`
        : '非有限金额';
      return {
        success: false,
        error: `订单确认金额为 ${amountText}，暂不允许确认或预占库存。请先调整报价或折扣。`,
      };
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
              customer_visible_note: `Your order was confirmed and a demo whole-order reservation was created. The reservation is valid for 72 hours (until ${expiryDate.slice(0, 16).replace('T', ' ')} UTC). This is not a database transaction. Please follow the proforma invoice for T/T payment.`,
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
      title: `Order ${order.order_no} confirmed`,
      message: 'Your order request was confirmed and demo stock was reserved for 72 hours.',
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
  }, [currentRole, orders, inventory, companies, currentSalesUser, addAuditLog]);

  // Salesperson: Extend Reservation
  const salesExtendReservation = useCallback((orderId: string, additionalHours: number) => {
    if (!canViewSalesOperations(currentRole)) {
      return { success: false, error: 'Sales operations are only available to sales or admin demo roles.' };
    }
    if (!beginOrderAction(`extend:${orderId}`)) {
      return { success: false, error: '该订单延期操作正在进行，请勿重复提交。' };
    }
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
              customer_visible_note: `The demo reservation was extended by ${additionalHours} hours. New expiry: ${newExp.slice(0, 16).replace('T', ' ')} UTC.`,
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
  }, [currentRole, orders, currentSalesUser, addAuditLog]);

  // Salesperson: Release Reservation
  const salesReleaseReservation = useCallback((orderId: string, reason: string) => {
    if (!canViewSalesOperations(currentRole)) {
      return { success: false, error: 'Sales operations are only available to sales or admin demo roles.' };
    }
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
    const pendingChange = pendingChangeError(order);
    if (pendingChange) return { success: false, error: pendingChange };
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
              customer_visible_note: `The demo reservation was released back to available stock. Reason: ${reason}`,
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
  }, [currentRole, orders, inventory, currentSalesUser, addAuditLog]);

  // Salesperson: Record Payment (Updates Customer Cumulative Spend & Tier)
  const salesRecordPayment = useCallback((orderId: string, amountUsd: number, reference: string) => {
    if (!canViewSalesOperations(currentRole)) {
      return { success: false, error: 'Payment recording is only available to sales or admin demo roles.' };
    }
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
    const pendingChange = pendingChangeError(order);
    if (pendingChange) return { success: false, error: pendingChange };
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return { success: false, error: '付款金额必须大于 0。' };
    }
    const cents = amountUsd * 100;
    if (Math.abs(cents - Math.round(cents)) > 1e-6) {
      return { success: false, error: '付款金额最多保留两位小数（USD 分）。' };
    }
    const amountCents = usdToCents(amountUsd);
    const expectedTotal = order.total_confirmed_usd ?? order.total_quoted_usd;
    const expectedAmountCheck = validateOrderAmount(expectedTotal, 'Order total');
    if (!expectedAmountCheck.valid) {
      return { success: false, error: `${expectedAmountCheck.error} Payment was not recorded.` };
    }
    const expectedCents = usdToCents(expectedTotal);
    if (amountCents < expectedCents) {
      return {
        success: false,
        error: `付款金额不足：订单确认总额 USD $${centsToUsd(expectedCents).toFixed(2)}，本次输入 USD $${centsToUsd(amountCents).toFixed(2)}。整单付款必须全额，未登记入账。`,
      };
    }
    if (amountCents > expectedCents) {
      return {
        success: false,
        error: `付款金额超过订单确认总额 USD $${centsToUsd(expectedCents).toFixed(2)}；本原型只支持整单全额付款。`,
      };
    }
    if (!reference.trim()) return { success: false, error: '请填写付款凭证索引。' };
    const paidAmount = centsToUsd(amountCents);

    const paymentTime = new Date().toISOString().replace('T', ' ').substr(0, 19);

    // Update order status
    setOrders(prev =>
      prev.map(o =>
        o.id === orderId
          ? {
              ...o,
              status: 'PAYMENT_RECORDED',
              payment_recorded_at: paymentTime,
              payment_amount_usd: paidAmount,
              payment_reference: reference,
              customer_visible_note: `Full payment of USD $${paidAmount.toFixed(2)} has been verified (reference: ${reference}). The order is now preparing for shipment and can no longer be cancelled.`,
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
        const newSpendCents = usdToCents(c.cumulative_spend_usd) + amountCents;
        const newSpend = centsToUsd(newSpendCents);
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
        title: `Payment received: ${order.order_no}`,
        message: `USD $${paidAmount.toFixed(2)} has been verified, added to your company\'s historical purchase total, and your inactivity timer was reset.`,
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

We acknowledge receipt of your wire transfer of USD $${paidAmount.toFixed(2)} (Ref: ${reference}) for Order #${order.order_no}.

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
      `Recorded USD $${paidAmount.toFixed(2)} payment. Reference: ${reference}. Updated customer spend and tier.`
    );

    return { success: true };
  }, [currentRole, orders, companies, tierRules, currentSalesUser, addAuditLog]);

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
    if (!canViewSalesOperations(currentRole)) {
      return { success: false, error: 'Shipment recording is only available to sales or admin demo roles.' };
    }
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
    const pendingChange = pendingChangeError(order);
    if (pendingChange) return { success: false, error: pendingChange };

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
        title: `Order ${order.order_no} shipped`,
        message: `Carrier: ${shipmentData.carrier}. Tracking: ${shipmentData.trackingNo}.`,
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
  }, [currentRole, orders, inventory, companies, currentSalesUser, addAuditLog]);

  // Salesperson: Handle Change Request (all-or-nothing)
  const salesHandleChangeRequest = useCallback((orderId: string, approve: boolean) => {
    if (!canViewSalesOperations(currentRole)) {
      return { success: false, error: 'Change approvals are only available to sales or admin demo roles.' };
    }
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
                customer_visible_note: 'The change request was rejected. The order and reserved stock remain unchanged.',
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
                customer_visible_note: 'Your cancellation request was approved and the reserved stock was released.',
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
              customer_visible_note: `Your quantity change was approved. The order total is now USD $${newTotal.toFixed(2)} and the demo reservation was reallocated.`,
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
  }, [currentRole, orders, inventory, currentSalesUser, addAuditLog]);

  // Submit Restock Request
  const submitRestockRequest = useCallback((skuId: string, requestedQty: number) => {
    if (currentRole !== 'customer') {
      return {
        success: false,
        message: 'Restock requests are only available in the customer demo role.',
      };
    }
    if (!currentCompany) return { success: false, message: 'Please sign in to a customer account.' };

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
    if (!foundSku || !foundProduct) return { success: false, message: 'SKU not found.' };

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

    return { success: true, message: 'Restock request recorded. You will be notified when stock reaches the MOQ.' };
  }, [currentRole, currentCompany, products, addAuditLog]);

  // Replenish stock & Notify customer if available >= 10 (PRD D09, T24)
  const replenishStock = useCallback((skuId: string, warehouseId: string, addQty: number) => {
    if (!canViewSalesOperations(currentRole)) {
      return;
    }
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
            title: `Back in stock: ${req.sku_code}`,
            message: `${req.sku_code} is now available at or above the MOQ. A restock notification does not reserve stock.`,
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
  }, [currentRole, restockRequests, companies, currentSalesUser, addAuditLog]);

  // Admin: 2-Step Company & Account Creation (PRD 9.1, D24, D25, D26)
  const adminCreateCompany = useCallback((data: {
    customerCode: string;
    shortName: string;
    countryAlpha3: string;
    internalNickname?: string;
  }) => {
    if (currentRole !== 'admin') {
      return { success: false, error: 'Customer account creation is only available to the admin demo role.' };
    }
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
  }, [currentRole, companies, currentAdminUser, addAuditLog]);

  // Admin: Create secondary account for existing company (e.g. AK000123B)
  const adminCreateSecondaryAccount = useCallback((companyId: string) => {
    if (currentRole !== 'admin') {
      return { success: false, error: 'Account creation is only available to the admin demo role.' };
    }
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
  }, [currentRole, companies, customerUsers, currentAdminUser, addAuditLog]);

  // Admin: Toggle Brand Grant
  const adminToggleBrandGrant = useCallback((companyId: string, brandId: string) => {
    if (currentRole !== 'admin') {
      return { success: false, error: 'Brand grants can only be changed by the admin demo role.' };
    }
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
    return { success: true };
  }, [currentRole, currentAdminUser, addAuditLog]);

  // Admin: Update Tier Rules
  const adminUpdateTierRule = useCallback((tierId: string, thresholdUsd: number, discountRate: number) => {
    if (currentRole !== 'admin') {
      return { success: false, error: 'Tier configuration is only available to the admin demo role.' };
    }
    const thresholdCheck = validateTierThreshold(thresholdUsd);
    if (!thresholdCheck.valid) {
      return { success: false, error: thresholdCheck.error ?? 'Invalid tier threshold.' };
    }
    const discountCheck = validateDiscountRate(discountRate);
    if (!discountCheck.valid) {
      return { success: false, error: discountCheck.error ?? 'Invalid discount rate.' };
    }
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
    return { success: true };
  }, [currentRole, currentAdminUser, addAuditLog]);

  // Admin: Add or update promotion
  const adminAddOrUpdatePromotion = useCallback((promo: Omit<Promotion, 'id'>) => {
    if (currentRole !== 'admin') {
      return { success: false, error: 'Promotion configuration is only available to the admin demo role.' };
    }
    const priceCheck = validateUnitPrice(promo.promo_price_usd, 'Promotion price');
    if (!priceCheck.valid) {
      return { success: false, error: priceCheck.error ?? 'Invalid promotion price.' };
    }
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
    return { success: true };
  }, [currentRole, currentAdminUser, addAuditLog]);

  // Admin: Excel bulk import. Fail-closed: every row is revalidated against current state.
  const excelImportStock = useCallback((
    rows: { sku_code: string; warehouse_code: string; on_hand: number; unsellable: number }[],
    expected?: InventoryImportExpectedRow[]
  ) => {
    if (currentRole !== 'admin') {
      return {
        success: false as const,
        count: 0,
        error: 'Inventory import is only available to the admin demo role.',
      };
    }
    const table = [
      inventoryImportHeaders,
      ...rows.map(row => [row.sku_code, row.warehouse_code, row.on_hand, row.unsellable]),
    ];
    const parsed = parseInventoryTable(table);
    if (parsed.errors.length) {
      return { success: false as const, count: 0, error: parsed.errors.join(' ') };
    }
    const checked = validateInventoryImport(parsed.lines, products, warehouses, inventory);
    if (expected && isPreviewSnapshotStale(expected, checked.rows)) {
      const refreshedErrors = checked.errors.length
        ? ` ${checked.errors.join(' ')}`
        : '';
      return {
        success: false as const,
        count: 0,
        stale: true,
        error: `Inventory changed since this preview. Review the refreshed differences and confirm again.${refreshedErrors}`,
      };
    }
    if (!checked.valid) {
      return {
        success: false as const,
        count: 0,
        error: checked.errors.join(' '),
      };
    }

    const now = new Date().toISOString().slice(0, 10);
    const nextInventory = inventory.map(balance => {
      const row = checked.rows.find(
        item =>
          item.skuId === balance.sku_id && item.warehouseId === balance.warehouse_id
      );
      return row
        ? {
            ...balance,
            on_hand: row.line.onHand,
            unsellable: row.line.unsellable,
            updated_at: now,
          }
        : balance;
    });
    setInventory(nextInventory);
    addAuditLog(
      currentAdminUser.name,
      'EXCEL_IMPORT_STOCK',
      'Multi-Warehouse Inventory',
      `Imported ${checked.rows.length} balance records from a validated local Mock batch.`
    );
    return { success: true as const, count: checked.rows.length };
  }, [currentRole, warehouses, products, inventory, currentAdminUser, addAuditLog]);

  // Admin product catalogue
  const adminCreateProduct = useCallback((input: AdminProductInput) => {
    if (currentRole !== 'admin') {
      return { success: false, error: 'Product management is only available to the admin demo role.' };
    }
    const code = input.productCode.trim();
    const title = input.title.trim();
    const titleEn = input.titleEn.trim();
    if (!code) return { success: false, error: 'Product code is required.' };
    if (!title || !titleEn)
      return { success: false, error: 'Chinese and English product names are required.' };
    if (products.some(p => p.product_code.toLowerCase() === code.toLowerCase()))
      return { success: false, error: `Product code ${code} already exists.` };
    if (!brands.some(b => b.id === input.brandId))
      return { success: false, error: 'Select a valid brand.' };
    if (input.seriesId && !series.some(item => item.id === input.seriesId))
      return { success: false, error: 'Select a valid series.' };
    if (input.tagCodes.some(codeValue => !featureTags.some(tag => tag.code === codeValue)))
      return { success: false, error: 'Select valid feature tags.' };
    const images = [input.primaryImage, ...input.galleryImages].filter(Boolean);
    if (images.some(image => !isDemoImageUrl(image)))
      return { success: false, error: 'Choose images from the local demo image library.' };
    if (input.primaryImage && !isDemoImageUrl(input.primaryImage))
      return { success: false, error: 'The primary image is not a valid local demo image.' };

    const productId = `prod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const primaryImage = input.primaryImage || input.galleryImages[0] || '';
    const product: Product = {
      id: productId,
      brand_id: input.brandId,
      product_code: code,
      title,
      title_en: titleEn,
      category: input.category,
      description: input.description.trim(),
      description_en: input.descriptionEn.trim(),
      material: input.material.trim(),
      capacity_or_size: input.capacityOrSize.trim(),
      primary_image: primaryImage,
      gallery_images: [...new Set(input.galleryImages.filter(Boolean))],
      active: false,
      series_id: input.seriesId || undefined,
      tag_codes: featureTags
        .filter(tag => input.tagCodes.includes(tag.code))
        .map(tag => tag.code),
      skus: [],
    };
    setProducts(prev => [product, ...prev]);
    addAuditLog(
      currentAdminUser.name,
      'CREATE_PRODUCT',
      code,
      `Created product ${titleEn} as an unlisted draft with no SKUs.`
    );
    return { success: true as const, productId };
  }, [currentRole, products, brands, series, featureTags, currentAdminUser, addAuditLog]);

  const adminUpdateProduct = useCallback((productId: string, input: AdminProductInput) => {
    if (currentRole !== 'admin') {
      return { success: false, error: 'Product management is only available to the admin demo role.' };
    }
    const product = products.find(item => item.id === productId);
    if (!product) return { success: false, error: 'Product not found.' };
    const code = input.productCode.trim();
    const title = input.title.trim();
    const titleEn = input.titleEn.trim();
    if (!code || !title || !titleEn)
      return { success: false, error: 'Product code and both product names are required.' };
    if (
      products.some(
        item =>
          item.id !== productId && item.product_code.toLowerCase() === code.toLowerCase()
      )
    )
      return { success: false, error: `Product code ${code} already exists.` };
    if (!brands.some(b => b.id === input.brandId))
      return { success: false, error: 'Select a valid brand.' };
    if (input.seriesId && !series.some(item => item.id === input.seriesId))
      return { success: false, error: 'Select a valid series.' };
    if (input.tagCodes.some(codeValue => !featureTags.some(tag => tag.code === codeValue)))
      return { success: false, error: 'Select valid feature tags.' };
    const images = [input.primaryImage, ...input.galleryImages].filter(Boolean);
    if (images.some(image => !isDemoImageUrl(image)))
      return { success: false, error: 'Choose images from the local demo image library.' };
    const primaryImage = input.primaryImage || input.galleryImages[0] || '';
    if (product.active !== false && !isDemoImageUrl(primaryImage))
      return {
        success: false,
        error: 'A listed product must keep at least one valid primary image.',
      };
    const galleryImages = [...new Set(input.galleryImages.filter(Boolean))];
    const allowedImages = new Set([primaryImage, ...galleryImages]);
    const next: Product = {
      ...product,
      brand_id: input.brandId,
      product_code: code,
      title,
      title_en: titleEn,
      category: input.category,
      description: input.description.trim(),
      description_en: input.descriptionEn.trim(),
      material: input.material.trim(),
      capacity_or_size: input.capacityOrSize.trim(),
      primary_image: primaryImage,
      gallery_images: galleryImages,
      series_id: input.seriesId || undefined,
      tag_codes: featureTags
        .filter(tag => input.tagCodes.includes(tag.code))
        .map(tag => tag.code),
      skus: product.skus.map(sku =>
        sku.image_url && !allowedImages.has(sku.image_url)
          ? { ...sku, image_url: undefined }
          : sku
      ),
    };
    setProducts(prev => prev.map(item => (item.id === productId ? next : item)));
    addAuditLog(
      currentAdminUser.name,
      'UPDATE_PRODUCT',
      code,
      `Updated product fields; historical order snapshots were not changed.`
    );
    return { success: true as const };
  }, [currentRole, products, brands, series, featureTags, currentAdminUser, addAuditLog]);

  const adminSetProductActive = useCallback((productId: string, active: boolean) => {
    if (currentRole !== 'admin') {
      return { success: false, error: 'Product listing is only available to the admin demo role.' };
    }
    const product = products.find(item => item.id === productId);
    if (!product) return { success: false, error: 'Product not found.' };
    if (active) {
      const activeSkus = product.skus.filter(sku => sku.sellable_status === 'active');
      if (!activeSkus.length) {
        return { success: false, error: 'Add at least one active SKU before listing.' };
      }
      const image = product.primary_image || product.gallery_images[0];
      if (!isDemoImageUrl(image)) {
        return { success: false, error: 'Add at least one valid local product image before listing.' };
      }
    }
    setProducts(prev =>
      prev.map(item => (item.id === productId ? { ...item, active } : item))
    );
    addAuditLog(
      currentAdminUser.name,
      active ? 'PUBLISH_PRODUCT' : 'UNPUBLISH_PRODUCT',
      product.product_code,
      active
        ? 'Listed product in the customer catalog.'
        : 'Unlisted product from the customer catalog.'
    );
    return { success: true as const };
  }, [currentRole, products, currentAdminUser, addAuditLog]);

  const adminCreateSku = useCallback((
    productId: string,
    input: AdminSkuInput,
    initialOnHand = 0
  ) => {
    if (currentRole !== 'admin') {
      return { success: false, error: 'SKU management is only available to the admin demo role.' };
    }
    const product = products.find(item => item.id === productId);
    if (!product) return { success: false, error: 'Product not found.' };
    const code = input.skuCode.trim();
    if (!code) return { success: false, error: 'SKU code is required.' };
    if (
      products.some(item =>
        item.skus.some(sku => sku.sku_code.toLowerCase() === code.toLowerCase())
      )
    )
      return { success: false, error: `SKU code ${code} already exists.` };
    if (!input.colorName.trim() || !input.colorHex)
      return { success: false, error: 'Colour name and swatch are required.' };
    if (!Number.isFinite(input.basePriceUsd) || input.basePriceUsd <= 0)
      return { success: false, error: 'Base wholesale price must be greater than 0.' };
    const productImages = new Set([product.primary_image, ...product.gallery_images]);
    if (input.imageUrl && (!isDemoImageUrl(input.imageUrl) || !productImages.has(input.imageUrl)))
      return {
        success: false,
        error: 'A SKU image must belong to the current product gallery.',
      };
    if (!Number.isInteger(initialOnHand) || initialOnHand < 0)
      return { success: false, error: 'Initial on-hand must be a non-negative whole number.' };

    const skuId = `sku-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const sku: ProductSKU = {
      id: skuId,
      product_id: productId,
      sku_code: code,
      color_name: input.colorName.trim(),
      color_name_en: input.colorNameEn.trim(),
      image_url: input.imageUrl,
      color_hex: input.colorHex,
      base_price_usd: input.basePriceUsd,
      sellable_status: input.sellableStatus,
    };
    setProducts(prev =>
      prev.map(item =>
        item.id === productId ? { ...item, skus: [...item.skus, sku] } : item
      )
    );
    setInventory(prev => [
      ...prev,
      {
        warehouse_id: 'wh-sh',
        sku_id: skuId,
        on_hand: initialOnHand,
        reserved: 0,
        unsellable: 0,
        updated_at: new Date().toISOString().slice(0, 10),
      },
    ]);
    addAuditLog(
      currentAdminUser.name,
      'CREATE_SKU',
      code,
      `Created SKU for ${product.product_code} with initial on-hand ${initialOnHand}.`
    );
    return { success: true as const, skuId };
  }, [currentRole, products, orders, currentAdminUser, addAuditLog]);

  const adminUpdateSku = useCallback((productId: string, skuId: string, input: AdminSkuInput) => {
    if (currentRole !== 'admin') {
      return { success: false, error: 'SKU management is only available to the admin demo role.' };
    }
    const product = products.find(item => item.id === productId);
    if (!product) return { success: false, error: 'Product not found.' };
    const sku = product.skus.find(item => item.id === skuId);
    if (!sku) return { success: false, error: 'SKU not found.' };
    const code = input.skuCode.trim();
    if (!code) return { success: false, error: 'SKU code is required.' };
    if (
      code !== sku.sku_code &&
      orders.some(order => order.lines.some(line => line.sku_id === skuId))
    )
      return {
        success: false,
        error:
          'This SKU is referenced by a historical order. Keep the SKU code; price, name and status can still be edited.',
      };
    if (
      products.some(item =>
        item.skus.some(
          other =>
            other.id !== skuId && other.sku_code.toLowerCase() === code.toLowerCase()
        )
      )
    )
      return { success: false, error: `SKU code ${code} already exists.` };
    if (!input.colorName.trim() || !input.colorHex)
      return { success: false, error: 'Colour name and swatch are required.' };
    if (!Number.isFinite(input.basePriceUsd) || input.basePriceUsd <= 0)
      return { success: false, error: 'Base wholesale price must be greater than 0.' };
    const productImages = new Set([product.primary_image, ...product.gallery_images]);
    if (input.imageUrl && (!isDemoImageUrl(input.imageUrl) || !productImages.has(input.imageUrl)))
      return {
        success: false,
        error: 'A SKU image must belong to the current product gallery.',
      };
    if (
      product.active !== false &&
      sku.sellable_status === 'active' &&
      input.sellableStatus !== 'active' &&
      !product.skus.some(
        other => other.id !== skuId && other.sellable_status === 'active'
      )
    ) {
      return {
        success: false,
        error:
          'Unpublish the product before deactivating its last active SKU. No status was changed.',
      };
    }

    const nextSku: ProductSKU = {
      ...sku,
      sku_code: code,
      color_name: input.colorName.trim(),
      color_name_en: input.colorNameEn.trim(),
      image_url: input.imageUrl,
      color_hex: input.colorHex,
      base_price_usd: input.basePriceUsd,
      sellable_status: input.sellableStatus,
    };
    setProducts(prev =>
      prev.map(item =>
        item.id === productId
          ? {
              ...item,
              skus: item.skus.map(entry => (entry.id === skuId ? nextSku : entry)),
            }
          : item
      )
    );
    addAuditLog(
      currentAdminUser.name,
      'UPDATE_SKU',
      code,
      `Updated SKU ${sku.sku_code}; order snapshots and reservation IDs were preserved.`
    );
    return { success: true as const };
  }, [currentRole, products, orders, currentAdminUser, addAuditLog]);

  const adminSaveSeries = useCallback((nextSeries: SeriesDefinition[]) => {
    if (currentRole !== 'admin') {
      return { success: false, error: 'Series management is only available to the admin demo role.' };
    }
    if (!nextSeries.length) return { success: false, error: 'At least one series is required.' };
    const ids = new Set<string>();
    for (const item of nextSeries) {
      if (!/^[a-z0-9-]{1,40}$/.test(item.id) || ids.has(item.id))
        return { success: false, error: 'Series IDs must be unique lowercase codes.' };
      if (!item.nameZh.trim() || !item.nameEn.trim())
        return { success: false, error: 'Each series needs Chinese and English names.' };
      if (!Number.isSafeInteger(item.order) || item.order < 1)
        return { success: false, error: 'Series order must be a positive whole number.' };
      ids.add(item.id);
    }
    const removedIds = new Set(
      series.filter(item => !ids.has(item.id)).map(item => item.id)
    );
    if (products.some(product => product.series_id && removedIds.has(product.series_id)))
      return {
        success: false,
        error: 'Cannot remove a series that is assigned to a product. The whole batch was rejected.',
      };
    setSeries([...nextSeries].sort((a, b) => a.order - b.order));
    addAuditLog(currentAdminUser.name, 'SAVE_SERIES', 'catalog', 'Updated series dictionary.');
    return { success: true as const };
  }, [currentRole, series, products, currentAdminUser, addAuditLog]);

  const adminSaveFeatureTags = useCallback((nextTags: FeatureTagDefinition[]) => {
    if (currentRole !== 'admin') {
      return { success: false, error: 'Feature tag management is only available to the admin demo role.' };
    }
    if (!nextTags.length)
      return { success: false, error: 'At least one feature tag is required.' };
    const codes = new Set<string>();
    for (const tag of nextTags) {
      if (!/^[A-Z0-9_]{2,40}$/.test(tag.code) || codes.has(tag.code))
        return { success: false, error: 'Tag codes must be unique uppercase codes.' };
      if (!tag.nameZh.trim() || !tag.nameEn.trim())
        return { success: false, error: 'Each tag needs Chinese and English names.' };
      if (!['orange', 'blue', 'sky', 'green', 'grey', 'purple'].includes(tag.tone))
        return { success: false, error: 'Choose a valid tag tone.' };
      if (!Number.isSafeInteger(tag.order) || tag.order < 1)
        return { success: false, error: 'Tag order must be a positive whole number.' };
      codes.add(tag.code);
    }
    const removedCodes = new Set(
      featureTags.filter(tag => !codes.has(tag.code)).map(tag => tag.code)
    );
    if (
      products.some(product =>
        (product.tag_codes ?? []).some(code => removedCodes.has(code))
      )
    )
      return {
        success: false,
        error: 'Cannot remove a tag that is assigned to a product. The whole batch was rejected.',
      };
    setFeatureTags([...nextTags].sort((a, b) => a.order - b.order));
    addAuditLog(currentAdminUser.name, 'SAVE_FEATURE_TAGS', 'catalog', 'Updated feature tag dictionary.');
    return { success: true as const };
  }, [currentRole, featureTags, products, currentAdminUser, addAuditLog]);

  // Complete first-time password reset
  const completePasswordReset = useCallback((_newPassword: string) => {
    if (currentRole !== 'customer') return;
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
  }, [currentRole, currentCustomerUser, addAuditLog]);

  // Inactivity simulation (time-travel for internal QA only)
  const simulateTimeTravelInactivity = useCallback((companyId: string, monthsToAdd: number) => {
    if (currentRole !== 'admin') {
      return { success: false, error: 'Inactivity simulation is only available in the internal admin QA panel.' };
    }
    if (!Number.isInteger(monthsToAdd) || monthsToAdd <= 0) {
      return { success: false, error: 'Months to add must be a positive whole number.' };
    }
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
    return { success: true };
  }, [currentRole, tierRules, addAuditLog]);

  const markNotificationAsRead = useCallback((notificationId: string) => {
    if (currentRole !== 'customer' || !currentCompany) return;
    setNotifications(prev =>
      prev.map(n =>
        n.id === notificationId && n.company_id === currentCompany.id
          ? { ...n, is_read: true }
          : n
      )
    );
  }, [currentRole, currentCompany]);

  const markEmailTemplateSent = useCallback((templateId: string) => {
    if (!canViewSalesOperations(currentRole)) return;
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
  }, [currentRole, currentSalesUser, addAuditLog]);

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
        series,
        featureTags,
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
        adminCreateProduct,
        adminUpdateProduct,
        adminSetProductActive,
        adminCreateSku,
        adminUpdateSku,
        adminSaveSeries,
        adminSaveFeatureTags,
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

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Role = 'customer' | 'sales' | 'admin';

export interface CustomerCompany {
  id: string; // Internal tech PK, e.g. "comp-001"
  customer_code: string; // Format: C + 6 digits, e.g. "C000123"
  short_name: string; // Company Short Name, e.g. "Apex Luggage Co."
  country_alpha3: string; // ISO 3166-1 alpha-3, e.g. "USA"
  internal_nickname?: string; // Internal nickname, sales/admin only, NEVER visible to customer
  assigned_sales_id: string; // e.g. "sales-1" (Tom Miller)
  status: 'active' | 'suspended';
  tier_id: string; // current active tier ID
  base_tier_id: string; // base tier calculated from cumulative spend before downgrades
  cumulative_spend_usd: number; // Historical cumulative effective purchase in USD (online + offline registered)
  last_effective_purchase_date: string; // YYYY-MM-DD
  months_inactive: number; // Simulated or calculated months since last effective purchase
  created_at: string;
}

export interface CustomerUser {
  id: string;
  company_id: string;
  username: string; // Format: AK + customer_code末6位 + letter, e.g. "AK000123A"
  account_letter: string; // 'A' to 'Z'
  must_change_password: boolean;
  status: 'active' | 'suspended';
  created_at: string;
}

export interface InternalUser {
  id: string;
  name: string;
  internal_email: string; // Internal only, e.g. tom.m@aoking-direct.internal
  role: 'sales' | 'admin';
}

export interface Brand {
  id: string;
  code: string; // e.g. "AOKING"
  name: string;
  is_default_granted: boolean;
}

export interface BrandGrant {
  company_id: string;
  brand_id: string;
  granted_at: string;
}

export interface ProductSKU {
  id: string; // e.g. "sku-9042-blk"
  product_id: string;
  sku_code: string; // e.g. "AK-9042-BLK"
  color_name: string;
  color_hex: string;
  base_price_usd: number;
  sellable_status: 'active' | 'discontinued';
}

export interface Product {
  id: string;
  brand_id: string;
  product_code: string; // e.g. "AK-9042"
  title: string;
  category: 'Business Backpacks' | 'Travel Luggage' | 'Urban Commuter' | 'Executive Briefcases';
  description: string;
  material: string;
  capacity_or_size: string;
  primary_image: string;
  gallery_images: string[];
  skus: ProductSKU[];
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
}

export interface InventoryBalance {
  warehouse_id: string;
  sku_id: string;
  on_hand: number;
  reserved: number;
  unsellable: number;
  updated_at: string;
}

export interface TierRule {
  id: string;
  tier_level: number; // 1, 2, 3, 4, 5
  name: string; // e.g. "Tier 1 - Standard", "Tier 2 - Silver"
  threshold_usd: number; // Cumulative spend threshold in USD
  discount_rate: number; // 0.05 = 5% off
}

export interface Promotion {
  id: string;
  sku_id: string;
  promo_price_usd: number;
  start_at: string; // YYYY-MM-DD
  end_at: string; // YYYY-MM-DD
  stack_tier_discount: boolean; // default false
  status: 'active' | 'scheduled' | 'expired';
}

export type OrderStatus =
  | 'DRAFT'
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'PAYMENT_RECORDED'
  | 'PREPARING_SHIPMENT'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'RESERVATION_EXPIRED';

export interface OrderLineItem {
  sku_id: string;
  sku_code: string;
  product_title: string;
  color_name: string;
  quantity: number; // must be >= 10 (MOQ 10)
  quoted_unit_price: number;
  confirmed_unit_price?: number;
  line_subtotal: number;
}

export interface OrderChangeRequest {
  id: string;
  request_type: 'modify_quantity' | 'cancel_order';
  requested_by_user_id: string;
  reason: string;
  modified_lines?: { sku_id: string; new_qty: number }[];
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  reviewed_at?: string;
  reviewer_id?: string;
}

export interface Order {
  id: string;
  order_no: string; // e.g. "ORD-20261101-001"
  company_id: string;
  created_by_user_id: string;
  created_by_username: string;
  status: OrderStatus;
  lines: OrderLineItem[];
  total_quoted_usd: number;
  total_confirmed_usd?: number;
  
  // Shipping request by customer
  shipping_method: 'Express' | 'Air' | 'Sea' | 'Customer Pickup' | 'Other';
  destination_country_alpha3: string; // ISO 3166-1 alpha-3, e.g. "USA"
  expected_ship_date: string;
  shipping_requirements: string; // Free text filtered for NO PII

  // Salesperson and Fulfillment
  assigned_sales_id: string;
  reservation_expires_at?: string; // ISO timestamp
  reservation_extended_count?: number;
  
  // Payment
  payment_recorded_at?: string;
  payment_amount_usd?: number;
  payment_reference?: string;

  // Logistics
  carrier?: string;
  tracking_no?: string;
  actual_ship_date?: string;
  estimated_delivery_date?: string;
  customer_visible_note?: string;
  internal_note?: string; // Only sales/admin can view!

  change_request?: OrderChangeRequest;
  created_at: string;
  updated_at: string;
}

export interface RestockRequest {
  id: string;
  company_id: string;
  sku_id: string;
  sku_code: string;
  product_title: string;
  color_name: string;
  requested_qty: number;
  status: 'pending' | 'notified' | 'fulfilled';
  created_at: string;
  notified_at?: string;
}

export interface CustomerNotification {
  id: string;
  company_id: string;
  title: string;
  message: string;
  event_type: 'ORDER_CONFIRMED' | 'PAYMENT_RECEIVED' | 'SHIPMENT_DISPATCHED' | 'RESTOCK_AVAILABLE' | 'RESERVATION_EXPIRING';
  related_id?: string;
  is_read: boolean;
  created_at: string;
}

export interface InternalEmailTemplate {
  id: string;
  event_type: string;
  sales_rep_email: string;
  recipient_company_code: string;
  recipient_company_name: string;
  subject: string;
  body_text: string;
  created_at: string;
  sent_by_sales_at?: string;
  status: 'ready_to_send' | 'sent_offline';
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actor: string; // e.g. "Tom Miller (Sales)", "AK000123A (Buyer)", "Admin"
  action: string;
  target: string;
  details: string; // Sanitized, strictly no client PII
}

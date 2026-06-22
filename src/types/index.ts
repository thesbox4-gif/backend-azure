export type UserRole = 'admin' | 'employee' | 'customer' | 'superadmin'
export type EmployeeStatus = 'pending' | 'approved' | 'rejected'
export type OrderStatus =
  | 'placed'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
export type ProductType =
  | 'saree'
  | 'jewellery'
  | 'mens_kurta'
  | 'sherwani'
  | 'bundi'
  | 'mens_shirt'
  | 'mens_tshirt'
  | 'mens_formal'
  | 'mens_trouser'

export interface Profile {
  id: string
  name: string
  phone?: string
  role: UserRole
  employee_status?: EmployeeStatus
  fcm_token?: string
  whatsapp?: string
  created_at: string
  updated_at: string
}

export interface Category {
  id: string
  name: string
  slug: string
  description?: string
  image_url?: string
  parent_id?: string | null
  created_at: string
}

export interface Product {
  id: string
  title: string
  description?: string
  type: ProductType
  category_id?: string
  base_price: number
  discount_pct: number
  coupon_code?: string
  coupon_disc?: number
  barcode?: string
  block?: boolean
  published: boolean
  created_by?: string
  created_at: string
  updated_at: string
}

export interface ProductImage {
  id: string
  product_id: string
  url: string
  alt_text?: string
  is_primary: boolean
  color?: string
  display_order: number
}

export interface Variant {
  id: string
  product_id: string
  color?: string
  size?: string
  quantity: number
  sold_count: number
  sku?: string
  image_url?: string
  created_at: string
}

export interface Address {
  id: string
  user_id: string
  line1: string
  line2?: string
  city: string
  state: string
  pincode: string
  country: string
  is_default: boolean
  created_at: string
}

export interface Order {
  id: string
  user_id: string
  address_id?: string
  status: OrderStatus
  total_amount: number
  discount_amount: number
  coupon_applied?: string
  razorpay_order_id?: string
  razorpay_payment_id?: string
  shiprocket_order_id?: string
  shiprocket_shipment_id?: string
  shiprocket_awb?: string
  shiprocket_courier_id?: number
  shiprocket_courier_name?: string
  tracking_url?: string
  shipment_status?: string
  expected_delivery_date?: string
  label_url?: string
  invoice_url?: string
  manifest_url?: string
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  variant_id: string
  quantity: number
  unit_price: number
}

export interface CartItem {
  id: string
  user_id: string
  product_id: string
  variant_id: string
  quantity: number
  created_at: string
}

export interface WishlistItem {
  id: string
  user_id: string
  product_id: string
  created_at: string
}

export interface Coupon {
  id: string
  code: string
  discount_pct: number
  max_uses?: number
  used_count: number
  expires_at?: string
  active: boolean
  created_at: string
}

export interface Notification {
  id: string
  user_id: string
  title: string
  body: string
  read: boolean
  created_at: string
}

export const VALID_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  placed:     ['confirmed', 'cancelled'],
  confirmed:  ['processing', 'cancelled', 'refunded'],
  processing: ['shipped', 'refunded'],
  shipped:    ['delivered', 'refunded'],
  delivered:  ['refunded'],
  cancelled:  [],
  refunded:   [],
}

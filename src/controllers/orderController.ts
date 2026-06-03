import Razorpay from 'razorpay'
import crypto from 'crypto'
import { Response } from 'express'
import { supabase } from '../supabase'
import {
  notifyAdminOrderPlaced,
  notifyCustomerStatusUpdate,
} from '../services/notificationService'
import { AuthRequest } from '../middleware/auth'
import { VALID_ORDER_TRANSITIONS, OrderStatus } from '../types'

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
})

const orderSelect = `
  *,
  user:profiles!user_id(id, name, phone),
  address:addresses(*),
  order_items(
    id, quantity, unit_price,
    product:products(id, title, type,
      images:product_images(url, is_primary)),
    variant:variants(id, color, size, sku)
  )
`

// Builds the internal order from the user's cart + address, then creates the
// matching Razorpay order. The amount is computed server-side — never trusted
// from the client. verifyPayment later flips this order to 'confirmed'.
export async function createRazorpayOrder(req: AuthRequest, res: Response) {
  const { address, coupon } = req.body
  const userId = req.user!.id

  const { data: cart } = await supabase
    .from('cart_items')
    .select('product_id, variant_id, quantity, product:products(base_price, discount_pct, category_id, category:categories(parent_id)), variant:variants(quantity)')
    .eq('user_id', userId)

  if (!cart || cart.length === 0) {
    return res.status(400).json({ error: 'Your cart is empty' })
  }

  let subtotal = 0
  const items: { product_id: string; variant_id: string; quantity: number; unit_price: number }[] = []
  for (const c of cart) {
    const product = c.product as unknown as { base_price: number; discount_pct: number } | null
    const variant = c.variant as unknown as { quantity: number } | null
    if (!product || !variant) {
      return res.status(400).json({ error: 'An item in your cart is no longer available' })
    }
    if (variant.quantity < c.quantity) {
      return res.status(400).json({ error: 'Insufficient stock for an item in your cart' })
    }
    const unitPrice = Math.round(product.base_price * (1 - (product.discount_pct ?? 0) / 100))
    subtotal += unitPrice * c.quantity
    items.push({ product_id: c.product_id, variant_id: c.variant_id, quantity: c.quantity, unit_price: unitPrice })
  }

  // Optional coupon
  let discount = 0
  let couponCode: string | null = null
  if (coupon) {
    const { data: cp } = await supabase
      .from('coupons')
      .select('code, discount_pct, max_uses, used_count, starts_at, expires_at, active, category_id, product_id')
      .eq('code', coupon)
      .maybeSingle()
    const now = new Date()
    const timeValid =
      cp &&
      cp.active &&
      (!cp.starts_at || new Date(cp.starts_at) <= now) &&
      (!cp.expires_at || new Date(cp.expires_at) > now) &&
      (cp.max_uses == null || cp.used_count < cp.max_uses)
    // Scope gate: a coupon limited to a category/product only applies when the
    // cart holds at least one matching item.
    let scopeMatch = true
    if (timeValid && (cp.category_id || cp.product_id)) {
      scopeMatch = cart.some((c) => {
        if (cp.product_id && c.product_id === cp.product_id) return true
        if (cp.category_id) {
          const p = c.product as unknown as
            | { category_id: string | null; category: { parent_id: string | null } | null }
            | null
          return p?.category_id === cp.category_id || p?.category?.parent_id === cp.category_id
        }
        return false
      })
    }
    if (timeValid && scopeMatch) {
      discount = Math.round((subtotal * cp.discount_pct) / 100)
      couponCode = cp.code
    }
  }

  const shipping = subtotal >= 999 ? 0 : 99
  const total = subtotal + shipping - discount
  if (total <= 0) return res.status(400).json({ error: 'Invalid order total' })

  // Persist the delivery address
  let addressId: string | null = null
  if (address?.line1) {
    const { data: addr } = await supabase
      .from('addresses')
      .insert({
        user_id: userId,
        line1: address.line1,
        line2: address.line2 ?? null,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        country: address.country ?? 'India',
      })
      .select('id')
      .single()
    addressId = addr?.id ?? null
  }

  // Internal order — awaiting payment
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      user_id: userId,
      address_id: addressId,
      status: 'placed',
      total_amount: total,
      discount_amount: discount,
      coupon_applied: couponCode,
    })
    .select('id')
    .single()
  if (orderErr) return res.status(400).json({ error: orderErr.message })

  await supabase.from('order_items').insert(items.map((i) => ({ order_id: order.id, ...i })))
  if (couponCode) {
    await supabase.rpc('increment_coupon_usage', { code: couponCode })
  }

  const rzpOrder = await razorpay.orders.create({
    amount: Math.round(total * 100),
    currency: 'INR',
    receipt: order.id,
  })

  res.json({
    razorpay_order_id: rzpOrder.id,
    amount: rzpOrder.amount,
    currency: rzpOrder.currency,
    order_id: order.id,
  })
}

export async function placeOrder(req: AuthRequest, res: Response) {
  const { address_id, items, coupon_code, total_amount, discount_amount = 0 } = req.body

  if (!items?.length) return res.status(400).json({ error: 'Order must have at least one item' })

  // Validate stock for all items in a single query
  const variantIds: string[] = items.map((i: { variant_id: string }) => i.variant_id)
  const { data: variants } = await supabase
    .from('variants')
    .select('id, quantity')
    .in('id', variantIds)

  for (const item of items as { variant_id: string; quantity: number }[]) {
    const v = variants?.find((x) => x.id === item.variant_id)
    if (!v || v.quantity < item.quantity) {
      return res.status(400).json({ error: `Insufficient stock for variant ${item.variant_id}` })
    }
  }

  // Create order
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      user_id: req.user!.id,
      address_id,
      status: 'placed',
      total_amount,
      discount_amount,
      coupon_applied: coupon_code || null,
    })
    .select()
    .single()

  if (orderErr) return res.status(400).json({ error: orderErr.message })

  // Insert order items
  const orderItems = (items as { product_id: string; variant_id: string; quantity: number; unit_price: number }[]).map((i) => ({
    order_id: order.id,
    product_id: i.product_id,
    variant_id: i.variant_id,
    quantity: i.quantity,
    unit_price: i.unit_price,
  }))

  await supabase.from('order_items').insert(orderItems)

  // Coupon usage
  if (coupon_code) {
    await supabase.rpc('increment_coupon_usage', { code: coupon_code })
  }

  res.status(201).json(order)
}

export async function verifyPayment(req: AuthRequest, res: Response) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id } = req.body

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex')

  if (expected !== razorpay_signature) {
    return res.status(400).json({ error: 'Payment signature mismatch' })
  }

  const { data: order, error } = await supabase
    .from('orders')
    .update({
      status: 'confirmed',
      razorpay_order_id,
      razorpay_payment_id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', order_id)
    .eq('user_id', req.user!.id)
    .select('*, order_items(id, variant_id, quantity)')
    .single()

  if (error) return res.status(400).json({ error: error.message })

  // Decrement stock atomically via RPC
  for (const item of order.order_items as { variant_id: string; quantity: number }[]) {
    await supabase.rpc('decrement_variant_stock', {
      variant_id: item.variant_id,
      qty: item.quantity,
    })
  }

  // Clear customer cart after successful payment
  await supabase.from('cart_items').delete().eq('user_id', req.user!.id)
  // Non-blocking notifications
  notifyAdminOrderPlaced(order)

  res.json({ success: true, order })
}

export async function getOrders(req: AuthRequest, res: Response) {
  const { status, userId, page = '1', limit = '20' } = req.query

  let query = supabase
    .from('orders')
    .select(orderSelect, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((+page - 1) * +limit, +page * +limit - 1)

  // Customers see only their orders; staff may scope to one customer via userId.
  if (req.user!.role === 'customer') {
    query = query.eq('user_id', req.user!.id)
  } else if (userId) {
    query = query.eq('user_id', userId as string)
  }

  if (status) query = query.eq('status', status as string)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ error: error.message })

  res.json({
    data,
    count,
    total: count,
    page: +page,
    limit: +limit,
    totalPages: Math.ceil((count ?? 0) / +limit),
  })
}

export async function getOrderById(req: AuthRequest, res: Response) {
  let query = supabase
    .from('orders')
    .select(orderSelect)
    .eq('id', req.params.id)

  if (req.user!.role === 'customer') {
    query = query.eq('user_id', req.user!.id)
  }

  const { data, error } = await query.single()
  if (error) return res.status(404).json({ error: 'Order not found' })
  res.json(data)
}

export async function updateOrderStatus(req: AuthRequest, res: Response) {
  if (!['admin', 'employee'].includes(req.user!.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const { status } = req.body
  const { id } = req.params

  const { data: current } = await supabase
    .from('orders')
    .select('status, user_id, razorpay_payment_id, total_amount')
    .eq('id', id)
    .single()

  if (!current) return res.status(404).json({ error: 'Order not found' })

  if (!VALID_ORDER_TRANSITIONS[current.status as OrderStatus]?.includes(status)) {
    return res.status(400).json({
      error: `Cannot transition from ${current.status} to ${status}`,
      allowed: VALID_ORDER_TRANSITIONS[current.status as OrderStatus],
    })
  }

  // Issue the money back through Razorpay before marking the order refunded.
  if (status === 'refunded' && current.razorpay_payment_id) {
    try {
      await razorpay.payments.refund(current.razorpay_payment_id, {
        amount: Math.round(Number(current.total_amount) * 100),
      })
    } catch (err) {
      return res.status(502).json({
        error: err instanceof Error ? err.message : 'Razorpay refund failed',
      })
    }
  }

  const refundPatch = status === 'refunded' ? { refund_status: 'completed' } : {}
  const { data, error } = await supabase
    .from('orders')
    .update({ status, ...refundPatch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })

  notifyCustomerStatusUpdate(current.user_id, id, status)

  res.json(data)
}

// Customer asks for a refund on a paid order. Records the request; an admin
// then transitions the order to 'refunded', which issues the Razorpay refund.
export async function requestRefund(req: AuthRequest, res: Response) {
  const reason = (req.body?.reason ?? '').toString().trim()
  if (!reason) {
    return res.status(400).json({ error: 'Please add a reason for the refund request' })
  }

  let query = supabase
    .from('orders')
    .select('status, refund_status, user_id')
    .eq('id', req.params.id)
  if (req.user!.role === 'customer') query = query.eq('user_id', req.user!.id)

  const { data: current } = await query.single()
  if (!current) return res.status(404).json({ error: 'Order not found' })

  const refundable: OrderStatus[] = ['confirmed', 'processing', 'shipped', 'delivered']
  if (!refundable.includes(current.status as OrderStatus)) {
    return res.status(400).json({ error: `A ${current.status} order cannot be refunded` })
  }
  if (current.refund_status === 'requested' || current.refund_status === 'completed') {
    return res.status(400).json({ error: 'A refund has already been requested for this order' })
  }

  const { data, error } = await supabase
    .from('orders')
    .update({
      refund_status: 'requested',
      refund_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select(orderSelect)
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
}

export async function cancelOrder(req: AuthRequest, res: Response) {
  let query = supabase
    .from('orders')
    .select('status, user_id')
    .eq('id', req.params.id)

  if (req.user!.role === 'customer') query = query.eq('user_id', req.user!.id)

  const { data: current } = await query.single()
  if (!current) return res.status(404).json({ error: 'Order not found' })

  if (!VALID_ORDER_TRANSITIONS[current.status as OrderStatus]?.includes('cancelled')) {
    return res.status(400).json({ error: `Cannot cancel an order with status ${current.status}` })
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })

  notifyCustomerStatusUpdate(current.user_id, req.params.id, 'cancelled')
  res.json(data)
}

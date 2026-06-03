import { Response } from 'express'
import { supabase } from '../supabase'
import { AuthRequest } from '../middleware/auth'
import { notifyCustomerStatusUpdate } from '../services/notificationService'
import {
  assignAwb,
  cancelByAwbs,
  checkServiceability,
  createAdhocOrder,
  generateInvoice,
  generateLabel,
  generateManifest,
  getPickupLocation,
  getPickupPincode,
  trackByAwb,
  type CreateAdhocOrderPayload,
} from '../services/shiprocketService'
import type { OrderStatus } from '../types'

const ORDER_SELECT = `
  *,
  user:profiles!user_id(id, name, phone),
  address:addresses(*),
  order_items(
    id, quantity, unit_price,
    product:products(id, title, type),
    variant:variants(id, color, size, sku)
  )
`

const WEIGHT_KG: Record<string, number> = {
  saree: 0.5,
  jewellery: 0.2,
}

function defaultWeightKg(
  items: Array<{ quantity: number; product?: { type?: string } | null }>
): number {
  let total = 0
  for (const item of items) {
    const type = item.product?.type ?? 'saree'
    total += (WEIGHT_KG[type] ?? 0.5) * item.quantity
  }
  return Math.max(0.1, Math.round(total * 100) / 100)
}

async function loadOrderForShipment(orderId: string, userId?: string) {
  let query = supabase.from('orders').select(ORDER_SELECT).eq('id', orderId)
  if (userId) query = query.eq('user_id', userId)
  const { data, error } = await query.single()
  if (error || !data) return null
  return data
}

async function getCustomerEmail(userId: string): Promise<string> {
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error || !data.user?.email) return 'customer@yuvaranisilks.in'
  return data.user.email
}

function buildAdhocPayload(
  order: Awaited<ReturnType<typeof loadOrderForShipment>> & object,
  email: string,
  weight: number
): CreateAdhocOrderPayload {
  const addr = order.address as {
    line1: string
    line2?: string
    city: string
    state: string
    pincode: string
    country?: string
  }
  const user = order.user as { name: string; phone?: string }
  const nameParts = (user?.name ?? 'Customer').trim().split(/\s+/)
  const firstName = nameParts[0] ?? 'Customer'
  const lastName = nameParts.slice(1).join(' ') || '.'

  const items = (order.order_items ?? []) as Array<{
    quantity: number
    unit_price: number
    product?: { title?: string; type?: string } | null
    variant?: { sku?: string; color?: string; size?: string } | null
  }>

  return {
    order_id: order.id.slice(0, 8).toUpperCase(),
    order_date: new Date(order.created_at).toISOString().slice(0, 16).replace('T', ' '),
    pickup_location: getPickupLocation(),
    billing_customer_name: firstName,
    billing_last_name: lastName,
    billing_address: addr.line1,
    billing_address_2: addr.line2 ?? undefined,
    billing_city: addr.city,
    billing_pincode: addr.pincode,
    billing_state: addr.state,
    billing_country: addr.country ?? 'India',
    billing_email: email,
    billing_phone: user?.phone ?? '9999999999',
    shipping_is_billing: true,
    order_items: items.map((item, idx) => ({
      name: item.product?.title ?? `Item ${idx + 1}`,
      sku: item.variant?.sku ?? `SKU-${idx + 1}`,
      units: item.quantity,
      selling_price: Number(item.unit_price),
    })),
    payment_method: 'Prepaid',
    sub_total: Number(order.total_amount),
    length: 20,
    breadth: 15,
    height: 5,
    weight,
  }
}

export async function checkServiceabilityHandler(req: AuthRequest, res: Response) {
  const { orderId, weight: weightOverride } = req.body as {
    orderId?: string
    weight?: number
  }
  if (!orderId) return res.status(400).json({ error: 'orderId is required' })

  const order = await loadOrderForShipment(orderId)
  if (!order) return res.status(404).json({ error: 'Order not found' })
  if (!order.address) {
    return res.status(400).json({ error: 'Order has no delivery address' })
  }

  const addr = order.address as { pincode: string }
  const items = (order.order_items ?? []) as Array<{ quantity: number; product?: { type?: string } }>
  const weight = weightOverride ?? defaultWeightKg(items)

  const couriers = await checkServiceability({
    pickup_postcode: getPickupPincode(),
    delivery_postcode: addr.pincode,
    weight,
    cod: 0,
    order_id: order.shiprocket_order_id ?? order.id.slice(0, 8),
  })

  res.json({ couriers, weight, delivery_pincode: addr.pincode })
}

export async function createShipmentHandler(req: AuthRequest, res: Response) {
  const { orderId, courier_id, weight: weightOverride } = req.body as {
    orderId?: string
    courier_id?: number
    weight?: number
  }
  if (!orderId || courier_id == null) {
    return res.status(400).json({ error: 'orderId and courier_id are required' })
  }

  const order = await loadOrderForShipment(orderId)
  if (!order) return res.status(404).json({ error: 'Order not found' })
  if (order.shiprocket_awb) {
    return res.status(400).json({ error: 'Shipment already created for this order' })
  }
  if (!order.address) {
    return res.status(400).json({ error: 'Order has no delivery address' })
  }

  const allowedStatuses = ['confirmed', 'processing']
  if (!allowedStatuses.includes(order.status)) {
    return res.status(400).json({
      error: `Cannot ship order with status "${order.status}". Order must be confirmed first.`,
    })
  }

  const items = (order.order_items ?? []) as Array<{ quantity: number; product?: { type?: string } }>
  const weight = weightOverride ?? defaultWeightKg(items)
  const email = await getCustomerEmail(order.user_id)
  const payload = buildAdhocPayload(order, email, weight)

  const created = await createAdhocOrder(payload)
  const awbResult = await assignAwb(created.shipment_id, courier_id)

  const trackingUrl = `https://shiprocket.co/tracking/${awbResult.awb_code}`

  const { data: updated, error } = await supabase
    .from('orders')
    .update({
      shiprocket_order_id: String(created.order_id),
      shiprocket_shipment_id: String(created.shipment_id),
      shiprocket_awb: awbResult.awb_code,
      shiprocket_courier_id: courier_id,
      shiprocket_courier_name: awbResult.courier_name,
      tracking_url: trackingUrl,
      shipment_status: 'AWB ASSIGNED',
      status: 'processing',
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .select(ORDER_SELECT)
    .single()

  if (error) return res.status(500).json({ error: error.message })

  notifyCustomerStatusUpdate(order.user_id, orderId, 'processing')

  res.json({
    order: updated,
    awb: awbResult.awb_code,
    courier_name: awbResult.courier_name,
    tracking_url: trackingUrl,
    shiprocket_order_id: created.order_id,
    shiprocket_shipment_id: created.shipment_id,
  })
}

type ShipmentOrder = NonNullable<Awaited<ReturnType<typeof loadOrderForShipment>>>

async function requireShipment(
  orderId: string
): Promise<{ ok: true; order: ShipmentOrder } | { ok: false; error: string; status: number }> {
  const order = await loadOrderForShipment(orderId)
  if (!order) return { ok: false, error: 'Order not found', status: 404 }
  if (!order.shiprocket_shipment_id) {
    return { ok: false, error: 'No Shiprocket shipment on this order', status: 400 }
  }
  return { ok: true, order }
}

export async function getLabelHandler(req: AuthRequest, res: Response) {
  const { orderId } = req.params
  const loaded = await requireShipment(orderId)
  if (!loaded.ok) return res.status(loaded.status).json({ error: loaded.error })

  const shipmentId = Number(loaded.order.shiprocket_shipment_id)
  if (!Number.isFinite(shipmentId)) {
    return res.status(400).json({ error: 'Invalid Shiprocket shipment id' })
  }
  const labelUrl = await generateLabel([shipmentId])

  await supabase
    .from('orders')
    .update({ label_url: labelUrl, updated_at: new Date().toISOString() })
    .eq('id', orderId)

  res.json({ label_url: labelUrl })
}

export async function getInvoiceHandler(req: AuthRequest, res: Response) {
  const { orderId } = req.params
  const loaded = await requireShipment(orderId)
  if (!loaded.ok) return res.status(loaded.status).json({ error: loaded.error })

  const srOrderId = Number(loaded.order.shiprocket_order_id)
  if (!Number.isFinite(srOrderId)) {
    return res.status(400).json({ error: 'Invalid Shiprocket order id' })
  }
  const invoiceUrl = await generateInvoice([srOrderId])

  await supabase
    .from('orders')
    .update({ invoice_url: invoiceUrl, updated_at: new Date().toISOString() })
    .eq('id', orderId)

  res.json({ invoice_url: invoiceUrl })
}

export async function getManifestHandler(req: AuthRequest, res: Response) {
  const { orderId } = req.params
  const loaded = await requireShipment(orderId)
  if (!loaded.ok) return res.status(loaded.status).json({ error: loaded.error })

  const shipmentId = Number(loaded.order.shiprocket_shipment_id)
  if (!Number.isFinite(shipmentId)) {
    return res.status(400).json({ error: 'Invalid Shiprocket shipment id' })
  }
  const manifestUrl = await generateManifest([shipmentId])

  await supabase
    .from('orders')
    .update({ manifest_url: manifestUrl, updated_at: new Date().toISOString() })
    .eq('id', orderId)

  res.json({ manifest_url: manifestUrl })
}

export async function trackShipmentHandler(req: AuthRequest, res: Response) {
  const { orderId } = req.params
  const userId = req.user!.role === 'customer' ? req.user!.id : undefined
  const order = await loadOrderForShipment(orderId, userId)
  if (!order) return res.status(404).json({ error: 'Order not found' })
  if (!order.shiprocket_awb) {
    return res.status(400).json({ error: 'No AWB assigned yet' })
  }

  const tracking = await trackByAwb(order.shiprocket_awb)
  res.json({ tracking, awb: order.shiprocket_awb, tracking_url: order.tracking_url })
}

export async function cancelShipmentHandler(req: AuthRequest, res: Response) {
  const { orderId } = req.params
  const loaded = await requireShipment(orderId)
  if (!loaded.ok) return res.status(loaded.status).json({ error: loaded.error })

  if (['shipped', 'delivered'].includes(loaded.order.status)) {
    return res.status(400).json({ error: 'Cannot cancel shipment after it has been shipped' })
  }

  const awb = loaded.order.shiprocket_awb
  if (!awb) {
    return res.status(400).json({ error: 'No AWB on this order' })
  }
  await cancelByAwbs([awb])

  const { data, error } = await supabase
    .from('orders')
    .update({
      shiprocket_order_id: null,
      shiprocket_shipment_id: null,
      shiprocket_awb: null,
      shiprocket_courier_id: null,
      shiprocket_courier_name: null,
      tracking_url: null,
      shipment_status: 'CANCELLED',
      label_url: null,
      invoice_url: null,
      manifest_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .select(ORDER_SELECT)
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ order: data, message: 'Shipment cancelled on Shiprocket' })
}

function mapWebhookToOrderStatus(currentStatus: string): OrderStatus | null {
  const s = currentStatus.toUpperCase()
  if (s.includes('DELIVERED')) return 'delivered'
  if (
    s.includes('PICKED') ||
    s.includes('TRANSIT') ||
    s.includes('OUT FOR DELIVERY') ||
    s.includes('SHIPPED')
  ) {
    return 'shipped'
  }
  return null
}

export async function webhookHandler(req: AuthRequest, res: Response) {
  const token = req.headers['x-api-key'] as string | undefined
  const expected = process.env.SHIPROCKET_WEBHOOK_TOKEN
  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'Invalid webhook token' })
  }

  const body = req.body as {
    awb?: string
    current_status?: string
    shipment_status?: string
    etd?: string
    scans?: unknown
  }

  const awb = body.awb
  const shipmentStatus = body.current_status ?? body.shipment_status ?? ''
  if (!awb) {
    return res.status(200).json({ ok: true, skipped: 'no awb' })
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id, user_id, status')
    .eq('shiprocket_awb', awb)
    .maybeSingle()

  if (!order) {
    return res.status(200).json({ ok: true, skipped: 'order not found' })
  }

  const patch: Record<string, unknown> = {
    shipment_status: shipmentStatus,
    updated_at: new Date().toISOString(),
  }

  if (body.etd) {
    patch.expected_delivery_date = body.etd.slice(0, 10)
  }

  const newStatus = mapWebhookToOrderStatus(shipmentStatus)
  if (newStatus && newStatus !== order.status) {
    patch.status = newStatus
  }

  await supabase.from('orders').update(patch).eq('id', order.id)

  if (newStatus && newStatus !== order.status) {
    notifyCustomerStatusUpdate(order.user_id, order.id, newStatus)
  }

  res.json({ ok: true })
}

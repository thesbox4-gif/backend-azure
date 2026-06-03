import { Response } from 'express'
import { supabase } from '../supabase'
import { AuthRequest } from '../middleware/auth'

// Record an in-person ("offline") sale attributed to the current employee/admin.
export async function recordOfflineSale(req: AuthRequest, res: Response) {
  const { variant_id } = req.body
  const qty = parseInt(req.body.quantity, 10)
  const customer_name = req.body.customer_name?.toString().trim() || null
  const customer_phone = req.body.customer_phone?.toString().trim() || null

  if (!variant_id || !qty || qty <= 0) {
    return res.status(400).json({ error: 'variant_id and a positive quantity are required' })
  }

  const { data: variant, error: vErr } = await supabase
    .from('variants')
    .select('id, quantity, product_id, product:products(base_price, discount_pct)')
    .eq('id', variant_id)
    .single()

  if (vErr || !variant) return res.status(404).json({ error: 'Variant not found' })
  if (variant.quantity < qty) {
    return res.status(400).json({ error: `Only ${variant.quantity} in stock` })
  }

  const product = variant.product as unknown as { base_price: number; discount_pct: number } | null
  const base = Number(product?.base_price ?? 0)
  const disc = Number(product?.discount_pct ?? 0)
  const unit_price = Math.round(base * (1 - disc / 100))

  const { data: sale, error: sErr } = await supabase
    .from('offline_sales')
    .insert({
      variant_id,
      product_id: variant.product_id,
      sold_by: req.user!.id,
      quantity: qty,
      unit_price,
      customer_name,
      customer_phone,
    })
    .select()
    .single()

  if (sErr) return res.status(400).json({ error: sErr.message })

  // Atomically decrement stock and bump sold_count.
  await supabase.rpc('decrement_variant_stock', { variant_id, qty })

  res.status(201).json(sale)
}

// List offline sales. Employees see only their own; admins see all.
export async function getOfflineSales(req: AuthRequest, res: Response) {
  const { page = '1', limit = '20', soldBy } = req.query
  const soldByValue =
    typeof soldBy === 'string' ? soldBy : Array.isArray(soldBy) ? soldBy[0] : undefined

  let query = supabase
    .from('offline_sales')
    .select(
      `*,
       product:products(id, title),
       variant:variants(id, color, size, sku),
       seller:profiles!sold_by(id, name)`,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range((+page - 1) * +limit, +page * +limit - 1)

  if (req.user!.role === 'employee') {
    query = query.eq('sold_by', req.user!.id)
  } else if (soldByValue) {
    query = query.eq('sold_by', soldByValue)
  }

  const { data, error, count } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json({ data, count, page: +page, limit: +limit })
}

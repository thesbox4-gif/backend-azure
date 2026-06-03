import { Router, Response } from 'express'
import { body, validationResult } from 'express-validator'
import { supabase } from '../supabase'
import { authenticate, requireRole, requireApprovedEmployee, AuthRequest } from '../middleware/auth'

const router = Router()

router.get('/product/:productId', async (req, res) => {
  const { data, error } = await supabase
    .from('variants')
    .select('*')
    .eq('product_id', req.params.productId)
    .order('created_at')

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post(
  '/',
  authenticate,
  requireApprovedEmployee,
  [
    body('product_id').isUUID(),
    body('quantity').isInt({ min: 0 }),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const { product_id, color, size, quantity, sku, image_url } = req.body

    const { data, error } = await supabase
      .from('variants')
      .insert({ product_id, color, size, quantity, sku, image_url })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.status(201).json(data)
  }
)

router.put('/product/:productId/bulk', authenticate, requireApprovedEmployee, async (req: AuthRequest, res: Response) => {
  const { variants } = req.body as { variants: Array<{ color: string; size: string; quantity: number; sku?: string; image_url?: string }> }

  if (!Array.isArray(variants)) return res.status(400).json({ error: 'variants must be an array' })

  const productId = req.params.productId
  // Empty string is not nullish — `??` would let `sku: ''` through, so every
  // row would share the same conflict key. Treat blank as "generate one".
  const skuFor = (v: { color: string; size: string; sku?: string }) => {
    const provided = (v.sku ?? '').trim()
    if (provided) return provided
    return `${productId.slice(0, 6)}-${v.color}-${v.size || 'na'}`
      .toLowerCase()
      .replace(/\s+/g, '-')
  }

  // Dedupe by sku — a single ON CONFLICT upsert cannot affect a row twice.
  const bySku = new Map<string, Record<string, unknown>>()
  for (const v of variants) {
    const sku = skuFor(v)
    bySku.set(sku, {
      product_id: productId,
      color: v.color,
      size: v.size,
      quantity: v.quantity,
      sku,
      image_url: v.image_url ?? null,
    })
  }
  const rows = [...bySku.values()]

  const { data, error } = await supabase
    .from('variants')
    .upsert(rows, { onConflict: 'sku' })
    .select()

  if (error) return res.status(400).json({ error: error.message })

  // Replace the variant set: drop rows no longer present so an edited product
  // does not keep stale variants. Stale stock would otherwise be re-summed on
  // the next edit and inflate the quantity each time.
  const keepSkus = new Set(rows.map((r) => r.sku as string))
  const { data: existing } = await supabase
    .from('variants')
    .select('id, sku')
    .eq('product_id', productId)
  const staleIds = (existing ?? [])
    .filter((v) => !keepSkus.has(v.sku))
    .map((v) => v.id)
  if (staleIds.length > 0) {
    await supabase.from('variants').delete().in('id', staleIds)
  }

  res.json(data)
})

router.patch('/:id', authenticate, requireApprovedEmployee, async (req: AuthRequest, res: Response) => {
  const { quantity, color, size, image_url } = req.body
  const updates: Record<string, unknown> = {}
  if (quantity !== undefined) updates.quantity = quantity
  if (color) updates.color = color
  if (size) updates.size = size
  if (image_url !== undefined) updates.image_url = image_url

  const { data, error } = await supabase
    .from('variants')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { error } = await supabase.from('variants').delete().eq('id', req.params.id)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ success: true })
})

export default router

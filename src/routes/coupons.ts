import { Router, Response } from 'express'
import { supabase } from '../supabase'
import { authenticate, requireRole, AuthRequest } from '../middleware/auth'

const router = Router()

// True if the user's cart holds at least one item the coupon's scope covers.
// A coupon with no category_id/product_id is unscoped → always true.
async function cartMatchesCouponScope(
  userId: string,
  coupon: { category_id: string | null; product_id: string | null }
): Promise<boolean> {
  if (!coupon.category_id && !coupon.product_id) return true

  const { data: cart } = await supabase
    .from('cart_items')
    .select('product_id, product:products(category_id, category:categories(parent_id))')
    .eq('user_id', userId)

  for (const c of cart ?? []) {
    if (coupon.product_id && c.product_id === coupon.product_id) return true
    if (coupon.category_id) {
      const product = c.product as unknown as
        | { category_id: string | null; category: { parent_id: string | null } | null }
        | null
      // Match the product's own category, or a root category whose
      // sub-category the product belongs to.
      if (product?.category_id === coupon.category_id) return true
      if (product?.category?.parent_id === coupon.category_id) return true
    }
  }
  return false
}

// Validate a coupon code against the signed-in user's cart.
router.get('/validate/:code', authenticate, async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('coupons')
    .select('code, discount_pct, starts_at, expires_at, max_uses, used_count, active, category_id, product_id')
    .eq('code', req.params.code.toUpperCase())
    .single()

  if (error || !data) return res.status(404).json({ error: 'Invalid coupon code' })
  if (!data.active) return res.status(400).json({ error: 'Coupon is not active' })
  if (data.starts_at && new Date(data.starts_at) > new Date()) {
    return res.status(400).json({ error: 'Coupon is not active yet' })
  }
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Coupon has expired' })
  }
  if (data.max_uses && data.used_count >= data.max_uses) {
    return res.status(400).json({ error: 'Coupon usage limit reached' })
  }

  const matches = await cartMatchesCouponScope(req.user!.id, data)
  if (!matches) {
    return res.status(400).json({ error: 'Coupon does not apply to the items in your bag' })
  }

  res.json({ code: data.code, discount_pct: data.discount_pct })
})

// Admin CRUD
router.get('/', authenticate, requireRole('admin'), async (_req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('coupons')
    .select('*, category:categories(id, name), product:products(id, title)')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { code, discount_pct, max_uses, starts_at, expires_at, category_id, product_id } = req.body

  const { data, error } = await supabase
    .from('coupons')
    .insert({
      code: code.toUpperCase(),
      discount_pct,
      max_uses: max_uses || null,
      starts_at: starts_at || null,
      expires_at: expires_at || null,
      category_id: category_id || null,
      product_id: product_id || null,
    })
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.status(201).json(data)
})

router.patch('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { active, discount_pct, max_uses, starts_at, expires_at, category_id, product_id } = req.body
  const updates: Record<string, unknown> = {}
  if (active !== undefined) updates.active = active
  if (discount_pct !== undefined) updates.discount_pct = discount_pct
  if (max_uses !== undefined) updates.max_uses = max_uses
  if (starts_at !== undefined) updates.starts_at = starts_at
  if (expires_at !== undefined) updates.expires_at = expires_at
  if (category_id !== undefined) updates.category_id = category_id
  if (product_id !== undefined) updates.product_id = product_id

  const { data, error } = await supabase
    .from('coupons')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

export default router

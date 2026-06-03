import { Response } from 'express'
import { supabase } from '../supabase'
import { AuthRequest } from '../middleware/auth'

const wishlistSelect = `
  id, created_at,
  product:products(id, title, base_price, discount_pct, type,
    images:product_images(url, is_primary, color),
    variants(id, color, size, quantity))
`

export async function getWishlist(req: AuthRequest, res: Response) {
  const { data, error } = await supabase
    .from('wishlist_items')
    .select(wishlistSelect)
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  // Storefront expects { data: Product[] } — unwrap the joined product.
  res.json({ data: (data ?? []).map((w: any) => w.product).filter(Boolean) })
}

export async function addToWishlist(req: AuthRequest, res: Response) {
  const { product_id } = req.body

  const { data, error } = await supabase
    .from('wishlist_items')
    .upsert({ user_id: req.user!.id, product_id }, { onConflict: 'user_id,product_id', ignoreDuplicates: true })
    .select(wishlistSelect)
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.status(201).json(data)
}

export async function removeFromWishlist(req: AuthRequest, res: Response) {
  const { error } = await supabase
    .from('wishlist_items')
    .delete()
    .eq('product_id', req.params.productId)
    .eq('user_id', req.user!.id)

  if (error) return res.status(400).json({ error: error.message })
  res.json({ success: true })
}

export async function toggleWishlist(req: AuthRequest, res: Response) {
  const { product_id } = req.body

  const { data: existing } = await supabase
    .from('wishlist_items')
    .select('id')
    .eq('user_id', req.user!.id)
    .eq('product_id', product_id)
    .single()

  if (existing) {
    await supabase.from('wishlist_items').delete().eq('id', existing.id)
    return res.json({ added: false })
  }

  await supabase.from('wishlist_items').insert({ user_id: req.user!.id, product_id })
  res.json({ added: true })
}

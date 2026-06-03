import { Response } from 'express'
import { supabase } from '../supabase'
import { AuthRequest } from '../middleware/auth'

const cartSelect = `
  id, quantity, product_id, variant_id,
  product:products(id, title, base_price, discount_pct, type,
    images:product_images(url, is_primary, color)),
  variant:variants(id, color, size, quantity, sku, image_url)
`

// The storefront always works with the whole cart, so every endpoint
// responds with the full, current list under { items }.
async function fetchCart(userId: string) {
  const { data } = await supabase
    .from('cart_items')
    .select(cartSelect)
    .eq('user_id', userId)
    .order('id', { ascending: true })
  return data ?? []
}

export async function getCart(req: AuthRequest, res: Response) {
  res.json({ items: await fetchCart(req.user!.id) })
}

export async function addToCart(req: AuthRequest, res: Response) {
  const { product_id, variant_id, quantity = 1 } = req.body

  const { data: variant } = await supabase
    .from('variants')
    .select('quantity')
    .eq('id', variant_id)
    .single()

  if (!variant || variant.quantity < 1) {
    return res.status(400).json({ error: 'Item out of stock' })
  }

  const { error } = await supabase
    .from('cart_items')
    .upsert(
      { user_id: req.user!.id, product_id, variant_id, quantity },
      { onConflict: 'user_id,variant_id', ignoreDuplicates: false }
    )

  if (error) return res.status(400).json({ error: error.message })
  res.status(201).json({ items: await fetchCart(req.user!.id) })
}

export async function updateCartItem(req: AuthRequest, res: Response) {
  const { quantity } = req.body
  if (!quantity || quantity < 1) {
    return res.status(400).json({ error: 'Quantity must be >= 1' })
  }

  const { error } = await supabase
    .from('cart_items')
    .update({ quantity })
    .eq('id', req.params.id)
    .eq('user_id', req.user!.id)

  if (error) return res.status(400).json({ error: error.message })
  res.json({ items: await fetchCart(req.user!.id) })
}

export async function removeFromCart(req: AuthRequest, res: Response) {
  const { error } = await supabase
    .from('cart_items')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user!.id)

  if (error) return res.status(400).json({ error: error.message })
  res.json({ items: await fetchCart(req.user!.id) })
}

export async function clearCart(req: AuthRequest, res: Response) {
  await supabase.from('cart_items').delete().eq('user_id', req.user!.id)
  res.json({ items: [] })
}

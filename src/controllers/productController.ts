import { Request, Response } from 'express'
import { supabase } from '../supabase'
import { AuthRequest } from '../middleware/auth'

const productSelect = `
  *,
  category:categories(id, name, slug),
  images:product_images(id, url, color, is_primary, display_order, alt_text),
  variants(id, color, size, quantity, sold_count, sku, image_url)
`

export async function getAllProducts(req: Request, res: Response) {
  const { type, category, search, minPrice, maxPrice, page = '1', limit = '20', published, sort } = req.query

  let query = supabase
    .from('products')
    .select(productSelect, { count: 'exact' })

  if (published !== 'all') query = query.eq('published', true)
  if (type) {
    // Accepts one or more (comma-separated) product types.
    const typeArr = (type as string).split(',').map((t) => t.trim()).filter(Boolean)
    query = query.in('type', typeArr)
  }
  if (category) {
    // Accepts one or more (comma-separated) category ids. A top-level category
    // match also includes products in its sub-categories.
    const catParam = (category as string).split(',').map((c) => c.trim()).filter(Boolean)
    const { data: subCats } = await supabase
      .from('categories')
      .select('id')
      .in('parent_id', catParam)
    const catIds = [...catParam, ...(subCats ?? []).map((c) => c.id)]
    query = query.in('category_id', catIds)
  }
  if (search) query = query.ilike('title', `%${search}%`)
  if (minPrice) query = query.gte('base_price', +minPrice)
  if (maxPrice) query = query.lte('base_price', +maxPrice)

  if (sort === 'price_asc') query = query.order('base_price', { ascending: true })
  else if (sort === 'price_desc') query = query.order('base_price', { ascending: false })
  else query = query.order('created_at', { ascending: false })

  query = query.range((+page - 1) * +limit, +page * +limit - 1)

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

export async function getProductById(req: Request, res: Response) {
  const { data, error } = await supabase
    .from('products')
    .select(productSelect)
    .eq('id', req.params.id)
    .single()

  if (error) return res.status(404).json({ error: 'Product not found' })
  res.json(data)
}

export async function createProduct(req: AuthRequest, res: Response) {
  const { title, description, type, category_id, base_price, discount_pct, coupon_code, coupon_disc } = req.body

  const { data, error } = await supabase
    .from('products')
    .insert({
      title,
      description,
      type,
      category_id: category_id || null,
      base_price,
      discount_pct: discount_pct ?? 0,
      coupon_code: coupon_code || null,
      coupon_disc: coupon_disc || null,
      created_by: req.user!.id,
      published: false,
    })
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.status(201).json(data)
}

export async function updateProduct(req: AuthRequest, res: Response) {
  const allowed = ['title', 'description', 'type', 'category_id', 'base_price', 'discount_pct', 'coupon_code', 'coupon_disc']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }

  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
}

export async function publishProduct(req: AuthRequest, res: Response) {
  const { data, error } = await supabase
    .from('products')
    .update({ published: true, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
}

export async function unpublishProduct(req: AuthRequest, res: Response) {
  const { data, error } = await supabase
    .from('products')
    .update({ published: false, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
}

export async function deleteProduct(req: AuthRequest, res: Response) {
  const { error } = await supabase.from('products').delete().eq('id', req.params.id)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ success: true })
}

export async function addProductImage(req: AuthRequest, res: Response) {
  const { url, alt_text, is_primary, color, display_order } = req.body
  const { product_id } = req.params

  if (is_primary) {
    await supabase
      .from('product_images')
      .update({ is_primary: false })
      .eq('product_id', product_id)
  }

  const { data, error } = await supabase
    .from('product_images')
    .insert({ product_id, url, alt_text, is_primary: !!is_primary, color, display_order: display_order ?? 0 })
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.status(201).json(data)
}

export async function deleteProductImage(req: AuthRequest, res: Response) {
  const { product_id, image_id } = req.params
  const { error } = await supabase
    .from('product_images')
    .delete()
    .eq('id', image_id)
    .eq('product_id', product_id)

  if (error) return res.status(400).json({ error: error.message })
  res.json({ success: true })
}

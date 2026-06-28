import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { query, queryOne, uuidParam, withTransaction, sql } from '../db'
import { AuthRequest } from '../middleware/auth'
import { scheduleBroadcast } from '../services/broadcastService'

function generateBarcode(): string {
  const now = new Date()
  const d = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const rand = String(Math.floor(10000 + Math.random() * 90000))
  return `YS-${d}-${rand}`
}

// Reproduces the Supabase embedded-resource shape:
//   { ...product, category:{id,name,slug}, images:[...], variants:[...] }
// via correlated FOR JSON subqueries. JSON_QUERY keeps nested arrays/objects
// as JSON (not escaped strings). Column alias `p` must be set by the caller.
const productJsonCols = `
  p.id, p.title, p.description, p.type, p.category_id, p.base_price, p.discount_pct,
  p.coupon_code, p.coupon_disc, p.published, p.barcode, p.barcode_image_url,
  p.rack_block, p.rack_row, p.rack_position,
  p.block, p.created_by, p.created_at, p.updated_at,
  JSON_QUERY((
    SELECT c.id, c.name, c.slug FROM dbo.categories c WHERE c.id = p.category_id
    FOR JSON PATH, INCLUDE_NULL_VALUES, WITHOUT_ARRAY_WRAPPER
  )) AS category,
  JSON_QUERY((
    SELECT pi.id, pi.url, pi.color, pi.is_primary, pi.display_order, pi.alt_text
    FROM dbo.product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order
    FOR JSON PATH, INCLUDE_NULL_VALUES
  )) AS images,
  JSON_QUERY((
    SELECT v.id, v.color, v.size, v.quantity, v.sold_count, v.sku, v.image_url
    FROM dbo.variants v WHERE v.product_id = p.id
    FOR JSON PATH, INCLUDE_NULL_VALUES
  )) AS variants`

// Each row comes back with category/images/variants as JSON strings (because we
// SELECT ... FOR JSON inside JSON_QUERY but read the outer row normally). Parse
// them so the response is real nested JSON, matching the old PostgREST output.
function parseProductRow(row: Record<string, unknown>) {
  return {
    ...row,
    published: !!row.published,
    block: !!row.block,
    category: row.category ? JSON.parse(row.category as string) : null,
    images: row.images ? JSON.parse(row.images as string) : [],
    variants: row.variants ? JSON.parse(row.variants as string) : [],
  }
}

export async function getAllProducts(req: Request, res: Response) {
  const { type, category, uncategorized, search, minPrice, maxPrice, page = '1', limit = '20', published, sort } = req.query

  const where: string[] = []
  const params: Record<string, unknown> = {}

  if (published !== 'all') where.push('p.published = 1')
  if (type) {
    const arr = (type as string).split(',').map((t) => t.trim()).filter(Boolean)
    where.push(`p.type IN (${arr.map((_, i) => `@type${i}`).join(',')})`)
    arr.forEach((t, i) => (params[`type${i}`] = t))
  }
  if (uncategorized === 'true') {
    // Products with no sub-category: either no category at all, or sitting directly
    // on a top-level root (which the Collections UI treats as "Uncategorized").
    where.push('(p.category_id IS NULL OR p.category_id IN (SELECT id FROM dbo.categories WHERE parent_id IS NULL))')
  }
  if (category) {
    const catParam = (category as string).split(',').map((c) => c.trim()).filter(Boolean)
    // top-level category match also includes its sub-categories
    const subs = await query<{ id: string }>(
      `SELECT id FROM dbo.categories WHERE parent_id IN (${catParam.map((_, i) => `@pc${i}`).join(',')})`,
      Object.fromEntries(catParam.map((c, i) => [`pc${i}`, uuidParam(c)]))
    )
    const catIds = [...catParam, ...subs.map((s) => s.id)]
    where.push(`p.category_id IN (${catIds.map((_, i) => `@cat${i}`).join(',')})`)
    catIds.forEach((c, i) => (params[`cat${i}`] = uuidParam(c)))
  }
  if (search) { where.push('p.title LIKE @search'); params.search = `%${search}%` }
  if (minPrice) { where.push('p.base_price >= @minPrice'); params.minPrice = +minPrice }
  if (maxPrice) { where.push('p.base_price <= @maxPrice'); params.maxPrice = +maxPrice }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const orderSql =
    sort === 'price_asc' ? 'ORDER BY p.base_price ASC'
    : sort === 'price_desc' ? 'ORDER BY p.base_price DESC'
    : 'ORDER BY p.created_at DESC'

  const offset = (+page - 1) * +limit
  params.offset = offset
  params.limit = +limit

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT ${productJsonCols}
     FROM dbo.products p ${whereSql} ${orderSql}
     OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      params
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM dbo.products p ${whereSql}`,
      params
    ),
  ])
  const count = countRow?.total ?? 0

  res.json({
    data: rows.map(parseProductRow),
    count,
    total: count,
    page: +page,
    limit: +limit,
    totalPages: Math.ceil(count / +limit),
  })
}

export async function getProductById(req: Request, res: Response) {
  const row = await queryOne(
    `SELECT ${productJsonCols} FROM dbo.products p WHERE p.id = @id`,
    { id: uuidParam(req.params.id) }
  )
  if (!row) return res.status(404).json({ error: 'Product not found' })
  res.json(parseProductRow(row))
}

export async function createProduct(req: AuthRequest, res: Response) {
  const {
    title, description, type, category_id, base_price, discount_pct,
    coupon_code, coupon_disc, barcode, barcode_image_url, block,
    rack_block, rack_row, rack_position,
  } = req.body
  const id = randomUUID()

  try {
    const data = await queryOne(
      `INSERT INTO dbo.products
         (id, title, description, type, category_id, base_price, discount_pct,
          coupon_code, coupon_disc, barcode, barcode_image_url,
          rack_block, rack_row, rack_position,
          block, created_by, published, created_at, updated_at)
       OUTPUT inserted.*
       VALUES
         (@id, @title, @description, @type, @category_id, @base_price, @discount_pct,
          @coupon_code, @coupon_disc, @barcode, @barcode_image_url,
          @rack_block, @rack_row, @rack_position,
          @block, @created_by, 0, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET())`,
      {
        id: uuidParam(id), title, description: description ?? null, type,
        category_id: uuidParam(category_id || null),
        base_price, discount_pct: discount_pct ?? 0,
        coupon_code: coupon_code || null, coupon_disc: coupon_disc || null,
        barcode: barcode?.toString().trim() || generateBarcode(),
        barcode_image_url: barcode_image_url?.toString().trim() || null,
        rack_block: rack_block?.toString().trim() || null,
        rack_row: rack_row?.toString().trim() || null,
        rack_position: rack_position?.toString().trim() || null,
        block: block === true || block === 1 || block === '1' || block === 'true' ? 1 : 0,
        created_by: uuidParam(req.user!.id),
      }
    )
    res.status(201).json(data)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Create failed' })
  }
}

export async function updateProduct(req: AuthRequest, res: Response) {
  const allowed = [
    'title', 'description', 'type', 'category_id', 'base_price', 'discount_pct',
    'coupon_code', 'coupon_disc', 'barcode', 'barcode_image_url', 'block',
    'rack_block', 'rack_row', 'rack_position',
  ]
  const nullableStrings = new Set(['barcode', 'barcode_image_url', 'rack_block', 'rack_row', 'rack_position'])
  const sets: string[] = ['updated_at = SYSDATETIMEOFFSET()']
  const params: Record<string, unknown> = { id: uuidParam(req.params.id) }
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      sets.push(`${key} = @${key}`)
      if (key === 'category_id') params[key] = uuidParam(req.body[key] || null)
      else if (nullableStrings.has(key)) params[key] = req.body[key]?.toString().trim() || null
      else if (key === 'block') params[key] = req.body[key] === true || req.body[key] === 1 || req.body[key] === '1' || req.body[key] === 'true' ? 1 : 0
      else params[key] = req.body[key]
    }
  }

  try {
    const data = await queryOne(
      `UPDATE dbo.products SET ${sets.join(', ')} OUTPUT inserted.* WHERE id = @id`,
      params
    )
    if (!data) return res.status(404).json({ error: 'Product not found' })
    res.json(data)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Update failed' })
  }
}

export async function publishProduct(req: AuthRequest, res: Response) {
  const data = await queryOne<Record<string, unknown>>(
    'UPDATE dbo.products SET published = 1, updated_at = SYSDATETIMEOFFSET() OUTPUT inserted.* WHERE id = @id',
    { id: uuidParam(req.params.id) }
  )
  if (!data) return res.status(404).json({ error: 'Product not found' })

  scheduleBroadcast({
    productId: data.id as string,
    title: data.title as string,
    price: Number(data.base_price),
    triggeredBy: req.user!.id,
  })

  res.json(data)
}

export async function unpublishProduct(req: AuthRequest, res: Response) {
  const data = await queryOne(
    'UPDATE dbo.products SET published = 0, updated_at = SYSDATETIMEOFFSET() OUTPUT inserted.* WHERE id = @id',
    { id: uuidParam(req.params.id) }
  )
  if (!data) return res.status(404).json({ error: 'Product not found' })
  res.json(data)
}

export async function deleteProduct(req: AuthRequest, res: Response) {
  try {
    const id = req.params.id

    await withTransaction(async (_tx, request) => {
      const bindId = (r: sql.Request) => r.input('id', sql.UniqueIdentifier, id)

      // A product that has been sold (online orders or offline sales) must not be
      // hard-deleted — that would corrupt historical sales/revenue reports. Sales
      // rows may reference either the product directly or one of its variants, so
      // we check both.
      const salesRes = await bindId(request()).query<{ orderItems: number; offlineSales: number }>(
        `SELECT
           (SELECT COUNT(*) FROM dbo.order_items
              WHERE product_id = @id
                 OR variant_id IN (SELECT id FROM dbo.variants WHERE product_id = @id)) AS orderItems,
           (SELECT COUNT(*) FROM dbo.offline_sales
              WHERE product_id = @id
                 OR variant_id IN (SELECT id FROM dbo.variants WHERE product_id = @id)) AS offlineSales`
      )
      const row = salesRes.recordset[0]
      const salesCount = (row?.orderItems ?? 0) + (row?.offlineSales ?? 0)
      if (salesCount > 0) {
        const e = new Error(
          'This product has sales records and cannot be deleted (it would corrupt your order history and reports). ' +
            'Unpublish it instead to hide it from customers.'
        ) as Error & { httpStatus?: number }
        e.httpStatus = 409
        throw e
      }

      // Clean up transient references that would otherwise block the delete. These
      // can point at the product or at its variants (cart_items.variant_id has no
      // cascade), so clear both. product_images and variants themselves are removed
      // automatically via ON DELETE CASCADE when the product row goes.
      await bindId(request()).query(
        `DELETE FROM dbo.cart_items
          WHERE product_id = @id
             OR variant_id IN (SELECT id FROM dbo.variants WHERE product_id = @id)`
      )
      await bindId(request()).query('DELETE FROM dbo.wishlist_items WHERE product_id = @id')
      await bindId(request()).query('DELETE FROM dbo.coupons WHERE product_id = @id')

      await bindId(request()).query('DELETE FROM dbo.products WHERE id = @id')
    })

    res.json({ success: true })
  } catch (err) {
    const status = (err as { httpStatus?: number }).httpStatus ?? 400
    res.status(status).json({ error: err instanceof Error ? err.message : 'Delete failed' })
  }
}

export async function addProductImage(req: AuthRequest, res: Response) {
  const { url, alt_text, is_primary, color, display_order } = req.body
  const { product_id } = req.params

  if (is_primary) {
    await query('UPDATE dbo.product_images SET is_primary = 0 WHERE product_id = @pid', {
      pid: uuidParam(product_id),
    })
  }

  const data = await queryOne(
    `INSERT INTO dbo.product_images (id, product_id, url, alt_text, is_primary, color, display_order)
     OUTPUT inserted.*
     VALUES (@id, @pid, @url, @alt_text, @is_primary, @color, @display_order)`,
    {
      id: uuidParam(randomUUID()), pid: uuidParam(product_id), url, alt_text: alt_text ?? null,
      is_primary: is_primary ? 1 : 0, color: color ?? null, display_order: display_order ?? 0,
    }
  )
  res.status(201).json(data)
}

export async function deleteProductImage(req: AuthRequest, res: Response) {
  const { product_id, image_id } = req.params
  await query('DELETE FROM dbo.product_images WHERE id = @iid AND product_id = @pid', {
    iid: uuidParam(image_id), pid: uuidParam(product_id),
  })
  res.json({ success: true })
}

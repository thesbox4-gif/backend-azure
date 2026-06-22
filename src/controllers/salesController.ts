import { Response } from 'express'
import { randomUUID } from 'crypto'
import { query, queryOne, getPool, uuidParam, sql } from '../db'
import { AuthRequest } from '../middleware/auth'

// Record an in-person ("offline") sale attributed to the current employee/admin.
export async function recordOfflineSale(req: AuthRequest, res: Response) {
  const { variant_id } = req.body
  const qty = parseInt(req.body.quantity, 10)
  const customer_name = req.body.customer_name?.toString().trim() || null
  const customer_phone = req.body.customer_phone?.toString().trim() || null
  const amountRaw = req.body.amount

  if (!variant_id || !qty || qty <= 0) {
    return res.status(400).json({ error: 'variant_id and a positive quantity are required' })
  }

  const variant = await queryOne<{ id: string; quantity: number; product_id: string; base_price: number | null; discount_pct: number | null }>(
    `SELECT v.id, v.quantity, v.product_id, p.base_price, p.discount_pct
     FROM dbo.variants v LEFT JOIN dbo.products p ON p.id = v.product_id
     WHERE v.id = @id`,
    { id: uuidParam(variant_id) }
  )
  if (!variant) return res.status(404).json({ error: 'Variant not found' })
  if (variant.quantity < qty) {
    return res.status(400).json({ error: `Only ${variant.quantity} in stock` })
  }

  let unit_price: number
  let amount: number
  if (amountRaw != null && amountRaw !== '') {
    amount = Number(amountRaw)
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' })
    }
    unit_price = Math.round((amount / qty) * 100) / 100
  } else {
    const base = Number(variant.base_price ?? 0)
    const disc = Number(variant.discount_pct ?? 0)
    unit_price = Math.round(base * (1 - disc / 100))
    amount = Math.round(unit_price * qty * 100) / 100
  }

  const sale = await queryOne(
    `INSERT INTO dbo.offline_sales (id, variant_id, product_id, sold_by, quantity, unit_price, amount, customer_name, customer_phone, created_at)
     OUTPUT inserted.*
     VALUES (@id, @vid, @pid, @soldby, @qty, @price, @amount, @cname, @cphone, SYSDATETIMEOFFSET())`,
    {
      id: uuidParam(randomUUID()), vid: uuidParam(variant_id), pid: uuidParam(variant.product_id),
      soldby: uuidParam(req.user!.id), qty, price: unit_price, amount,
      cname: customer_name, cphone: customer_phone,
    }
  )

  // Atomically decrement stock and bump sold_count.
  const pool = await getPool()
  await pool.request()
    .input('variant_id', sql.UniqueIdentifier, variant_id)
    .input('qty', sql.Int, qty)
    .execute('dbo.decrement_variant_stock')

  res.status(201).json(sale)
}

function offlineSaleAmountExpr(prefix = ''): string {
  const p = prefix ? `${prefix}.` : ''
  return `COALESCE(${p}amount, ${p}unit_price * ${p}quantity)`
}

export async function fetchOfflineSalesTotals(filters: {
  soldBy?: string
  since?: string
} = {}): Promise<{ totalAmount: number; saleCount: number; itemsSold: number }> {
  const where: string[] = []
  const params: Record<string, unknown> = {}

  if (filters.soldBy) {
    where.push('sold_by = @sold')
    params.sold = uuidParam(filters.soldBy)
  }
  if (filters.since) {
    where.push('created_at >= @since')
    params.since = filters.since
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const row = await queryOne<Record<string, number>>(
    `SELECT
       ISNULL(SUM(${offlineSaleAmountExpr()}), 0) AS totalAmount,
       COUNT(*) AS saleCount,
       ISNULL(SUM(quantity), 0) AS itemsSold
     FROM dbo.offline_sales ${whereSql}`,
    params
  )

  return {
    totalAmount: Number(row?.totalAmount ?? 0),
    saleCount: Number(row?.saleCount ?? 0),
    itemsSold: Number(row?.itemsSold ?? 0),
  }
}

// List offline sales. Employees see only their own; admins see all.
export async function getOfflineSales(req: AuthRequest, res: Response) {
  const { page = '1', limit = '20', soldBy } = req.query
  const soldByValue: string | undefined =
    typeof soldBy === 'string' ? soldBy
    : Array.isArray(soldBy) && typeof soldBy[0] === 'string' ? soldBy[0]
    : undefined

  const where: string[] = []
  const params: Record<string, unknown> = { offset: (+page - 1) * +limit, limit: +limit }
  if (req.user!.role === 'employee') { where.push('os.sold_by = @sold'); params.sold = uuidParam(req.user!.id) }
  else if (soldByValue) { where.push('os.sold_by = @sold'); params.sold = uuidParam(soldByValue) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const cols = `
    os.*,
    JSON_QUERY((SELECT p.id, p.title FROM dbo.products p WHERE p.id = os.product_id FOR JSON PATH, INCLUDE_NULL_VALUES, WITHOUT_ARRAY_WRAPPER)) AS product,
    JSON_QUERY((SELECT v.id, v.color, v.size, v.sku FROM dbo.variants v WHERE v.id = os.variant_id FOR JSON PATH, INCLUDE_NULL_VALUES, WITHOUT_ARRAY_WRAPPER)) AS variant,
    JSON_QUERY((SELECT pr.id, pr.name FROM dbo.profiles pr WHERE pr.id = os.sold_by FOR JSON PATH, INCLUDE_NULL_VALUES, WITHOUT_ARRAY_WRAPPER)) AS seller`

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT ${cols} FROM dbo.offline_sales os ${whereSql}
     ORDER BY os.created_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      params
    ),
    queryOne<{ total: number }>(`SELECT COUNT(*) AS total FROM dbo.offline_sales os ${whereSql}`, params),
  ])

  const data = rows.map((r) => ({
    ...r,
    product: r.product ? JSON.parse(r.product as string) : null,
    variant: r.variant ? JSON.parse(r.variant as string) : null,
    seller: r.seller ? JSON.parse(r.seller as string) : null,
  }))
  res.json({ data, count: countRow?.total ?? 0, page: +page, limit: +limit })
}

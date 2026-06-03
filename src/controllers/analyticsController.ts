import { Response } from 'express'
import { supabase } from '../supabase'
import { AuthRequest } from '../middleware/auth'

export async function getDashboardStats(_req: AuthRequest, res: Response) {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const [
    allOrders, monthOrders, totalCount, pendingCount,
    lowStock, outOfStock, totalProducts, totalCustomers, totalEmployees,
    allOffline, monthOffline,
  ] = await Promise.all([
    supabase.from('orders').select('total_amount').not('status', 'eq', 'cancelled'),
    supabase
      .from('orders')
      .select('total_amount')
      .gte('created_at', monthStart)
      .not('status', 'eq', 'cancelled'),
    supabase.from('orders').select('id', { count: 'exact', head: true }),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'placed'),
    // Low stock = 1-4 left; out of stock = 0 left (separate so neither goes negative).
    supabase.from('variants').select('id', { count: 'exact', head: true }).gt('quantity', 0).lt('quantity', 5),
    supabase.from('variants').select('id', { count: 'exact', head: true }).eq('quantity', 0),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('published', true),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'customer'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'employee'),
    supabase.from('offline_sales').select('quantity, unit_price'),
    supabase.from('offline_sales').select('quantity, unit_price').gte('created_at', monthStart),
  ])

  const onlineRevenue = allOrders.data?.reduce((s, o) => s + Number(o.total_amount), 0) ?? 0
  const onlineRevenueMonth = monthOrders.data?.reduce((s, o) => s + Number(o.total_amount), 0) ?? 0
  const offlineRevenue = (allOffline.data ?? []).reduce(
    (s, o) => s + Number(o.unit_price) * Number(o.quantity), 0,
  )
  const offlineRevenueMonth = (monthOffline.data ?? []).reduce(
    (s, o) => s + Number(o.unit_price) * Number(o.quantity), 0,
  )

  res.json({
    totalRevenue: onlineRevenue + offlineRevenue,
    revenueThisMonth: onlineRevenueMonth + offlineRevenueMonth,
    onlineRevenue,
    offlineRevenue,
    totalOrders: totalCount.count ?? 0,
    pendingOrders: pendingCount.count ?? 0,
    lowStockVariants: lowStock.count ?? 0,
    outOfStockVariants: outOfStock.count ?? 0,
    totalProducts: totalProducts.count ?? 0,
    totalCustomers: totalCustomers.count ?? 0,
    totalEmployees: totalEmployees.count ?? 0,
  })
}

export async function getSalesTimeline(_req: AuthRequest, res: Response) {
  const { data, error } = await supabase.rpc('daily_sales_last_30_days')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
}

export async function getInventory(req: AuthRequest, res: Response) {
  const { type, category } = req.query

  let query = supabase
    .from('variants')
    .select(`
      id, color, size, quantity, sold_count,
      product:products(id, title, type, published,
        category:categories(id, name))
    `)
    .order('sold_count', { ascending: false })

  if (type) query = (query as any).eq('product.type', type)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })

  let filtered = data ?? []
  if (type) filtered = filtered.filter((v: any) => v.product?.type === type)
  if (category) filtered = filtered.filter((v: any) => v.product?.category?.id === category)

  res.json(filtered)
}

// Per-employee offline-sales performance + top performer.
export async function getEmployeePerformance(req: AuthRequest, res: Response) {
  const period = req.query.period as string | undefined

  let since: string | undefined
  if (period === 'today') {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    since = d.toISOString()
  } else if (period === 'week') {
    const d = new Date(); d.setDate(d.getDate() - 7)
    since = d.toISOString()
  } else if (period === 'month') {
    const d = new Date(); d.setDate(d.getDate() - 30)
    since = d.toISOString()
  }

  let query = supabase
    .from('offline_sales')
    .select('quantity, unit_price, sold_by, created_at, seller:profiles!sold_by(id, name)')

  if (since) {
    query = query.gte('created_at', since)
  }

  const { data: sales, error } = await query

  if (error) return res.status(500).json({ error: error.message })

  const map: Record<string, { id: string; name: string; revenue: number; itemsSold: number; saleCount: number }> = {}
  for (const s of sales ?? []) {
    const id = s.sold_by as string | null
    if (!id) continue
    const seller = s.seller as unknown as { name?: string } | null
    if (!map[id]) {
      map[id] = { id, name: seller?.name ?? 'Unknown', revenue: 0, itemsSold: 0, saleCount: 0 }
    }
    map[id].revenue += Number(s.unit_price) * Number(s.quantity)
    map[id].itemsSold += Number(s.quantity)
    map[id].saleCount += 1
  }

  const employees = Object.values(map).sort((a, b) => b.revenue - a.revenue)
  res.json({ employees, topPerformer: employees[0] ?? null })
}

// Online (web orders) vs offline (in-person) sales totals.
export async function getSalesSummary(_req: AuthRequest, res: Response) {
  const [online, offline] = await Promise.all([
    supabase.from('orders').select('total_amount').not('status', 'eq', 'cancelled'),
    supabase.from('offline_sales').select('quantity, unit_price'),
  ])

  const onlineRevenue = (online.data ?? []).reduce((s, o) => s + Number(o.total_amount), 0)
  const offlineRevenue = (offline.data ?? []).reduce(
    (s, o) => s + Number(o.unit_price) * Number(o.quantity),
    0
  )

  res.json({
    onlineRevenue,
    offlineRevenue,
    totalRevenue: onlineRevenue + offlineRevenue,
    onlineCount: online.data?.length ?? 0,
    offlineCount: offline.data?.length ?? 0,
  })
}

// Per-category inventory depth — for each category: how many products, how many
// distinct colors, total stock left, variant count and low-stock variant count.
export async function getCategoryInventory(_req: AuthRequest, res: Response) {
  const { data, error } = await supabase
    .from('variants')
    .select('quantity, color, product:products(id, type, category:categories(id, name, parent_id))')

  if (error) return res.status(500).json({ error: error.message })

  type Bucket = {
    id: string
    name: string
    parentId: string | null
    itemsLeft: number
    variantCount: number
    lowStock: number
    products: Set<string>
    colors: Record<string, number>
    types: Set<string>
  }
  const map: Record<string, Bucket> = {}

  for (const v of data ?? []) {
    const product = v.product as unknown as
      | { id?: string; type?: string; category?: { id: string; name: string; parent_id: string | null } }
      | null
    const cat = product?.category
    const key = cat?.id ?? 'uncategorized'
    if (!map[key]) {
      map[key] = {
        id: key,
        name: cat?.name ?? 'Uncategorized',
        parentId: cat?.parent_id ?? null,
        itemsLeft: 0,
        variantCount: 0,
        lowStock: 0,
        products: new Set(),
        colors: {},
        types: new Set(),
      }
    }
    const b = map[key]
    const qty = Number(v.quantity)
    b.itemsLeft += qty
    b.variantCount += 1
    if (qty < 5) b.lowStock += 1
    if (product?.id) b.products.add(product.id)
    if (v.color) {
      const col = v.color as string
      b.colors[col] = (b.colors[col] || 0) + qty
    }
    if (product?.type) b.types.add(product.type)
  }

  const result = Object.values(map)
    .map((b) => ({
      id: b.id,
      name: b.name,
      parentId: b.parentId,
      type: [...b.types][0] ?? null,
      productCount: b.products.size,
      colorCount: Object.keys(b.colors).length,
      colors: Object.entries(b.colors).map(([color, qty]) => ({ color, qty })),
      variantCount: b.variantCount,
      itemsLeft: b.itemsLeft,
      lowStock: b.lowStock,
    }))
    .sort((a, b) => b.itemsLeft - a.itemsLeft)

  res.json(result)
}

export async function getCategorySales(_req: AuthRequest, res: Response) {
  // Combine online order items with offline ("mark as sold") sales so per-type
  // revenue reflects every sales channel — not just web orders.
  const [online, offline] = await Promise.all([
    supabase.from('order_items').select('quantity, unit_price, product:products(type)'),
    supabase.from('offline_sales').select('quantity, unit_price, product:products(type)'),
  ])

  if (online.error) return res.status(500).json({ error: online.error.message })
  if (offline.error) return res.status(500).json({ error: offline.error.message })

  const grouped: Record<string, { revenue: number; count: number }> = {}
  const tally = (rows: any[] | null) => {
    for (const item of rows ?? []) {
      const type = item.product?.type ?? 'unknown'
      if (!grouped[type]) grouped[type] = { revenue: 0, count: 0 }
      grouped[type].revenue += Number(item.quantity) * Number(item.unit_price)
      grouped[type].count += Number(item.quantity)
    }
  }
  tally(online.data)
  tally(offline.data)

  res.json(
    Object.entries(grouped)
      .map(([type, g]) => ({ type, revenue: g.revenue, count: g.count }))
      .sort((a, b) => b.revenue - a.revenue)
  )
}

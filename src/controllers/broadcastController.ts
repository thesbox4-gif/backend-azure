import { Response } from 'express'
import { query, queryOne, uuidParam } from '../db'
import { AuthRequest } from '../middleware/auth'

// GET /api/broadcast/settings
export async function getBroadcastSettings(_req: AuthRequest, res: Response) {
  const row = await queryOne(
    'SELECT enabled, product_base_url, updated_at FROM dbo.broadcast_settings WHERE id = 1'
  )
  if (!row) return res.status(500).json({ error: 'Broadcast settings not initialised' })
  res.json(row)
}

// PATCH /api/broadcast/settings
export async function updateBroadcastSettings(req: AuthRequest, res: Response) {
  const { enabled, product_base_url } = req.body

  if (enabled === undefined && product_base_url === undefined) {
    return res.status(400).json({ error: 'Provide at least one of: enabled, product_base_url' })
  }

  const sets: string[] = ['updated_at = SYSDATETIMEOFFSET()', 'updated_by = @updatedBy']
  const params: Record<string, unknown> = { updatedBy: uuidParam(req.user!.id) }

  if (enabled !== undefined)          { sets.push('enabled = @enabled');                   params.enabled = enabled ? 1 : 0 }
  if (product_base_url !== undefined) { sets.push('product_base_url = @product_base_url'); params.product_base_url = product_base_url.toString().trim() }

  await query(`UPDATE dbo.broadcast_settings SET ${sets.join(', ')} WHERE id = 1`, params)

  const row = await queryOne(
    'SELECT enabled, product_base_url, updated_at FROM dbo.broadcast_settings WHERE id = 1'
  )
  res.json(row)
}

// GET /api/broadcast/logs — paginated list of broadcasts
export async function getBroadcastLogs(req: AuthRequest, res: Response) {
  const { page = '1', limit = '20' } = req.query
  const offset = (+page - 1) * +limit

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT l.id, l.product_id, l.product_title, l.product_price,
              l.product_image_url, l.product_url,
              l.total_recipients, l.whatsapp_sent, l.in_app_sent, l.failed,
              l.created_at,
              p.name AS triggered_by_name
       FROM dbo.broadcast_log l
       LEFT JOIN dbo.profiles p ON p.id = l.triggered_by
       ORDER BY l.created_at DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      { offset, limit: +limit }
    ),
    queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM dbo.broadcast_log'),
  ])

  res.json({ data: rows, count: countRow?.total ?? 0, page: +page, limit: +limit })
}

// GET /api/broadcast/logs/:id/deliveries — per-customer delivery records for one broadcast
export async function getBroadcastDeliveries(req: AuthRequest, res: Response) {
  const { id } = req.params
  const { page = '1', limit = '50', channel, status } = req.query
  const offset = (+page - 1) * +limit

  const where: string[] = ['d.broadcast_id = @bid']
  const params: Record<string, unknown> = { bid: uuidParam(id), offset, limit: +limit }

  if (typeof channel === 'string' && channel) { where.push('d.channel = @channel'); params.channel = channel }
  if (typeof status  === 'string' && status)  { where.push('d.status = @status');   params.status = status }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT d.id, d.phone, d.channel, d.status, d.error_msg, d.sent_at,
              p.name AS customer_name, p.email AS customer_email
       FROM dbo.broadcast_delivery d
       LEFT JOIN dbo.profiles p ON p.id = d.customer_id
       ${whereSql}
       ORDER BY d.sent_at DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      params
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM dbo.broadcast_delivery d ${whereSql}`,
      params
    ),
  ])

  res.json({ data: rows, count: countRow?.total ?? 0, page: +page, limit: +limit })
}

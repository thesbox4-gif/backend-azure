import { Response } from 'express'
import { query, queryOne, uuidParam } from '../db'
import { AuthRequest } from '../middleware/auth'
import { runReengagement } from '../services/reengagementScheduler'

const VALID_DAYS = [30, 60, 90] as const

const SETTINGS_SELECT = `
  SELECT inactivity_days, enabled, message,
         product_base_url, collection_url,
         last_run_at, updated_at
  FROM dbo.reengagement_settings WHERE id = 1`

// GET /api/reengagement/settings
export async function getSettings(_req: AuthRequest, res: Response) {
  const row = await queryOne(SETTINGS_SELECT)
  if (!row) return res.status(500).json({ error: 'Re-engagement settings not initialised' })
  res.json(row)
}

// PATCH /api/reengagement/settings
export async function updateSettings(req: AuthRequest, res: Response) {
  const { inactivity_days, enabled, message, product_base_url, collection_url } = req.body

  if (inactivity_days !== undefined && !VALID_DAYS.includes(inactivity_days)) {
    return res.status(400).json({ error: 'inactivity_days must be 30, 60, or 90' })
  }

  const sets: string[] = ['updated_at = SYSDATETIMEOFFSET()', 'updated_by = @updatedBy']
  const params: Record<string, unknown> = { updatedBy: uuidParam(req.user!.id) }

  if (inactivity_days !== undefined)  { sets.push('inactivity_days = @inactivity_days');   params.inactivity_days = inactivity_days }
  if (enabled !== undefined)          { sets.push('enabled = @enabled');                    params.enabled = enabled ? 1 : 0 }
  if (message !== undefined) {
    if (!message.toString().trim()) return res.status(400).json({ error: 'message cannot be empty' })
    sets.push('message = @message')
    params.message = message.toString().trim()
  }
  if (product_base_url !== undefined) { sets.push('product_base_url = @product_base_url'); params.product_base_url = product_base_url.toString().trim() }
  if (collection_url !== undefined)   { sets.push('collection_url = @collection_url');     params.collection_url = collection_url.toString().trim() }

  if (sets.length === 2) {
    return res.status(400).json({
      error: 'Provide at least one of: inactivity_days, enabled, message, product_base_url, collection_url',
    })
  }

  await query(`UPDATE dbo.reengagement_settings SET ${sets.join(', ')} WHERE id = 1`, params)

  const row = await queryOne(SETTINGS_SELECT)
  res.json(row)
}

// POST /api/reengagement/run  — manual trigger
export async function triggerRun(_req: AuthRequest, res: Response) {
  const result = await runReengagement()
  res.json(result)
}

// GET /api/reengagement/log
export async function getLog(req: AuthRequest, res: Response) {
  const { page = '1', limit = '50', channel } = req.query
  const offset = (+page - 1) * +limit

  const where = typeof channel === 'string' && channel ? `WHERE channel = @channel` : ''
  const channelParam = typeof channel === 'string' && channel ? { channel } : {}

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT l.id, l.phone, l.channel, l.sent_at,
              p.name AS customer_name, p.email AS customer_email
       FROM dbo.reengagement_log l
       LEFT JOIN dbo.profiles p ON p.id = l.customer_id
       ${where}
       ORDER BY l.sent_at DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      { offset, limit: +limit, ...channelParam }
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM dbo.reengagement_log l ${where}`,
      channelParam
    ),
  ])

  res.json({ data: rows, count: countRow?.total ?? 0, page: +page, limit: +limit })
}

import { Response } from 'express'
import { query, queryOne } from '../db'
import { AuthRequest } from '../middleware/auth'

function clientId(): number {
  const id = parseInt(process.env.CLIENT_ID ?? '1', 10)
  return Number.isFinite(id) && id > 0 ? id : 1
}

// GET /api/dashboard/usage
export async function getUsage(_req: AuthRequest, res: Response) {
  const [uploadRow, quotaRow] = await Promise.all([
    queryOne<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM dbo.product_images'),
    queryOne<{ image_limit: number; images_used: number; upload_limit: number }>(
      `SELECT image_limit, images_used, upload_limit
       FROM dbo.ai_quota_settings WHERE client_id = @client_id`,
      { client_id: clientId() }
    ),
  ])

  res.json({
    uploadedUsed:   Number(uploadRow?.cnt ?? 0),
    uploadedLimit:  Number(quotaRow?.upload_limit ?? 500),
    generatedUsed:  Number(quotaRow?.images_used ?? 0),
    generatedLimit: Number(quotaRow?.image_limit ?? 500),
  })
}

// PATCH /api/dashboard/limits
export async function updateLimits(req: AuthRequest, res: Response) {
  const { uploadedLimit, generatedLimit } = req.body

  if (uploadedLimit === undefined && generatedLimit === undefined) {
    return res.status(400).json({ error: 'Provide at least one of: uploadedLimit, generatedLimit' })
  }

  const sets: string[] = ['updated_at = SYSDATETIMEOFFSET()']
  const params: Record<string, unknown> = { client_id: clientId() }

  if (uploadedLimit !== undefined) {
    if (!Number.isInteger(uploadedLimit) || uploadedLimit < 0) {
      return res.status(400).json({ error: 'uploadedLimit must be a non-negative integer' })
    }
    sets.push('upload_limit = @upload_limit')
    params.upload_limit = uploadedLimit
  }

  if (generatedLimit !== undefined) {
    if (!Number.isInteger(generatedLimit) || generatedLimit < 0) {
      return res.status(400).json({ error: 'generatedLimit must be a non-negative integer' })
    }
    sets.push('image_limit = @image_limit')
    params.image_limit = generatedLimit
  }

  await query(
    `UPDATE dbo.ai_quota_settings SET ${sets.join(', ')} WHERE client_id = @client_id`,
    params
  )

  const [uploadRow, quotaRow] = await Promise.all([
    queryOne<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM dbo.product_images'),
    queryOne<{ image_limit: number; images_used: number; upload_limit: number }>(
      `SELECT image_limit, images_used, upload_limit
       FROM dbo.ai_quota_settings WHERE client_id = @client_id`,
      { client_id: clientId() }
    ),
  ])

  res.json({
    uploadedUsed:   Number(uploadRow?.cnt ?? 0),
    uploadedLimit:  Number(quotaRow?.upload_limit ?? 500),
    generatedUsed:  Number(quotaRow?.images_used ?? 0),
    generatedLimit: Number(quotaRow?.image_limit ?? 500),
  })
}

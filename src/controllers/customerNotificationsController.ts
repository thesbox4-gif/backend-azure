import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { query, queryOne, uuidParam } from '../db'
import { AuthRequest } from '../middleware/auth'

// POST /api/customer-notifications — public subscribe / re-subscribe
export async function subscribe(req: Request, res: Response) {
  const { customerId, phone, whatsappNumber } = req.body

  if (!phone?.toString().trim()) {
    return res.status(400).json({ error: 'phone is required' })
  }

  const phoneTrimmed = phone.toString().trim()

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM dbo.customer_notifications WHERE phone = @phone',
    { phone: phoneTrimmed }
  )

  if (existing) {
    const row = await queryOne(
      `UPDATE dbo.customer_notifications
       SET subscribed = 1,
           customer_id = COALESCE(@customerId, customer_id),
           whatsapp_number = COALESCE(@whatsapp, whatsapp_number)
       OUTPUT inserted.*
       WHERE phone = @phone`,
      {
        phone: phoneTrimmed,
        customerId: uuidParam(customerId ?? null),
        whatsapp: whatsappNumber?.toString().trim() ?? null,
      }
    )
    return res.json(row)
  }

  const row = await queryOne(
    `INSERT INTO dbo.customer_notifications (id, customer_id, phone, whatsapp_number)
     OUTPUT inserted.*
     VALUES (@id, @customerId, @phone, @whatsapp)`,
    {
      id: uuidParam(randomUUID()),
      customerId: uuidParam(customerId ?? null),
      phone: phoneTrimmed,
      whatsapp: whatsappNumber?.toString().trim() ?? null,
    }
  )
  res.status(201).json(row)
}

// POST /api/customer-notifications/unsubscribe — public
export async function unsubscribe(req: Request, res: Response) {
  const { phone } = req.body
  if (!phone?.toString().trim()) {
    return res.status(400).json({ error: 'phone is required' })
  }

  await query(
    'UPDATE dbo.customer_notifications SET subscribed = 0 WHERE phone = @phone',
    { phone: phone.toString().trim() }
  )
  res.json({ success: true })
}

// GET /api/customer-notifications — admin: list all
export async function listSubscribers(req: Request, res: Response) {
  const { page = '1', limit = '50', subscribed } = req.query
  const offset = (+page - 1) * +limit

  const where =
    subscribed === 'true' ? 'WHERE subscribed = 1' :
    subscribed === 'false' ? 'WHERE subscribed = 0' : ''

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT * FROM dbo.customer_notifications ${where}
       ORDER BY created_at DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      { offset, limit: +limit }
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM dbo.customer_notifications ${where}`
    ),
  ])

  res.json({ data: rows, count: countRow?.total ?? 0, page: +page, limit: +limit })
}

// POST /api/notifications/new-product — admin: broadcast to all subscribed registered users
export async function broadcastNewProduct(req: AuthRequest, res: Response) {
  const { productId: _productId, title, message } = req.body

  if (!title?.toString().trim()) {
    return res.status(400).json({ error: 'title is required' })
  }

  const notifTitle = 'New Arrival!'
  const notifBody = message?.toString().trim() || `Check out our new product: ${title}`

  const subscribers = await query<{ customer_id: string }>(
    `SELECT customer_id FROM dbo.customer_notifications
     WHERE subscribed = 1 AND customer_id IS NOT NULL`
  )

  if (subscribers.length === 0) {
    return res.json({ notified: 0, message: 'No registered subscribers found' })
  }

  const valuesSql = subscribers
    .map((_, i) => `(NEWID(), @uid${i}, @notifTitle, @notifBody, 0, SYSDATETIMEOFFSET())`)
    .join(',\n')

  const params: Record<string, unknown> = { notifTitle, notifBody }
  subscribers.forEach((s, i) => { params[`uid${i}`] = uuidParam(s.customer_id) })

  await query(
    `INSERT INTO dbo.notifications (id, user_id, title, body, [read], created_at)
     VALUES ${valuesSql}`,
    params
  )

  res.json({ notified: subscribers.length })
}

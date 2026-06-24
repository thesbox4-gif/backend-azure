import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { query, queryOne, uuidParam } from '../db'

const VALID_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'] as const

export async function createVideoBooking(req: Request, res: Response) {
  const { customerName, phone, preferredDate, preferredTime, notes } = req.body

  if (!customerName?.toString().trim() || !phone?.toString().trim() || !preferredDate || !preferredTime) {
    return res.status(400).json({
      error: 'customerName, phone, preferredDate, and preferredTime are required',
    })
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) {
    return res.status(400).json({ error: 'preferredDate must be YYYY-MM-DD' })
  }

  const row = await queryOne(
    `INSERT INTO dbo.video_bookings
       (id, customer_name, phone, preferred_date, preferred_time, notes)
     OUTPUT inserted.*
     VALUES (@id, @name, @phone, @date, @time, @notes)`,
    {
      id:    uuidParam(randomUUID()),
      name:  customerName.toString().trim(),
      phone: phone.toString().trim(),
      date:  preferredDate,
      time:  preferredTime.toString().trim(),
      notes: notes?.toString().trim() ?? null,
    }
  )

  // Hook point: WhatsApp Business API booking confirmation goes here
  res.status(201).json(row)
}

export async function getVideoBookings(req: Request, res: Response) {
  const { page = '1', limit = '20', status } = req.query
  const offset = (+page - 1) * +limit

  const where: string[] = []
  const params: Record<string, unknown> = { offset, limit: +limit }

  if (typeof status === 'string' && status) {
    where.push('status = @status')
    params.status = status
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT * FROM dbo.video_bookings ${whereSql}
       ORDER BY created_at DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      params
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM dbo.video_bookings ${whereSql}`,
      params
    ),
  ])

  res.json({ data: rows, count: countRow?.total ?? 0, page: +page, limit: +limit })
}

export async function updateVideoBookingStatus(req: Request, res: Response) {
  const { id } = req.params
  const { status } = req.body

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` })
  }

  const row = await queryOne(
    `UPDATE dbo.video_bookings
     SET status = @status
     OUTPUT inserted.*
     WHERE id = @id`,
    { id: uuidParam(id), status }
  )

  if (!row) return res.status(404).json({ error: 'Booking not found' })

  // Hook point: WhatsApp Business API status-change notification goes here
  res.json(row)
}

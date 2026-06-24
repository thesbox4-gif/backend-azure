import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { query, queryOne, uuidParam } from '../db'

export async function createProductEnquiry(req: Request, res: Response) {
  const { productId, productName, customerName, phone, message } = req.body

  if (!customerName?.toString().trim() || !phone?.toString().trim()) {
    return res.status(400).json({ error: 'customerName and phone are required' })
  }

  const row = await queryOne(
    `INSERT INTO dbo.product_enquiries
       (id, product_id, product_name, customer_name, phone, message)
     OUTPUT inserted.*
     VALUES (@id, @productId, @productName, @customerName, @phone, @message)`,
    {
      id:           uuidParam(randomUUID()),
      productId:    uuidParam(productId ?? null),
      productName:  productName?.toString().trim() ?? null,
      customerName: customerName.toString().trim(),
      phone:        phone.toString().trim(),
      message:      message?.toString().trim() ?? null,
    }
  )

  // Hook point: WhatsApp Business API notification to admin goes here
  res.status(201).json(row)
}

export async function getProductEnquiries(req: Request, res: Response) {
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
      `SELECT * FROM dbo.product_enquiries ${whereSql}
       ORDER BY created_at DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      params
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM dbo.product_enquiries ${whereSql}`,
      params
    ),
  ])

  res.json({ data: rows, count: countRow?.total ?? 0, page: +page, limit: +limit })
}

export async function updateEnquiryStatus(req: Request, res: Response) {
  const { id } = req.params
  const { status } = req.body
  const VALID = ['new', 'responded', 'closed'] as const

  if (!VALID.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` })
  }

  const row = await queryOne(
    `UPDATE dbo.product_enquiries
     SET status = @status
     OUTPUT inserted.*
     WHERE id = @id`,
    { id: uuidParam(id), status }
  )

  if (!row) return res.status(404).json({ error: 'Enquiry not found' })
  res.json(row)
}

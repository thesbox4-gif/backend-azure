import { Request, Response } from 'express'
import { query, queryOne } from '../db'

export async function getPreviousBuyers(req: Request, res: Response) {
  const { page = '1', limit = '50', source } = req.query
  const offset = (+page - 1) * +limit

  let dataSql: string
  let countSql: string

  const onlineSql = `
    SELECT p.id, p.name, p.phone, p.email, p.whatsapp,
           COUNT(DISTINCT o.id) AS order_count,
           CAST(SUM(o.total_amount) AS decimal(10,2)) AS total_spent,
           MAX(o.created_at) AS last_purchase_at,
           'online' AS source
    FROM dbo.profiles p
    JOIN dbo.orders o ON o.user_id = p.id AND o.status <> 'cancelled'
    GROUP BY p.id, p.name, p.phone, p.email, p.whatsapp`

  const offlineSql = `
    SELECT NULL AS id, customer_name AS name, customer_phone AS phone,
           NULL AS email, NULL AS whatsapp,
           COUNT(*) AS order_count,
           CAST(SUM(COALESCE(amount, unit_price * quantity)) AS decimal(10,2)) AS total_spent,
           MAX(created_at) AS last_purchase_at,
           'offline' AS source
    FROM dbo.offline_sales
    WHERE customer_phone IS NOT NULL
    GROUP BY customer_name, customer_phone`

  const baseSql =
    source === 'online'  ? onlineSql :
    source === 'offline' ? offlineSql :
    `${onlineSql} UNION ALL ${offlineSql}`

  dataSql = `
    SELECT * FROM (${baseSql}) t
    ORDER BY last_purchase_at DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`

  countSql = `SELECT COUNT(*) AS total FROM (${baseSql}) t`

  const [rows, countRow] = await Promise.all([
    query(dataSql, { offset, limit: +limit }),
    queryOne<{ total: number }>(countSql),
  ])

  res.json({
    data: rows,
    count: countRow?.total ?? 0,
    page: +page,
    limit: +limit,
  })
}

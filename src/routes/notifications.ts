import { Router, Response } from 'express'
import { query, uuidParam } from '../db'
import { authenticate, requireRole, AuthRequest } from '../middleware/auth'
import { broadcastNewProduct } from '../controllers/customerNotificationsController'

const router = Router()

router.use(authenticate)

router.get('/', async (req: AuthRequest, res: Response) => {
  const data = await query(
    'SELECT TOP 50 * FROM dbo.notifications WHERE user_id = @uid ORDER BY created_at DESC',
    { uid: uuidParam(req.user!.id) }
  )
  res.json(data)
})

router.post('/mark-read', async (req: AuthRequest, res: Response) => {
  const { ids } = req.body
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' })
  if (ids.length === 0) return res.json({ success: true })

  await query(
    `UPDATE dbo.notifications SET [read] = 1
     WHERE user_id = @uid AND id IN (${ids.map((_, i) => `@id${i}`).join(',')})`,
    { uid: uuidParam(req.user!.id), ...Object.fromEntries(ids.map((id, i) => [`id${i}`, uuidParam(id)])) }
  )
  res.json({ success: true })
})

router.post('/mark-all-read', async (req: AuthRequest, res: Response) => {
  await query(
    'UPDATE dbo.notifications SET [read] = 1 WHERE user_id = @uid AND [read] = 0',
    { uid: uuidParam(req.user!.id) }
  )
  res.json({ success: true })
})

// Admin: broadcast new-product notification to all subscribed registered customers
router.post('/new-product', requireRole('admin'), broadcastNewProduct)

export default router

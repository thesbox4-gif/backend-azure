import { Router, Response } from 'express'
import { supabase } from '../supabase'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()

router.use(authenticate)

router.get('/', async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/mark-read', async (req: AuthRequest, res: Response) => {
  const { ids } = req.body
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' })

  await supabase
    .from('notifications')
    .update({ read: true })
    .in('id', ids)
    .eq('user_id', req.user!.id)

  res.json({ success: true })
})

router.post('/mark-all-read', async (req: AuthRequest, res: Response) => {
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', req.user!.id)
    .eq('read', false)

  res.json({ success: true })
})

export default router

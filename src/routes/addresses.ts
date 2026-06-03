import { Router, Response } from 'express'
import { body, validationResult } from 'express-validator'
import { supabase } from '../supabase'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()

router.use(authenticate)

router.get('/', async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('addresses')
    .select('*')
    .eq('user_id', req.user!.id)
    .order('is_default', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ data: data ?? [] })
})

router.post(
  '/',
  [
    body('line1').trim().notEmpty(),
    body('city').trim().notEmpty(),
    body('state').trim().notEmpty(),
    body('pincode').trim().notEmpty(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const { line1, line2, city, state, pincode, country = 'India', is_default = false } = req.body

    if (is_default) {
      await supabase.from('addresses').update({ is_default: false }).eq('user_id', req.user!.id)
    }

    const { data, error } = await supabase
      .from('addresses')
      .insert({ user_id: req.user!.id, line1, line2, city, state, pincode, country, is_default })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.status(201).json(data)
  }
)

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  const { line1, line2, city, state, pincode, country, is_default } = req.body
  const updates: Record<string, unknown> = {}
  if (line1) updates.line1 = line1
  if (line2 !== undefined) updates.line2 = line2
  if (city) updates.city = city
  if (state) updates.state = state
  if (pincode) updates.pincode = pincode
  if (country) updates.country = country

  if (is_default) {
    await supabase.from('addresses').update({ is_default: false }).eq('user_id', req.user!.id)
    updates.is_default = true
  }

  const { data, error } = await supabase
    .from('addresses')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user!.id)
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const { error } = await supabase
    .from('addresses')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user!.id)

  if (error) return res.status(400).json({ error: error.message })
  res.json({ success: true })
})

export default router

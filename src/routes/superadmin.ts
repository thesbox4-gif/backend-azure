import { Router, Response } from 'express'
import { body, validationResult } from 'express-validator'
import { authenticate, requireSuperAdmin, AuthRequest } from '../middleware/auth'
import {
  getQuotaStats,
  updateLimits,
  resetPeriodCounters,
} from '../services/aiQuotaService'
import {
  listAdmins,
  getAdmin,
  createAdmin,
  updateAdmin,
  resetAdminPassword,
  setAdminActive,
  deleteAdmin,
} from '../controllers/adminManagementController'

const router = Router()

router.get('/admins', authenticate, requireSuperAdmin, listAdmins)
router.post('/admins', authenticate, requireSuperAdmin, createAdmin)
router.get('/admins/:id', authenticate, requireSuperAdmin, getAdmin)
router.patch('/admins/:id', authenticate, requireSuperAdmin, updateAdmin)
router.patch('/admins/:id/password', authenticate, requireSuperAdmin, resetAdminPassword)
router.patch('/admins/:id/status', authenticate, requireSuperAdmin, setAdminActive)
router.delete('/admins/:id', authenticate, requireSuperAdmin, deleteAdmin)

router.get('/ai-quota', authenticate, requireSuperAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const stats = await getQuotaStats()
    res.json(stats)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load quota stats' })
  }
})

router.patch(
  '/ai-quota',
  authenticate,
  requireSuperAdmin,
  body('imageLimit').optional().isInt({ min: 0 }),
  body('contentLimit').optional().isInt({ min: 0 }),
  body('resetPeriod').optional().isIn(['lifetime', 'monthly']),
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const { imageLimit, contentLimit, resetPeriod } = req.body
    if (imageLimit === undefined && contentLimit === undefined && resetPeriod === undefined) {
      return res.status(400).json({ error: 'Provide at least one field to update' })
    }

    try {
      const stats = await updateLimits(
        { imageLimit, contentLimit, resetPeriod },
        req.user!.id
      )
      res.json(stats)
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update limits' })
    }
  }
)

router.post(
  '/ai-quota/reset-period',
  authenticate,
  requireSuperAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      const stats = await resetPeriodCounters()
      res.json(stats)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to reset period' })
    }
  }
)

export default router

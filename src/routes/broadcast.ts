import { Router } from 'express'
import { authenticate, requireRole } from '../middleware/auth'
import {
  getBroadcastSettings,
  updateBroadcastSettings,
  getBroadcastLogs,
  getBroadcastDeliveries,
} from '../controllers/broadcastController'

const router = Router()

router.use(authenticate, requireRole('admin'))

router.get('/settings',                  getBroadcastSettings)
router.patch('/settings',                updateBroadcastSettings)
router.get('/logs',                      getBroadcastLogs)
router.get('/logs/:id/deliveries',       getBroadcastDeliveries)

export default router

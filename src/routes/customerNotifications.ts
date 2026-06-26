import { Router } from 'express'
import { authenticate, requireRole } from '../middleware/auth'
import { subscribe, unsubscribe, listSubscribers } from '../controllers/customerNotificationsController'

const router = Router()

// Public — customers opt in / out without an account
router.post('/', subscribe)
router.post('/unsubscribe', unsubscribe)

// Admin only
router.get('/', authenticate, requireRole('admin'), listSubscribers)

export default router

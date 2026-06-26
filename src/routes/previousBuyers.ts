import { Router } from 'express'
import { authenticate, requireRole } from '../middleware/auth'
import { getPreviousBuyers } from '../controllers/previousBuyersController'

const router = Router()

router.get('/previous-buyers', authenticate, requireRole('admin'), getPreviousBuyers)

export default router

import { Router } from 'express'
import { authenticate, requireRole } from '../middleware/auth'
import { getUsage, updateLimits } from '../controllers/dashboardController'

const router = Router()

router.use(authenticate, requireRole('admin'))

router.get('/usage', getUsage)
router.patch('/limits', updateLimits)

export default router

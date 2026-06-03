import { Router } from 'express'
import { authenticate, requireApprovedEmployee } from '../middleware/auth'
import { recordOfflineSale, getOfflineSales } from '../controllers/salesController'

const router = Router()

router.post('/', authenticate, requireApprovedEmployee, recordOfflineSale)
router.get('/', authenticate, requireApprovedEmployee, getOfflineSales)

export default router

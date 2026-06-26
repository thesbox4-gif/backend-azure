import { Router } from 'express'
import { authenticate, requireRole } from '../middleware/auth'
import { getSettings, updateSettings, triggerRun, getLog } from '../controllers/reengagementController'

const router = Router()

router.use(authenticate, requireRole('admin'))

router.get('/settings', getSettings)
router.patch('/settings', updateSettings)
router.post('/run', triggerRun)
router.get('/log', getLog)

export default router

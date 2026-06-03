import { Router } from 'express'
import { authenticate, requireRole } from '../middleware/auth'
import { getEmployees, approveOrRejectEmployee, removeEmployee } from '../controllers/employeeController'

const router = Router()

router.use(authenticate, requireRole('admin'))

router.get('/', getEmployees)
router.patch('/:id/approve', approveOrRejectEmployee)
router.delete('/:id', removeEmployee)

export default router

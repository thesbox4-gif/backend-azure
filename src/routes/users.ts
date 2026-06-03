import { Router } from 'express'
import { authenticate, requireRole } from '../middleware/auth'
import {
  listUsers, getUser, createUser, deleteUser, resetUserPassword, setUserActive,
} from '../controllers/userController'

const router = Router()

router.use(authenticate, requireRole('admin'))

router.get('/', listUsers)
router.post('/', createUser)
router.get('/:id', getUser)
router.patch('/:id/password', resetUserPassword)
router.patch('/:id/status', setUserActive)
router.delete('/:id', deleteUser)

export default router

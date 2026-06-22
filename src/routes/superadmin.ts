import { Router } from 'express'
import { authenticate, requireSuperAdmin } from '../middleware/auth'
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

export default router

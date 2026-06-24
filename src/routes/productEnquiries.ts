import { Router } from 'express'
import { authenticate, requireRole } from '../middleware/auth'
import {
  createProductEnquiry,
  getProductEnquiries,
  updateEnquiryStatus,
} from '../controllers/enquiriesController'

const router = Router()

// Public — customers submit without an account
router.post('/', createProductEnquiry)

// Admin only
router.get('/', authenticate, requireRole('admin'), getProductEnquiries)
router.patch('/:id/status', authenticate, requireRole('admin'), updateEnquiryStatus)

export default router

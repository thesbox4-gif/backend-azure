import { Router } from 'express'
import { authenticate, requireRole } from '../middleware/auth'
import {
  createVideoBooking,
  getVideoBookings,
  updateVideoBookingStatus,
} from '../controllers/videoBookingsController'

const router = Router()

// Public — customers book without an account
router.post('/', createVideoBooking)

// Admin only
router.get('/', authenticate, requireRole('admin'), getVideoBookings)
router.patch('/:id/status', authenticate, requireRole('admin'), updateVideoBookingStatus)

export default router

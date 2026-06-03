import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { createRazorpayOrder, verifyPayment } from '../controllers/orderController'

const router = Router()

router.post('/create', authenticate, createRazorpayOrder)
router.post('/verify', authenticate, verifyPayment)

export default router

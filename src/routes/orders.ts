import { Router, Response, NextFunction } from 'express'
import { body, validationResult } from 'express-validator'
import { authenticate, requireRole } from '../middleware/auth'
import {
  getOrders,
  getOrderById,
  placeOrder,
  updateOrderStatus,
  cancelOrder,
  requestRefund,
} from '../controllers/orderController'
import { AuthRequest } from '../middleware/auth'

const router = Router()

router.use(authenticate)

router.get('/', getOrders)
router.get('/:id', getOrderById)

router.post(
  '/',
  [
    body('address_id').isUUID(),
    body('items').isArray({ min: 1 }),
    body('total_amount').isFloat({ min: 0 }),
  ],
  async (req: AuthRequest, res: Response, _next: NextFunction) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
    return placeOrder(req, res)
  }
)

router.patch('/:id/status', requireRole('admin', 'employee'), updateOrderStatus)
router.post('/:id/cancel', cancelOrder)
router.post('/:id/refund', requestRefund)

export default router

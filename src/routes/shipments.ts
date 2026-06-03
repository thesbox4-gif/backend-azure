import { Router } from 'express'
import { authenticate, requireRole } from '../middleware/auth'
import {
  cancelShipmentHandler,
  checkServiceabilityHandler,
  createShipmentHandler,
  getInvoiceHandler,
  getLabelHandler,
  getManifestHandler,
  trackShipmentHandler,
  webhookHandler,
} from '../controllers/shipmentController'

const router = Router()

router.post('/webhook', webhookHandler)

router.post(
  '/serviceability',
  authenticate,
  requireRole('admin', 'employee'),
  checkServiceabilityHandler
)
router.post('/create', authenticate, requireRole('admin', 'employee'), createShipmentHandler)
router.post(
  '/:orderId/label',
  authenticate,
  requireRole('admin', 'employee'),
  getLabelHandler
)
router.post(
  '/:orderId/invoice',
  authenticate,
  requireRole('admin', 'employee'),
  getInvoiceHandler
)
router.post(
  '/:orderId/manifest',
  authenticate,
  requireRole('admin', 'employee'),
  getManifestHandler
)
router.get('/:orderId/track', authenticate, trackShipmentHandler)
router.post(
  '/:orderId/cancel',
  authenticate,
  requireRole('admin', 'employee'),
  cancelShipmentHandler
)

export default router

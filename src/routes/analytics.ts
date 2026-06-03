import { Router } from 'express'
import { authenticate, requireRole } from '../middleware/auth'
import {
  getDashboardStats,
  getSalesTimeline,
  getInventory,
  getCategorySales,
  getCategoryInventory,
  getEmployeePerformance,
  getSalesSummary,
} from '../controllers/analyticsController'

const router = Router()

router.use(authenticate)

router.get('/dashboard', requireRole('admin', 'employee'), getDashboardStats)
router.get('/sales', requireRole('admin'), getSalesTimeline)
router.get('/inventory', requireRole('admin', 'employee'), getInventory)
router.get('/category-sales', requireRole('admin'), getCategorySales)
router.get('/category-inventory', requireRole('admin', 'employee'), getCategoryInventory)
router.get('/employee-performance', requireRole('admin'), getEmployeePerformance)
router.get('/sales-summary', requireRole('admin'), getSalesSummary)

export default router

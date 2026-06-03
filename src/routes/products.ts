import { Router } from 'express'
import { authenticate, requireRole, requireApprovedEmployee } from '../middleware/auth'
import {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  publishProduct,
  unpublishProduct,
  deleteProduct,
  addProductImage,
  deleteProductImage,
} from '../controllers/productController'

const router = Router()

router.get('/', getAllProducts)
router.get('/:id', getProductById)

router.post('/', authenticate, requireApprovedEmployee, createProduct)
router.patch('/:id', authenticate, requireApprovedEmployee, updateProduct)
router.post('/:id/publish', authenticate, requireApprovedEmployee, publishProduct)
router.post('/:id/unpublish', authenticate, requireRole('admin'), unpublishProduct)
router.delete('/:id', authenticate, requireRole('admin'), deleteProduct)
router.post('/:product_id/images', authenticate, requireApprovedEmployee, addProductImage)
router.delete('/:product_id/images/:image_id', authenticate, requireApprovedEmployee, deleteProductImage)

export default router

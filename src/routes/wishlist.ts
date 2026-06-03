import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { getWishlist, addToWishlist, removeFromWishlist, toggleWishlist } from '../controllers/wishlistController'

const router = Router()

router.use(authenticate)

router.get('/', getWishlist)
router.post('/', addToWishlist)
router.post('/toggle', toggleWishlist)
router.delete('/:productId', removeFromWishlist)

export default router

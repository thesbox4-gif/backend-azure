import { Router, Request, Response } from 'express'
import multer from 'multer'
import { authenticate, requireApprovedEmployee } from '../middleware/auth'
import { uploadImage } from '../services/storageService'
import { uploadLimiter } from '../middleware/rateLimiter'

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files are allowed'))
  },
})

router.post(
  '/image',
  uploadLimiter,
  authenticate,
  requireApprovedEmployee,
  upload.single('file'),
  async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const bucket = (req.body.bucket as 'product-images' | 'category-images') ?? 'product-images'
    if (!['product-images', 'category-images'].includes(bucket)) {
      return res.status(400).json({ error: 'Invalid bucket' })
    }

    const url = await uploadImage(req.file.buffer, req.file.originalname, bucket)
    res.json({ url })
  }
)

export default router

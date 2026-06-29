import { Router, Response } from 'express'
import multer from 'multer'
import { authenticate, requireApprovedEmployee, AuthRequest } from '../middleware/auth'
import { uploadImage } from '../services/storageService'
import { uploadLimiter } from '../middleware/rateLimiter'
import { checkAndIncrementLimit, decrementLimit, QuotaExceededError } from '../services/aiQuotaService'

const router = Router()

const fileSizeBytes = (parseInt(process.env.IMAGE_FILE_SIZE_LIMIT_MB ?? '10', 10) || 10) * 1024 * 1024

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: fileSizeBytes },
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
  async (req: AuthRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const bucket = (req.body.bucket as 'product-images' | 'category-images') ?? 'product-images'
    if (!['product-images', 'category-images'].includes(bucket)) {
      return res.status(400).json({ error: 'Invalid bucket' })
    }

    try {
      await checkAndIncrementLimit('upload')
    } catch (err) {
      if (err instanceof QuotaExceededError) return res.status(429).json({ error: err.message })
      throw err
    }

    try {
      const url = await uploadImage(req.file.buffer, req.file.originalname, bucket)
      res.json({ url })
    } catch (err) {
      // Refund the slot — the file was never stored
      await decrementLimit('upload').catch(() => {})
      throw err
    }
  }
)

export default router

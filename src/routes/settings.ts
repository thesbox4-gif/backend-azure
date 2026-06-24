import { Router } from 'express'
import { getWhatsAppSettings } from '../controllers/settingsController'

const router = Router()

router.get('/whatsapp', getWhatsAppSettings)

export default router

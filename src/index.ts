import 'dotenv/config'

import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import pinoHttp from 'pino-http'

import { logger } from './logger'
import { errorHandler, notFound } from './middleware/errorHandler'
import { apiLimiter } from './middleware/rateLimiter'

import authRoutes from './routes/auth'
import categoryRoutes from './routes/categories'
import productRoutes from './routes/products'
import variantRoutes from './routes/variants'
import cartRoutes from './routes/cart'
import wishlistRoutes from './routes/wishlist'
import orderRoutes from './routes/orders'
import addressRoutes from './routes/addresses'
import uploadRoutes from './routes/upload'
import aiRoutes from './routes/ai'
import razorpayRoutes from './routes/razorpay'
import employeeRoutes from './routes/employees'
import analyticsRoutes from './routes/analytics'
import couponRoutes from './routes/coupons'
import notificationRoutes from './routes/notifications'
import salesRoutes from './routes/sales'
import userRoutes from './routes/users'
import shipmentRoutes from './routes/shipments'
import superadminRoutes from './routes/superadmin'
import settingsRoutes from './routes/settings'
import productEnquiriesRoutes from './routes/productEnquiries'
import videoBookingsRoutes from './routes/videoBookings'
import customerNotificationsRoutes from './routes/customerNotifications'
import previousBuyersRoutes from './routes/previousBuyers'
import dashboardRoutes from './routes/dashboard'
import reengagementRoutes from './routes/reengagement'
import broadcastRoutes from './routes/broadcast'
import { reengagementScheduler } from './services/reengagementScheduler'

const app = express()

// Trim each origin and drop blanks so a stray space in ALLOWED_ORIGINS
// (e.g. "a.com, https://b.com") can't silently break CORS for a real origin.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ?.split(',')
  .map((o) => o.trim())
  .filter(Boolean)

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(
  cors({
    origin: allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : '*',
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
)

app.use(compression())

app.use(pinoHttp({ logger }))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

app.use('/api', apiLimiter)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

app.use('/api/auth', authRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/products', productRoutes)
app.use('/api/variants', variantRoutes)
app.use('/api/cart', cartRoutes)
app.use('/api/wishlist', wishlistRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/addresses', addressRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/razorpay', razorpayRoutes)
app.use('/api/employees', employeeRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/coupons', couponRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/sales', salesRoutes)
app.use('/api/users', userRoutes)
app.use('/api/shipments', shipmentRoutes)
app.use('/api/superadmin', superadminRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/product-enquiries', productEnquiriesRoutes)
app.use('/api/video-bookings', videoBookingsRoutes)
app.use('/api/customer-notifications', customerNotificationsRoutes)
app.use('/api/customers', previousBuyersRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/reengagement', reengagementRoutes)
app.use('/api/broadcast', broadcastRoutes)

app.use(notFound)
app.use(errorHandler)

const PORT = Number.parseInt(process.env.PORT ?? '4000', 10)

const server = app.listen(PORT)

server.once('listening', () => {
  logger.info(`Backend running on http://localhost:${PORT}`)
  reengagementScheduler.start()
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(
      { port: PORT, err },
      `Port ${PORT} is already in use (another backend or app is running). Stop that process or set PORT to a free port in backend/.env, then try again. On Windows: netstat -ano | findstr :${PORT} then taskkill /PID <pid> /F`
    )
  } else {
    logger.error({ err }, 'Server failed to start')
  }
  process.exit(1)
})

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Received shutdown signal')
  reengagementScheduler.stop()
  server.close(() => {
    logger.info('Server closed')
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export default app

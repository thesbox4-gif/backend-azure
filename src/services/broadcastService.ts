import { randomUUID } from 'crypto'
import twilio from 'twilio'
import { query, queryOne, uuidParam } from '../db'
import { logger } from '../logger'
import { notificationQueue } from './queueService'

// ── Twilio ────────────────────────────────────────────────────────────────────
function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  return sid && token ? twilio(sid, token) : null
}

function toWhatsAppUri(phone: string): string | null {
  const d = phone.replace(/\D/g, '')
  if (d.length === 10) return `whatsapp:+91${d}`
  if (d.length === 12 && d.startsWith('91')) return `whatsapp:+${d}`
  if (d.length === 13 && d.startsWith('091')) return `whatsapp:+${d.slice(1)}`
  return null
}

// ── Message builder ───────────────────────────────────────────────────────────
function buildMessage(title: string, price: number, productUrl: string): string {
  const priceFormatted = new Intl.NumberFormat('en-IN').format(price)
  return [
    'New Arrival at Yuvarani Silks ❤️',
    '',
    title,
    '',
    `Price: ₹${priceFormatted}`,
    '',
    'View Product:',
    productUrl,
  ].join('\n')
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface BroadcastParams {
  productId: string
  title: string
  price: number
  triggeredBy: string
}

interface Subscriber {
  phone: string
  whatsapp_number: string | null
  customer_id: string | null
}

// ── Core broadcast (runs inside notificationQueue job) ────────────────────────
async function executeBroadcast(params: BroadcastParams): Promise<void> {
  // 1. Load settings
  const settings = await queryOne<{ enabled: boolean; product_base_url: string }>(
    'SELECT enabled, product_base_url FROM dbo.broadcast_settings WHERE id = 1'
  )
  if (!settings?.enabled) {
    logger.info('Product broadcast disabled — skipping')
    return
  }

  // 2. Resolve primary image
  const imgRow = await queryOne<{ url: string }>(
    `SELECT TOP 1 url FROM dbo.product_images
     WHERE product_id = @pid
     ORDER BY is_primary DESC, display_order ASC`,
    { pid: uuidParam(params.productId) }
  )
  const imageUrl = imgRow?.url ?? null

  // 3. Build product URL
  const base = settings.product_base_url.replace(/\/$/, '')
  const productUrl = base ? `${base}/${params.productId}` : params.productId

  // 4. Build message
  const message = buildMessage(params.title, params.price, productUrl)

  // 5. Get all active subscribers
  const subscribers = await query<Subscriber>(
    `SELECT phone, whatsapp_number, customer_id
     FROM dbo.customer_notifications
     WHERE subscribed = 1`
  )

  if (subscribers.length === 0) {
    logger.info({ productId: params.productId }, 'Product broadcast: no subscribers')
    return
  }

  // 6. Create broadcast_log row
  const broadcastId = randomUUID()
  await query(
    `INSERT INTO dbo.broadcast_log
       (id, product_id, product_title, product_price, product_image_url, product_url,
        total_recipients, triggered_by)
     VALUES
       (@id, @pid, @title, @price, @imageUrl, @productUrl, @total, @triggeredBy)`,
    {
      id: uuidParam(broadcastId),
      pid: uuidParam(params.productId),
      title: params.title,
      price: params.price,
      imageUrl,
      productUrl,
      total: subscribers.length,
      triggeredBy: uuidParam(params.triggeredBy),
    }
  )

  const twilioClient = getTwilioClient()
  const twilioFrom = process.env.TWILIO_WHATSAPP_FROM

  let whatsappSent = 0
  let inAppSent = 0
  let failed = 0

  // 7. Send to each subscriber
  for (const sub of subscribers) {
    // WhatsApp — prefer whatsapp_number, fall back to phone
    const targetPhone = sub.whatsapp_number || sub.phone
    const waUri = toWhatsAppUri(targetPhone)

    if (twilioClient && twilioFrom && waUri) {
      try {
        await twilioClient.messages.create({ from: twilioFrom, to: waUri, body: message })
        await logDelivery(broadcastId, sub.phone, sub.customer_id, 'whatsapp', 'sent', null)
        whatsappSent++
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        await logDelivery(broadcastId, sub.phone, sub.customer_id, 'whatsapp', 'failed', errMsg)
        logger.warn({ phone: targetPhone, err: errMsg }, 'Broadcast WhatsApp failed')
        failed++
      }
    }

    // In-app — only for registered customers
    if (sub.customer_id) {
      try {
        await query(
          `INSERT INTO dbo.notifications (id, user_id, title, body, [read], created_at)
           VALUES (@id, @uid, @title, @body, 0, SYSDATETIMEOFFSET())`,
          {
            id: uuidParam(randomUUID()),
            uid: uuidParam(sub.customer_id),
            title: 'New Arrival! ❤️',
            body: message,
          }
        )
        await logDelivery(broadcastId, sub.phone, sub.customer_id, 'in_app', 'sent', null)
        inAppSent++
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        await logDelivery(broadcastId, sub.phone, sub.customer_id, 'in_app', 'failed', errMsg)
        logger.warn({ customerId: sub.customer_id, err: errMsg }, 'Broadcast in-app failed')
        failed++
      }
    }
  }

  // 8. Update broadcast_log with final counts
  await query(
    `UPDATE dbo.broadcast_log
     SET whatsapp_sent = @wa, in_app_sent = @ia, failed = @f
     WHERE id = @id`,
    {
      id: uuidParam(broadcastId),
      wa: whatsappSent,
      ia: inAppSent,
      f: failed,
    }
  )

  logger.info(
    { broadcastId, whatsappSent, inAppSent, failed, total: subscribers.length },
    'Product broadcast complete'
  )
}

async function logDelivery(
  broadcastId: string,
  phone: string,
  customerId: string | null,
  channel: 'whatsapp' | 'in_app',
  status: 'sent' | 'failed',
  errorMsg: string | null
): Promise<void> {
  await query(
    `INSERT INTO dbo.broadcast_delivery (id, broadcast_id, phone, customer_id, channel, status, error_msg)
     VALUES (@id, @bid, @phone, @cid, @channel, @status, @errorMsg)`,
    {
      id: uuidParam(randomUUID()),
      bid: uuidParam(broadcastId),
      phone,
      cid: uuidParam(customerId),
      channel,
      status,
      errorMsg: errorMsg ?? null,
    }
  )
}

// ── Public API — enqueues broadcast, returns immediately ──────────────────────
export function scheduleBroadcast(params: BroadcastParams): void {
  notificationQueue.enqueue(() => executeBroadcast(params))
}

import { randomUUID } from 'crypto'
import twilio from 'twilio'
import { query, queryOne, uuidParam } from '../db'
import { logger } from '../logger'

// ── Twilio client (lazy, same pattern as notificationService) ─────────────────
function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  return sid && token ? twilio(sid, token) : null
}

// ── Phone normalizer: accepts 10-digit, 91XXXXXXXXXX, +91XXXXXXXXXX → WhatsApp URI
function toWhatsAppUri(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `whatsapp:+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `whatsapp:+${digits}`
  if (digits.length === 13 && digits.startsWith('091')) return `whatsapp:+${digits.slice(1)}`
  return null
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface SettingsRow {
  inactivity_days: number
  enabled: boolean
  message: string
  last_run_at: string | null
  product_base_url: string
  collection_url: string
}

interface InactiveCustomer {
  phone: string
  name: string | null
  customer_id: string | null
}

interface LatestProduct {
  id: string
  title: string
  image_url: string | null
}

// Exported so future WhatsApp Business API callers can send media/product cards
// without re-querying the DB. The text fallback in buildProductLines is unaffected.
export interface ProductCard {
  id: string
  title: string
  imageUrl: string | null  // primary image URL — null when no image uploaded yet
  productUrl: string       // full link, empty string when product_base_url not configured
}

export interface RunResult {
  whatsappSent: number
  inAppSent: number
  skipped: number
  errors: number
}

// ── Core logic ────────────────────────────────────────────────────────────────
async function loadSettings(): Promise<SettingsRow | null> {
  return queryOne<SettingsRow>(
    `SELECT inactivity_days, enabled, message, last_run_at,
            product_base_url, collection_url
     FROM dbo.reengagement_settings WHERE id = 1`
  )
}

async function fetchLatestProducts(limit = 3): Promise<LatestProduct[]> {
  return query<LatestProduct>(
    `SELECT TOP (@limit)
       p.id,
       p.title,
       (SELECT TOP 1 url
        FROM dbo.product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.is_primary DESC, pi.display_order ASC) AS image_url
     FROM dbo.products p
     WHERE p.published = 1
     ORDER BY p.created_at DESC`,
    { limit }
  )
}

function buildProductCards(products: LatestProduct[], baseUrl: string): ProductCard[] {
  const base = baseUrl.replace(/\/$/, '')
  return products.map(p => ({
    id: p.id,
    title: p.title,
    imageUrl: p.image_url ?? null,
    productUrl: base ? `${base}/${p.id}` : '',
  }))
}

function buildProductLines(cards: ProductCard[]): string {
  if (cards.length === 0) return '(No new arrivals at the moment)'
  return cards
    .map(c => (c.productUrl ? `• ${c.title}: ${c.productUrl}` : `• ${c.title}`))
    .join('\n')
}

// Substitutes {CustomerName}, {Products}, {CollectionURL} in the template.
function applyTemplate(
  template: string,
  vars: { customerName: string; products: string; collectionUrl: string }
): string {
  return template
    .replace(/\{CustomerName\}/g, vars.customerName || 'Valued Customer')
    .replace(/\{Products\}/g, vars.products)
    .replace(/\{CollectionURL\}/g, vars.collectionUrl || '')
}

async function findInactiveCustomers(days: number): Promise<InactiveCustomer[]> {
  // Union online (registered) + offline customers whose last purchase is older
  // than `days`, excluding anyone who already got a re-engagement message within
  // the same `days` window (prevents duplicate sends per cycle).
  return query<InactiveCustomer>(
    `SELECT phone, MAX(name) AS name, MAX(customer_id) AS customer_id
     FROM (
       SELECT p.phone,
              p.name,
              p.id  AS customer_id,
              MAX(o.created_at) AS last_purchase
       FROM dbo.profiles p
       JOIN dbo.orders o ON o.user_id = p.id AND o.status <> 'cancelled'
       WHERE p.phone IS NOT NULL
       GROUP BY p.phone, p.name, p.id
       HAVING MAX(o.created_at) < DATEADD(day, -@days, SYSDATETIMEOFFSET())

       UNION ALL

       SELECT customer_phone AS phone,
              MAX(customer_name) AS name,
              NULL              AS customer_id,
              MAX(created_at)   AS last_purchase
       FROM dbo.offline_sales
       WHERE customer_phone IS NOT NULL
       GROUP BY customer_phone
       HAVING MAX(created_at) < DATEADD(day, -@days, SYSDATETIMEOFFSET())
     ) t
     WHERE phone NOT IN (
       SELECT phone FROM dbo.reengagement_log
       WHERE sent_at > DATEADD(day, -@days, SYSDATETIMEOFFSET())
     )
     GROUP BY phone`,
    { days }
  )
}

async function logSend(phone: string, customerId: string | null, channel: 'whatsapp' | 'in_app'): Promise<void> {
  await query(
    `INSERT INTO dbo.reengagement_log (id, customer_id, phone, channel)
     VALUES (@id, @cid, @phone, @channel)`,
    {
      id: uuidParam(randomUUID()),
      cid: uuidParam(customerId),
      phone,
      channel,
    }
  )
}

async function markRun(): Promise<void> {
  await query(
    'UPDATE dbo.reengagement_settings SET last_run_at = SYSDATETIMEOFFSET() WHERE id = 1'
  )
}

export async function runReengagement(): Promise<RunResult> {
  const result: RunResult = { whatsappSent: 0, inAppSent: 0, skipped: 0, errors: 0 }

  const settings = await loadSettings()
  if (!settings) { logger.warn('Re-engagement settings row missing'); return result }
  if (!settings.enabled) { logger.info('Re-engagement disabled — skipping'); return result }

  const customers = await findInactiveCustomers(settings.inactivity_days)
  if (customers.length === 0) {
    logger.info('Re-engagement: no inactive customers found')
    await markRun()
    return result
  }

  // Fetch latest products once — same for every customer in this run
  const latestProducts = await fetchLatestProducts(3)
  const productCards = buildProductCards(latestProducts, settings.product_base_url)
  const productLines = buildProductLines(productCards)

  const withImages = productCards.filter(c => c.imageUrl !== null).length
  logger.info(
    { customers: customers.length, days: settings.inactivity_days, products: latestProducts.length, withImages },
    'Re-engagement: processing customers'
  )

  const twilioClient = getTwilioClient()
  const twilioFrom = process.env.TWILIO_WHATSAPP_FROM

  for (const customer of customers) {
    // Personalise per customer — only {CustomerName} differs between sends
    const personalMessage = applyTemplate(settings.message, {
      customerName: customer.name || 'Valued Customer',
      products: productLines,
      collectionUrl: settings.collection_url,
    })

    let sent = false

    // 1. WhatsApp via Twilio
    if (twilioClient && twilioFrom) {
      const to = toWhatsAppUri(customer.phone)
      if (to) {
        try {
          await twilioClient.messages.create({ from: twilioFrom, to, body: personalMessage })
          await logSend(customer.phone, customer.customer_id, 'whatsapp')
          result.whatsappSent++
          sent = true
        } catch (err) {
          logger.error({ err, phone: customer.phone }, 'Re-engagement WhatsApp failed')
          result.errors++
        }
      }
    }

    // 2. In-app notification for registered customers
    if (customer.customer_id) {
      try {
        await query(
          `INSERT INTO dbo.notifications (id, user_id, title, body, [read], created_at)
           VALUES (@id, @uid, @title, @body, 0, SYSDATETIMEOFFSET())`,
          {
            id: uuidParam(randomUUID()),
            uid: uuidParam(customer.customer_id),
            title: 'We miss you! ❤️',
            body: personalMessage,
          }
        )
        await logSend(customer.phone, customer.customer_id, 'in_app')
        result.inAppSent++
        sent = true
      } catch (err) {
        logger.error({ err, customerId: customer.customer_id }, 'Re-engagement in-app notification failed')
        result.errors++
      }
    }

    if (!sent) result.skipped++
  }

  await markRun()
  logger.info(result, 'Re-engagement run complete')
  return result
}

// ── Scheduler (daily check) ───────────────────────────────────────────────────
const INTERVAL_MS = 24 * 60 * 60 * 1000  // 24 hours

class ReengagementScheduler {
  private timer: NodeJS.Timeout | null = null
  private busy = false

  start(): void {
    logger.info('Re-engagement scheduler started (24 h interval)')
    void this.tick()
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      logger.info('Re-engagement scheduler stopped')
    }
  }

  private async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await runReengagement()
    } catch (err) {
      logger.error({ err }, 'Re-engagement scheduler tick failed')
    } finally {
      this.busy = false
    }
  }
}

export const reengagementScheduler = new ReengagementScheduler()

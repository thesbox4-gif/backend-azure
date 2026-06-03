import { logger } from '../logger'

const BASE_URL = 'https://apiv2.shiprocket.in/v1/external'

export interface CourierOption {
  courier_company_id: number
  courier_name: string
  rate: number
  estimated_delivery_days: string
  etd: string
  cod: number
  rating: number
  freight_charge?: number
}

export interface CreateAdhocOrderPayload {
  order_id: string
  order_date: string
  pickup_location: string
  billing_customer_name: string
  billing_last_name: string
  billing_address: string
  billing_address_2?: string
  billing_city: string
  billing_pincode: string
  billing_state: string
  billing_country: string
  billing_email: string
  billing_phone: string
  shipping_is_billing: boolean
  order_items: Array<{
    name: string
    sku: string
    units: number
    selling_price: number
    discount?: number
  }>
  payment_method: 'Prepaid' | 'COD'
  sub_total: number
  length: number
  breadth: number
  height: number
  weight: number
}

export interface CreateOrderResult {
  order_id: number
  shipment_id: number
}

export interface AssignAwbResult {
  awb_code: string
  courier_name: string
  courier_company_id?: number
}

export interface TrackingPayload {
  tracking_data?: {
    track_status?: number
    shipment_status?: string
    shipment_track?: Array<{
      current_status?: string
      date?: string
      activity?: string
      location?: string
    }>
  }
}

let tokenCache: { token: string; expiresAt: number } | null = null

function getCredentials() {
  const email = process.env.SHIPROCKET_EMAIL
  const password = process.env.SHIPROCKET_PASSWORD
  if (!email || !password) {
    throw new Error('SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD must be set in backend/.env')
  }
  return { email, password }
}

async function login(force = false): Promise<string> {
  if (!force && tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token
  }

  const { email, password } = getCredentials()
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  const data = (await res.json()) as { token?: string; message?: string }
  if (!res.ok || !data.token) {
    throw new Error(data.message ?? `Shiprocket login failed (${res.status})`)
  }

  // Token valid ~10 days; refresh a day early
  tokenCache = {
    token: data.token,
    expiresAt: Date.now() + 9 * 24 * 60 * 60 * 1000,
  }
  return data.token
}

async function srFetch<T>(
  path: string,
  options: RequestInit = {},
  retried = false
): Promise<T> {
  const token = await login()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers as Record<string, string>),
    },
  })

  if (res.status === 401 && !retried) {
    tokenCache = null
    await login(true)
    return srFetch<T>(path, options, true)
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      (data as { message?: string }).message ??
      (data as { error?: string }).error ??
      `Shiprocket API error (${res.status})`
    logger.error({ path, status: res.status, data }, 'Shiprocket request failed')
    throw new Error(msg)
  }
  return data as T
}

export async function checkServiceability(params: {
  pickup_postcode: string
  delivery_postcode: string
  weight: number
  cod?: 0 | 1
  order_id?: string
}): Promise<CourierOption[]> {
  const qs = new URLSearchParams({
    pickup_postcode: params.pickup_postcode,
    delivery_postcode: params.delivery_postcode,
    weight: String(params.weight),
    cod: String(params.cod ?? 0),
  })
  if (params.order_id) qs.set('order_id', params.order_id)

  const data = await srFetch<{
    data?: {
      available_courier_companies?: CourierOption[]
    }
  }>(`/courier/serviceability/?${qs.toString()}`, { method: 'GET' })

  return data.data?.available_courier_companies ?? []
}

export async function createAdhocOrder(
  payload: CreateAdhocOrderPayload
): Promise<CreateOrderResult> {
  const data = await srFetch<{
    order_id?: number
    shipment_id?: number
    message?: string
  }>('/orders/create/adhoc', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  if (!data.order_id || !data.shipment_id) {
    throw new Error(data.message ?? 'Shiprocket did not return order_id/shipment_id')
  }
  return { order_id: data.order_id, shipment_id: data.shipment_id }
}

export async function assignAwb(
  shipment_id: number,
  courier_id: number
): Promise<AssignAwbResult> {
  const data = await srFetch<{
    response?: {
      data?: {
        awb_code?: string
        courier_name?: string
        courier_company_id?: number
      }
    }
    awb_code?: string
    courier_name?: string
  }>('/courier/assign/awb', {
    method: 'POST',
    body: JSON.stringify({ shipment_id, courier_id }),
  })

  const inner = data.response?.data
  const awb_code = inner?.awb_code ?? data.awb_code
  const courier_name = inner?.courier_name ?? data.courier_name
  if (!awb_code) {
    throw new Error('Shiprocket did not return AWB code')
  }
  return {
    awb_code,
    courier_name: courier_name ?? 'Courier',
    courier_company_id: inner?.courier_company_id ?? courier_id,
  }
}

export async function generateLabel(shipment_ids: number[]): Promise<string> {
  const data = await srFetch<{ label_url?: string; response?: { label_url?: string } }>(
    '/courier/generate/label',
    {
      method: 'POST',
      body: JSON.stringify({ shipment_id: shipment_ids }),
    }
  )
  const url = data.label_url ?? data.response?.label_url
  if (!url) throw new Error('Shiprocket did not return label URL')
  return url
}

export async function generateInvoice(order_ids: number[]): Promise<string> {
  const data = await srFetch<{ invoice_url?: string; response?: { invoice_url?: string } }>(
    '/orders/print/invoice',
    {
      method: 'POST',
      body: JSON.stringify({ ids: order_ids }),
    }
  )
  const url = data.invoice_url ?? data.response?.invoice_url
  if (!url) throw new Error('Shiprocket did not return invoice URL')
  return url
}

export async function generateManifest(shipment_ids: number[]): Promise<string> {
  const data = await srFetch<{ manifest_url?: string; response?: { manifest_url?: string } }>(
    '/manifests/generate',
    {
      method: 'POST',
      body: JSON.stringify({ shipment_id: shipment_ids }),
    }
  )
  const url = data.manifest_url ?? data.response?.manifest_url
  if (!url) throw new Error('Shiprocket did not return manifest URL')
  return url
}

export async function trackByAwb(awb: string): Promise<TrackingPayload> {
  return srFetch<TrackingPayload>(`/courier/track/awb/${encodeURIComponent(awb)}`, {
    method: 'GET',
  })
}

export async function cancelByAwbs(awbs: string[]): Promise<void> {
  await srFetch('/orders/cancel/shipment/awbs', {
    method: 'POST',
    body: JSON.stringify({ awbs }),
  })
}

export function getPickupLocation(): string {
  return process.env.SHIPROCKET_PICKUP_LOCATION ?? 'Primary'
}

export function getPickupPincode(): string {
  const pin = process.env.SHIPROCKET_PICKUP_PINCODE
  if (!pin) throw new Error('SHIPROCKET_PICKUP_PINCODE must be set in backend/.env')
  return pin
}

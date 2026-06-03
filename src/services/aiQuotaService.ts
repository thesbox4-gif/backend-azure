import { supabase } from '../supabase'

export type AiUsageType = 'image' | 'content'
export type ResetPeriod = 'lifetime' | 'monthly'

export class QuotaExceededError extends Error {
  readonly usageType: AiUsageType

  constructor(usageType: AiUsageType) {
    const label = usageType === 'image' ? 'image' : 'content'
    super(`AI ${label} quota exhausted. Contact platform admin.`)
    this.name = 'QuotaExceededError'
    this.usageType = usageType
  }
}

interface QuotaRow {
  image_limit: number
  content_limit: number
  reset_period: ResetPeriod
  period_start: string
  images_used: number
  content_used: number
  updated_at: string | null
}

export interface QuotaBucket {
  used: number
  limit: number
  remaining: number
}

export interface QuotaStats {
  images: QuotaBucket
  content: QuotaBucket
  resetPeriod: ResetPeriod
  periodStart: string
  updatedAt: string | null
}

async function ensurePeriodFresh(): Promise<void> {
  const { error } = await supabase.rpc('maybe_reset_ai_quota_period')
  if (error) throw new Error(error.message)
}

async function fetchSettingsRow(): Promise<QuotaRow> {
  await ensurePeriodFresh()
  const { data, error } = await supabase
    .from('ai_quota_settings')
    .select('image_limit, content_limit, reset_period, period_start, images_used, content_used, updated_at')
    .eq('id', 1)
    .single()

  if (error || !data) throw new Error('AI quota settings not configured')
  return data as QuotaRow
}

function toStats(row: QuotaRow): QuotaStats {
  return {
    images: {
      used: row.images_used,
      limit: row.image_limit,
      remaining: Math.max(0, row.image_limit - row.images_used),
    },
    content: {
      used: row.content_used,
      limit: row.content_limit,
      remaining: Math.max(0, row.content_limit - row.content_used),
    },
    resetPeriod: row.reset_period,
    periodStart: row.period_start,
    updatedAt: row.updated_at,
  }
}

export async function getQuotaStats(): Promise<QuotaStats> {
  const row = await fetchSettingsRow()
  return toStats(row)
}

export async function consumeQuota(type: AiUsageType, userId?: string): Promise<void> {
  const { error } = await supabase.rpc('consume_ai_quota', {
    p_type: type,
    p_user_id: userId ?? null,
  })

  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('image quota exhausted')) throw new QuotaExceededError('image')
    if (msg.includes('content quota exhausted')) throw new QuotaExceededError('content')
    throw new Error(error.message)
  }
}

export interface UpdateLimitsInput {
  imageLimit?: number
  contentLimit?: number
  resetPeriod?: ResetPeriod
}

export async function updateLimits(
  input: UpdateLimitsInput,
  updatedBy: string
): Promise<QuotaStats> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', updatedBy)
    .maybeSingle()

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: profile?.id ?? null,
  }

  if (input.imageLimit !== undefined) {
    if (!Number.isInteger(input.imageLimit) || input.imageLimit < 0) {
      throw new Error('imageLimit must be a non-negative integer')
    }
    patch.image_limit = input.imageLimit
  }
  if (input.contentLimit !== undefined) {
    if (!Number.isInteger(input.contentLimit) || input.contentLimit < 0) {
      throw new Error('contentLimit must be a non-negative integer')
    }
    patch.content_limit = input.contentLimit
  }
  if (input.resetPeriod !== undefined) {
    if (!['lifetime', 'monthly'].includes(input.resetPeriod)) {
      throw new Error('resetPeriod must be lifetime or monthly')
    }
    patch.reset_period = input.resetPeriod
    if (input.resetPeriod === 'monthly') {
      patch.period_start = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
    }
  }

  const { error } = await supabase.from('ai_quota_settings').update(patch).eq('id', 1)
  if (error) throw new Error(error.message)

  return getQuotaStats()
}

export async function resetPeriodCounters(): Promise<QuotaStats> {
  const { error } = await supabase.rpc('reset_ai_quota_period')
  if (error) throw new Error(error.message)
  return getQuotaStats()
}

const EC2_BASE_URL = process.env.EC2_LIVE_SERVER_URL || 'http://3.109.208.28:8080'

const RAW_MAX_EC2_QUOTE_AGE_SECONDS = Number(process.env.MAX_EC2_QUOTE_AGE_SECONDS || 180)
export const MAX_EC2_QUOTE_AGE_SECONDS = Number.isFinite(RAW_MAX_EC2_QUOTE_AGE_SECONDS)
  ? RAW_MAX_EC2_QUOTE_AGE_SECONDS
  : 180

const RAW_MAX_EC2_QUOTE_FUTURE_DRIFT_SECONDS = Number(process.env.MAX_EC2_QUOTE_FUTURE_DRIFT_SECONDS || 90)
export const MAX_EC2_QUOTE_FUTURE_DRIFT_SECONDS = Number.isFinite(RAW_MAX_EC2_QUOTE_FUTURE_DRIFT_SECONDS)
  ? RAW_MAX_EC2_QUOTE_FUTURE_DRIFT_SECONDS
  : 90

export type FreshEC2QuoteCheck =
  | { ok: true; price: number; ageSeconds: number | null }
  | { ok: false; reason: string }

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

function parseNaiveISTTimestamp(value: string): Date | null {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/
  )
  if (!match) return null

  const [, year, month, day, hour, minute, second = '0', fraction = '0'] = match
  const milliseconds = Number(fraction.padEnd(3, '0').slice(0, 3))
  const utcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    milliseconds
  ) - IST_OFFSET_MS

  const parsed = new Date(utcMs)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function getISTTimeParts(now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const weekday = parts.find((p) => p.type === 'weekday')?.value || 'Sun'
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || '0')

  return { weekday, hour, minute }
}

export function isNSEMarketSessionLive(now: Date = new Date()): boolean {
  const { weekday, hour, minute } = getISTTimeParts(now)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  const mins = hour * 60 + minute
  const open = 9 * 60 + 15
  const close = 15 * 60 + 30
  return mins >= open && mins <= close
}

export function parsePossibleTimestamp(value: unknown): Date | null {
  if (value == null) return null

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const trimmed = value.trim()
    const numeric = Number(trimmed)
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
      const ms = numeric > 1e12 ? numeric : numeric * 1000
      const d = new Date(ms)
      if (!Number.isNaN(d.getTime())) return d
    }

    // EC2 emits naive timestamps like 2026-03-12T10:00:03.372943 in IST.
    if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(trimmed) && !/(Z|[+-]\d{2}:\d{2})$/i.test(trimmed)) {
      const istDate = parseNaiveISTTimestamp(trimmed)
      if (istDate) return istDate
    }

    const d = new Date(trimmed)
    return Number.isNaN(d.getTime()) ? null : d
  }

  return null
}

export async function getFreshEC2Quote(symbol: string): Promise<FreshEC2QuoteCheck> {
  try {
    const response = await fetch(`${EC2_BASE_URL}/prices`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    })

    if (!response.ok) {
      return { ok: false, reason: 'EC2 live feed unreachable.' }
    }

    const body = await response.json()
    const upperSymbol = symbol.toUpperCase()
    const quote = body?.data?.[upperSymbol]
    const ltp = Number(quote?.ltp)
    if (!Number.isFinite(ltp) || ltp <= 0) {
      return { ok: false, reason: `No valid EC2 live price for ${upperSymbol}.` }
    }

    const quoteTs =
      parsePossibleTimestamp(quote?.timestamp) ||
      parsePossibleTimestamp(quote?.lastUpdated) ||
      parsePossibleTimestamp(quote?.updatedAt) ||
      parsePossibleTimestamp(quote?.exchangeTimestamp) ||
      parsePossibleTimestamp(quote?.time) ||
      parsePossibleTimestamp(body?.timestamp)

    if (!quoteTs) {
      return { ok: false, reason: 'EC2 quote has no reliable timestamp. Feed may be static.' }
    }

    const ageSeconds = Math.floor((Date.now() - quoteTs.getTime()) / 1000)
    if (ageSeconds < -MAX_EC2_QUOTE_FUTURE_DRIFT_SECONDS) {
      return { ok: false, reason: `EC2 quote timestamp is ahead by ${Math.abs(ageSeconds)}s. Feed is not safe for execution.` }
    }
    if (ageSeconds > MAX_EC2_QUOTE_AGE_SECONDS) {
      return { ok: false, reason: `EC2 quote is stale (${Math.max(ageSeconds, 0)}s old).` }
    }

    return { ok: true, price: ltp, ageSeconds: Math.max(ageSeconds, 0) }
  } catch {
    return { ok: false, reason: 'EC2 live feed timeout/error.' }
  }
}

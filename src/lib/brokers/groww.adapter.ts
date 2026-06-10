import crypto from 'crypto'
import type {
  BrokerAdapter,
  BrokerConnectCallbackInput,
  BrokerConnectCallbackResult,
  BrokerConnectStartInput,
  BrokerConnectStartResult,
  BrokerCredentials,
  BrokerHolding,
  BrokerPlaceOrderInput,
  BrokerPlaceOrderResult,
} from '@/lib/brokers/types'
import { brokerFetch } from '@/lib/brokers/proxy-fetch'

const GROWW_API_BASE_URL = process.env.GROWW_API_BASE_URL || 'https://api.groww.in'
const GROWW_API_VERSION = process.env.GROWW_API_VERSION || '1.0'
const GROWW_TOKEN_KEY_TYPE = (process.env.GROWW_TOKEN_KEY_TYPE || 'approval').toLowerCase()

function ensure(value: string | null | undefined, field: string) {
  if (!value) throw new Error(`Missing Groww ${field}`)
  return value
}

function mapProduct(productType: 'INTRADAY' | 'DELIVERY'): string {
  return productType === 'INTRADAY' ? 'MIS' : 'CNC'
}

function mapExchange(exchange?: string | null): string {
  return (exchange || '').toUpperCase() === 'BSE' ? 'BSE' : 'NSE'
}

function normalizeKeyType(value?: string | null): 'approval' | 'totp' {
  return value === 'totp' ? 'totp' : 'approval'
}

function makeOrderReference(idempotencyKey: string): string {
  const compact = idempotencyKey.replace(/[^a-zA-Z0-9]/g, '')
  const seed = compact.length > 0 ? compact : `${Date.now()}${Math.random().toString(36).slice(2)}`
  return seed.slice(0, 20).padEnd(8, '0')
}

function nextGrowwReset(): Date {
  // Groww resets at 6:00 AM IST = 00:30 UTC
  const now = new Date()
  const reset = new Date(now)
  reset.setUTCHours(0, 30, 0, 0)
  if (reset <= now) reset.setUTCDate(reset.getUTCDate() + 1)
  return reset
}

function buildChecksum(apiSecret: string, timestampSec: string): string {
  return crypto
    .createHash('sha256')
    .update(`${apiSecret}${timestampSec}`)
    .digest('hex')
}

async function parseJsonSafe(response: Response): Promise<any> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function extractErrorMessage(data: any, fallback: string): string {
  return (
    data?.error?.message ||
    data?.error?.detail ||
    data?.payload?.remark ||
    data?.payload?.message ||
    data?.message ||
    fallback
  )
}

function shouldRetryWithEqSymbol(data: any, tradingSymbol: string): boolean {
  if (tradingSymbol.toUpperCase().endsWith('-EQ')) return false

  const code = data?.error?.code || data?.payload?.error?.code
  const msg = JSON.stringify(data || {}).toLowerCase()
  if (code === 'GA001') return true
  return msg.includes('trading symbol') && msg.includes('invalid')
}

async function requestAccessToken(
  credentials: BrokerCredentials,
  keyTypeRaw?: string | null
): Promise<{ accessToken: string; tokenExpiresAt: Date | null; keyType: 'approval' | 'totp'; raw: any }> {
  const apiKey = ensure(credentials.apiKey, 'apiKey')
  const apiSecret = ensure(credentials.apiSecret, 'apiSecret')
  const keyType = normalizeKeyType(keyTypeRaw || GROWW_TOKEN_KEY_TYPE)

  const timestampSec = Math.floor(Date.now() / 1000).toString()
  const checksum = buildChecksum(apiSecret, timestampSec)

  const response = await brokerFetch(`${GROWW_API_BASE_URL}/v1/token/api/access`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      key_type: keyType,
      checksum,
      timestamp: timestampSec,
    }),
  })

  const data = await parseJsonSafe(response)
  const accessToken = data?.payload?.token || data?.token || null
  // Post-SEBI (April 2026): Groww returns {"token":"..."} directly, no status field
  const status = String(data?.status || '').toUpperCase()
  const failed = !response.ok || !accessToken || (status !== '' && status !== 'SUCCESS')
  if (failed) {
    const rawDetail = data?.raw ? String(data.raw).slice(0, 300) : JSON.stringify(data).slice(0, 300)
    console.error('[Groww] token fetch failed:', response.status, rawDetail)
    const msg = extractErrorMessage(data, `Groww token fetch failed (${response.status})`)
    throw new Error(`${msg} | raw: ${rawDetail}`)
  }

  const expiryRaw = data?.payload?.expiry || data?.payload?.expires_at || data?.expiry || null
  // Groww resets all tokens at 6 AM IST daily. If API doesn't return expiry, calculate it.
  const tokenExpiresAt = expiryRaw ? new Date(expiryRaw) : nextGrowwReset()

  return { accessToken, tokenExpiresAt, keyType, raw: data }
}

async function placeGrowwOrder(
  accessToken: string,
  input: BrokerPlaceOrderInput,
  tradingSymbol: string
): Promise<BrokerPlaceOrderResult> {
  const payload: Record<string, any> = {
    trading_symbol: tradingSymbol,
    quantity: input.quantity,
    validity: 'DAY',
    exchange: mapExchange(input.stock.growwExchange || input.stock.exchange),
    segment: 'CASH',
    product: mapProduct(input.productType),
    order_type: input.orderType,
    transaction_type: input.side,
    order_reference_id: makeOrderReference(input.idempotencyKey),
  }

  if (input.orderType === 'LIMIT') {
    const price = Number(input.price || 0)
    if (!price || price <= 0) throw new Error('LIMIT order requires a valid price')
    payload.price = price
  }

  const response = await brokerFetch(`${GROWW_API_BASE_URL}/v1/order/create`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-VERSION': GROWW_API_VERSION,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  })

  const data = await parseJsonSafe(response)
  const orderId = data?.payload?.groww_order_id || data?.payload?.order_id || data?.order_id || null
  const apiStatus = String(data?.status || '').toUpperCase()
  const status = data?.payload?.order_status || data?.status
  if (!response.ok || apiStatus !== 'SUCCESS' || !orderId) {
    const msg = extractErrorMessage(data, `Groww order failed (${response.status})`)
    throw Object.assign(new Error(msg), { __growwData: data })
  }

  return {
    brokerOrderId: String(orderId),
    status: status || 'PLACED',
    raw: data,
  }
}

export class GrowwAdapter implements BrokerAdapter {
  name = 'GROWW' as const

  async connectStart(input: BrokerConnectStartInput): Promise<BrokerConnectStartResult> {
    ensure(input.credentials.apiKey, 'apiKey')
    ensure(input.credentials.apiSecret, 'apiSecret')

    // Groww key exchange is server-to-server. Reuse callback route for consistency with existing flow.
    const callbackUrl = new URL(input.redirectUri)
    callbackUrl.searchParams.set('state', input.state)

    return {
      redirectUrl: callbackUrl.toString(),
      meta: {
        flow: 'api-token',
      },
    }
  }

  async connectCallback(input: BrokerConnectCallbackInput): Promise<BrokerConnectCallbackResult> {
    const token = await requestAccessToken(input.credentials)
    return {
      accessToken: token.accessToken,
      tokenExpiresAt: token.tokenExpiresAt,
      meta: {
        keyType: token.keyType,
      },
    }
  }

  async refreshIfNeeded(credentials: BrokerCredentials): Promise<BrokerCredentials> {
    // Groww resets tokens at 6 AM IST daily. Do not silently re-fetch access tokens:
    // after expiry the user must click Connect in Trading Settings again (credentials stay saved).
    return credentials
  }

  async placeOrder(input: BrokerPlaceOrderInput): Promise<BrokerPlaceOrderResult> {
    const accessToken = ensure(input.credentials.accessToken, 'accessToken')
    const explicitTradingSymbol = input.stock.growwTradingSymbol || input.symbol

    try {
      return await placeGrowwOrder(accessToken, input, explicitTradingSymbol)
    } catch (error: any) {
      const data = error?.__growwData
      if (shouldRetryWithEqSymbol(data, explicitTradingSymbol)) {
        return placeGrowwOrder(accessToken, input, `${input.symbol}-EQ`)
      }
      throw error
    }
  }

  async getHoldings(credentials: BrokerCredentials): Promise<BrokerHolding[]> {
    const accessToken = ensure(credentials.accessToken, 'accessToken')

    const response = await brokerFetch(`${GROWW_API_BASE_URL}/v1/holdings/user`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-VERSION': GROWW_API_VERSION,
        Authorization: `Bearer ${accessToken}`,
      },
    })

    const data = await parseJsonSafe(response)
    // Groww docs: { status, payload: { holdings: [...] } }
    // Post-SEBI some endpoints drop the wrapper, try all patterns
    const raw =
      data?.payload?.holdings ??
      data?.data ??
      data?.payload?.holdingData ??
      data?.holdingData ??
      data?.holdings ??
      []

    if (!Array.isArray(raw)) {
      throw new Error(`Groww holdings: unexpected shape | keys: ${Object.keys(data || {}).join(',')} | raw: ${JSON.stringify(data).slice(0, 300)}`)
    }

    return raw.map((h: any) => {
      const qty = Number(h.quantity ?? h.holdingQuantity ?? h.availableQty ?? 0)
      const avg = Number(h.average_price ?? h.averagePrice ?? h.avgPrice ?? h.buyAvgPrice ?? 0)
      const ltp = Number(h.ltp ?? h.lastTradedPrice ?? h.close_price ?? h.currentPrice ?? avg)
      const invested = qty * avg
      const current = qty * ltp
      return {
        symbol: String(h.trading_symbol ?? h.tradingSymbol ?? h.symbol ?? h.scripName ?? ''),
        quantity: qty,
        averagePrice: avg,
        ltp,
        investedValue: invested,
        currentValue: current,
        pnl: current - invested,
        pnlPercent: invested > 0 ? ((current - invested) / invested) * 100 : 0,
        exchange: String(h.exchange ?? h.exchangeCode ?? 'NSE'),
      }
    }).filter(h => h.symbol && h.quantity > 0)
  }
}

export const growwAdapter = new GrowwAdapter()

import crypto from 'crypto'
import type {
  BrokerAdapter,
  BrokerConnectCallbackInput,
  BrokerConnectCallbackResult,
  BrokerConnectStartInput,
  BrokerConnectStartResult,
  BrokerHolding,
  BrokerPlaceOrderInput,
  BrokerPlaceOrderResult,
} from '@/lib/brokers/types'
import { brokerFetch } from '@/lib/brokers/proxy-fetch'

const ZERODHA_LOGIN_URL = 'https://kite.trade/connect/login'
const ZERODHA_BASE_URL = process.env.ZERODHA_API_BASE_URL || 'https://api.kite.trade'

function mapProduct(productType: 'INTRADAY' | 'DELIVERY'): string {
  return productType === 'INTRADAY' ? 'MIS' : 'CNC'
}

function ensure(value: string | null | undefined, field: string) {
  if (!value) throw new Error(`Missing Zerodha ${field}`)
  return value
}

async function parseJsonSafe(response: Response): Promise<any> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

export class ZerodhaAdapter implements BrokerAdapter {
  name = 'ZERODHA' as const

  async connectStart(input: BrokerConnectStartInput): Promise<BrokerConnectStartResult> {
    const apiKey = ensure(input.credentials.apiKey, 'apiKey')
    const params = new URLSearchParams({
      api_key: apiKey,
      v: '3',
      state: input.state,
    })

    return {
      redirectUrl: `${ZERODHA_LOGIN_URL}?${params.toString()}`,
    }
  }

  async connectCallback(input: BrokerConnectCallbackInput): Promise<BrokerConnectCallbackResult> {
    const apiKey = ensure(input.credentials.apiKey, 'apiKey')
    const apiSecret = ensure(input.credentials.apiSecret, 'apiSecret')

    const requestToken = input.query.get('request_token')
    if (!requestToken) {
      throw new Error('Zerodha callback missing request_token')
    }

    const checksum = crypto
      .createHash('sha256')
      .update(`${apiKey}${requestToken}${apiSecret}`)
      .digest('hex')

    const body = new URLSearchParams({
      api_key: apiKey,
      request_token: requestToken,
      checksum,
    })

    const response = await brokerFetch(`${ZERODHA_BASE_URL}/session/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Kite-Version': '3',
      },
      body,
    })

    const data = await parseJsonSafe(response)
    if (!response.ok || data?.status !== 'success' || !data?.data?.access_token) {
      const msg = data?.message || data?.error_type || `Zerodha token exchange failed (${response.status})`
      throw new Error(msg)
    }

    const d = data.data
    return {
      accessToken: d.access_token,
      tokenExpiresAt: null,
      meta: {
        userId: d.user_id || null,
        userName: d.user_name || null,
        email: d.email || null,
        publicToken: d.public_token || null,
      },
    }
  }

  async placeOrder(input: BrokerPlaceOrderInput): Promise<BrokerPlaceOrderResult> {
    const apiKey = ensure(input.credentials.apiKey, 'apiKey')
    const accessToken = ensure(input.credentials.accessToken, 'accessToken')

    const tradingsymbol = input.stock.zerodhaTradingSymbol || input.symbol
    const exchange = input.stock.zerodhaExchange || input.stock.exchange || 'NSE'

    const params = new URLSearchParams({
      exchange,
      tradingsymbol,
      transaction_type: input.side,
      quantity: String(input.quantity),
      order_type: input.orderType,
      product: mapProduct(input.productType),
      validity: 'DAY',
      tag: input.idempotencyKey.slice(0, 20),
    })

    if (input.orderType === 'LIMIT') {
      const price = input.price ?? 0
      if (price <= 0) throw new Error('LIMIT order requires a valid price')
      params.set('price', String(price))
    }

    const response = await brokerFetch(`${ZERODHA_BASE_URL}/orders/regular`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Kite-Version': '3',
        Authorization: `token ${apiKey}:${accessToken}`,
      },
      body: params,
    })

    const data = await parseJsonSafe(response)
    if (!response.ok || data?.status !== 'success' || !data?.data?.order_id) {
      const msg = data?.message || data?.error_type || `Zerodha order failed (${response.status})`
      throw new Error(msg)
    }

    return {
      brokerOrderId: data.data.order_id,
      status: 'PLACED',
      raw: data,
    }
  }

  async getHoldings(credentials: Parameters<BrokerAdapter['placeOrder']>[0]['credentials']): Promise<BrokerHolding[]> {
    const apiKey = ensure(credentials.apiKey, 'apiKey')
    const accessToken = ensure(credentials.accessToken, 'accessToken')

    const response = await brokerFetch(`${ZERODHA_BASE_URL}/portfolio/holdings`, {
      method: 'GET',
      headers: {
        'X-Kite-Version': '3',
        Authorization: `token ${apiKey}:${accessToken}`,
      },
    })

    const data = await parseJsonSafe(response)
    const raw = data?.data ?? data?.holdings ?? []

    if (!Array.isArray(raw)) {
      throw new Error(`Zerodha holdings: unexpected shape | ${JSON.stringify(data).slice(0, 200)}`)
    }

    return raw.map((h: any) => {
      const qty = Number(h.quantity ?? 0)
      const avg = Number(h.average_price ?? 0)
      const ltp = Number(h.last_price ?? h.close_price ?? avg)
      const invested = qty * avg
      const current = qty * ltp
      return {
        symbol: String(h.tradingsymbol ?? h.trading_symbol ?? ''),
        quantity: qty,
        averagePrice: avg,
        ltp,
        investedValue: invested,
        currentValue: current,
        pnl: Number(h.pnl ?? (current - invested)),
        pnlPercent: invested > 0 ? ((current - invested) / invested) * 100 : 0,
        exchange: String(h.exchange ?? 'NSE'),
      }
    }).filter(h => h.symbol && h.quantity > 0)
  }
}

export const zerodhaAdapter = new ZerodhaAdapter()

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

const DHAN_AUTH_BASE_URL = process.env.DHAN_AUTH_BASE_URL || 'https://auth.dhan.co'
const DHAN_API_BASE_URL = process.env.DHAN_API_BASE_URL || 'https://api.dhan.co'

function ensure(value: string | null | undefined, field: string) {
  if (!value) throw new Error(`Missing Dhan ${field}`)
  return value
}

function mapExchangeSegment(exchange?: string | null): string {
  if ((exchange || '').toUpperCase() === 'BSE') return 'BSE_EQ'
  return 'NSE_EQ'
}

function mapProduct(productType: 'INTRADAY' | 'DELIVERY'): string {
  return productType === 'INTRADAY' ? 'INTRADAY' : 'CNC'
}

async function parseJsonSafe(response: Response): Promise<any> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

export class DhanAdapter implements BrokerAdapter {
  name = 'DHAN' as const

  async connectStart(input: BrokerConnectStartInput): Promise<BrokerConnectStartResult> {
    const apiKey = ensure(input.credentials.apiKey, 'apiKey')
    const apiSecret = ensure(input.credentials.apiSecret, 'apiSecret')
    const clientId = ensure(input.credentials.clientId, 'clientId')

    const response = await brokerFetch(
      `${DHAN_AUTH_BASE_URL}/app/generate-consent?client_id=${encodeURIComponent(clientId)}`,
      {
        method: 'POST',
        headers: {
          app_id: apiKey,
          app_secret: apiSecret,
        },
      }
    )

    const data = await parseJsonSafe(response)
    if (!response.ok || !data?.consentAppId) {
      const msg = data?.message || data?.error || `Dhan consent generation failed (${response.status})`
      throw new Error(msg)
    }

    const consentAppId = data.consentAppId as string
    return {
      redirectUrl: `${DHAN_AUTH_BASE_URL}/login/consentApp-login?consentAppId=${encodeURIComponent(consentAppId)}`,
      meta: {
        consentAppId,
        consentAppStatus: data?.consentAppStatus || null,
      },
    }
  }

  async connectCallback(input: BrokerConnectCallbackInput): Promise<BrokerConnectCallbackResult> {
    const apiKey = ensure(input.credentials.apiKey, 'apiKey')
    const apiSecret = ensure(input.credentials.apiSecret, 'apiSecret')

    const tokenId = input.query.get('tokenId') || input.query.get('tokenid')
    if (!tokenId) {
      throw new Error('Dhan callback missing tokenId')
    }

    const response = await brokerFetch(
      `${DHAN_AUTH_BASE_URL}/app/consumeApp-consent?tokenId=${encodeURIComponent(tokenId)}`,
      {
        method: 'GET',
        headers: {
          app_id: apiKey,
          app_secret: apiSecret,
        },
      }
    )

    const data = await parseJsonSafe(response)
    if (!response.ok || !data?.accessToken) {
      const msg = data?.message || data?.error || `Dhan token exchange failed (${response.status})`
      throw new Error(msg)
    }

    const tokenExpiresAt = data?.expiryTime ? new Date(data.expiryTime) : null

    return {
      accessToken: data.accessToken,
      tokenExpiresAt,
      meta: {
        dhanClientId: data?.dhanClientId || null,
        dhanClientName: data?.dhanClientName || null,
        dhanClientUcc: data?.dhanClientUcc || null,
        givenPowerOfAttorney: data?.givenPowerOfAttorney ?? null,
      },
    }
  }

  async placeOrder(input: BrokerPlaceOrderInput): Promise<BrokerPlaceOrderResult> {
    const accessToken = ensure(input.credentials.accessToken, 'accessToken')
    const clientId = ensure(input.credentials.clientId, 'clientId')
    const securityId = input.stock.dhanSecurityId

    if (!securityId) {
      throw new Error(`Dhan securityId mapping missing for ${input.symbol}`)
    }

    const payload = {
      dhanClientId: clientId,
      correlationId: input.idempotencyKey.slice(0, 36),
      transactionType: input.side,
      exchangeSegment: mapExchangeSegment(input.stock.exchange),
      productType: mapProduct(input.productType),
      orderType: input.orderType,
      validity: 'DAY',
      securityId,
      quantity: input.quantity,
      disclosedQuantity: 0,
      price: input.orderType === 'LIMIT' ? Number(input.price || 0) : 0,
      triggerPrice: 0,
      afterMarketOrder: false,
    }

    if (input.orderType === 'LIMIT' && (!input.price || input.price <= 0)) {
      throw new Error('LIMIT order requires a valid price')
    }

    const response = await brokerFetch(`${DHAN_API_BASE_URL}/v2/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access-token': accessToken,
      },
      body: JSON.stringify(payload),
    })

    const data = await parseJsonSafe(response)
    if (!response.ok || !data?.orderId) {
      const msg = data?.message || data?.error || `Dhan order failed (${response.status})`
      throw new Error(msg)
    }

    return {
      brokerOrderId: data.orderId,
      status: data.orderStatus || 'PENDING',
      raw: data,
    }
  }

  async getHoldings(credentials: BrokerConnectCallbackInput['credentials']): Promise<BrokerHolding[]> {
    const accessToken = ensure(credentials.accessToken, 'accessToken')

    // Dhan v2 holdings endpoint
    const response = await brokerFetch(`${DHAN_API_BASE_URL}/v2/holdings`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'access-token': accessToken,
      },
    })

    const data = await parseJsonSafe(response)
    // Dhan returns array directly or nested
    const raw = Array.isArray(data) ? data : (data?.data ?? data?.holdings ?? [])

    if (!Array.isArray(raw)) {
      throw new Error(`Dhan holdings: unexpected shape | ${JSON.stringify(data).slice(0, 200)}`)
    }

    return raw.map((h: any) => {
      const qty = Number(h.totalQty ?? h.availableQty ?? h.quantity ?? 0)
      const avg = Number(h.avgCostPrice ?? h.averagePrice ?? 0)
      // Dhan does not return LTP in holdings — will be enriched by cascading price fetch in route
      const ltp = avg
      const invested = qty * avg
      return {
        symbol: String(h.tradingSymbol ?? h.symbol ?? ''),
        quantity: qty,
        averagePrice: avg,
        ltp,
        investedValue: invested,
        currentValue: invested,
        pnl: 0,
        pnlPercent: 0,
        exchange: String(h.exchange ?? 'NSE'),
      }
    }).filter(h => h.symbol && h.quantity > 0)
  }
}

export const dhanAdapter = new DhanAdapter()

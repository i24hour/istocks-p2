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

const ANGELONE_BASE_URL = process.env.ANGELONE_API_BASE_URL || 'https://apiconnect.angelone.in'
const ANGELONE_PUBLISHER_URL = 'https://smartapi.angelone.in/publisher-login'

function ensure(value: string | null | undefined, field: string) {
  if (!value) throw new Error(`Missing Angel One ${field}`)
  return value
}

async function parseJsonSafe(response: Response): Promise<any> {
  const text = await response.text()
  try { return JSON.parse(text) } catch { return { raw: text } }
}

function extractError(data: any, fallback: string): string {
  return data?.message || data?.errorcode || data?.error || fallback
}

// Angel One tokens expire at midnight daily
function nextAngelOneReset(): Date {
  const now = new Date()
  const reset = new Date(now)
  // Midnight IST = 18:30 UTC previous day. Use 18:31 UTC to be safe.
  reset.setUTCHours(18, 31, 0, 0)
  if (reset <= now) reset.setUTCDate(reset.getUTCDate() + 1)
  return reset
}

function getAngelHeaders(apiKey: string, jwtToken?: string) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-PrivateKey': apiKey,
    ...(jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {}),
  }
}

export class AngelOneAdapter implements BrokerAdapter {
  name = 'ANGELONE' as const

  // Step 1: Redirect to Angel One publisher login URL
  async connectStart(input: BrokerConnectStartInput): Promise<BrokerConnectStartResult> {
    const apiKey = ensure(input.credentials.apiKey, 'apiKey')

    const redirectUrl = new URL(ANGELONE_PUBLISHER_URL)
    redirectUrl.searchParams.set('api_key', apiKey)
    redirectUrl.searchParams.set('redirect_url', input.redirectUri)
    redirectUrl.searchParams.set('state', input.state)

    return { redirectUrl: redirectUrl.toString() }
  }

  // Step 2: Exchange auth_token from callback for jwtToken
  async connectCallback(input: BrokerConnectCallbackInput): Promise<BrokerConnectCallbackResult> {
    const apiKey = ensure(input.credentials.apiKey, 'apiKey')

    // Angel One publisher login returns auth_token + feed_token as query params
    const authToken = input.query.get('auth_token') || input.query.get('authtoken')
    const feedToken = input.query.get('feed_token') || input.query.get('feedtoken')

    if (!authToken) {
      throw new Error('Angel One callback missing auth_token')
    }

    // Generate access token from auth_token
    const response = await brokerFetch(`${ANGELONE_BASE_URL}/rest/auth/angelbroking/jwt/v1/generateTokens`, {
      method: 'POST',
      headers: getAngelHeaders(apiKey),
      body: JSON.stringify({ refreshToken: authToken }),
    })

    const data = await parseJsonSafe(response)
    if (!data?.status || !data?.data?.jwtToken) {
      // auth_token itself is the JWT in some flows
      if (authToken.startsWith('eyJ')) {
        return {
          accessToken: authToken,
          tokenExpiresAt: nextAngelOneReset(),
          meta: { feedToken, authToken },
        }
      }
      const msg = extractError(data, `Angel One token exchange failed (${response.status})`)
      throw new Error(msg)
    }

    return {
      accessToken: data.data.jwtToken,
      tokenExpiresAt: nextAngelOneReset(),
      meta: {
        refreshToken: data.data.refreshToken ?? authToken,
        feedToken: data.data.feedToken ?? feedToken,
        clientCode: data.data.clientcode || null,
      },
    }
  }

  async refreshIfNeeded(credentials: BrokerCredentials): Promise<BrokerCredentials> {
    const stillValid =
      !!credentials.accessToken &&
      !!credentials.tokenExpiresAt &&
      credentials.tokenExpiresAt.getTime() > Date.now() + 60_000

    if (stillValid) return credentials

    const apiKey = credentials.apiKey
    if (!apiKey) return credentials

    const refreshToken = (credentials.meta as any)?.refreshToken
    if (!refreshToken) return credentials

    try {
      const response = await brokerFetch(`${ANGELONE_BASE_URL}/rest/auth/angelbroking/jwt/v1/generateTokens`, {
        method: 'POST',
        headers: getAngelHeaders(apiKey),
        body: JSON.stringify({ refreshToken }),
      })
      const data = await parseJsonSafe(response)
      if (data?.status && data?.data?.jwtToken) {
        return {
          ...credentials,
          accessToken: data.data.jwtToken,
          tokenExpiresAt: nextAngelOneReset(),
          meta: {
            ...(credentials.meta as object || {}),
            refreshToken: data.data.refreshToken ?? refreshToken,
            feedToken: data.data.feedToken ?? (credentials.meta as any)?.feedToken,
          },
        }
      }
    } catch { /* fallback to existing */ }

    return credentials
  }

  async placeOrder(input: BrokerPlaceOrderInput): Promise<BrokerPlaceOrderResult> {
    const apiKey = ensure(input.credentials.apiKey, 'apiKey')
    const jwtToken = ensure(input.credentials.accessToken, 'accessToken')

    const payload = {
      variety: 'NORMAL',
      tradingsymbol: input.stock.symbol || input.symbol,
      symboltoken: input.stock.symbol, // We don't have Angel One token IDs — workaround
      transactiontype: input.side,
      exchange: (input.stock.exchange || 'NSE').toUpperCase(),
      ordertype: input.orderType,
      producttype: input.productType === 'INTRADAY' ? 'INTRADAY' : 'DELIVERY',
      duration: 'DAY',
      price: input.orderType === 'LIMIT' ? String(input.price ?? 0) : '0',
      quantity: String(input.quantity),
      ordertag: input.idempotencyKey.slice(0, 20),
    }

    const response = await brokerFetch(`${ANGELONE_BASE_URL}/rest/secure/angelbroking/order/v1/placeOrder`, {
      method: 'POST',
      headers: getAngelHeaders(apiKey, jwtToken),
      body: JSON.stringify(payload),
    })

    const data = await parseJsonSafe(response)
    if (!data?.status || !data?.data?.orderid) {
      const msg = extractError(data, `Angel One order failed (${response.status})`)
      throw new Error(msg)
    }

    return {
      brokerOrderId: data.data.orderid,
      status: 'PLACED',
      raw: data,
    }
  }

  async getHoldings(credentials: BrokerCredentials): Promise<BrokerHolding[]> {
    const apiKey = ensure(credentials.apiKey, 'apiKey')
    const jwtToken = ensure(credentials.accessToken, 'accessToken')

    const response = await brokerFetch(
      `${ANGELONE_BASE_URL}/rest/secure/angelbroking/portfolio/v1/getAllHolding`,
      {
        method: 'GET',
        headers: getAngelHeaders(apiKey, jwtToken),
      }
    )

    const data = await parseJsonSafe(response)
    // Angel One: { status: true, data: { holdings: [...], totalholding: {...} } }
    const raw = data?.data?.holdings ?? data?.holdings ?? data?.data ?? []

    if (!Array.isArray(raw)) {
      throw new Error(`Angel One holdings: unexpected shape | ${JSON.stringify(data).slice(0, 200)}`)
    }

    return raw.map((h: any) => {
      const qty = Number(h.quantity ?? h.t1quantity ?? h.realisedquantity ?? 0)
      const avg = Number(h.averageprice ?? h.average_price ?? 0)
      // Angel One returns LTP and P&L directly!
      const ltp = Number(h.ltp ?? h.close ?? avg)
      const invested = qty * avg
      const current = qty * ltp
      return {
        symbol: String(h.tradingsymbol ?? h.trading_symbol ?? ''),
        quantity: qty,
        averagePrice: avg,
        ltp,
        investedValue: invested,
        currentValue: current,
        pnl: Number(h.profitandloss ?? (current - invested)),
        pnlPercent: Number(h.pnlpercentage ?? (invested > 0 ? ((current - invested) / invested) * 100 : 0)),
        exchange: String(h.exchange ?? 'NSE'),
      }
    }).filter(h => h.symbol && h.quantity > 0)
  }
}

export const angelOneAdapter = new AngelOneAdapter()

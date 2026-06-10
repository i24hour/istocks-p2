import { prisma } from '@/lib/prisma'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { getBrokerAdapter } from '@/lib/brokers/factory'
import { resolveCanonicalSymbol } from '@/lib/instrumentRegistry'
import { getFreshEC2Quote, isNSEMarketSessionLive } from '@/lib/market-session'
import { fetchLiveMarketQuote } from '@/lib/yahoo-finance'
import { getUserPlan, PLANS } from '@/lib/subscription'
import {
  isBrokerName,
  normalizeMode,
  normalizeOrderType,
  normalizeProductType,
  type TradeExecutionRequest,
  type TradeExecutionResult,
  type TradingMode,
} from '@/lib/trading/types'
import { invalidateExpiredGrowwConnection } from '@/lib/trading/groww-token-gate'

const LIVE_TRADING_ENABLED = (process.env.LIVE_TRADING_ENABLED || 'false').toLowerCase() === 'true'
const LIVE_MAX_ORDER_VALUE = Number(process.env.LIVE_MAX_ORDER_VALUE || 500000)

const LIVE_PRICE_URL = process.env.EC2_LIVE_SERVER_URL
  ? `${process.env.EC2_LIVE_SERVER_URL}/prices`
  : null

async function fetchLivePrice(symbol: string): Promise<number | null> {
  if (!LIVE_PRICE_URL) return null

  try {
    const response = await fetch(LIVE_PRICE_URL, { cache: 'no-store' })
    if (!response.ok) return null
    const data = await response.json()
    const ltp = data?.data?.[symbol]?.ltp
    return typeof ltp === 'number' && ltp > 0 ? ltp : null
  } catch {
    return null
  }
}

function validateRequest(body: TradeExecutionRequest) {
  if (!body.symbol?.trim()) throw new Error('symbol is required')
  if (!body.side || !['BUY', 'SELL'].includes(body.side)) throw new Error('side must be BUY or SELL')
  if (!body.quantity || body.quantity <= 0) throw new Error('quantity must be > 0')
  if (!body.idempotencyKey?.trim()) throw new Error('idempotencyKey is required')
}

async function getOrderValueEstimate(symbol: string, quantity: number, price?: number | null): Promise<number> {
  if (price && price > 0) return price * quantity
  const ltp = await fetchLivePrice(symbol)
  return (ltp || 0) * quantity
}

function buildMarketOpenPendingCondition(sessionId?: string) {
  return {
    sessionId: sessionId || null,
    source: 'auto-market-open-queue',
    queueReason: 'MARKET_CLOSED_OR_EC2_UNAVAILABLE',
    autoExecuteOnMarketOpen: true,
    queuedAt: new Date().toISOString(),
    conditions: [
      {
        indicator: 'MARKET_OPEN',
        operator: '>=',
        threshold: 1,
        currentValue: 0,
        isMet: false,
      },
    ],
  }
}

async function findExistingByIdempotency(idempotencyKey: string): Promise<TradeExecutionResult | null> {
  const existing = await prisma.tradingOrder.findUnique({
    where: { idempotencyKey },
  })

  if (!existing) return null

  return {
    success: true,
    mode: existing.tradingMode as TradingMode,
    symbol: existing.symbol,
    side: existing.orderType as 'BUY' | 'SELL',
    quantity: existing.quantity,
    brokerName: existing.brokerName as any,
    orderId: existing.id,
    brokerOrderId: existing.brokerOrderId || undefined,
    executedPrice: existing.executedPrice,
    status: existing.status,
    message: 'Duplicate idempotency key: returning previous order result',
    rawBrokerResponse: existing.rawBrokerResponse || undefined,
  }
}

export async function executeTradeForUser(
  userId: string,
  body: TradeExecutionRequest
): Promise<TradeExecutionResult> {
  validateRequest(body)

  const existing = await findExistingByIdempotency(body.idempotencyKey!)
  if (existing) return existing

  const symbol = await resolveCanonicalSymbol(body.symbol)
  if (!symbol) throw new Error('Could not resolve symbol')

  const mode = normalizeMode(body.mode)
  const orderType = normalizeOrderType(body.orderType)
  const productType = normalizeProductType(body.productType)

  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: {
      symbol: true,
      exchange: true,
      dhanSecurityId: true,
      zerodhaTradingSymbol: true,
      zerodhaExchange: true,
    },
  })

  const stockMapping = stock || {
    symbol,
    exchange: 'NSE',
    dhanSecurityId: null,
    zerodhaTradingSymbol: null,
    zerodhaExchange: null,
  }

  let estimatedValue = await getOrderValueEstimate(symbol, body.quantity, body.price)
  const marketSessionLive = isNSEMarketSessionLive()
  const liveQuoteCheck = await getFreshEC2Quote(symbol)
  let yahooFallbackPrice: number | null = null

  // Yahoo fallback: if EC2 is unavailable, try Yahoo for price estimation (PAPER and LIVE).
  if (marketSessionLive && !liveQuoteCheck.ok) {
    const yahooQuote = await fetchLiveMarketQuote(symbol)
    if (yahooQuote.ok && Number.isFinite(yahooQuote.quote.price) && yahooQuote.quote.price > 0) {
      yahooFallbackPrice = Number(yahooQuote.quote.price)
    }
  }

  // If EC2 was down and estimatedValue was 0, use Yahoo price for the order value estimate.
  if (estimatedValue <= 0 && yahooFallbackPrice !== null) {
    estimatedValue = yahooFallbackPrice * body.quantity
  }

  // PAPER mode: enforce plan-based paper trade limit
  if (mode === 'PAPER') {
    const planId = await getUserPlan(userId)
    const paperMax = PLANS[planId].paperTradeMax
    if (estimatedValue > paperMax) {
      throw new Error(
        `Paper trade blocked: order value ₹${estimatedValue.toLocaleString('en-IN')} exceeds your plan limit of ₹${paperMax.toLocaleString('en-IN')}. ` +
        (planId === 'free' ? 'Upgrade to Pro for ₹1 Crore limit.' : 'Contact support.')
      )
    }
  }

  const canExecuteNow = mode === 'PAPER'
    ? (marketSessionLive && (liveQuoteCheck.ok || yahooFallbackPrice !== null))
    : (marketSessionLive && liveQuoteCheck.ok)

  if (mode === 'LIVE') {
    await invalidateExpiredGrowwConnection(userId)
    if (!marketSessionLive) {
      throw new Error('Live trade blocked: market is closed (Mon-Fri, 09:15-15:30 IST).')
    }
    // EC2 is only used for price estimation — for LIVE orders, the broker is the authority.
    // Block only if we have no price source at all (EC2 down, Yahoo down, no limit price).
    if (!liveQuoteCheck.ok && yahooFallbackPrice === null && !(body.price && body.price > 0)) {
      throw new Error('Live trade blocked: could not fetch a live price for this symbol. Try again or use a LIMIT order with an explicit price.')
    }
    if (!LIVE_TRADING_ENABLED) {
      throw new Error('Live trading is disabled by server configuration')
    }
    if (!body.confirmed) {
      throw new Error('Live orders require explicit confirmation')
    }
    if (estimatedValue > LIVE_MAX_ORDER_VALUE) {
      throw new Error(`Order value exceeds LIVE_MAX_ORDER_VALUE (${LIVE_MAX_ORDER_VALUE})`)
    }

    const preference = await prisma.userTradingPreference.findUnique({ where: { userId } })
    const selectedBroker = body.brokerName || preference?.preferredLiveBroker || null

    if (!isBrokerName(selectedBroker)) {
      throw new Error('No preferred live broker configured. Set Zerodha, Dhan, or Groww in trading settings.')
    }

    const connection = await prisma.brokerConnection.findUnique({
      where: {
        userId_brokerName: {
          userId,
          brokerName: selectedBroker,
        },
      },
    })

    if (!connection || !connection.isConnected) {
      throw new Error(`${selectedBroker} is not connected. Connect broker in Trading Settings.`)
    }

    const credentials = {
      apiKey: decryptSecret(connection.apiKeyEnc),
      apiSecret: decryptSecret(connection.apiSecretEnc),
      clientId: decryptSecret(connection.clientIdEnc),
      accessToken: decryptSecret(connection.accessTokenEnc),
      tokenExpiresAt: connection.tokenExpiresAt,
      meta: (connection.metaJson as Record<string, unknown> | null) || null,
    }

    const adapter = getBrokerAdapter(selectedBroker)
    const refreshedCreds = adapter.refreshIfNeeded
      ? await adapter.refreshIfNeeded(credentials)
      : credentials

    const brokerOrder = await adapter.placeOrder({
      symbol,
      side: body.side,
      quantity: body.quantity,
      orderType,
      productType,
      price: body.price,
      idempotencyKey: body.idempotencyKey!,
      stock: stockMapping,
      credentials: refreshedCreds,
    })

    if (refreshedCreds.accessToken && refreshedCreds.accessToken !== credentials.accessToken) {
      await prisma.brokerConnection.update({
        where: {
          userId_brokerName: {
            userId,
            brokerName: selectedBroker,
          },
        },
        data: {
          accessTokenEnc: encryptSecret(refreshedCreds.accessToken),
          tokenExpiresAt: refreshedCreds.tokenExpiresAt || null,
          lastValidatedAt: new Date(),
        },
      })
    }

    const order = await prisma.tradingOrder.create({
      data: {
        userId,
        symbol,
        orderType: body.side,
        productType,
        quantity: body.quantity,
        status: 'EXECUTED',
        tradingMode: 'LIVE',
        brokerName: selectedBroker,
        brokerOrderId: brokerOrder.brokerOrderId,
        brokerStatus: brokerOrder.status,
        rawBrokerResponse: brokerOrder.raw as any,
        idempotencyKey: body.idempotencyKey,
        entryPrice: orderType === 'LIMIT' ? body.price || null : null,
        executedPrice: orderType === 'LIMIT' ? body.price || null : null,
        executedAt: new Date(),
        positionValue: estimatedValue,
      },
    })

    return {
      success: true,
      mode: 'LIVE',
      symbol,
      side: body.side,
      quantity: body.quantity,
      brokerName: selectedBroker,
      orderId: order.id,
      brokerOrderId: brokerOrder.brokerOrderId,
      executedPrice: order.executedPrice,
      status: order.status,
      message: `Live order sent via ${selectedBroker}`,
      rawBrokerResponse: brokerOrder.raw,
    }
  }

  if (!canExecuteNow) {
    const queuedOrder = await prisma.tradingOrder.create({
      data: {
        userId,
        symbol,
        orderType: body.side,
        productType,
        quantity: body.quantity,
        status: 'PENDING',
        tradingMode: 'PAPER',
        idempotencyKey: body.idempotencyKey,
        entryCondition: buildMarketOpenPendingCondition(body.sessionId) as any,
        positionValue: 0,
      },
    })

    const pendingReason = !marketSessionLive
      ? 'Market is currently closed.'
      : liveQuoteCheck.ok
        ? 'Execution is temporarily unavailable.'
        : liveQuoteCheck.reason

    const autoExecHint = !marketSessionLive
      ? 'It will auto-execute when market opens.'
      : 'It will auto-execute during market hours once live execution feed is available.'

    return {
      success: true,
      mode: 'PAPER',
      symbol,
      side: body.side,
      quantity: body.quantity,
      orderId: queuedOrder.id,
      executedPrice: null,
      status: 'PENDING',
      deferred: true,
      deferredReason: pendingReason,
      message: `${pendingReason} Trade moved to Conditional. ${autoExecHint}`,
    }
  }

  const executionQuote = liveQuoteCheck.ok
    ? { price: liveQuoteCheck.price, source: 'EC2' as const }
    : yahooFallbackPrice !== null
      ? { price: yahooFallbackPrice, source: 'YAHOO' as const }
      : null

  const executionPrice = orderType === 'LIMIT'
    ? (body.price || executionQuote?.price || null)
    : (executionQuote?.price || null)
  if (!executionPrice || executionPrice <= 0) {
    throw new Error(`Could not fetch live price for ${symbol}`)
  }

  const paperOrder = await prisma.tradingOrder.create({
    data: {
      userId,
      symbol,
      orderType: body.side,
      productType,
      quantity: body.quantity,
      status: 'EXECUTED',
      tradingMode: 'PAPER',
      idempotencyKey: body.idempotencyKey,
      entryPrice: orderType === 'LIMIT' ? body.price || null : null,
      executedPrice: executionPrice,
      executedAt: new Date(),
      positionValue: executionPrice * body.quantity,
      entryCondition: (body.userPrompt || body.targetProfitPct != null || body.strategyParams?.length || body.conditions?.length) ? {
        sessionId: body.sessionId || null,
        userPrompt: body.userPrompt,
        targetProfitPct: body.targetProfitPct,
        strategyParams: body.strategyParams,
        conditions: body.conditions,
      } as any : undefined,
      rawBrokerResponse: {
        executionPriceSource: executionQuote?.source || 'UNKNOWN',
      } as any,
    },
  })

  return {
    success: true,
    mode: 'PAPER',
    symbol,
    side: body.side,
    quantity: body.quantity,
    orderId: paperOrder.id,
    executedPrice: executionPrice,
    status: paperOrder.status,
    message: executionQuote?.source === 'YAHOO'
      ? `Paper order executed for ${symbol} (Yahoo live fallback price)`
      : `Paper order executed for ${symbol}`,
  }
}

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession } from '@/lib/auth'
import { fetchEC2AllPrices } from '@/lib/ec2-helpers'
import { getFreshEC2Quote, isNSEMarketSessionLive } from '@/lib/market-session'
import { processPendingPaperTrades } from '@/lib/pending-paper-trades'
import { batchQuote, fetchLiveMarketQuote } from '@/lib/yahoo-finance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'

type HoldingCondition = {
  indicator: string
  operator: '<' | '<=' | '>' | '>=' | '='
  threshold: number
  currentValue?: number
  isMet?: boolean
}

type PendingEntryCondition = {
  conditions?: HoldingCondition[]
  sessionId?: string | null
  targetProfitPct?: number
  targetPrice?: number
  strategyParams?: Array<{ key: string; label: string; value: string }>
  userPrompt?: string
  [key: string]: unknown
}

async function fetchYahooFallbackPrices(symbols: string[]): Promise<Record<string, number>> {
  const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean)))
  if (unique.length === 0) return {}

  const prices: Record<string, number> = {}

  const CHUNK = 80
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK)
    try {
      const quotes = await batchQuote(chunk)
      for (const q of quotes) {
        const symbol = q.symbol.toUpperCase()
        if (Number.isFinite(q.price) && q.price > 0) {
          prices[symbol] = q.price
        }
      }
    } catch {
      // Continue chunk-by-chunk; we still try single-symbol fallback below for misses.
    }
  }

  const unresolved = unique.filter((s) => !(s in prices))
  for (const symbol of unresolved) {
    try {
      const quote = await fetchLiveMarketQuote(symbol)
      if (quote.ok && Number.isFinite(quote.quote.price) && quote.quote.price > 0) {
        prices[symbol] = Number(quote.quote.price)
      }
    } catch {
      // ignore unresolved symbol
    }
  }

  return prices
}

function normalizeTradeConditions(raw: unknown): HoldingCondition[] {
  if (!Array.isArray(raw)) return []

  const normalized: HoldingCondition[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const indicator = typeof row.indicator === 'string' ? row.indicator.trim().toUpperCase() : ''
    const operator = typeof row.operator === 'string' ? row.operator.trim() : ''
    const threshold = Number(row.threshold)

    if (!indicator) continue
    if (operator !== '<' && operator !== '<=' && operator !== '>' && operator !== '>=' && operator !== '=') continue
    if (!Number.isFinite(threshold)) continue

    normalized.push({
      indicator,
      operator,
      threshold,
      currentValue: typeof row.currentValue === 'number' && Number.isFinite(row.currentValue)
        ? row.currentValue
        : undefined,
      isMet: typeof row.isMet === 'boolean' ? row.isMet : undefined,
    })
  }

  return normalized
}

export async function GET() {
  try {
    const authSession = await getAuthSession()
    if (!authSession?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    await processPendingPaperTrades({ userId: authSession.user.id }).catch(() => {
      // Best-effort processor. Holdings should still load even if this pass fails.
    })

    const TRADING_ORDER_PAGE = 500

    const [executedOrders, pendingOrders] = await Promise.all([
      prisma.tradingOrder.findMany({
        where: {
          userId: authSession.user.id,
          status: 'EXECUTED',
          tradingMode: 'PAPER',
        },
        orderBy: { createdAt: 'desc' },
        take: TRADING_ORDER_PAGE,
        select: {
          id: true,
          createdAt: true,
          symbol: true,
          orderType: true,
          quantity: true,
          executedPrice: true,
          positionValue: true,
          entryCondition: true,
          brokerStatus: true,
          rawBrokerResponse: true,
        },
      }),
      prisma.tradingOrder.findMany({
        where: {
          userId: authSession.user.id,
          status: 'PENDING',
          tradingMode: 'PAPER',
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          createdAt: true,
          symbol: true,
          orderType: true,
          quantity: true,
          entryCondition: true,
          takeProfit: true,
          stopLoss: true,
        },
      }),
    ])

    const symbolsForPricing = Array.from(
      new Set([
        ...executedOrders
          .filter((o) => o.brokerStatus !== 'CLOSED')
          .map((o) => o.symbol.toUpperCase()),
        ...pendingOrders.map((o) => o.symbol.toUpperCase()),
      ])
    )

    // Fast path: no live LTPs needed (only closed book / empty) — avoid downloading
    // the full EC2 /prices payload (hundreds of symbols) on every page load.
    let mergedLivePrices: Record<string, number> = {}
    let yahooFallbackPrices: Record<string, number> = {}
    let livePrices: Record<string, number> = {}

    if (symbolsForPricing.length > 0) {
      // Run Yahoo batch + full EC2 in parallel so we never pay EC2 time + then Yahoo
      // (previous behaviour was: await EC2, then only Yahoo for misses — two sequential hops).
      const [ec2Map, yahooMap] = await Promise.all([
        fetchEC2AllPrices(),
        fetchYahooFallbackPrices(symbolsForPricing),
      ])
      livePrices = ec2Map
      yahooFallbackPrices = yahooMap
      // EC2 preferred over Yahoo when both have the symbol
      mergedLivePrices = { ...yahooMap, ...ec2Map }

      const stillMissing = symbolsForPricing.filter((symbol) => {
        const v = mergedLivePrices[symbol]
        return !(typeof v === 'number' && Number.isFinite(v) && v > 0)
      })
      if (stillMissing.length > 0) {
        const extra = await fetchYahooFallbackPrices(stillMissing)
        mergedLivePrices = { ...mergedLivePrices, ...extra }
        yahooFallbackPrices = { ...yahooFallbackPrices, ...extra }
      }
    }

    const executedHoldings = executedOrders.map((order) => {
      const entryData = (order.entryCondition || {}) as PendingEntryCondition
      const conditions = normalizeTradeConditions(entryData.conditions)
      const strategyParams = Array.isArray(entryData.strategyParams)
        ? entryData.strategyParams
        : []

      const action = order.orderType === 'SELL' ? 'SELL' : 'BUY'
      const avgPrice = Number(order.executedPrice || 0)
      const investedAmount = Number(order.positionValue || 0) || avgPrice * order.quantity
      const rawMeta = (order.rawBrokerResponse || {}) as Record<string, unknown>
      const isClosed = order.brokerStatus === 'CLOSED'
      const closedPrice = typeof rawMeta.exitPrice === 'number' && Number.isFinite(rawMeta.exitPrice)
        ? rawMeta.exitPrice
        : avgPrice

      const marketPrice = isClosed
        ? closedPrice
        : (mergedLivePrices[order.symbol.toUpperCase()] || avgPrice)

      const returns = isClosed
        ? (typeof rawMeta.finalReturns === 'number' && Number.isFinite(rawMeta.finalReturns)
          ? rawMeta.finalReturns
          : (closedPrice - avgPrice) * order.quantity * (action === 'BUY' ? 1 : -1))
        : (marketPrice - avgPrice) * order.quantity * (action === 'BUY' ? 1 : -1)

      const currentProfitPct = !isClosed && avgPrice > 0 && marketPrice > 0
        ? (action === 'BUY'
          ? ((marketPrice / avgPrice) - 1) * 100
          : ((avgPrice / marketPrice) - 1) * 100)
        : undefined

      const targetProfitPct = typeof entryData.targetProfitPct === 'number' ? entryData.targetProfitPct : undefined
      const targetPrice = typeof entryData.targetPrice === 'number' ? entryData.targetPrice : undefined
      const targetProgressPct =
        typeof targetProfitPct === 'number' && typeof currentProfitPct === 'number' && targetProfitPct !== 0
          ? (currentProfitPct / targetProfitPct) * 100
          : undefined

      return {
        id: order.id,
        sessionId: entryData.sessionId || order.id,
        createdAt: order.createdAt,
        symbol: order.symbol,
        action,
        quantity: order.quantity,
        avgPrice,
        marketPrice,
        returns,
        investedAmount,
        isLive: !isClosed,
        status: isClosed ? 'CLOSED' : 'LIVE',
        priceSource: isClosed
          ? 'Closed'
          : (livePrices[order.symbol.toUpperCase()] ? 'EC2 WebSocket' : (yahooFallbackPrices[order.symbol.toUpperCase()] ? 'Yahoo Live Fallback' : 'Price Unavailable')),
        strategyParams,
        conditions,
        targetProfitPct,
        targetPrice,
        currentProfitPct,
        targetProgressPct,
        liveIndicators: {},
        userPrompt: typeof entryData.userPrompt === 'string' ? entryData.userPrompt : undefined,
      }
    })

    const conditionHoldings = pendingOrders.map((order) => {
      const entryData = (order.entryCondition || {}) as PendingEntryCondition
      const action = order.orderType === 'SELL' ? 'SELL' : 'BUY'
      const livePrice = mergedLivePrices[order.symbol.toUpperCase()]
      const targetPrice = typeof entryData.targetPrice === 'number'
        ? entryData.targetPrice
        : typeof order.takeProfit === 'number'
          ? order.takeProfit
          : undefined

      return {
        id: order.id,
        sessionId: entryData.sessionId || order.id,
        createdAt: order.createdAt,
        symbol: order.symbol,
        action,
        quantity: order.quantity,
        avgPrice: 0,
        marketPrice: typeof livePrice === 'number' && Number.isFinite(livePrice) ? livePrice : 0,
        returns: 0,
        investedAmount: 0,
        isLive: false,
        status: 'CONDITION',
        priceSource: typeof livePrice === 'number' && Number.isFinite(livePrice)
          ? (livePrices[order.symbol.toUpperCase()] ? 'EC2 WebSocket' : 'Yahoo Live Fallback')
          : 'Waiting for market/conditions',
        strategyParams: Array.isArray(entryData.strategyParams) ? entryData.strategyParams : [],
        conditions: normalizeTradeConditions(entryData.conditions),
        targetProfitPct: typeof entryData.targetProfitPct === 'number' ? entryData.targetProfitPct : undefined,
        targetPrice,
        currentProfitPct: undefined,
        targetProgressPct: undefined,
        liveIndicators: {},
        userPrompt: typeof entryData.userPrompt === 'string' ? entryData.userPrompt : undefined,
      }
    })

    const holdings = [...conditionHoldings, ...executedHoldings].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )

    return NextResponse.json({ success: true, data: holdings })
  } catch (error: any) {
    console.error('Error fetching holdings:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch holdings' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const authSession = await getAuthSession()
    if (!authSession?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { holdingId, exitPrice: rawClientExit } = body as {
      holdingId?: string
      exitPrice?: unknown
    }

    if (!holdingId) {
      return NextResponse.json({ success: false, error: 'holdingId is required' }, { status: 400 })
    }

    if (!isNSEMarketSessionLive()) {
      return NextResponse.json(
        {
          success: false,
          error: 'Exit blocked: market is closed. Exit is allowed only during live market hours (Mon-Fri, 09:15-15:30 IST).',
        },
        { status: 400 }
      )
    }

    const order = await prisma.tradingOrder.findFirst({
      where: {
        id: holdingId,
        userId: authSession.user.id,
        tradingMode: 'PAPER',
        status: 'EXECUTED',
      },
      select: {
        id: true,
        symbol: true,
        orderType: true,
        quantity: true,
        executedPrice: true,
        brokerStatus: true,
        rawBrokerResponse: true,
      },
    })

    if (!order) {
      return NextResponse.json({ success: false, error: 'Holding not found or access denied' }, { status: 404 })
    }

    if (order.brokerStatus === 'CLOSED') {
      return NextResponse.json({ success: false, error: `${order.symbol} is already closed.` }, { status: 400 })
    }

    const symbolUpper = order.symbol.toUpperCase()

    const parsedClient =
      typeof rawClientExit === 'number'
        ? rawClientExit
        : typeof rawClientExit === 'string' && rawClientExit.trim() !== ''
          ? Number(rawClientExit)
          : NaN
    const clientExitOk = Number.isFinite(parsedClient) && parsedClient > 0

    let exitPrice: number
    let exitPriceSource: 'ec2-live' | 'yahoo-live-fallback' | 'client-display'

    if (clientExitOk) {
      // Paper exit: UI already showed this price (EC2 or Yahoo); skip slow sequential quotes.
      exitPrice = parsedClient
      exitPriceSource = 'client-display'
    } else {
      const [quoteCheck, yahooQuote] = await Promise.all([
        getFreshEC2Quote(symbolUpper),
        fetchLiveMarketQuote(symbolUpper),
      ])

      if (quoteCheck.ok) {
        exitPrice = quoteCheck.price
        exitPriceSource = 'ec2-live'
      } else if (
        yahooQuote.ok
        && Number.isFinite(yahooQuote.quote.price)
        && yahooQuote.quote.price > 0
      ) {
        exitPrice = Number(yahooQuote.quote.price)
        exitPriceSource = 'yahoo-live-fallback'
      } else {
        return NextResponse.json(
          {
            success: false,
            error:
              `Exit blocked: ${quoteCheck.reason} Yahoo quote also unavailable for ${symbolUpper}.`,
          },
          { status: 400 }
        )
      }
    }
    const action = order.orderType === 'SELL' ? 'SELL' : 'BUY'
    const avgPrice = Number(order.executedPrice || 0)
    const finalReturns = (exitPrice - avgPrice) * Number(order.quantity || 0) * (action === 'BUY' ? 1 : -1)
    const existingMeta = (order.rawBrokerResponse || {}) as Record<string, unknown>

    await prisma.tradingOrder.update({
      where: { id: order.id },
      data: {
        brokerStatus: 'CLOSED',
        rawBrokerResponse: {
          ...existingMeta,
          exitPrice,
          exitPriceSource,
          finalReturns,
          closedAt: new Date().toISOString(),
          exitSource: 'web-holdings',
        } as any,
      },
    })

    const sourceLabel =
      exitPriceSource === 'yahoo-live-fallback'
        ? 'Yahoo live'
        : exitPriceSource === 'client-display'
          ? 'displayed price'
          : 'EC2 live'

    return NextResponse.json({
      success: true,
      message: `${order.symbol} position exited at ₹${exitPrice.toFixed(2)} (${sourceLabel})`,
      returns: finalReturns,
      exitPrice,
      exitPriceSource,
    })
  } catch (error: any) {
    console.error('Error exiting holding:', error)
    return NextResponse.json({ success: false, error: 'Failed to exit holding' }, { status: 500 })
  }
}

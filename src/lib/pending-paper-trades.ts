import { prisma } from '@/lib/prisma'
import { fetchEC2LiveSnapshot } from '@/lib/ec2-helpers'
import { getFreshEC2Quote, isNSEMarketSessionLive } from '@/lib/market-session'
import { fetchLiveMarketQuote } from '@/lib/yahoo-finance'
import { decryptSecret } from '@/lib/crypto'
import { getBrokerAdapter } from '@/lib/brokers/factory'
import { isBrokerName } from '@/lib/trading/types'

type PendingTradeCondition = {
  indicator: string
  operator: '<' | '<=' | '>' | '>=' | '='
  threshold: number
  thresholdIndicator?: string
  currentValue?: number
  isMet?: boolean
}

type PendingEntryConditionPayload = {
  conditions?: PendingTradeCondition[]
  sessionId?: string | null
  [key: string]: unknown
}

type ProcessPendingPaperTradesOptions = {
  userId?: string
}

type ProcessPendingPaperTradesResult = {
  marketLive: boolean
  inspected: number
  executed: number
}

type ExecutableQuoteCheck =
  | { ok: true; price: number; source: 'EC2' | 'YAHOO'; ageSeconds: number | null }
  | { ok: false; reason: string }

function getInternalApiBaseUrl(): string {
  if (process.env.INTERNAL_API_BASE_URL) return process.env.INTERNAL_API_BASE_URL
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3002'
}

const VALID_OPERATORS = new Set(['<', '<=', '>', '>=', '='])

function compareCondition(left: number, operator: PendingTradeCondition['operator'], right: number): boolean {
  switch (operator) {
    case '<':
      return left < right
    case '<=':
      return left <= right
    case '>':
      return left > right
    case '>=':
      return left >= right
    case '=':
      return Math.abs(left - right) < 1e-9
    default:
      return false
  }
}

function normalizeIndicatorName(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase()
}

function normalizePendingConditions(raw: unknown): PendingTradeCondition[] {
  if (!Array.isArray(raw)) return []

  const normalized: PendingTradeCondition[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>

    const indicator = typeof row.indicator === 'string' ? normalizeIndicatorName(row.indicator.trim()) : ''
    if (!indicator) continue

    const operatorRaw = typeof row.operator === 'string' ? row.operator.trim() : ''
    const operator = VALID_OPERATORS.has(operatorRaw)
      ? (operatorRaw as PendingTradeCondition['operator'])
      : null
    if (!operator) continue

    const threshold = Number(row.threshold ?? 0)
    if (!Number.isFinite(threshold)) continue

    normalized.push({
      indicator,
      operator,
      threshold,
      thresholdIndicator: typeof row.thresholdIndicator === 'string'
        ? normalizeIndicatorName(row.thresholdIndicator.trim())
        : undefined,
      currentValue: typeof row.currentValue === 'number' && Number.isFinite(row.currentValue)
        ? row.currentValue
        : undefined,
      isMet: typeof row.isMet === 'boolean' ? row.isMet : undefined,
    })
  }

  return normalized
}

function getIndicatorSnapshotValue(indicators: unknown, indicator: string): number | undefined {
  if (!indicators || typeof indicators !== 'object') return undefined
  const record = indicators as Record<string, unknown>
  const normalized = normalizeIndicatorName(indicator)

  if (normalized === 'RSI') {
    const val = record.rsi
    return typeof val === 'number' && Number.isFinite(val) ? val : undefined
  }
  if (normalized === 'MACD') {
    const val = record.macd
    return typeof val === 'number' && Number.isFinite(val) ? val : undefined
  }
  if (normalized === 'MACDSIGNAL') {
    const val = record.macdSignal
    return typeof val === 'number' && Number.isFinite(val) ? val : undefined
  }
  if (normalized === 'ADX') {
    const val = record.adx
    return typeof val === 'number' && Number.isFinite(val) ? val : undefined
  }
  if (normalized === 'VWAP') {
    const val = record.vwap
    return typeof val === 'number' && Number.isFinite(val) ? val : undefined
  }
  if (normalized === 'CCI') {
    const val = record.cci
    return typeof val === 'number' && Number.isFinite(val) ? val : undefined
  }
  if (normalized === 'ROC') {
    const val = record.roc
    return typeof val === 'number' && Number.isFinite(val) ? val : undefined
  }
  if (normalized === 'SUPERTREND') {
    const val = record.supertrend
    return typeof val === 'number' && Number.isFinite(val) ? val : undefined
  }
  if (normalized === 'STOCHK') {
    const val = record.stochK
    return typeof val === 'number' && Number.isFinite(val) ? val : undefined
  }
  if (normalized === 'STOCHD') {
    const val = record.stochD
    return typeof val === 'number' && Number.isFinite(val) ? val : undefined
  }
  if (normalized === 'WILLIAMSR') {
    const val = record.williamsR
    return typeof val === 'number' && Number.isFinite(val) ? val : undefined
  }
  if (/^EMA\d+$/.test(normalized)) {
    const val = record[`ema${normalized.slice(3)}`]
    return typeof val === 'number' && Number.isFinite(val) ? val : undefined
  }
  if (/^SMA\d+$/.test(normalized)) {
    const val = record[`sma${normalized.slice(3)}`]
    return typeof val === 'number' && Number.isFinite(val) ? val : undefined
  }

  const fallback = record[normalized.toLowerCase()]
  return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : undefined
}

async function getExecutableQuote(symbol: string): Promise<ExecutableQuoteCheck> {
  const ec2Quote = await getFreshEC2Quote(symbol)
  if (ec2Quote.ok) {
    return {
      ok: true,
      price: ec2Quote.price,
      source: 'EC2',
      ageSeconds: ec2Quote.ageSeconds,
    }
  }

  const yahooQuote = await fetchLiveMarketQuote(symbol)
  if (yahooQuote.ok && Number.isFinite(yahooQuote.quote.price) && yahooQuote.quote.price > 0) {
    return {
      ok: true,
      price: Number(yahooQuote.quote.price),
      source: 'YAHOO',
      ageSeconds: null,
    }
  }

  return { ok: false, reason: ec2Quote.reason }
}

async function getConditionIndicators(symbol: string): Promise<Record<string, unknown>> {
  const baseUrl = getInternalApiBaseUrl().replace(/\/$/, '')
  try {
    const response = await fetch(
      `${baseUrl}/api/live-indicators?symbol=${encodeURIComponent(symbol)}`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(7000),
      }
    )
    if (response.ok) {
      const body = await response.json()
      if (body?.success && body?.data?.indicators && typeof body.data.indicators === 'object') {
        return body.data.indicators as Record<string, unknown>
      }
    }
  } catch {
    // Fallback below
  }

  const snapshot = await fetchEC2LiveSnapshot(symbol)
  return (snapshot.indicators as Record<string, unknown>) || {}
}

async function evaluateConditions(
  symbol: string,
  conditions: PendingTradeCondition[],
  marketLive: boolean,
  indicatorCache: Map<string, Record<string, unknown>>
): Promise<{ allMet: boolean; evaluated: PendingTradeCondition[] }> {
  if (conditions.length === 0) {
    return {
      allMet: marketLive,
      evaluated: [
        {
          indicator: 'MARKET_OPEN',
          operator: '>=',
          threshold: 1,
          currentValue: marketLive ? 1 : 0,
          isMet: marketLive,
        },
      ],
    }
  }

  let indicatorsSnapshot: Record<string, unknown> | null = null
  const evaluated: PendingTradeCondition[] = []
  let allMet = true

  for (const condition of conditions) {
    if (condition.indicator === 'MARKET_OPEN') {
      const currentValue = marketLive ? 1 : 0
      const isMet = compareCondition(currentValue, condition.operator, condition.threshold)
      evaluated.push({ ...condition, currentValue, isMet })
      if (!isMet) allMet = false
      continue
    }

    if (!indicatorsSnapshot) {
      indicatorsSnapshot = indicatorCache.get(symbol) || null
      if (!indicatorsSnapshot) {
        indicatorsSnapshot = await getConditionIndicators(symbol)
        indicatorCache.set(symbol, indicatorsSnapshot)
      }
    }

    const currentValue = getIndicatorSnapshotValue(indicatorsSnapshot, condition.indicator)
    const threshold = condition.thresholdIndicator
      ? getIndicatorSnapshotValue(indicatorsSnapshot, condition.thresholdIndicator)
      : condition.threshold

    const hasNumbers = typeof currentValue === 'number' && Number.isFinite(currentValue) &&
      typeof threshold === 'number' && Number.isFinite(threshold)
    const isMet = hasNumbers ? compareCondition(currentValue, condition.operator, threshold as number) : false

    evaluated.push({
      ...condition,
      threshold: typeof threshold === 'number' && Number.isFinite(threshold) ? threshold : condition.threshold,
      currentValue,
      isMet,
    })
    if (!isMet) allMet = false
  }

  return { allMet, evaluated }
}

export async function processPendingPaperTrades(
  options: ProcessPendingPaperTradesOptions = {}
): Promise<ProcessPendingPaperTradesResult> {
  const marketLive = isNSEMarketSessionLive()
  if (!marketLive) {
    return { marketLive, inspected: 0, executed: 0 }
  }

  const pendingOrders = await prisma.tradingOrder.findMany({
    where: {
      status: 'PENDING',
      ...(options.userId ? { userId: options.userId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      userId: true,
      symbol: true,
      orderType: true,
      productType: true,
      quantity: true,
      entryCondition: true,
      tradingMode: true,
      brokerName: true,
    },
  })

  if (pendingOrders.length === 0) {
    return { marketLive, inspected: 0, executed: 0 }
  }

  const quoteCache = new Map<string, ExecutableQuoteCheck>()
  const indicatorCache = new Map<string, Record<string, unknown>>()
  let executed = 0

  for (const order of pendingOrders) {
    const symbol = order.symbol.toUpperCase()
    const quoteCheck = quoteCache.get(symbol) || await getExecutableQuote(symbol)
    quoteCache.set(symbol, quoteCheck)
    if (!quoteCheck.ok) continue

    const entryData = (order.entryCondition || {}) as PendingEntryConditionPayload
    const conditions = normalizePendingConditions(entryData.conditions)
    const { allMet, evaluated } = await evaluateConditions(symbol, conditions, marketLive, indicatorCache)
    if (!allMet) continue

    const executedAt = new Date()
    const baseEntryCondition = {
      ...entryData,
      conditions: evaluated,
      autoExecutedAt: executedAt.toISOString(),
      autoExecutedBy: 'cron-condition-processor',
      executionPriceSource: quoteCheck.source,
      executionQuoteAgeSeconds: quoteCheck.ageSeconds,
    }

    if (order.tradingMode === 'LIVE') {
      // LIVE conditional: place real order via broker
      if (!isBrokerName(order.brokerName)) continue
      try {
        const connection = await prisma.brokerConnection.findUnique({
          where: { userId_brokerName: { userId: order.userId, brokerName: order.brokerName! } },
        })
        if (!connection?.isConnected) continue

        const credentials = {
          apiKey: decryptSecret(connection.apiKeyEnc),
          apiSecret: decryptSecret(connection.apiSecretEnc),
          clientId: decryptSecret(connection.clientIdEnc),
          accessToken: decryptSecret(connection.accessTokenEnc),
          tokenExpiresAt: connection.tokenExpiresAt,
          meta: (connection.metaJson as Record<string, unknown> | null) || null,
        }

        const stock = await prisma.stock.findUnique({
          where: { symbol },
          select: { symbol: true, exchange: true, dhanSecurityId: true, zerodhaTradingSymbol: true, zerodhaExchange: true },
        })

        const adapter = getBrokerAdapter(order.brokerName!)
        const brokerOrder = await adapter.placeOrder({
          symbol,
          side: order.orderType as 'BUY' | 'SELL',
          quantity: order.quantity,
          orderType: 'MARKET',
          productType: (order.productType || 'INTRADAY') as 'INTRADAY' | 'DELIVERY',
          price: null,
          idempotencyKey: `cond-${order.id}`,
          stock: stock || { symbol, exchange: 'NSE', dhanSecurityId: null, zerodhaTradingSymbol: null, zerodhaExchange: null },
          credentials,
        })

        await prisma.tradingOrder.update({
          where: { id: order.id },
          data: {
            status: 'EXECUTED',
            brokerOrderId: brokerOrder.brokerOrderId,
            brokerStatus: brokerOrder.status,
            executedPrice: quoteCheck.price,
            executedAt,
            positionValue: quoteCheck.price * order.quantity,
            rawBrokerResponse: brokerOrder.raw as any,
            entryCondition: baseEntryCondition as any,
          },
        })
        executed += 1
      } catch (err: any) {
        console.error(`[pending-trades] LIVE order ${order.id} failed:`, err?.message || err)
        // Don't mark as executed — leave PENDING so it retries next tick
      }
      continue
    }

    // PAPER: update DB directly (no broker involved)
    await prisma.tradingOrder.update({
      where: { id: order.id },
      data: {
        status: 'EXECUTED',
        executedPrice: quoteCheck.price,
        executedAt,
        positionValue: quoteCheck.price * order.quantity,
        entryCondition: baseEntryCondition as any,
      },
    })

    executed += 1
  }

  return {
    marketLive,
    inspected: pendingOrders.length,
    executed,
  }
}


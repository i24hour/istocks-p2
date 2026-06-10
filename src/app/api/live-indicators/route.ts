import { NextRequest, NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { liveIndicatorEngine } from '@/services/live-indicator-engine'
import { resolveCanonicalSymbol } from '@/lib/instrumentRegistry'
import { technicalIndicatorsService } from '@/services/technical-indicators.service'
import { fetchOHLCV, computeIndicators, fetchLiveMarketQuote, yahooSymbol } from '@/lib/yahoo-finance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'

const noCacheHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
}

const EC2_BASE_URL = process.env.EC2_LIVE_SERVER_URL || 'http://3.109.208.28:8080'
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] })

type Candle = {
  timestamp: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function minuteBucket(date: Date): number {
  return Math.floor(date.getTime() / 60000) * 60000
}

function sanitizeYahooMinuteCandles(rows: any[]): Candle[] {
  const deduped = new Map<number, Candle>()

  for (const row of rows || []) {
    const timestamp = row?.date instanceof Date ? row.date : new Date(row?.date)
    const open = Number(row?.open)
    const high = Number(row?.high)
    const low = Number(row?.low)
    const close = Number(row?.close)
    const volume = Number(row?.volume ?? 0)

    if (
      Number.isNaN(timestamp.getTime()) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      continue
    }

    const bucket = minuteBucket(timestamp)
    deduped.set(bucket, {
      timestamp: new Date(bucket),
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    })
  }

  return Array.from(deduped.values()).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}

async function fetchCandlesFromYahoo1m(symbol: string): Promise<Candle[] | null> {
  const now = new Date()
  const period1 = new Date(now.getTime() - 6 * 60 * 60 * 1000)
  const primaryTicker = yahooSymbol(symbol)
  const base = symbol.toUpperCase().replace(/\.(NS|BO)$/i, '')

  const tickerCandidates = Array.from(new Set([
    primaryTicker,
    ...(primaryTicker.startsWith('^') || primaryTicker.endsWith('.BO') ? [] : [`${base}.BO`]),
  ]))

  for (const ticker of tickerCandidates) {
    try {
      const result: any = await yahooFinance.chart(
        ticker,
        { period1, period2: now, interval: '1m', return: 'array' },
        { validateResult: false }
      )

      const candles = sanitizeYahooMinuteCandles(Array.isArray(result?.quotes) ? result.quotes : [])
      if (candles.length >= 15) return candles
    } catch {
      // Try next ticker candidate
    }
  }

  return null
}

async function fetchLivePrice(symbol: string): Promise<number | null> {
  try {
    const response = await fetch(`${EC2_BASE_URL}/prices`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const body = await response.json()
    const value = body?.data?.[symbol]?.ltp
    return typeof value === 'number' ? value : null
  } catch {
    return null
  }
}

async function fetchCandlesFromEC2(symbol: string): Promise<Candle[] | null> {
  try {
    const url = `${EC2_BASE_URL}/candles?symbol=${encodeURIComponent(symbol)}&interval=ONE_MINUTE&count=300`
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return null
    const body = await response.json()
    if (!body?.success || !body?.data || body.data.length === 0) return null

    return body.data.map((c: any) => ({
      timestamp: new Date(c.timestamp),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume),
    }))
  } catch (err) {
    console.warn(`EC2 /candles fetch failed for ${symbol}:`, err)
    return null
  }
}

async function computeOnDemandSnapshot(symbol: string) {
  // Only use EC2 live candles — never fall back to database
  const candles = await fetchCandlesFromEC2(symbol)

  if (!candles || candles.length < 15) {
    console.warn(`[indicators] EC2 candles unavailable for ${symbol} (got ${candles?.length ?? 0}). Not falling back to DB.`)
    return null
  }

  const source = 'ec2-live-candles'

  const livePrice = await fetchLivePrice(symbol)
  const now = new Date()
  const currentBucket = minuteBucket(now)

  if (livePrice !== null) {
    const last = candles[candles.length - 1]
    const lastBucket = minuteBucket(last.timestamp)

    if (lastBucket === currentBucket) {
      last.high = Math.max(last.high, livePrice)
      last.low = Math.min(last.low, livePrice)
      last.close = livePrice
    } else {
      candles.push({
        timestamp: new Date(currentBucket),
        open: last.close,
        high: livePrice,
        low: livePrice,
        close: livePrice,
        volume: 0,
      })
    }
  }

  const indicatorsArray = technicalIndicatorsService.calculateAllIndicators(candles)
  const latest = indicatorsArray[indicatorsArray.length - 1] || {}

  return {
    symbol,
    timeframe: '1m',
    lastTickAt: now.toISOString(),
    currentPrice: livePrice ?? candles[candles.length - 1].close,
    source: source + (livePrice !== null ? '+live-tick' : ''),
    indicators: {
      sma20: (latest as any).sma20,
      sma50: (latest as any).sma50,
      sma200: (latest as any).sma200,
      ema12: (latest as any).ema12,
      ema26: (latest as any).ema26,
      macd: (latest as any).macd,
      macdSignal: (latest as any).macdSignal,
      macdHistogram: (latest as any).macdHistogram,
      adx: (latest as any).adx,
      plusDI: (latest as any).plusDI,
      minusDI: (latest as any).minusDI,
      rsi: (latest as any).rsi,
      stochK: (latest as any).stochK,
      stochD: (latest as any).stochD,
      cci: (latest as any).cci,
      williamsR: (latest as any).williamsR,
      roc: (latest as any).roc,
      bbUpper: (latest as any).bbUpper,
      bbMiddle: (latest as any).bbMiddle,
      bbLower: (latest as any).bbLower,
      atr: (latest as any).atr,
      obv: typeof (latest as any).obv === 'bigint' ? Number((latest as any).obv) : (latest as any).obv,
      vwap: (latest as any).vwap,
      forceIndex: (latest as any).forceIndex,
      adLine: (latest as any).adLine,
      supertrend: (latest as any).supertrend,
      supertrendDirection: (latest as any).supertrendDirection,
    },
    readiness: {
      candles: candles.length,
      minNeededForCore: 26,
      isCoreReady: candles.length >= 26,
      mode: 'on-demand',
    },
  }
}

async function computeYahooIntradaySnapshot(symbol: string) {
  const candles = await fetchCandlesFromYahoo1m(symbol)
  if (!candles || candles.length < 15) return null

  const now = new Date()
  const currentBucket = minuteBucket(now)
  let livePrice: number | null = null

  const liveQuote = await fetchLiveMarketQuote(symbol)
  if (liveQuote.ok && Number.isFinite(liveQuote.quote.price)) {
    livePrice = Number(liveQuote.quote.price)
  }

  if (livePrice !== null) {
    const last = candles[candles.length - 1]
    const lastBucket = minuteBucket(last.timestamp)

    if (lastBucket === currentBucket) {
      last.high = Math.max(last.high, livePrice)
      last.low = Math.min(last.low, livePrice)
      last.close = livePrice
    } else {
      candles.push({
        timestamp: new Date(currentBucket),
        open: last.close,
        high: livePrice,
        low: livePrice,
        close: livePrice,
        volume: 0,
      })
    }
  }

  const indicatorsArray = technicalIndicatorsService.calculateAllIndicators(candles)
  const latest = indicatorsArray[indicatorsArray.length - 1] || {}

  return {
    symbol,
    timeframe: '1m',
    lastTickAt: now.toISOString(),
    currentPrice: livePrice ?? candles[candles.length - 1].close,
    source: `yahoo-1m${livePrice !== null ? '+live-quote' : ''}`,
    indicators: {
      sma20: (latest as any).sma20,
      sma50: (latest as any).sma50,
      sma200: (latest as any).sma200,
      ema12: (latest as any).ema12,
      ema26: (latest as any).ema26,
      macd: (latest as any).macd,
      macdSignal: (latest as any).macdSignal,
      macdHistogram: (latest as any).macdHistogram,
      adx: (latest as any).adx,
      plusDI: (latest as any).plusDI,
      minusDI: (latest as any).minusDI,
      rsi: (latest as any).rsi,
      stochK: (latest as any).stochK,
      stochD: (latest as any).stochD,
      cci: (latest as any).cci,
      williamsR: (latest as any).williamsR,
      roc: (latest as any).roc,
      bbUpper: (latest as any).bbUpper,
      bbMiddle: (latest as any).bbMiddle,
      bbLower: (latest as any).bbLower,
      atr: (latest as any).atr,
      obv: typeof (latest as any).obv === 'bigint' ? Number((latest as any).obv) : (latest as any).obv,
      vwap: (latest as any).vwap,
      forceIndex: (latest as any).forceIndex,
      adLine: (latest as any).adLine,
      supertrend: (latest as any).supertrend,
      supertrendDirection: (latest as any).supertrendDirection,
    },
    readiness: {
      candles: candles.length,
      minNeededForCore: 26,
      isCoreReady: candles.length >= 26,
      mode: 'yahoo-1m-fallback',
    },
  }
}

// ── Daily / multi-timeframe snapshot via Yahoo Finance ──────────────────────

async function computeDailySnapshot(symbol: string, yahooRange: '3mo' | '6mo' | '1y' = '3mo') {
  try {
    const candles = await fetchOHLCV(symbol, yahooRange, '1d')
    if (candles.length < 20) return null
    const ind = computeIndicators(candles)
    const now = new Date()
    return {
      symbol,
      timeframe: '1d',
      lastTickAt: now.toISOString(),
      currentPrice: ind.latestClose ?? candles[candles.length - 1].close,
      source: 'yahoo-daily',
      indicators: {
        sma20: ind.sma20,
        sma50: ind.sma50,
        sma200: ind.sma200,
        ema12: ind.ema12,
        ema26: ind.ema26,
        macd: ind.macd,
        macdSignal: ind.macdSignal,
        macdHistogram: ind.macdHist,
        rsi: ind.rsi14,             // mapped to 'rsi' to match EC2 field name
        bbUpper: ind.bbUpper,
        bbMiddle: ind.bbMiddle,
        bbLower: ind.bbLower,
        atr: ind.atr14,             // mapped to 'atr'
      },
      readiness: {
        candles: candles.length,
        minNeededForCore: 26,
        isCoreReady: candles.length >= 26,
        mode: 'yahoo-daily',
      },
    }
  } catch (err) {
    console.warn(`[indicators] Yahoo daily fetch failed for ${symbol}:`, err)
    return null
  }
}

// ── Timeframe router helper ───────────────────────────────────────────────────

function isNonMinuteTimeframe(tf: string | null): boolean {
  if (!tf) return false
  // anything other than blank / '1m' / 'intraday' is routed to Yahoo
  return /^1d$|^daily$|^1w$|^weekly$|^1h$|^hourly$|^\d+d$|^\d+w$/.test(tf.toLowerCase())
}

export async function GET(request: NextRequest) {
  try {
    const symbolParam = request.nextUrl.searchParams.get('symbol')
    const timeframeParam = request.nextUrl.searchParams.get('timeframe')

    if (symbolParam) {
      const canonical = await resolveCanonicalSymbol(symbolParam)

      // Route non-intraday timeframes to Yahoo Finance daily data
      if (isNonMinuteTimeframe(timeframeParam)) {
        const snapshot = await computeDailySnapshot(canonical)
        if (!snapshot) {
          return NextResponse.json(
            { success: false, error: `Daily candles unavailable for ${canonical}.` },
            { status: 503, headers: noCacheHeaders }
          )
        }
        return NextResponse.json({ success: true, data: snapshot }, { headers: noCacheHeaders })
      }

      const snapshot = await computeOnDemandSnapshot(canonical)

      if (snapshot) {
        return NextResponse.json({ success: true, data: snapshot }, {
          headers: noCacheHeaders,
        })
      }

      // If EC2 1-minute candles are unavailable, fall back to Yahoo 1-minute candles.
      const yahooIntradaySnapshot = await computeYahooIntradaySnapshot(canonical)
      if (yahooIntradaySnapshot) {
        return NextResponse.json({ success: true, data: yahooIntradaySnapshot }, {
          headers: noCacheHeaders,
        })
      }

      // Default/Intraday indicator requests must stay strictly 1-minute.
      // Do not silently return daily RSI for trading-condition evaluation.
      return NextResponse.json(
        {
          success: false,
          error: `1-minute live indicators unavailable for ${canonical}. EC2 may be down or market may be closed.`,
        },
        { status: 503, headers: noCacheHeaders }
      )
    }

    await liveIndicatorEngine.ensureStarted()
    const liveAll = liveIndicatorEngine.getSnapshot() || []

    return NextResponse.json({ success: true, data: liveAll }, {
      headers: noCacheHeaders,
    })
  } catch (error: any) {
    console.error('Live indicators API error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Failed to fetch live indicators' }, { status: 500 })
  }
}

/**
 * EC2 Live Data Helpers
 * Provides server-side access to real-time prices and indicators from the EC2 FastAPI server.
 * Used by both /api/chat and /api/stocks/[symbol]/analyze for live-trading queries.
 */

import { technicalIndicatorsService } from '@/services/technical-indicators.service'
import YahooFinance from 'yahoo-finance2'
import { fetchLiveMarketQuote, yahooSymbol } from '@/lib/yahoo-finance'

const EC2_BASE_URL = process.env.EC2_LIVE_SERVER_URL || 'http://3.109.208.28:8080'
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] })

export interface EC2LiveIndicators {
  // Moving Averages
  sma20?: number; sma50?: number; sma200?: number
  ema12?: number; ema26?: number
  wma20?: number; dema20?: number; tema20?: number; hma20?: number; vwma20?: number
  // MACD
  macd?: number; macdSignal?: number; macdHistogram?: number
  // Momentum
  rsi?: number
  stochK?: number; stochD?: number
  williamsR?: number; roc?: number; ao?: number; uo?: number
  cmo?: number; tsi?: number; ppo?: number; dpo?: number
  // Trend
  cci?: number
  adx?: number; plusDI?: number; minusDI?: number
  trix?: number; kst?: number; kstSignal?: number
  aroonUp?: number; aroonDown?: number; aroonOsc?: number
  psar?: number; psarSignal?: number
  ichimokuConv?: number; ichimokuBase?: number
  ichimokuLeadA?: number; ichimokuLeadB?: number; ichimokuLagging?: number
  supertrend?: number; supertrendDirection?: number
  // Volatility
  bbUpper?: number; bbMiddle?: number; bbLower?: number
  atr?: number
  kcUpper?: number; kcMiddle?: number; kcLower?: number
  dcUpper?: number; dcMiddle?: number; dcLower?: number
  stdDev20?: number
  // Volume
  obv?: number; vwap?: number; forceIndex?: number; adLine?: number
  mfi?: number; cmf?: number; pvt?: number; eom?: number
}

export interface EC2LiveSnapshot {
  symbol: string
  ltp: number | null          // Last Traded Price
  candlesUsed: number         // Number of 1-min candles computed from
  indicators: EC2LiveIndicators | null
  indicatorSource?: 'ec2-1m' | 'ec2-1m+yahoo-1m-fallback' | 'yahoo-1m-fallback' | 'none'
  available: boolean          // false if EC2 is unreachable
}

function minuteBucket(date: Date): number {
  return Math.floor(date.getTime() / 60000) * 60000
}

function sanitizeYahooMinuteCandles(rows: any[]): any[] {
  const deduped = new Map<number, any>()

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

// ── Private helpers ────────────────────────────────────────

async function fetchEC2LivePrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`${EC2_BASE_URL}/prices`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const body = await res.json()
    const val = body?.data?.[symbol]?.ltp
    return typeof val === 'number' ? val : null
  } catch {
    return null
  }
}

async function fetchEC2Candles(symbol: string, count = 200): Promise<any[] | null> {
  try {
    const url = `${EC2_BASE_URL}/candles?symbol=${encodeURIComponent(symbol)}&interval=ONE_MINUTE&count=${count}`
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const body = await res.json()
    if (!body?.success || !Array.isArray(body.data) || body.data.length === 0) return null
    return body.data.map((c: any) => ({
      timestamp: new Date(c.timestamp),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume),
    }))
  } catch {
    return null
  }
}

function needsCoreIndicatorFallback(indicators: EC2LiveIndicators | null): boolean {
  if (!indicators) return true
  return (
    indicators.rsi == null ||
    indicators.macd == null ||
    indicators.macdSignal == null ||
    indicators.ema12 == null ||
    indicators.ema26 == null
  )
}

async function fetchYahooIntradayFallbackIndicators(symbol: string): Promise<{
  indicators: EC2LiveIndicators
  candlesUsed: number
  latestClose: number | null
} | null> {
  try {
    const now = new Date()
    const period1 = new Date(now.getTime() - 6 * 60 * 60 * 1000)
    const primaryTicker = yahooSymbol(symbol)
    const base = symbol.toUpperCase().replace(/\.(NS|BO)$/i, '')
    const tickerCandidates = Array.from(new Set([
      primaryTicker,
      ...(primaryTicker.startsWith('^') || primaryTicker.endsWith('.BO') ? [] : [`${base}.BO`]),
    ]))

    let candles: any[] | null = null
    for (const ticker of tickerCandidates) {
      try {
        const chart: any = await yahooFinance.chart(
          ticker,
          { period1, period2: now, interval: '1m', return: 'array' },
          { validateResult: false }
        )
        const rows = sanitizeYahooMinuteCandles(Array.isArray(chart?.quotes) ? chart.quotes : [])
        if (rows.length >= 15) {
          candles = rows
          break
        }
      } catch {
        // try next candidate
      }
    }

    if (!candles || candles.length < 15) return null

    let livePrice: number | null = null
    const liveQuote = await fetchLiveMarketQuote(symbol)
    if (liveQuote.ok && Number.isFinite(liveQuote.quote.price) && liveQuote.quote.price > 0) {
      livePrice = Number(liveQuote.quote.price)
    }

    if (livePrice !== null) {
      const last = candles[candles.length - 1]
      const currentBucket = minuteBucket(now)
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

    const snap = technicalIndicatorsService.calculateLiveSnapshot(candles)
    const indicators: EC2LiveIndicators = {
      // Moving averages
      sma20: snap.sma20,
      sma50: snap.sma50,
      sma200: snap.sma200,
      ema12: snap.ema12,
      ema26: snap.ema26,
      wma20: snap.wma20,
      dema20: snap.dema20,
      tema20: snap.tema20,
      hma20: snap.hma20,
      vwma20: snap.vwma20,
      // MACD
      macd: snap.macd,
      macdSignal: snap.macdSignal,
      macdHistogram: snap.macdHistogram,
      // Momentum
      rsi: snap.rsi,
      stochK: snap.stochK,
      stochD: snap.stochD,
      williamsR: snap.williamsR,
      roc: snap.roc,
      ao: snap.ao,
      uo: snap.uo,
      cmo: snap.cmo,
      tsi: snap.tsi,
      ppo: snap.ppo,
      dpo: snap.dpo,
      // Trend
      cci: snap.cci,
      adx: snap.adx,
      plusDI: snap.plusDI,
      minusDI: snap.minusDI,
      trix: snap.trix,
      kst: snap.kst,
      kstSignal: snap.kstSignal,
      aroonUp: snap.aroonUp,
      aroonDown: snap.aroonDown,
      aroonOsc: snap.aroonOsc,
      psar: snap.psar,
      psarSignal: snap.psarSignal,
      ichimokuConv: snap.ichimokuConv,
      ichimokuBase: snap.ichimokuBase,
      ichimokuLeadA: snap.ichimokuLeadA,
      ichimokuLeadB: snap.ichimokuLeadB,
      ichimokuLagging: snap.ichimokuLagging,
      supertrend: snap.supertrend,
      supertrendDirection: snap.supertrendDirection,
      // Volatility
      bbUpper: snap.bbUpper,
      bbMiddle: snap.bbMiddle,
      bbLower: snap.bbLower,
      atr: snap.atr,
      kcUpper: snap.kcUpper,
      kcMiddle: snap.kcMiddle,
      kcLower: snap.kcLower,
      dcUpper: snap.dcUpper,
      dcMiddle: snap.dcMiddle,
      dcLower: snap.dcLower,
      stdDev20: snap.stdDev20,
      // Volume
      obv: typeof snap.obv === 'bigint' ? Number(snap.obv) : snap.obv,
      vwap: snap.vwap,
      forceIndex: snap.forceIndex,
      adLine: snap.adLine,
      mfi: snap.mfi,
      cmf: snap.cmf,
      pvt: snap.pvt,
      eom: snap.eom,
    }

    return {
      indicators,
      candlesUsed: candles.length,
      latestClose: livePrice ?? candles[candles.length - 1].close,
    }
  } catch {
    return null
  }
}

// ── Public helpers ─────────────────────────────────────────

/**
 * Fetch a full live snapshot for one symbol:
 * LTP from /prices  +  indicators computed from /candles
 */
export async function fetchEC2LiveSnapshot(symbol: string): Promise<EC2LiveSnapshot> {
  let [ltp, candles] = await Promise.all([
    fetchEC2LivePrice(symbol),
    fetchEC2Candles(symbol),
  ])

  let indicators: EC2LiveIndicators | null = null
  let indicatorSource: EC2LiveSnapshot['indicatorSource'] = 'none'
  let candlesUsed = candles?.length ?? 0

  if (candles && candles.length >= 15) {
    try {
      const snap = technicalIndicatorsService.calculateLiveSnapshot(candles)
      indicators = {
        // Moving Averages
        sma20: snap.sma20, sma50: snap.sma50, sma200: snap.sma200,
        ema12: snap.ema12, ema26: snap.ema26,
        wma20: snap.wma20, dema20: snap.dema20, tema20: snap.tema20,
        hma20: snap.hma20, vwma20: snap.vwma20,
        // MACD
        macd: snap.macd, macdSignal: snap.macdSignal, macdHistogram: snap.macdHistogram,
        // Momentum
        rsi: snap.rsi,
        stochK: snap.stochK, stochD: snap.stochD,
        williamsR: snap.williamsR, roc: snap.roc, ao: snap.ao, uo: snap.uo,
        cmo: snap.cmo, tsi: snap.tsi, ppo: snap.ppo, dpo: snap.dpo,
        // Trend
        cci: snap.cci,
        adx: snap.adx, plusDI: snap.plusDI, minusDI: snap.minusDI,
        trix: snap.trix, kst: snap.kst, kstSignal: snap.kstSignal,
        aroonUp: snap.aroonUp, aroonDown: snap.aroonDown, aroonOsc: snap.aroonOsc,
        psar: snap.psar, psarSignal: snap.psarSignal,
        ichimokuConv: snap.ichimokuConv, ichimokuBase: snap.ichimokuBase,
        ichimokuLeadA: snap.ichimokuLeadA, ichimokuLeadB: snap.ichimokuLeadB,
        ichimokuLagging: snap.ichimokuLagging,
        supertrend: snap.supertrend, supertrendDirection: snap.supertrendDirection,
        // Volatility
        bbUpper: snap.bbUpper, bbMiddle: snap.bbMiddle, bbLower: snap.bbLower,
        atr: snap.atr,
        kcUpper: snap.kcUpper, kcMiddle: snap.kcMiddle, kcLower: snap.kcLower,
        dcUpper: snap.dcUpper, dcMiddle: snap.dcMiddle, dcLower: snap.dcLower,
        stdDev20: snap.stdDev20,
        // Volume
        obv: typeof snap.obv === 'bigint' ? Number(snap.obv) : snap.obv,
        vwap: snap.vwap, forceIndex: snap.forceIndex, adLine: snap.adLine,
        mfi: snap.mfi, cmf: snap.cmf, pvt: snap.pvt, eom: snap.eom,
      }
      indicatorSource = 'ec2-1m'
    } catch (err) {
      console.warn('[ec2-helpers] indicator calc failed:', err)
    }
  }

  // Fallback/supplement path: if EC2 minute-candles are missing or core indicators are unavailable,
  // compute from Yahoo 1-minute candles so trading conditions stay aligned with intraday UI.
  if (needsCoreIndicatorFallback(indicators)) {
    const fallback = await fetchYahooIntradayFallbackIndicators(symbol)
    if (fallback) {
      if (indicators) {
        indicators = {
          ...fallback.indicators,
          ...indicators, // keep EC2 values where already available
          rsi: indicators.rsi ?? fallback.indicators.rsi,
          macd: indicators.macd ?? fallback.indicators.macd,
          macdSignal: indicators.macdSignal ?? fallback.indicators.macdSignal,
          macdHistogram: indicators.macdHistogram ?? fallback.indicators.macdHistogram,
          ema12: indicators.ema12 ?? fallback.indicators.ema12,
          ema26: indicators.ema26 ?? fallback.indicators.ema26,
          sma20: indicators.sma20 ?? fallback.indicators.sma20,
          sma50: indicators.sma50 ?? fallback.indicators.sma50,
          sma200: indicators.sma200 ?? fallback.indicators.sma200,
          atr: indicators.atr ?? fallback.indicators.atr,
        }
        indicatorSource = 'ec2-1m+yahoo-1m-fallback'
      } else {
        indicators = fallback.indicators
        indicatorSource = 'yahoo-1m-fallback'
      }

      if ((ltp == null || ltp <= 0) && fallback.latestClose != null) {
        ltp = fallback.latestClose
      }
      if (candlesUsed < 15) candlesUsed = fallback.candlesUsed
    }
  }

  return {
    symbol,
    ltp,
    candlesUsed,
    indicators,
    indicatorSource,
    available: ltp !== null || (candles !== null && candles.length > 0) || indicators !== null,
  }
}

/**
 * Fetch bulk live prices for all tracked symbols.
 * Returns { SYMBOL: ltp } map.
 */
export async function fetchEC2AllPrices(): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${EC2_BASE_URL}/prices`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return {}
    const body = await res.json()
    if (!body?.data) return {}
    const prices: Record<string, number> = {}
    for (const [sym, data] of Object.entries(body.data)) {
      const ltp = (data as any)?.ltp
      if (typeof ltp === 'number') prices[sym] = ltp
    }
    return prices
  } catch {
    return {}
  }
}

/**
 * Format a live snapshot into a human-readable string for Gemini prompts.
 */
export function formatSnapshotForPrompt(snapshot: EC2LiveSnapshot, stockName = ''): string {
  const name = stockName ? `${stockName} (${snapshot.symbol})` : snapshot.symbol
  const priceStr = snapshot.ltp != null ? `₹${snapshot.ltp.toFixed(2)}` : 'N/A'
  const sourceLabel =
    snapshot.indicatorSource === 'ec2-1m' ? 'EC2 1-min live candles'
    : snapshot.indicatorSource === 'ec2-1m+yahoo-1m-fallback' ? 'EC2 1-min + Yahoo 1-min fallback'
    : snapshot.indicatorSource === 'yahoo-1m-fallback' ? 'Yahoo 1-min fallback'
    : 'N/A'

  const iv = snapshot.indicators
  const fmt  = (v?: number | null, prefix = '') => v != null ? `${prefix}${v.toFixed(2)}` : 'N/A'
  const fmtB = (v?: bigint | number | null)      => v != null ? String(v) : 'N/A'
  const stLine = iv?.supertrendDirection === 1 ? '🟢 Bullish' : iv?.supertrendDirection === -1 ? '🔴 Bearish' : 'N/A'
  const rsiTag = iv?.rsi != null ? (iv.rsi > 70 ? ' ⚠️ Overbought' : iv.rsi < 30 ? ' ⚠️ Oversold' : ' ✅ Neutral') : ''

  return `📡 LIVE DATA — ${name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Current Price (LTP): ${priceStr}
• Candles Used:        ${snapshot.candlesUsed} × 1-min candles
• Indicator Source:    ${sourceLabel}

📊 MOVING AVERAGES:
  SMA20: ${fmt(iv?.sma20, '₹')}  SMA50: ${fmt(iv?.sma50, '₹')}  SMA200: ${fmt(iv?.sma200, '₹')}
  EMA12: ${fmt(iv?.ema12, '₹')}  EMA26: ${fmt(iv?.ema26, '₹')}
  WMA20: ${fmt(iv?.wma20, '₹')}  DEMA20: ${fmt(iv?.dema20, '₹')}  TEMA20: ${fmt(iv?.tema20, '₹')}
  HMA20: ${fmt(iv?.hma20, '₹')}  VWMA20: ${fmt(iv?.vwma20, '₹')}
  MACD: ${fmt(iv?.macd)}  Signal: ${fmt(iv?.macdSignal)}  Histogram: ${fmt(iv?.macdHistogram)}

📈 MOMENTUM:
  RSI(14): ${fmt(iv?.rsi)}${rsiTag}
  Stoch %K: ${fmt(iv?.stochK)}  %D: ${fmt(iv?.stochD)}
  Williams %R: ${fmt(iv?.williamsR)}  ROC: ${fmt(iv?.roc)}
  AO: ${fmt(iv?.ao)}  UO: ${fmt(iv?.uo)}  CMO: ${fmt(iv?.cmo)}
  TSI: ${fmt(iv?.tsi)}  PPO: ${fmt(iv?.ppo)}  DPO: ${fmt(iv?.dpo)}

📉 TREND:
  CCI(20): ${fmt(iv?.cci)}
  ADX: ${fmt(iv?.adx)}  +DI: ${fmt(iv?.plusDI)}  -DI: ${fmt(iv?.minusDI)}
  TRIX: ${fmt(iv?.trix)}  KST: ${fmt(iv?.kst)}  KST Signal: ${fmt(iv?.kstSignal)}
  Aroon Up: ${fmt(iv?.aroonUp)}  Down: ${fmt(iv?.aroonDown)}  Osc: ${fmt(iv?.aroonOsc)}
  PSAR: ${fmt(iv?.psar, '₹')}  (${iv?.psarSignal === 1 ? '🟢 Bullish' : iv?.psarSignal === -1 ? '🔴 Bearish' : 'N/A'})
  Ichimoku — Conv: ${fmt(iv?.ichimokuConv, '₹')}  Base: ${fmt(iv?.ichimokuBase, '₹')}  SpanA: ${fmt(iv?.ichimokuLeadA, '₹')}  SpanB: ${fmt(iv?.ichimokuLeadB, '₹')}
  Supertrend: ${fmt(iv?.supertrend, '₹')}  (${stLine})

🌡️ VOLATILITY:
  BB Upper: ${fmt(iv?.bbUpper, '₹')}  Middle: ${fmt(iv?.bbMiddle, '₹')}  Lower: ${fmt(iv?.bbLower, '₹')}
  ATR(14): ${fmt(iv?.atr)}
  KC Upper: ${fmt(iv?.kcUpper, '₹')}  Middle: ${fmt(iv?.kcMiddle, '₹')}  Lower: ${fmt(iv?.kcLower, '₹')}
  DC Upper: ${fmt(iv?.dcUpper, '₹')}  Middle: ${fmt(iv?.dcMiddle, '₹')}  Lower: ${fmt(iv?.dcLower, '₹')}
  StdDev(20): ${fmt(iv?.stdDev20)}

📦 VOLUME:
  OBV: ${fmtB(iv?.obv)}  VWAP: ${fmt(iv?.vwap, '₹')}
  Force Index: ${fmt(iv?.forceIndex)}  A/D Line: ${fmt(iv?.adLine)}
  MFI(14): ${fmt(iv?.mfi)}  CMF(20): ${fmt(iv?.cmf)}
  PVT: ${fmt(iv?.pvt)}  EOM: ${fmt(iv?.eom)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
}

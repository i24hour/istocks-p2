/**
 * Price-Range Stock Screener
 *
 * Pipeline:
 *  1. EC2 /prices  → filter symbols by live LTP in [min, max]
 *  2. Yahoo batchQuote → confirm live price + filter by volume
 *  3. Parallel:
 *       3A. Yahoo fetchOHLCV → calculateTradingLevels (confidence score + Entry/SL/Target/R:R)
 *       3B. Serper last-24h  → headline sentiment score
 *  4. Rank by confidence_score + sentimentScore → return top N
 */

import { fetchEC2AllPrices } from '@/lib/ec2-helpers'
import { batchQuote, fetchOHLCV } from '@/lib/yahoo-finance'
import { calculateTradingLevels, type TradingLevels } from '@/lib/trading-levels'
import { searchGoogle } from '@/lib/googleSearch'
import { prisma } from '@/lib/prisma'

const MIN_VOLUME = 50_000  // 50k shares/day minimum to filter out illiquid stocks
const MAX_OHLCV_PARALLEL = 20  // cap parallel Yahoo OHLCV calls

export interface ScreenedStock {
  symbol: string
  name: string
  livePrice: number
  changePercent: number
  volume: number
  levels: TradingLevels | null   // Entry / SL / Target / R:R + confidence_score
  confidenceScore: number        // 0-100 from calculateTradingLevels
  sentimentScore: number         // 1-5 from Serper headlines
  totalScore: number             // confidenceScore + sentimentScore * 20 (normalized)
  sentimentHeadlines: string[]
}

export interface PriceRangeScreenResult {
  stocks: ScreenedStock[]
  totalInRange: number
  totalLiquid: number
  priceRange: { min: number; max: number }
  dataSource: 'ec2' | 'yahoo_fallback'
  timestamp: string
}

function scoreSentiment(headlines: string[]): number {
  if (headlines.length === 0) return 3  // neutral when no news found

  const positiveRe = /\b(gain|rise|jump|surge|beat|upgrade|buy|target raised?|contract|order|win|record high|strong|rally|bullish|growth|profit|revenue|results? beat|above expectation|outperform)\b/i
  const negativeRe = /\b(fall|drop|decline|miss|downgrade|sell|fraud|scam|loss|below expectation|weak|bearish|cut|concern|risk|probe|investigation|suspend|halt|penalty)\b/i

  let pos = 0, neg = 0
  for (const h of headlines) {
    if (positiveRe.test(h)) pos++
    if (negativeRe.test(h)) neg++
  }

  const net = pos - neg
  if (net >= 2) return 5
  if (net === 1) return 4
  if (net === 0) return 3
  if (net === -1) return 2
  return 1
}

// ── Main screener ─────────────────────────────────────────────────────────────

export async function screenByPriceRange(
  min: number,
  max: number,
  limit = 7
): Promise<PriceRangeScreenResult> {
  const timestamp = new Date().toISOString()

  // ── Phase 1: Get all live prices (EC2 first, Yahoo fallback) ─────────────
  let livePriceMap: Record<string, number> = {}
  let dataSource: PriceRangeScreenResult['dataSource'] = 'ec2'

  try {
    livePriceMap = await fetchEC2AllPrices()
  } catch { /* handled below */ }

  let rangeSymbols: string[] = []

  if (Object.keys(livePriceMap).length > 0) {
    rangeSymbols = Object.entries(livePriceMap)
      .filter(([, p]) => p >= min && p <= max)
      .map(([sym]) => sym)
  } else {
    // EC2 down → Yahoo batchQuote on full DB symbol list
    dataSource = 'yahoo_fallback'
    try {
      const dbSymbols = (await prisma.stock.findMany({ select: { symbol: true }, take: 400 }))
        .map(s => s.symbol)
      const quotes = await batchQuote(dbSymbols)
      for (const q of quotes) {
        if (q.price >= min && q.price <= max) {
          rangeSymbols.push(q.symbol)
          livePriceMap[q.symbol] = q.price
        }
      }
    } catch {
      return { stocks: [], totalInRange: 0, totalLiquid: 0, priceRange: { min, max }, dataSource, timestamp }
    }
  }

  const totalInRange = rangeSymbols.length

  if (totalInRange === 0) {
    return { stocks: [], totalInRange: 0, totalLiquid: 0, priceRange: { min, max }, dataSource, timestamp }
  }

  // ── Phase 2: Yahoo batchQuote → live volume + name ───────────────────────
  type Candidate = { symbol: string; name: string; price: number; changePercent: number; volume: number }
  let candidates: Candidate[] = []

  try {
    const quotes = await batchQuote(rangeSymbols)
    for (const q of quotes) {
      if (q.price >= min && q.price <= max && (q.volume ?? 0) >= MIN_VOLUME) {
        candidates.push({
          symbol: q.symbol,
          name: q.name || q.symbol,
          price: q.price,
          changePercent: q.changePercent ?? 0,
          volume: q.volume ?? 0,
        })
      }
    }
  } catch {
    // volume filter unavailable — use EC2 prices directly, top 20 by symbol
    candidates = rangeSymbols.slice(0, MAX_OHLCV_PARALLEL).map(sym => ({
      symbol: sym,
      name: sym,
      price: livePriceMap[sym] ?? 0,
      changePercent: 0,
      volume: 0,
    }))
  }

  // Sort by volume desc, cap at MAX_OHLCV_PARALLEL for analysis
  candidates.sort((a, b) => b.volume - a.volume)
  const toAnalyze = candidates.slice(0, MAX_OHLCV_PARALLEL)
  const totalLiquid = candidates.length

  if (toAnalyze.length === 0) {
    return { stocks: [], totalInRange, totalLiquid: 0, priceRange: { min, max }, dataSource, timestamp }
  }

  // ── Phase 3: Parallel OHLCV+Levels (3A) + Serper sentiment (3B) ─────────
  const settled = await Promise.allSettled(
    toAnalyze.map(async (stock): Promise<ScreenedStock> => {
      const [levels, headlines] = await Promise.all([
        // 3A — Yahoo OHLCV → calculateTradingLevels (confidence score + Entry/SL/Target/R:R)
        fetchOHLCV(stock.symbol, '3mo', '1d')
          .then(candles => candles.length >= 15
            ? calculateTradingLevels(stock.symbol, '1d', candles as any)
            : null
          )
          .catch(() => null),

        // 3B — Serper last 24h headlines
        searchGoogle(
          `${stock.name} stock news`,
          stock.symbol,
          stock.name,
          3,
          { recencyDays: 1, sortByDate: true }
        ).then(r => r.results.map(x => `${x.name}: ${x.snippet}`))
         .catch(() => [] as string[]),
      ])

      const confidenceScore = levels?.confidence_score ?? 40  // default to neutral 40 if no levels
      const sentScore = scoreSentiment(headlines)
      // Normalize sentiment (1-5) to same scale: multiply by 20 → 20-100
      // Then blend: 70% confidence + 30% sentiment
      const totalScore = Math.round(confidenceScore * 0.7 + sentScore * 20 * 0.3)

      return {
        symbol: stock.symbol,
        name: stock.name,
        livePrice: stock.price,
        changePercent: stock.changePercent,
        volume: stock.volume,
        levels,
        confidenceScore,
        sentimentScore: sentScore,
        totalScore,
        sentimentHeadlines: headlines.slice(0, 2),
      }
    })
  )

  const stocks: ScreenedStock[] = settled
    .filter((r): r is PromiseFulfilledResult<ScreenedStock> => r.status === 'fulfilled')
    .map(r => r.value)
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, limit)

  return { stocks, totalInRange, totalLiquid, priceRange: { min, max }, dataSource, timestamp }
}

// ── Message detection helper (used by ai-engine.ts) ─────────────────────────

export function detectPriceRangeScreening(message: string): { min: number; max: number } | null {
  const q = message.toLowerCase()

  // Must be a discovery/screening query, not a single stock question
  const isScreeningIntent = /\b(which|what|find|show|give|suggest|recommend|list|good|best|stocks?\s+to\s+buy|stocks?\s+i\s+can|stocks?\s+under|stocks?\s+in|stocks?\s+between|stocks?\s+from|stocks?\s+around|kaunse|konse|kaun)\b/i.test(q)
  if (!isScreeningIntent) return null

  // Extract price range — various formats
  const patterns: RegExp[] = [
    // "100-300", "100 to 300", "100–300"
    /(?:₹|rs\.?\s*)?(\d+)\s*(?:[-–]|to)\s*(?:₹|rs\.?\s*)?(\d+)/i,
    // "between 100 and 300"
    /between\s+(?:₹|rs\.?\s*)?(\d+)\s+and\s+(?:₹|rs\.?\s*)?(\d+)/i,
    // "from 100 to 300" / "from range 100 300"
    /from\s+(?:range[s]?\s+)?(?:₹|rs\.?\s*)?(\d+)[^\d]+(?:₹|rs\.?\s*)?(\d+)/i,
    // "range 100 to 300"
    /range[s]?\s+(?:₹|rs\.?\s*)?(\d+)\s*(?:[-–]|to)\s*(?:₹|rs\.?\s*)?(\d+)/i,
  ]

  for (const pattern of patterns) {
    const m = message.match(pattern)
    if (m?.[1] && m?.[2]) {
      const a = parseFloat(m[1])
      const b = parseFloat(m[2])
      if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 && a < b) {
        return { min: a, max: b }
      }
    }
  }

  // Single bound: "under 300", "below 500", "above 100"
  const underMatch = message.match(/(?:under|below|less\s+than)\s+(?:₹|rs\.?\s*)?(\d+)/i)
  if (underMatch?.[1] && isScreeningIntent) {
    const max = parseFloat(underMatch[1])
    if (Number.isFinite(max) && max > 0) return { min: 1, max }
  }

  const aboveMatch = message.match(/(?:above|over|more\s+than)\s+(?:₹|rs\.?\s*)?(\d+)/i)
  if (aboveMatch?.[1] && isScreeningIntent) {
    const min = parseFloat(aboveMatch[1])
    if (Number.isFinite(min) && min > 0) return { min, max: min * 5 }  // cap at 5x for sensible results
  }

  return null
}

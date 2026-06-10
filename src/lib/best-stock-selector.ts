import { prisma } from '@/lib/prisma'
import { searchGoogle } from '@/lib/googleSearch'

type ScannerRow = {
  id: string
  symbol: string
  name: string
  exchange: string
  latestTimestamp: Date
  close: number
  rsi: number
  sma50: number
  avgTradedValue20d: number
  candles20d: number
}

export interface BestStockCandidate {
  id: string
  symbol: string
  name: string
  exchange: string
  latestTimestamp: Date
  close: number
  rsi: number
  sma50: number
  avgTradedValue20d: number
  candles20d: number
  trendGapPct: number
  trendScore: number
  rsiScore: number
  technicalScore: number
  webScore: number
  finalScore: number
  sentimentLabel: 'Positive' | 'Neutral' | 'Negative'
  sentimentSummary: string
  sourceCount: number
  topHeadlines: { title: string; url: string; datePublished?: string }[]
}

export interface BestStockSelectionResult {
  generatedAt: Date
  universeCount: number
  eligibleCount: number
  shortlistCount: number
  requestedCount: number
  weights: {
    technical: number
    web: number
  }
  candidates: BestStockCandidate[]
}

export interface BestStockSelectionOptions {
  requestedCount?: number
  shortlistCount?: number
  allowExpandedCount?: boolean
}

const DEFAULT_REQUESTED_COUNT = 10
const MAX_REQUESTED_COUNT = 20
const DEFAULT_SHORTLIST_COUNT = 50
const TECHNICAL_WEIGHT = 0.8
const WEB_WEIGHT = 0.2
const MIN_PRICE = 20
const MIN_AVG_TRADED_VALUE_20D = 20_000_000 // ₹2 crore
const MIN_20D_CANDLES = 15
const MAX_PRICE_AGE_DAYS = 10
const WEB_RECENCY_DAYS = 3
const CACHE_TTL_MS = 30 * 60 * 1000

type UniverseScanTier = {
  label: string
  minPrice: number
  minAvgTradedValue20d: number
  min20dCandles: number
  maxPriceAgeDays: number
}

const UNIVERSE_SCAN_TIERS: UniverseScanTier[] = [
  {
    label: 'strict',
    minPrice: MIN_PRICE,
    minAvgTradedValue20d: MIN_AVG_TRADED_VALUE_20D,
    min20dCandles: MIN_20D_CANDLES,
    maxPriceAgeDays: MAX_PRICE_AGE_DAYS,
  },
  {
    label: 'relaxed',
    minPrice: 10,
    minAvgTradedValue20d: 5_000_000, // ₹50 lakh
    min20dCandles: 10,
    maxPriceAgeDays: 21,
  },
  {
    label: 'broad',
    minPrice: 5,
    minAvgTradedValue20d: 0,
    min20dCandles: 5,
    maxPriceAgeDays: 60,
  },
]

const POSITIVE_PATTERNS: Array<[RegExp, number]> = [
  [/\b(order win|order book|contract win|major order|new order|deal win)\b/i, 1.4],
  [/\b(strong earnings|profit jump|profit rises?|revenue rises?|margin expands?)\b/i, 1.3],
  [/\b(upgrade|upgraded|buy rating|outperform|overweight)\b/i, 1.2],
  [/\b(approval|approves|cleared|license|launch|expansion|capex plan)\b/i, 1.0],
  [/\b(rally|surge|gains?|jumps?|record high|bullish)\b/i, 0.8],
  [/\b(acquisition|strategic partnership|tie-up|partnership)\b/i, 0.7],
]

const NEGATIVE_PATTERNS: Array<[RegExp, number]> = [
  [/\b(probe|investigation|raid|fraud|default|insolvency|bankruptcy)\b/i, 1.5],
  [/\b(downgrade|cut to sell|underperform|reduce rating)\b/i, 1.3],
  [/\b(loss widens?|profit falls?|revenue drops?|margin pressure)\b/i, 1.3],
  [/\b(penalty|fine|lawsuit|tax notice|regulatory action)\b/i, 1.1],
  [/\b(slump|falls?|drops?|selloff|bearish|weak guidance)\b/i, 0.9],
  [/\b(debt concern|pledge|resignation|delay|miss(es|ed)? estimates?)\b/i, 0.9],
]

const SOURCE_QUALITY: Record<string, number> = {
  'reuters.com': 1.0,
  'economictimes.indiatimes.com': 0.95,
  'moneycontrol.com': 0.95,
  'livemint.com': 0.92,
  'business-standard.com': 0.9,
  'thehindubusinessline.com': 0.9,
  'cnbctv18.com': 0.88,
  'ndtvprofit.com': 0.88,
  'mintgenie.livemint.com': 0.85,
  'financialexpress.com': 0.84,
  'investing.com': 0.8,
  'tradingview.com': 0.75,
  'bseindia.com': 0.95,
  'nseindia.com': 0.95,
}

type CachedSelection = {
  expiresAt: number
  generatedAt: Date
  universeCount: number
  eligibleCount: number
  shortlistCount: number
  rankedCandidates: BestStockCandidate[]
}

const selectionCache = new Map<string, CachedSelection>()

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeRequestedCount(value?: number, maxCount = MAX_REQUESTED_COUNT): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_REQUESTED_COUNT
  return clamp(Math.floor(value), 1, maxCount)
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function sourceQualityScore(url: string): number {
  const domain = extractDomain(url)
  if (!domain) return 0.55
  const exact = SOURCE_QUALITY[domain]
  if (typeof exact === 'number') return exact
  const partial = Object.entries(SOURCE_QUALITY).find(([known]) => domain === known || domain.endsWith(`.${known}`))
  return partial ? partial[1] : 0.6
}

function recencyWeight(datePublished?: string): number {
  if (!datePublished) return 0.45
  const parsed = new Date(datePublished)
  if (Number.isNaN(parsed.getTime())) return 0.45
  const ageDays = (Date.now() - parsed.getTime()) / (24 * 60 * 60 * 1000)
  if (ageDays <= 1) return 1
  if (ageDays <= 2) return 0.85
  if (ageDays <= 3) return 0.7
  if (ageDays <= 5) return 0.45
  return 0.2
}

function keywordSentimentScore(text: string): number {
  let score = 0
  for (const [pattern, weight] of POSITIVE_PATTERNS) {
    if (pattern.test(text)) score += weight
  }
  for (const [pattern, weight] of NEGATIVE_PATTERNS) {
    if (pattern.test(text)) score -= weight
  }
  return clamp(score / 3.5, -1, 1)
}

function computeTrendScore(close: number, sma50: number): number {
  if (!Number.isFinite(close) || !Number.isFinite(sma50) || sma50 <= 0) return 0
  const gap = (close - sma50) / sma50
  return clamp(((gap + 0.05) / 0.13) * 100, 0, 100)
}

function computeRsiScore(rsi: number): number {
  if (!Number.isFinite(rsi)) return 0
  return clamp(100 - Math.abs(rsi - 60) * 3.3, 0, 100)
}

function formatCompactCurrency(amount: number): string {
  if (!Number.isFinite(amount)) return 'N/A'
  if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(1)}Cr`
  if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(1)}L`
  return `₹${amount.toFixed(0)}`
}

async function fetchScannerUniverseTier(tier: UniverseScanTier): Promise<ScannerRow[]> {
  const cutoffDate = new Date(Date.now() - tier.maxPriceAgeDays * 24 * 60 * 60 * 1000)

  return prisma.$queryRaw<ScannerRow[]>`
    SELECT
      s.id,
      s.symbol,
      s.name,
      s.exchange,
      latest."latestTimestamp",
      latest.close,
      latest.rsi,
      latest."sma50",
      COALESCE(liquidity."avgTradedValue20d", 0) AS "avgTradedValue20d",
      liquidity."candles20d"
    FROM "Stock" s
    JOIN LATERAL (
      SELECT
        sp.timestamp AS "latestTimestamp",
        sp.close,
        COALESCE(sp.rsi, 55)::double precision AS rsi,
        COALESCE(
          sp."sma50",
          sp."sma20",
          (
            SELECT AVG(hist.close)::double precision
            FROM (
              SELECT h.close
              FROM "StockPrice" h
              WHERE h."stockId" = s.id
              ORDER BY h.timestamp DESC
              LIMIT 50
            ) AS hist
          ),
          sp.close
        )::double precision AS "sma50"
      FROM "StockPrice" sp
      WHERE sp."stockId" = s.id
      ORDER BY sp.timestamp DESC
      LIMIT 1
    ) AS latest ON TRUE
    JOIN LATERAL (
      SELECT
        AVG((recent.close * recent.volume)::double precision) AS "avgTradedValue20d",
        COUNT(*)::int AS "candles20d"
      FROM (
        SELECT sp.close, sp.volume
        FROM "StockPrice" sp
        WHERE sp."stockId" = s.id
        ORDER BY sp.timestamp DESC
        LIMIT 20
      ) AS recent
    ) AS liquidity ON TRUE
    WHERE
      latest.close IS NOT NULL
      AND latest."sma50" IS NOT NULL
      AND latest.close >= ${tier.minPrice}
      AND COALESCE(liquidity."avgTradedValue20d", 0) >= ${tier.minAvgTradedValue20d}
      AND liquidity."candles20d" >= ${tier.min20dCandles}
      AND latest."latestTimestamp" >= ${cutoffDate}
  `
}

async function fetchScannerUniverse(targetRows: number): Promise<{ universeCount: number; rows: ScannerRow[] }> {
  const universeCount = await prisma.stock.count()
  let rows: ScannerRow[] = []

  for (const tier of UNIVERSE_SCAN_TIERS) {
    rows = await fetchScannerUniverseTier(tier)
    if (rows.length >= targetRows) break
  }

  return { universeCount, rows }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  async function runner() {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runner())
  await Promise.all(runners)
  return results
}

async function enrichWithWebSentiment(row: ScannerRow, technicalScore: number): Promise<BestStockCandidate> {
  const trendGapPct = ((row.close - row.sma50) / row.sma50) * 100
  const trendScore = computeTrendScore(row.close, row.sma50)
  const rsiScore = computeRsiScore(row.rsi)

  const response = await searchGoogle(
    `${row.name} ${row.symbol} latest news India stock`,
    row.symbol,
    row.name,
    4,
    {
      recencyDays: WEB_RECENCY_DAYS,
      requireFresh: false,
      requireDatedForFresh: false,
      sortByDate: true,
    }
  ).catch(() => ({ success: false, results: [] as any[] }))

  const results = Array.isArray(response.results) ? response.results.slice(0, 4) : []
  const articleScores = results.map((item) => {
    const text = `${item.name} ${item.snippet}`.toLowerCase()
    const sentiment = keywordSentimentScore(text)
    const sourceQuality = sourceQualityScore(item.url)
    const recency = recencyWeight(item.datePublished)
    return { sentiment, sourceQuality, recency, item }
  })

  const totalWeight = articleScores.reduce((sum, item) => sum + item.sourceQuality * item.recency, 0)
  const weightedSentiment = totalWeight > 0
    ? articleScores.reduce((sum, item) => sum + item.sentiment * item.sourceQuality * item.recency, 0) / totalWeight
    : 0
  const avgRecency = articleScores.length > 0
    ? articleScores.reduce((sum, item) => sum + item.recency, 0) / articleScores.length
    : 0.5
  const avgSourceQuality = articleScores.length > 0
    ? articleScores.reduce((sum, item) => sum + item.sourceQuality, 0) / articleScores.length
    : 0.6

  const polarityScore = (weightedSentiment + 1) * 50
  const webScore = articleScores.length > 0
    ? clamp((polarityScore * 0.6) + (avgRecency * 100 * 0.25) + (avgSourceQuality * 100 * 0.15), 0, 100)
    : 50

  const sentimentLabel: BestStockCandidate['sentimentLabel'] =
    weightedSentiment > 0.15 ? 'Positive' :
    weightedSentiment < -0.15 ? 'Negative' :
    'Neutral'

  const sentimentSummary = articleScores.length > 0
    ? `${sentimentLabel} news flow from ${articleScores.length} recent sources`
    : 'Neutral — no strong fresh news found'

  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    exchange: row.exchange,
    latestTimestamp: row.latestTimestamp,
    close: row.close,
    rsi: row.rsi,
    sma50: row.sma50,
    avgTradedValue20d: row.avgTradedValue20d,
    candles20d: row.candles20d,
    trendGapPct,
    trendScore,
    rsiScore,
    technicalScore,
    webScore,
    finalScore: clamp((technicalScore * TECHNICAL_WEIGHT) + (webScore * WEB_WEIGHT), 0, 100),
    sentimentLabel,
    sentimentSummary: `${sentimentSummary}; avg traded value ${formatCompactCurrency(row.avgTradedValue20d)}/day`,
    sourceCount: articleScores.length,
    topHeadlines: results.slice(0, 2).map((item) => ({
      title: item.name,
      url: item.url,
      datePublished: item.datePublished,
    })),
  }
}

export async function selectBestStocks(options: BestStockSelectionOptions = {}): Promise<BestStockSelectionResult> {
  const shortlistCount = Math.max(DEFAULT_SHORTLIST_COUNT, options.shortlistCount ?? DEFAULT_SHORTLIST_COUNT)
  const requestedCount = normalizeRequestedCount(
    options.requestedCount,
    options.allowExpandedCount ? shortlistCount : MAX_REQUESTED_COUNT
  )
  const cacheKey = `best-stock-v3:${shortlistCount}:${new Date().toISOString().slice(0, 13)}`
  const cached = selectionCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return {
      generatedAt: cached.generatedAt,
      universeCount: cached.universeCount,
      eligibleCount: cached.eligibleCount,
      shortlistCount: cached.shortlistCount,
      requestedCount,
      weights: {
        technical: TECHNICAL_WEIGHT,
        web: WEB_WEIGHT,
      },
      candidates: cached.rankedCandidates.slice(0, requestedCount),
    }
  }

  const { universeCount, rows } = await fetchScannerUniverse(Math.max(shortlistCount, requestedCount))

  const technicallyRanked = rows
    .map((row) => {
      const trendScore = computeTrendScore(row.close, row.sma50)
      const rsiScore = computeRsiScore(row.rsi)
      const technicalScore = clamp((trendScore * 0.55) + (rsiScore * 0.45), 0, 100)
      return { row, technicalScore }
    })
    .sort((left, right) => right.technicalScore - left.technicalScore)

  const shortlisted = technicallyRanked.slice(0, shortlistCount)
  const enriched = await mapWithConcurrency(shortlisted, 10, async ({ row, technicalScore }) =>
    enrichWithWebSentiment(row, technicalScore)
  )

  const rankedCandidates = enriched
    .sort((left, right) => right.finalScore - left.finalScore)

  const result: BestStockSelectionResult = {
    generatedAt: new Date(),
    universeCount,
    eligibleCount: rows.length,
    shortlistCount: shortlisted.length,
    requestedCount,
    weights: {
      technical: TECHNICAL_WEIGHT,
      web: WEB_WEIGHT,
    },
    candidates: rankedCandidates.slice(0, requestedCount),
  }

  selectionCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    generatedAt: result.generatedAt,
    universeCount,
    eligibleCount: rows.length,
    shortlistCount: shortlisted.length,
    rankedCandidates,
  })

  return result
}

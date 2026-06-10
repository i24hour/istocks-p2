import { fetchOHLCV, computeIndicators, batchQuote } from '@/lib/yahoo-finance'
import { runMarketScanner } from '@/lib/market-scanners'
import { calculateTradingLevels } from '@/lib/trading-levels'
import { fetchCascadingPrices } from '@/lib/cascading-price-fetch'
import { prisma } from '@/lib/prisma'
import type { ScreenerCriteria } from './prompt-enhancer'

// Threshold: if SQL scanners return fewer than this, expand to full DB scan via Yahoo
const SQL_MIN_CANDIDATES = 20
// Max candidates to fetch full OHLCV for after Yahoo pre-filter
const OHLCV_CANDIDATE_LIMIT = 60
// Batch size for Yahoo batchQuote (Yahoo handles up to ~300 at once)
const QUOTE_BATCH_SIZE = 300

export interface ScreenerCandidate {
    symbol: string
    name: string
    close: number
    score: number
    rsi14: number | null
    sma50: number | null
    sma200: number | null
    macdHist: number | null
    trendGapPct: number | null
    volumeRatio: number | null
    levels: {
        entry: number
        stopLoss: number
        target: number
        riskReward: number
        setupType: string
        confidence: number
        holdingLabel: string
    } | null
    scanSource: string
}

export interface ScreenerResult {
    criteria: ScreenerCriteria
    candidates: ScreenerCandidate[]
    universeCount: number
    scoredCount: number
    durationMs: number
    yahooFallback?: boolean
}

export type ScreenerStep = (text: string) => void

function normalize(value: number, min: number, max: number, invert = false): number {
    if (max <= min) return 0.5
    const clamped = Math.max(min, Math.min(max, value))
    const n = (clamped - min) / (max - min)
    return invert ? 1 - n : n
}

function safeAvg(arr: number[]): number {
    if (!arr.length) return 0
    return arr.reduce((s, v) => s + v, 0) / arr.length
}

export async function runDynamicScreener(
    criteria: ScreenerCriteria,
    onStep: ScreenerStep
): Promise<ScreenerResult> {
    const t0 = Date.now()

    // ── Phase 1: Discovery ────────────────────────────────────────────────────
    onStep(`Running ${criteria.discoveryKeys.length} market scans to find candidates...`)

    const scanResults = await Promise.allSettled(
        criteria.discoveryKeys.map(key =>
            runMarketScanner({ key, topN: 20, horizonDays: criteria.horizonDays })
        )
    )

    // Collect unique symbols; track which scan found them
    const symbolMeta = new Map<string, { name: string; close: number; source: string }>()
    for (const result of scanResults) {
        if (result.status !== 'fulfilled') continue
        for (const row of result.value.rows) {
            if (!symbolMeta.has(row.symbol)) {
                symbolMeta.set(row.symbol, {
                    name: row.name,
                    close: row.close,
                    source: result.value.title,
                })
            }
        }
    }

    let symbolList = [...symbolMeta.keys()]
    let usingYahooFallback = false

    if (symbolList.length < SQL_MIN_CANDIDATES) {
        // SQL scanners returned too few — expand to ALL stocks in DB via Yahoo batch quotes
        onStep(`SQL returned only ${symbolList.length} candidates — scanning full stock database via Yahoo...`)
        usingYahooFallback = true

        try {
            // Step 1: Get all stock symbols from DB
            const allDbStocks = await prisma.stock.findMany({
                select: { symbol: true, name: true },
                orderBy: { symbol: 'asc' },
            })
            onStep(`Fetching live quotes for ${allDbStocks.length} stocks from DB...`)

            // Step 2: batchQuote all of them in parallel chunks
            const allSymbols = allDbStocks.map(s => s.symbol)
            const nameMap = new Map(allDbStocks.map(s => [s.symbol, s.name]))
            const chunks: string[][] = []
            for (let i = 0; i < allSymbols.length; i += QUOTE_BATCH_SIZE) {
                chunks.push(allSymbols.slice(i, i + QUOTE_BATCH_SIZE))
            }

            // Run max 4 chunks concurrently to avoid Yahoo rate limits
            const allQuotes: Awaited<ReturnType<typeof batchQuote>> = []
            for (let i = 0; i < chunks.length; i += 4) {
                const batch = chunks.slice(i, i + 4)
                const results = await Promise.allSettled(batch.map(c => batchQuote(c)))
                for (const r of results) {
                    if (r.status === 'fulfilled') allQuotes.push(...r.value)
                }
            }

            onStep(`Got quotes for ${allQuotes.length} stocks — pre-filtering by intent...`)

            // Step 3: Intent-based pre-filter using Yahoo quote fields
            // (price, changePercent, volume/avgVolume, 52wHigh, 52wLow, peRatio)
            const intent = criteria.intent
            const scoredQuotes = allQuotes
                .filter(q => q.price > 5) // skip penny stocks
                .map(q => {
                    const pctFrom52wHigh = q.fiftyTwoWeekHigh > 0
                        ? ((q.fiftyTwoWeekHigh - q.price) / q.fiftyTwoWeekHigh) * 100
                        : 0
                    const pctFrom52wLow = q.fiftyTwoWeekLow > 0
                        ? ((q.price - q.fiftyTwoWeekLow) / q.fiftyTwoWeekLow) * 100
                        : 0
                    const volRatio = q.avgVolume > 0 ? q.volume / q.avgVolume : 1

                    let preScore = 0
                    if (intent === 'undervalued' || intent === 'oversold') {
                        // Want stocks that have pulled back but aren't dead
                        preScore = pctFrom52wHigh * 0.4           // more drop = more opportunity
                            + (q.peRatio && q.peRatio < 35 && q.peRatio > 0 ? (35 - q.peRatio) : 0) * 0.3
                            + Math.max(0, -q.changePercent) * 0.2  // recent dip
                            + volRatio * 0.1
                    } else if (intent === 'momentum' || intent === 'breakout') {
                        // Want stocks moving up with volume
                        preScore = Math.max(0, q.changePercent) * 0.4
                            + (pctFrom52wLow > 0 ? Math.min(pctFrom52wLow, 50) : 0) * 0.3
                            + volRatio * 0.3
                    } else if (intent === 'safe') {
                        // Want stocks near 52w high with low volatility
                        preScore = (100 - pctFrom52wHigh) * 0.5
                            + (q.marketCap ? Math.min(Math.log10(q.marketCap), 13) * 5 : 0) * 0.3
                            + volRatio * 0.2
                    } else {
                        // Generic: balanced momentum + volume spike
                        preScore = Math.abs(q.changePercent) * 0.3
                            + volRatio * 0.4
                            + (pctFrom52wLow > 0 ? Math.min(pctFrom52wLow / 100, 1) * 20 : 0) * 0.3
                    }
                    return { q, preScore }
                })
                .sort((a, b) => b.preScore - a.preScore)
                .slice(0, OHLCV_CANDIDATE_LIMIT)

            // Add SQL scanner results first (they already passed DB filters)
            for (const sym of [...symbolMeta.keys()]) {
                const existing = symbolMeta.get(sym)!
                if (!scoredQuotes.find(s => s.q.symbol === sym)) {
                    scoredQuotes.push({
                        q: { symbol: sym, price: existing.close, changePercent: 0, volume: 0, avgVolume: 0, fiftyTwoWeekHigh: 0, fiftyTwoWeekLow: 0, peRatio: null, marketCap: null } as any,
                        preScore: 999,
                    })
                }
            }
            symbolMeta.clear()

            for (const { q } of scoredQuotes) {
                symbolMeta.set(q.symbol, {
                    name: nameMap.get(q.symbol) ?? q.symbol,
                    close: q.price,
                    source: 'Yahoo full scan',
                })
            }

        } catch (err) {
            console.error('[screener] Yahoo full DB scan failed:', err)
            // Last resort: keep whatever SQL found
        }

        symbolList = [...symbolMeta.keys()]
    }

    const universeCount = symbolList.length

    if (universeCount === 0) {
        return { criteria, candidates: [], universeCount: 0, scoredCount: 0, durationMs: Date.now() - t0 }
    }

    const sourceLabel = usingYahooFallback
        ? `Yahoo full DB scan (${universeCount} pre-filtered candidates)`
        : `${universeCount} candidate stocks from SQL scanners`
    onStep(`Found ${sourceLabel} — fetching indicators...`)

    // ── Phase 2: Data Gather ──────────────────────────────────────────────────
    const dataResults = await Promise.allSettled(
        symbolList.map(async (symbol) => {
            const candles = await fetchOHLCV(symbol, '1y', '1d')
            if (candles.length < 20) return null
            const ind = computeIndicators(candles)
            const avg20Vol = safeAvg(candles.slice(-20).map(c => c.volume))
            const latestVol = candles[candles.length - 1]?.volume ?? 0
            const volumeRatio = avg20Vol > 0 ? latestVol / avg20Vol : 1

            // Convert Date timestamps → number for calculateTradingLevels
            const tlCandles = candles.map(c => ({
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume,
                timestamp: c.timestamp instanceof Date ? c.timestamp.getTime() : Number(c.timestamp),
            }))
            const levels = calculateTradingLevels(symbol, '1d', tlCandles)

            return { symbol, ind, volumeRatio, levels }
        })
    )

    onStep(`Scoring and ranking by ${criteria.label} criteria...`)

    // ── Phase 3: Score ────────────────────────────────────────────────────────
    const { weights, intent } = criteria

    // Collect all values for cross-stock normalization
    const allRsi: number[] = []
    const allMomentum: number[] = []
    const allMacdHist: number[] = []
    const allVolumeRatio: number[] = []

    for (const r of dataResults) {
        if (r.status !== 'fulfilled' || !r.value) continue
        const { ind, volumeRatio } = r.value
        if (ind.rsi14 != null) allRsi.push(ind.rsi14)
        if (ind.sma50 != null && ind.latestClose != null) {
            allMomentum.push(((ind.latestClose - ind.sma50) / ind.sma50) * 100)
        }
        if (ind.macdHist != null) allMacdHist.push(ind.macdHist)
        allVolumeRatio.push(volumeRatio)
    }

    const rsiMin = Math.min(...allRsi)
    const rsiMax = Math.max(...allRsi)
    const momMin = Math.min(...allMomentum)
    const momMax = Math.max(...allMomentum)
    const macdMin = Math.min(...allMacdHist)
    const macdMax = Math.max(...allMacdHist)
    const volMin = Math.min(...allVolumeRatio)
    const volMax = Math.max(...allVolumeRatio)

    const wantsOversold = intent === 'oversold' || intent === 'undervalued'

    const scored: ScreenerCandidate[] = []

    for (const r of dataResults) {
        if (r.status !== 'fulfilled' || !r.value) continue
        const { symbol, ind, volumeRatio, levels } = r.value
        const meta = symbolMeta.get(symbol)
        if (!meta) continue

        const close = ind.latestClose ?? meta.close
        const rsi14 = ind.rsi14 ?? null
        const sma50 = ind.sma50 ?? null
        const sma200 = ind.sma200 ?? null
        const macdHist = ind.macdHist ?? null
        const trendGapPct = sma50 && close ? ((close - sma50) / sma50) * 100 : null

        // RSI score: for oversold/undervalued, lower RSI (more oversold) = better
        const rsiScore = rsi14 != null
            ? normalize(rsi14, rsiMin, rsiMax, wantsOversold)
            : 0.5

        // Momentum score: for oversold/undervalued, being below SMA50 is an opportunity
        const momentumScore = trendGapPct != null
            ? normalize(trendGapPct, momMin, momMax, wantsOversold)
            : 0.5

        // SMA trend: above SMA200 = bullish (always rewarded for safe/generic; neutral for oversold)
        const smaScore = sma200 && close
            ? (close > sma200 ? 1 : intent === 'safe' ? 0 : 0.35)
            : 0.5

        // Volume score: higher volume ratio = more interest
        const volumeScore = normalize(volumeRatio, volMin, volMax)

        // MACD score: positive histogram = bullish momentum
        const macdScore = macdHist != null
            ? normalize(macdHist, macdMin, macdMax, false)
            : 0.5

        const score =
            weights.rsi * rsiScore +
            weights.momentum * momentumScore +
            weights.sma * smaScore +
            weights.volume * volumeScore +
            weights.macd * macdScore

        scored.push({
            symbol,
            name: meta.name,
            close,
            score: Math.round(score * 1000) / 10,
            rsi14,
            sma50,
            sma200,
            macdHist,
            trendGapPct,
            volumeRatio,
            levels: levels
                ? {
                    entry: levels.entry_price,
                    stopLoss: levels.stop_loss,
                    target: levels.target_price,
                    riskReward: levels.risk_reward_ratio,
                    setupType: levels.setup_type,
                    confidence: levels.confidence_score,
                    holdingLabel: levels.holding?.holdingLabel ?? 'N/A',
                }
                : null,
            scanSource: meta.source,
        })
    }

    scored.sort((a, b) => b.score - a.score)

    const top = scored.slice(0, criteria.topN)

    // ── Phase 4: Live Price Refresh (Cascading: EC2 → Yahoo → OHLCV) ───────────
    onStep(`Fetching live prices for top ${top.length} picks...`)
    try {
        const topSymbols = top.map(c => c.symbol)
        const priceMap = await fetchCascadingPrices(topSymbols)
        for (const c of top) {
            const cascadingPrice = priceMap.get(c.symbol)
            if (cascadingPrice && cascadingPrice.price > 0) {
                c.close = cascadingPrice.price
            }
        }
    } catch {
        // Non-fatal — keep OHLCV close as fallback
    }

    return {
        criteria,
        candidates: top,
        universeCount,
        scoredCount: scored.length,
        durationMs: Date.now() - t0,
        yahooFallback: usingYahooFallback,
    } as ScreenerResult
}

export function formatScreenerAnswer(result: ScreenerResult, detectedLang: string): string {
    const { criteria, candidates, universeCount, scoredCount, yahooFallback } = result
    const isHindi = /Hindi|Hinglish/i.test(detectedLang)

    if (!candidates.length) {
        return isHindi
            ? `${criteria.label} ke liye koi stock qualify nahi hua. Baad mein try karein.`
            : `No stocks qualified for "${criteria.label}" scan right now. Try again later.`
    }

    const header = isHindi
        ? `**${criteria.label}** — Top ${candidates.length} picks`
        : `**${criteria.label}** — Top ${candidates.length} picks`

    const universeLabel = yahooFallback ? `Yahoo (${universeCount} stocks from full DB)` : 'SQL scanners'
    const summary = isHindi
        ? `${universeLabel} se ${universeCount} candidates → ${scoredCount} scored → top ${candidates.length} selected`
        : `${universeLabel}: ${universeCount} candidates → scored ${scoredCount} → selected top ${candidates.length}`

    const lines = candidates.map((c, i) => {
        const rsiStr = c.rsi14 != null ? `RSI ${c.rsi14.toFixed(1)}` : 'RSI —'
        const gapStr = c.trendGapPct != null
            ? `vs SMA50 ${c.trendGapPct >= 0 ? '+' : ''}${c.trendGapPct.toFixed(1)}%`
            : ''
        const macdStr = c.macdHist != null
            ? (c.macdHist > 0 ? 'MACD ↑' : 'MACD ↓')
            : ''
        const trendStr = c.sma200 != null && c.close
            ? (c.close > c.sma200 ? 'Uptrend' : 'Downtrend')
            : ''

        const indicators = [rsiStr, gapStr, macdStr, trendStr].filter(Boolean).join(' | ')
        let line = `${i + 1}. **${c.symbol}** — ₹${c.close.toFixed(2)} | Score ${c.score.toFixed(0)}/100\n   ${indicators}`

        if (c.levels) {
            const l = c.levels
            line += `\n   Entry ₹${l.entry.toFixed(2)} | SL ₹${l.stopLoss.toFixed(2)} | Target ₹${l.target.toFixed(2)} | R:R ${l.riskReward}x | Holding: ${l.holdingLabel}`
        }

        return line
    })

    const scoringNote = isHindi
        ? `_Scoring: RSI ${Math.round(criteria.weights.rsi * 100)}% + Momentum ${Math.round(criteria.weights.momentum * 100)}% + SMA Trend ${Math.round(criteria.weights.sma * 100)}% + Volume ${Math.round(criteria.weights.volume * 100)}% + MACD ${Math.round(criteria.weights.macd * 100)}%_`
        : `_Scoring: RSI ${Math.round(criteria.weights.rsi * 100)}% · Momentum ${Math.round(criteria.weights.momentum * 100)}% · SMA Trend ${Math.round(criteria.weights.sma * 100)}% · Volume ${Math.round(criteria.weights.volume * 100)}% · MACD ${Math.round(criteria.weights.macd * 100)}%_`

    return `${header}\n${summary}\n\n${lines.join('\n\n')}\n\n${scoringNote}`
}

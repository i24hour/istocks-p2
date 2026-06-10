/**
 * Market Scanners
 *
 * Deterministic, SQL-driven answers for the "extreme price / indicator" class
 * of questions that the LLM router used to answer incorrectly (e.g. "stocks
 * right now at their lowest" being interpreted as "worst-ranked in my daily
 * selection").
 *
 * Each scanner is a pure function that runs a single Prisma $queryRaw and
 * returns a typed `ScannerRow[]`. The chat-engine (`ai-engine.ts`) picks a
 * scanner via `detectMarketScanner()` — if nothing matches, routing continues
 * as before.
 *
 * IMPORTANT: No LLM is used to decide which rows come back. Rows come
 * straight from SQL so the list cannot be hallucinated.
 *
 * Conventions
 *   - "N days" in user questions is parsed into trading sessions (see
 *     `parseTradingDaysHorizon`) with a default of 20 trading days (~1 month).
 *   - Universe-wide scans apply a liquidity floor (`avgTradedValue20d >= ₹2 cr`)
 *     so we don't surface illiquid small caps.
 *   - Results are hard-capped at 10 rows to keep the chat reply short.
 */

import { prisma } from '@/lib/prisma'

// ── Public types ────────────────────────────────────────────────────────────

export type ScannerKey =
    | 'near52wLow'
    | 'near52wHigh'
    | 'deepestDrawdown'
    | 'biggestRunners'
    | 'biggestLosersWindow'
    | 'oversoldRsi'
    | 'overboughtRsi'
    | 'bollingerLower'
    | 'bollingerUpper'
    | 'goldenCross'
    | 'deathCross'
    | 'macdBullishCross'
    | 'macdBearishCross'
    | 'aboveSMA200'
    | 'belowSMA50'
    | 'unusualVolume'

export interface ScannerRequest {
    key: ScannerKey
    topN: number
    /** Trading-session horizon (only used by window-based scanners). */
    horizonDays: number
    /**
     * For RSI scanners: the threshold extracted from the user's message.
     * e.g. "RSI below 30" → 30; "RSI below 25" → 25.
     * Defaults to 30 for oversoldRsi, 70 for overboughtRsi.
     */
    rsiThreshold?: number
}

export interface ScannerRow {
    symbol: string
    name: string
    close: number
    /**
     * A single numeric value relevant to the scanner, e.g. "%-from-52w-low"
     * or "window return %". Used to sort and to label each row in the reply.
     */
    metric: number
    /** Human-readable label for `metric`, e.g. "from 52w low". */
    metricLabel: string
    rsi: number | null
    sma50: number | null
    sma200: number | null
    avgTradedValue20d: number
}

export interface ScannerResult {
    request: ScannerRequest
    /** Short title to show to the user, e.g. "Stocks near 52-week low". */
    title: string
    rows: ScannerRow[]
}

// ── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_TOP_N = 10
const DEFAULT_HORIZON_TRADING_DAYS = 20
const TRADING_DAYS_PER_YEAR = 252
const MIN_PRICE = 20
const MIN_AVG_TRADED_VALUE_20D = 20_000_000 // ₹2 crore
const MIN_CANDLES_20D = 15
const MAX_PRICE_AGE_DAYS = 10

function cutoffRecent(): Date {
    return new Date(Date.now() - MAX_PRICE_AGE_DAYS * 24 * 60 * 60 * 1000)
}

// ── Phrase detector ─────────────────────────────────────────────────────────

/**
 * Parse a "last N [days|weeks|months]" mention into trading sessions.
 * Returns null when no window phrase is present (caller uses default).
 */
function parseTradingDaysHorizon(q: string): number | null {
    const m = q.match(
        /\b(?:last|past|previous|in\s+the\s+last|in\s+past)\s+(\d{1,3})\s*(day|days|d|week|weeks|w|month|months|mo)\b/i
    )
    if (m) {
        const n = Math.max(1, Math.min(365, Number.parseInt(m[1], 10)))
        const unit = m[2].toLowerCase()
        if (unit.startsWith('d')) return n
        if (unit.startsWith('w')) return n * 5      // 5 trading sessions / week
        return Math.round(n * 21)                    // ~21 trading sessions / month
    }
    if (/\blast\s+week\b|\bpast\s+week\b|\bthis\s+week\b/i.test(q)) return 5
    if (/\blast\s+month\b|\bpast\s+month\b|\bthis\s+month\b/i.test(q)) return 21
    if (/\bytd\b|\byear\s*to\s*date\b/i.test(q)) return TRADING_DAYS_PER_YEAR
    return null
}

function parseTopN(q: string): number | null {
    const m =
        q.match(/\btop\s+(\d{1,2})\b/i) ||
        q.match(/\b(\d{1,2})\s+stocks?\b/i) ||
        q.match(/\bgive\s+me\s+(\d{1,2})\b/i) ||
        q.match(/\bshow\s+me\s+(\d{1,2})\b/i) ||
        q.match(/\blist\s+(\d{1,2})\b/i)
    if (!m) return null
    const n = Number.parseInt(m[1], 10)
    if (!Number.isFinite(n) || n <= 0) return null
    return Math.min(20, n)
}

/**
 * Parse an explicit RSI threshold from phrases like:
 *   "RSI below 30"  → 30
 *   "RSI under 25"  → 25
 *   "RSI < 35"      → 35
 * Returns null if no explicit number found.
 */
function parseRsiThreshold(q: string, defaultValue: number): number {
    const m = q.match(/\brsi\s*(?:<|under|below|se\s*neeche)\s*(\d{1,3})\b/i)
        ?? q.match(/\brsi\s*<\s*(\d{1,3})\b/i)
    if (m) {
        const n = Number.parseInt(m[1], 10)
        if (Number.isFinite(n) && n > 0 && n < 100) return n
    }
    return defaultValue
}

/**
 * Map the user's free-form message to a scanner, or null if nothing matches.
 *
 * Phrase banks intentionally include Hinglish variants ("gir rahe hai",
 * "bottom pe", "peak pe", "sabse zyada gira", "volume badh gayi").
 */
export function detectMarketScanner(message: string): ScannerRequest | null {
    const q = message.toLowerCase()

    // Block when the user clearly means a single-stock follow-up.
    if (/\b(this\s+stock|is\s+stock|that\s+stock|yeh\s+stock|iska|uska|iske|uske)\b/i.test(q)) {
        return null
    }

    const topN = parseTopN(q) ?? DEFAULT_TOP_N
    const horizonDays = parseTradingDaysHorizon(q) ?? DEFAULT_HORIZON_TRADING_DAYS

    type Rule = { key: ScannerKey; re: RegExp }
    const rules: Rule[] = [
        // Order matters — more specific phrases first.
        {
            key: 'near52wLow',
            re: /\b(52[- ]?week\s+low|52\s*wk\s+low|yearly\s+low|year\s+low|near(?:est)?\s+(?:the\s+)?low|at\s+(?:their|its)?\s*lows?|stocks?\s+(?:right\s+now\s+)?at\s+(?:their|its)?\s*lowest|lowest\s+(?:stocks?|price)|at\s+bottoms?|bottom\s+pe|low\s+pe|lows?\s+pe\s+chal|gir\s+(?:gaye|gayi|rahe|rhe|rahi|rhi)|girte\s+(?:hue|huye)|neeche\s+chal|sabse\s+neeche)\b/i,
        },
        {
            key: 'near52wHigh',
            re: /\b(52[- ]?week\s+high|52\s*wk\s+high|yearly\s+high|year\s+high|all[- ]?time\s+high|ath\b|new\s+highs?|at\s+(?:their|its)?\s*highs?|stocks?\s+(?:right\s+now\s+)?at\s+(?:their|its)?\s*highest|highest\s+(?:stocks?|price)|peak\s+pe|high\s+pe|sabse\s+upar|upar\s+chal)\b/i,
        },
        {
            key: 'unusualVolume',
            re: /\b(unusual\s+volume|volume\s+spike|volume\s+surge|heavy\s+volume|high\s+volume\s+today|volume\s+badh(?:\s+gayi)?|zyada\s+volume|bhari\s+volume)\b/i,
        },
        {
            key: 'goldenCross',
            re: /\b(golden\s+cross|sma\s*50\s+crossed\s+sma\s*200|50[- ]?day\s+crossed\s+200[- ]?day|50\s*dma\s+crossed\s+200\s*dma)\b/i,
        },
        {
            key: 'deathCross',
            re: /\b(death\s+cross|sma\s*50\s+below\s+sma\s*200|50[- ]?day\s+below\s+200[- ]?day)\b/i,
        },
        {
            key: 'macdBullishCross',
            re: /\b(macd\s+(?:bullish\s+)?cross(?:over)?|bullish\s+macd|macd\s+crossed\s+(?:above|over)\s+signal)\b/i,
        },
        {
            key: 'macdBearishCross',
            re: /\b(bearish\s+macd|macd\s+crossed\s+(?:below|under)\s+signal|macd\s+bearish\s+cross(?:over)?)\b/i,
        },
        {
            key: 'oversoldRsi',
            re: /\b(oversold|rsi\s*(?:<|under|below|se\s*neeche)\s*\d+|rsi\s*<\s*\d+)\b/i,
        },
        {
            key: 'overboughtRsi',
            re: /\b(overbought|rsi\s*(?:>|over|above|se\s*upar)\s*\d+|rsi\s*>\s*\d+)\b/i,
        },
        {
            key: 'bollingerLower',
            re: /\b(bollinger\s+(?:lower|bottom|lower\s+band)|bb\s+lower|near\s+bb\s+lower)\b/i,
        },
        {
            key: 'bollingerUpper',
            re: /\b(bollinger\s+(?:upper|top|upper\s+band)|bb\s+upper|near\s+bb\s+upper)\b/i,
        },
        {
            key: 'aboveSMA200',
            re: /\b(above\s+sma\s*200|above\s+200[- ]?day|long[- ]?term\s+bullish|long[- ]?term\s+uptrend)\b/i,
        },
        {
            key: 'belowSMA50',
            re: /\b(below\s+sma\s*50|below\s+50[- ]?day|short[- ]?term\s+weak|short[- ]?term\s+downtrend)\b/i,
        },
        {
            key: 'deepestDrawdown',
            re: /\b(deepest\s+drawdown|biggest\s+drawdown|fallen\s+the\s+most|most\s+fallen|crashed\s+the\s+most|sabse\s+zyada\s+gir|sabse\s+zyada\s+fallen|farthest\s+from\s+high)\b/i,
        },
        {
            key: 'biggestLosersWindow',
            re: /\b(biggest\s+losers?\s+(?:in\s+)?(?:last|past)|worst\s+performers?\s+(?:in\s+)?(?:last|past)|down\s+the\s+most\s+in|sabse\s+zyada\s+gire\s+in)\b/i,
        },
        {
            key: 'biggestRunners',
            re: /\b(biggest\s+runners?|biggest\s+gainers?\s+(?:in\s+)?(?:last|past)|up\s+the\s+most\s+in|best\s+performers?\s+(?:in\s+)?(?:last|past)|best\s+gainers?\s+(?:in\s+)?(?:last|past)|biggest\s+winners?\s+(?:in\s+)?(?:last|past))\b/i,
        },
    ]

    for (const rule of rules) {
        if (rule.re.test(q)) {
            const rsiThreshold =
                rule.key === 'oversoldRsi' ? parseRsiThreshold(q, 30) :
                rule.key === 'overboughtRsi' ? parseRsiThreshold(q, 70) :
                undefined
            return { key: rule.key, topN, horizonDays, rsiThreshold }
        }
    }
    return null
}

// ── Runners ─────────────────────────────────────────────────────────────────

/**
 * Execute the scanner selected by `detectMarketScanner`. Returns empty rows
 * on error so the caller can decide to fall back to the LLM path.
 */
export async function runMarketScanner(req: ScannerRequest): Promise<ScannerResult> {
    const handler = SCANNERS[req.key]
    try {
        return await handler(req)
    } catch (err) {
        console.error('[market-scanners] scanner error:', req.key, err)
        return { request: req, title: handler.title(req), rows: [] }
    }
}

interface ScannerHandler {
    title: (req: ScannerRequest) => string
    (req: ScannerRequest): Promise<ScannerResult>
}

function makeHandler(
    titleFn: (req: ScannerRequest) => string,
    runFn: (req: ScannerRequest) => Promise<ScannerRow[]>
): ScannerHandler {
    const handler = (async (req: ScannerRequest) => ({
        request: req,
        title: titleFn(req),
        rows: await runFn(req),
    })) as ScannerHandler
    handler.title = titleFn
    return handler
}

const SCANNERS: Record<ScannerKey, ScannerHandler> = {
    near52wLow: makeHandler(
        () => 'Stocks near their 52-week low',
        (req) => runYearlyExtremeScanner(req, 'low')
    ),
    near52wHigh: makeHandler(
        () => 'Stocks near their 52-week high',
        (req) => runYearlyExtremeScanner(req, 'high')
    ),
    deepestDrawdown: makeHandler(
        () => 'Stocks with the deepest drawdown from their 52-week high',
        (req) => runDrawdownScanner(req)
    ),
    biggestRunners: makeHandler(
        (req) => `Biggest gainers over the last ${req.horizonDays} trading days`,
        (req) => runWindowReturnScanner(req, 'gainers')
    ),
    biggestLosersWindow: makeHandler(
        (req) => `Biggest losers over the last ${req.horizonDays} trading days`,
        (req) => runWindowReturnScanner(req, 'losers')
    ),
    oversoldRsi: makeHandler(
        (req) => `Oversold stocks (RSI < ${req.rsiThreshold ?? 30})`,
        (req) => runIndicatorThresholdScanner(req, 'oversoldRsi')
    ),
    overboughtRsi: makeHandler(
        (req) => `Overbought stocks (RSI > ${req.rsiThreshold ?? 70})`,
        (req) => runIndicatorThresholdScanner(req, 'overboughtRsi')
    ),
    bollingerLower: makeHandler(
        () => 'Stocks near the Bollinger lower band',
        (req) => runIndicatorThresholdScanner(req, 'bollingerLower')
    ),
    bollingerUpper: makeHandler(
        () => 'Stocks near the Bollinger upper band',
        (req) => runIndicatorThresholdScanner(req, 'bollingerUpper')
    ),
    goldenCross: makeHandler(
        () => 'Stocks with a recent golden cross (SMA50 crossed above SMA200)',
        (req) => runCrossScanner(req, 'golden')
    ),
    deathCross: makeHandler(
        () => 'Stocks with a recent death cross (SMA50 crossed below SMA200)',
        (req) => runCrossScanner(req, 'death')
    ),
    macdBullishCross: makeHandler(
        () => 'Stocks with a bullish MACD crossover',
        (req) => runCrossScanner(req, 'macdBullish')
    ),
    macdBearishCross: makeHandler(
        () => 'Stocks with a bearish MACD crossover',
        (req) => runCrossScanner(req, 'macdBearish')
    ),
    aboveSMA200: makeHandler(
        () => 'Stocks trading above their SMA200 (long-term bullish)',
        (req) => runIndicatorThresholdScanner(req, 'aboveSMA200')
    ),
    belowSMA50: makeHandler(
        () => 'Stocks trading below their SMA50 (short-term weak)',
        (req) => runIndicatorThresholdScanner(req, 'belowSMA50')
    ),
    unusualVolume: makeHandler(
        () => 'Stocks with unusual volume today (>3× 20-day average)',
        (req) => runUnusualVolumeScanner(req)
    ),
}

// ── SQL templates ───────────────────────────────────────────────────────────

/**
 * Query shared scaffolding: the latest candle per stock + 20-day liquidity.
 * Every scanner joins this and then applies its own `WHERE` / `ORDER BY`.
 */
function buildBaseLateralJoins(): string {
    return `
        FROM "Stock" s
        JOIN LATERAL (
            SELECT
                sp.timestamp, sp.close, sp.open, sp.high, sp.low, sp.volume,
                sp.rsi, sp."sma50", sp."sma200",
                sp.macd, sp."macdSignal",
                sp."bbUpper", sp."bbLower"
            FROM "StockPrice" sp
            WHERE sp."stockId" = s.id
            ORDER BY sp.timestamp DESC
            LIMIT 1
        ) AS latest ON TRUE
        JOIN LATERAL (
            SELECT
                AVG((recent.close * recent.volume)::double precision) AS "avgTradedValue20d",
                AVG(recent.volume::double precision) AS "avgVolume20d",
                COUNT(*)::int AS "candles20d"
            FROM (
                SELECT sp.close, sp.volume
                FROM "StockPrice" sp
                WHERE sp."stockId" = s.id
                ORDER BY sp.timestamp DESC
                LIMIT 20
            ) AS recent
        ) AS liquidity ON TRUE
    `
}

const LIQUIDITY_FLOOR_SQL = `
    AND latest.close >= ${MIN_PRICE}
    AND liquidity."candles20d" >= ${MIN_CANDLES_20D}
    AND liquidity."avgTradedValue20d" >= ${MIN_AVG_TRADED_VALUE_20D}
`

function mapRow(r: any, metric: number, metricLabel: string): ScannerRow {
    return {
        symbol: r.symbol,
        name: r.name,
        close: Number(r.close),
        metric,
        metricLabel,
        rsi: r.rsi == null ? null : Number(r.rsi),
        sma50: r.sma50 == null ? null : Number(r.sma50),
        sma200: r.sma200 == null ? null : Number(r.sma200),
        avgTradedValue20d: Number(r.avgTradedValue20d ?? 0),
    }
}

async function runYearlyExtremeScanner(
    req: ScannerRequest,
    side: 'low' | 'high'
): Promise<ScannerRow[]> {
    const cutoff = cutoffRecent()
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT
            s.symbol,
            s.name,
            latest.close,
            latest.rsi,
            latest."sma50",
            latest."sma200",
            liquidity."avgTradedValue20d",
            yearly."yearLow",
            yearly."yearHigh"
        ${buildBaseLateralJoins()}
        JOIN LATERAL (
            SELECT MIN(sp.low) AS "yearLow", MAX(sp.high) AS "yearHigh"
            FROM "StockPrice" sp
            WHERE sp."stockId" = s.id
              AND sp.timestamp >= NOW() - INTERVAL '${TRADING_DAYS_PER_YEAR} days'
        ) AS yearly ON TRUE
        WHERE latest.timestamp >= $1
          ${LIQUIDITY_FLOOR_SQL}
          AND yearly."yearLow" IS NOT NULL
          AND yearly."yearHigh" IS NOT NULL
          AND yearly."yearLow" > 0
        ORDER BY ${side === 'low'
            ? '(latest.close - yearly."yearLow") / NULLIF(yearly."yearLow", 0) ASC'
            : '(yearly."yearHigh" - latest.close) / NULLIF(yearly."yearHigh", 0) ASC'}
        LIMIT ${req.topN};
        `,
        cutoff
    )

    return rows.map((r) => {
        if (side === 'low') {
            const pctFromLow = ((Number(r.close) - Number(r.yearLow)) / Number(r.yearLow)) * 100
            return mapRow(r, pctFromLow, 'from 52w low')
        }
        const pctFromHigh = ((Number(r.yearHigh) - Number(r.close)) / Number(r.yearHigh)) * 100
        return mapRow(r, pctFromHigh, 'below 52w high')
    })
}

async function runDrawdownScanner(req: ScannerRequest): Promise<ScannerRow[]> {
    const cutoff = cutoffRecent()
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT
            s.symbol,
            s.name,
            latest.close,
            latest.rsi,
            latest."sma50",
            latest."sma200",
            liquidity."avgTradedValue20d",
            yearly."yearHigh"
        ${buildBaseLateralJoins()}
        JOIN LATERAL (
            SELECT MAX(sp.high) AS "yearHigh"
            FROM "StockPrice" sp
            WHERE sp."stockId" = s.id
              AND sp.timestamp >= NOW() - INTERVAL '${TRADING_DAYS_PER_YEAR} days'
        ) AS yearly ON TRUE
        WHERE latest.timestamp >= $1
          ${LIQUIDITY_FLOOR_SQL}
          AND yearly."yearHigh" IS NOT NULL
          AND yearly."yearHigh" > 0
        ORDER BY (latest.close - yearly."yearHigh") / NULLIF(yearly."yearHigh", 0) ASC
        LIMIT ${req.topN};
        `,
        cutoff
    )

    return rows.map((r) => {
        const drawdownPct = ((Number(r.close) - Number(r.yearHigh)) / Number(r.yearHigh)) * 100
        return mapRow(r, drawdownPct, 'drawdown from peak')
    })
}

async function runWindowReturnScanner(
    req: ScannerRequest,
    side: 'gainers' | 'losers'
): Promise<ScannerRow[]> {
    const cutoff = cutoffRecent()
    // We need the close N trading sessions ago. A trading session ≈ 1 row in
    // StockPrice (daily). To handle gaps (holidays, stocks with short history)
    // we take the (N)th most-recent row per stock — which is exactly "N
    // sessions back" without depending on calendar math.
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT
            s.symbol,
            s.name,
            latest.close,
            latest.rsi,
            latest."sma50",
            latest."sma200",
            liquidity."avgTradedValue20d",
            window_start.close AS "startClose"
        ${buildBaseLateralJoins()}
        JOIN LATERAL (
            SELECT sp.close
            FROM "StockPrice" sp
            WHERE sp."stockId" = s.id
            ORDER BY sp.timestamp DESC
            OFFSET ${req.horizonDays} LIMIT 1
        ) AS window_start ON TRUE
        WHERE latest.timestamp >= $1
          ${LIQUIDITY_FLOOR_SQL}
          AND window_start.close IS NOT NULL
          AND window_start.close > 0
        ORDER BY ${side === 'gainers'
            ? '(latest.close - window_start.close) / NULLIF(window_start.close, 0) DESC'
            : '(latest.close - window_start.close) / NULLIF(window_start.close, 0) ASC'}
        LIMIT ${req.topN};
        `,
        cutoff
    )

    return rows.map((r) => {
        const returnPct = ((Number(r.close) - Number(r.startClose)) / Number(r.startClose)) * 100
        return mapRow(r, returnPct, `${req.horizonDays}-session return`)
    })
}

type ThresholdKind =
    | 'oversoldRsi'
    | 'overboughtRsi'
    | 'bollingerLower'
    | 'bollingerUpper'
    | 'aboveSMA200'
    | 'belowSMA50'

async function runIndicatorThresholdScanner(
    req: ScannerRequest,
    kind: ThresholdKind
): Promise<ScannerRow[]> {
    const cutoff = cutoffRecent()

    const { whereSql, orderBySql, label } = (() => {
        switch (kind) {
            case 'oversoldRsi': {
                const threshold = req.rsiThreshold ?? 30
                return {
                    whereSql: `AND latest.rsi IS NOT NULL AND latest.rsi < ${threshold}`,
                    orderBySql: `ORDER BY latest.rsi ASC`,
                    label: 'RSI',
                }
            }
            case 'overboughtRsi': {
                const threshold = req.rsiThreshold ?? 70
                return {
                    whereSql: `AND latest.rsi IS NOT NULL AND latest.rsi > ${threshold}`,
                    orderBySql: `ORDER BY latest.rsi DESC`,
                    label: 'RSI',
                }
            }
            case 'bollingerLower':
                return {
                    whereSql: `AND latest."bbLower" IS NOT NULL AND latest.close <= latest."bbLower" * 1.01`,
                    orderBySql: `ORDER BY (latest.close - latest."bbLower") / NULLIF(latest."bbLower", 0) ASC`,
                    label: 'from BB lower',
                }
            case 'bollingerUpper':
                return {
                    whereSql: `AND latest."bbUpper" IS NOT NULL AND latest.close >= latest."bbUpper" * 0.99`,
                    orderBySql: `ORDER BY (latest."bbUpper" - latest.close) / NULLIF(latest."bbUpper", 0) ASC`,
                    label: 'below BB upper',
                }
            case 'aboveSMA200':
                return {
                    whereSql: `AND latest."sma200" IS NOT NULL AND latest.close > latest."sma200"`,
                    orderBySql: `ORDER BY (latest.close - latest."sma200") / NULLIF(latest."sma200", 0) DESC`,
                    label: 'above SMA200',
                }
            case 'belowSMA50':
                return {
                    whereSql: `AND latest."sma50" IS NOT NULL AND latest.close < latest."sma50"`,
                    orderBySql: `ORDER BY (latest.close - latest."sma50") / NULLIF(latest."sma50", 0) ASC`,
                    label: 'below SMA50',
                }
        }
    })()

    const rows = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT
            s.symbol,
            s.name,
            latest.close,
            latest.rsi,
            latest."sma50",
            latest."sma200",
            latest."bbUpper",
            latest."bbLower",
            liquidity."avgTradedValue20d"
        ${buildBaseLateralJoins()}
        WHERE latest.timestamp >= $1
          ${LIQUIDITY_FLOOR_SQL}
          ${whereSql}
        ${orderBySql}
        LIMIT ${req.topN};
        `,
        cutoff
    )

    return rows.map((r) => {
        let metric: number
        if (kind === 'oversoldRsi' || kind === 'overboughtRsi') {
            metric = Number(r.rsi ?? 0)
        } else if (kind === 'bollingerLower') {
            metric = ((Number(r.close) - Number(r.bbLower)) / Number(r.bbLower)) * 100
        } else if (kind === 'bollingerUpper') {
            metric = ((Number(r.bbUpper) - Number(r.close)) / Number(r.bbUpper)) * 100
        } else if (kind === 'aboveSMA200') {
            metric = ((Number(r.close) - Number(r.sma200)) / Number(r.sma200)) * 100
        } else {
            metric = ((Number(r.close) - Number(r.sma50)) / Number(r.sma50)) * 100
        }
        return mapRow(r, metric, label)
    })
}

type CrossKind = 'golden' | 'death' | 'macdBullish' | 'macdBearish'

async function runCrossScanner(req: ScannerRequest, kind: CrossKind): Promise<ScannerRow[]> {
    const cutoff = cutoffRecent()

    // For each stock pull the 2 most-recent candles and detect the crossover
    // on the latest one. We keep the lookup to "did the cross happen on the
    // most recent bar?" — that's what "has a recent cross" usually means for
    // daily scanners, and it keeps the SQL cheap.
    const base = `
        SELECT
            s.symbol,
            s.name,
            latest.close,
            latest.rsi,
            latest."sma50",
            latest."sma200",
            liquidity."avgTradedValue20d",
            prev."sma50"      AS prev_sma50,
            prev."sma200"     AS prev_sma200,
            prev.macd         AS prev_macd,
            prev."macdSignal" AS prev_macd_signal,
            latest.macd        AS latest_macd,
            latest."macdSignal" AS latest_macd_signal
        ${buildBaseLateralJoins()}
        JOIN LATERAL (
            SELECT sp."sma50", sp."sma200", sp.macd, sp."macdSignal"
            FROM "StockPrice" sp
            WHERE sp."stockId" = s.id
            ORDER BY sp.timestamp DESC
            OFFSET 1 LIMIT 1
        ) AS prev ON TRUE
        WHERE latest.timestamp >= $1
          ${LIQUIDITY_FLOOR_SQL}
    `

    const filter = (() => {
        switch (kind) {
            case 'golden':
                return `
                    AND latest."sma50"  IS NOT NULL AND latest."sma200"  IS NOT NULL
                    AND prev."sma50"    IS NOT NULL AND prev."sma200"    IS NOT NULL
                    AND latest."sma50" > latest."sma200"
                    AND prev."sma50"  <= prev."sma200"
                `
            case 'death':
                return `
                    AND latest."sma50"  IS NOT NULL AND latest."sma200"  IS NOT NULL
                    AND prev."sma50"    IS NOT NULL AND prev."sma200"    IS NOT NULL
                    AND latest."sma50" < latest."sma200"
                    AND prev."sma50"  >= prev."sma200"
                `
            case 'macdBullish':
                return `
                    AND latest.macd         IS NOT NULL AND latest."macdSignal" IS NOT NULL
                    AND prev.macd           IS NOT NULL AND prev."macdSignal"   IS NOT NULL
                    AND latest.macd > latest."macdSignal"
                    AND prev.macd  <= prev."macdSignal"
                `
            case 'macdBearish':
                return `
                    AND latest.macd         IS NOT NULL AND latest."macdSignal" IS NOT NULL
                    AND prev.macd           IS NOT NULL AND prev."macdSignal"   IS NOT NULL
                    AND latest.macd < latest."macdSignal"
                    AND prev.macd  >= prev."macdSignal"
                `
        }
    })()

    const orderBy = (() => {
        switch (kind) {
            case 'golden':
                return `ORDER BY (latest."sma50" - latest."sma200") / NULLIF(latest."sma200", 0) DESC`
            case 'death':
                return `ORDER BY (latest."sma50" - latest."sma200") / NULLIF(latest."sma200", 0) ASC`
            case 'macdBullish':
                return `ORDER BY (latest.macd - latest."macdSignal") DESC`
            case 'macdBearish':
                return `ORDER BY (latest.macd - latest."macdSignal") ASC`
        }
    })()

    const rows = await prisma.$queryRawUnsafe<any[]>(
        `${base}${filter}${orderBy} LIMIT ${req.topN};`,
        cutoff
    )

    return rows.map((r) => {
        if (kind === 'golden' || kind === 'death') {
            const spread = Number(r.sma50) && Number(r.sma200)
                ? ((Number(r.sma50) - Number(r.sma200)) / Number(r.sma200)) * 100
                : 0
            return mapRow(r, spread, 'SMA50 vs SMA200')
        }
        const spread = Number(r.latest_macd ?? 0) - Number(r.latest_macd_signal ?? 0)
        return mapRow(r, spread, 'MACD − signal')
    })
}

async function runUnusualVolumeScanner(req: ScannerRequest): Promise<ScannerRow[]> {
    const cutoff = cutoffRecent()
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT
            s.symbol,
            s.name,
            latest.close,
            latest.volume       AS today_volume,
            latest.rsi,
            latest."sma50",
            latest."sma200",
            liquidity."avgVolume20d",
            liquidity."avgTradedValue20d"
        ${buildBaseLateralJoins()}
        WHERE latest.timestamp >= $1
          ${LIQUIDITY_FLOOR_SQL}
          AND liquidity."avgVolume20d" IS NOT NULL
          AND liquidity."avgVolume20d" > 0
          AND (latest.volume::double precision) > 3 * liquidity."avgVolume20d"
        ORDER BY (latest.volume::double precision) / NULLIF(liquidity."avgVolume20d", 0) DESC
        LIMIT ${req.topN};
        `,
        cutoff
    )

    return rows.map((r) => {
        const ratio = Number(r.avgVolume20d) ? Number(r.today_volume) / Number(r.avgVolume20d) : 0
        return mapRow(r, ratio, '× 20d avg volume')
    })
}

// ── Formatter (used by the chat engine to render the answer) ────────────────

/**
 * Markdown-formatted reply. The chat engine now renders assistant messages
 * through react-markdown, so **bold** / bullet lists are preserved.
 */
export function formatScannerAnswer(result: ScannerResult, detectedLang: string): string {
    const isHindiLike = /Hindi|Hinglish/i.test(detectedLang)

    if (result.rows.length === 0) {
        return isHindiLike
            ? `Filters pass karne wala koi stock nahi mila (${result.title}). Database me abhi enough daily data ya liquidity wale naam nahi hai.`
            : `No stocks passed the filters for: ${result.title}. The database may not have enough daily data or liquid names right now.`
    }

    const header = `**${result.title}** — ${result.rows.length} stocks`
    const lines = result.rows.map((row, i) => {
        const metricText = formatMetricNumber(row.metric, row.metricLabel)
        const rsiPart = row.rsi != null ? ` | RSI ${row.rsi.toFixed(1)}` : ''
        return (
            `${i + 1}. **${row.symbol}** (${row.name}) — ₹${row.close.toFixed(2)} | ` +
            `${metricText}${rsiPart}`
        )
    })

    const note = isHindiLike
        ? `_Liquidity filter: 20-day avg traded value ≥ ₹2 Cr. Data: iStocks database._`
        : `_Liquidity filter: 20-day avg traded value ≥ ₹2 Cr. Source: iStocks database._`

    return `${header}\n\n${lines.join('\n')}\n\n${note}`
}

function formatMetricNumber(value: number, label: string): string {
    if (!Number.isFinite(value)) return `${label}: NA`
    // RSI is already a 0-100 number, don't tag it with %.
    if (/^RSI$/i.test(label)) return `${label} ${value.toFixed(1)}`
    // Volume ratio is a "×" multiplier.
    if (label.includes('× 20d')) return `${value.toFixed(2)}${label.replace('×', '×').replace(' 20d', '× 20d avg vol')}`
    const sign = value >= 0 ? '+' : ''
    return `${label} ${sign}${value.toFixed(2)}%`
}

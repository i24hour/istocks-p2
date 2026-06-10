/**
 * Aryabhata — Numerical Evidence Agent
 *
 * Pulls quantitative data from PostgreSQL (for stock queries) and
 * searches for statistics/numerical evidence. Derives probability from hard numbers.
 */

import { searchGoogle } from '@/lib/googleSearch'
import { prisma } from '@/lib/prisma'
import { scoreArticlesBatch, computeWeightedProbability } from './article-scorer'
import { generateExpertText } from './expert-llm'
import type { AgentReport, OnExpertsEvent, ScoredArticle, SqlDataPoint } from './types'

interface ParsedQuery {
    isStockRelated: boolean
    symbol?: string
    indicator?: string
    condition?: string
    userData?: string
}

async function parseQueryForNumerics(query: string): Promise<ParsedQuery> {
    const prompt = `Analyze this probability question to extract numerical/data requirements.

QUESTION: "${query}"

Respond ONLY with JSON (no markdown):
{
  "isStockRelated": <true/false>,
  "symbol": "<stock symbol if mentioned, else null>",
  "indicator": "<technical indicator name if mentioned, e.g. RSI, MACD, else null>",
  "condition": "<the specific condition to check, e.g. 'close above 3000', 'RSI > 70', else null>",
  "userData": "<any user-provided numerical data embedded in the question, else null>"
}`

    try {
        const text = await generateExpertText('aryabhata', prompt)
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        return JSON.parse(clean)
    } catch {
        return { isStockRelated: false }
    }
}

async function runStockSqlAnalysis(
    query: string,
    parsed: ParsedQuery,
    emit: OnExpertsEvent
): Promise<SqlDataPoint[]> {
    const dataPoints: SqlDataPoint[] = []
    if (!parsed.symbol) return dataPoints

    const symbol = parsed.symbol.toUpperCase()

    // Find the stock
    let stock: { id: string; symbol: string; name: string } | null = null
    try {
        stock = await prisma.stock.findFirst({
            where: { symbol: { contains: symbol, mode: 'insensitive' } },
            select: { id: true, symbol: true, name: true },
        })
    } catch { return dataPoints }

    if (!stock) return dataPoints

    // 1. RSI distribution analysis
    if (!parsed.indicator || parsed.indicator.toLowerCase().includes('rsi')) {
        try {
            const rsiQuery = `SELECT
  COUNT(*) FILTER (WHERE rsi < 30) AS oversold_count,
  COUNT(*) FILTER (WHERE rsi BETWEEN 30 AND 70) AS neutral_count,
  COUNT(*) FILTER (WHERE rsi > 70) AS overbought_count,
  COUNT(*) AS total,
  ROUND(AVG(rsi)::numeric, 2) AS avg_rsi,
  ROUND(STDDEV(rsi)::numeric, 2) AS rsi_std
FROM "StockPrice" WHERE "stockId" = '${stock.id}' AND rsi IS NOT NULL`

            const result = await prisma.$queryRawUnsafe(rsiQuery) as any[]
            if (result?.[0]) {
                const r = result[0]
                const total = Number(r.total) || 1
                const overboughtPct = Math.round(Number(r.overbought_count) / total * 100)
                const oversoldPct = Math.round(Number(r.oversold_count) / total * 100)
                const dp: SqlDataPoint = {
                    description: `${stock.symbol} RSI distribution (${total.toLocaleString()} candles)`,
                    query: rsiQuery,
                    result: `Oversold (<30): ${oversoldPct}% | Neutral: ${Math.round(Number(r.neutral_count)/total*100)}% | Overbought (>70): ${overboughtPct}% | Avg RSI: ${r.avg_rsi}`,
                    probabilitySignal: overboughtPct > 30 ? -0.3 : oversoldPct > 30 ? 0.3 : 0,
                    confidence: 0.85,
                }
                dataPoints.push(dp)
                emit({ type: 'agent_sql', agent: 'aryabhata', dataPoint: dp })
            }
        } catch { /* skip */ }
    }

    // 2. Price movement analysis — how often does price close higher next day
    try {
        const directionQuery = `SELECT
  COUNT(*) FILTER (WHERE next_close > close) AS up_days,
  COUNT(*) FILTER (WHERE next_close < close) AS down_days,
  COUNT(*) FILTER (WHERE next_close = close) AS flat_days,
  COUNT(*) AS total
FROM (
  SELECT close,
    LEAD(close) OVER (ORDER BY timestamp) AS next_close
  FROM "StockPrice" WHERE "stockId" = '${stock.id}'
) t WHERE next_close IS NOT NULL`

        const result = await prisma.$queryRawUnsafe(directionQuery) as any[]
        if (result?.[0]) {
            const r = result[0]
            const total = Number(r.total) || 1
            const upPct = Math.round(Number(r.up_days) / total * 100)
            const dp: SqlDataPoint = {
                description: `${stock.symbol} next-candle direction base rate`,
                query: directionQuery,
                result: `Up: ${upPct}% | Down: ${Math.round(Number(r.down_days)/total*100)}% | Flat: ${Math.round(Number(r.flat_days)/total*100)}% (out of ${total.toLocaleString()} candles)`,
                probabilitySignal: (upPct - 50) / 100,
                confidence: 0.9,
            }
            dataPoints.push(dp)
            emit({ type: 'agent_sql', agent: 'aryabhata', dataPoint: dp })
        }
    } catch { /* skip */ }

    // 3. If condition mentions a price level, check historical occurrence
    if (parsed.condition) {
        try {
            const latestPrice = await prisma.$queryRawUnsafe(
                `SELECT close, rsi, sma50, sma200, macd FROM "StockPrice"
                 WHERE "stockId" = '${stock.id}'
                 ORDER BY timestamp DESC LIMIT 1`
            ) as any[]

            if (latestPrice?.[0]) {
                const p = latestPrice[0]
                const dp: SqlDataPoint = {
                    description: `${stock.symbol} latest indicators snapshot`,
                    query: 'Latest price + key indicators',
                    result: `Close: ₹${p.close} | RSI: ${p.rsi?.toFixed(1) || 'N/A'} | SMA50: ${p.sma50?.toFixed(1) || 'N/A'} | SMA200: ${p.sma200?.toFixed(1) || 'N/A'} | MACD: ${p.macd?.toFixed(3) || 'N/A'}`,
                    probabilitySignal: p.close > p.sma50 && p.close > p.sma200 ? 0.2 : -0.2,
                    confidence: 0.95,
                }
                dataPoints.push(dp)
                emit({ type: 'agent_sql', agent: 'aryabhata', dataPoint: dp })
            }
        } catch { /* skip */ }
    }

    // 4. Volatility (ATR) analysis
    try {
        const atrQuery = `SELECT
  ROUND(AVG(atr)::numeric, 4) AS avg_atr,
  ROUND(MAX(close)::numeric, 2) AS max_close,
  ROUND(MIN(close)::numeric, 2) AS min_close,
  ROUND(STDDEV(close)::numeric, 2) AS price_std
FROM "StockPrice" WHERE "stockId" = '${stock.id}' AND atr IS NOT NULL`

        const result = await prisma.$queryRawUnsafe(atrQuery) as any[]
        if (result?.[0]) {
            const r = result[0]
            const dp: SqlDataPoint = {
                description: `${stock.symbol} price volatility (historical range)`,
                query: atrQuery,
                result: `Avg ATR: ${r.avg_atr} | Historical Range: ₹${r.min_close} – ₹${r.max_close} | Price Std Dev: ₹${r.price_std}`,
                probabilitySignal: 0,
                confidence: 0.8,
            }
            dataPoints.push(dp)
            emit({ type: 'agent_sql', agent: 'aryabhata', dataPoint: dp })
        }
    } catch { /* skip */ }

    return dataPoints
}

async function buildNumericalSearches(query: string): Promise<{ label: string; query: string }[]> {
    const prompt = `You are Aryabhata, a numerical data analyst. Generate 3 search queries to find STATISTICS, NUMBERS, and QUANTITATIVE DATA relevant to this probability question.

QUESTION: "${query}"

Respond ONLY with JSON (no markdown):
[
  { "label": "Base rate statistics", "query": "<search for historical statistics and percentages>" },
  { "label": "Quantitative research", "query": "<search for numerical analysis and data>" },
  { "label": "Probability data", "query": "<search for probability estimates backed by numbers>" }
]

Rules:
- Include words like "statistics", "percentage", "rate", "data", "numbers", "probability"
- Focus on finding HARD NUMBERS not opinions
- For stocks: include financial ratios, historical performance data`

    try {
        const text = await generateExpertText('aryabhata', prompt)
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        const parsed = JSON.parse(clean)
        if (Array.isArray(parsed)) return parsed.slice(0, 3)
    } catch { /* fall through */ }

    return [
        { label: 'Base rate statistics', query: `${query} statistics percentage historical data` },
        { label: 'Quantitative research', query: `${query} quantitative analysis numbers research` },
        { label: 'Probability data', query: `${query} probability data empirical evidence` },
    ]
}

async function synthesizeReport(
    query: string,
    articles: ScoredArticle[],
    sqlDataPoints: SqlDataPoint[],
    rawProbability: number
): Promise<{ keyReasons: string[]; reasoning: string }> {
    const sqlContext = sqlDataPoints.map(d => `- ${d.description}: ${d.result} (signal: ${d.probabilitySignal > 0 ? '+' : ''}${d.probabilitySignal.toFixed(2)})`).join('\n')
    const topArticles = articles.slice(0, 6).map(a =>
        `- [${Math.round(a.relevance * 100)}% relevant] ${a.keyStatement}`
    ).join('\n')

    const prompt = `You are Aryabhata, a numerical data analyst. Synthesize quantitative evidence to estimate probability.

QUESTION: "${query}"

DATABASE EVIDENCE:
${sqlContext || 'No database data available.'}

STATISTICAL SOURCES:
${topArticles || 'No statistical articles found.'}

WEIGHTED PROBABILITY FROM NUMBERS: ${rawProbability}%

Provide synthesis as JSON (no markdown):
{
  "keyReasons": ["<numerical reason 1>", "<numerical reason 2>", "<numerical reason 3>", "<numerical reason 4>"],
  "reasoning": "<2-3 sentence paragraph citing specific numbers and what they imply about the probability>"
}

Always cite specific numbers. Be empirical and data-driven.`

    try {
        const text = await generateExpertText('aryabhata', prompt)
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        const parsed = JSON.parse(clean)
        return {
            keyReasons: Array.isArray(parsed.keyReasons) ? parsed.keyReasons.slice(0, 4) : [],
            reasoning: String(parsed.reasoning || ''),
        }
    } catch {
        return {
            keyReasons: ['Numerical analysis inconclusive'],
            reasoning: `Based on available quantitative data, the probability estimate is ${rawProbability}%.`,
        }
    }
}

export async function runAryabhata(
    query: string,
    emit: OnExpertsEvent,
    userProvidedData?: string
): Promise<AgentReport> {
    emit({ type: 'agent_start', agent: 'aryabhata' })

    const parsed = await parseQueryForNumerics(query)
    const sqlDataPoints: SqlDataPoint[] = []
    const allArticles: ScoredArticle[] = []
    const searchQueries: string[] = []

    // If user provided data, convert to a data point
    if (userProvidedData) {
        const dp: SqlDataPoint = {
            description: 'User-provided data',
            query: 'user_input',
            result: userProvidedData,
            probabilitySignal: 0,
            confidence: 0.7,
        }
        sqlDataPoints.push(dp)
        emit({ type: 'agent_sql', agent: 'aryabhata', dataPoint: dp })
    }

    // Run SQL analysis if stock-related
    if (parsed.isStockRelated && parsed.symbol) {
        emit({
            type: 'agent_searching',
            agent: 'aryabhata',
            searchQuery: `PostgreSQL: ${parsed.symbol} historical analysis`,
            layer: 0,
            layerLabel: 'Database analysis',
        })
        const dbPoints = await runStockSqlAnalysis(query, parsed, emit)
        sqlDataPoints.push(...dbPoints)
    }

    // Numerical article searches
    const searches = await buildNumericalSearches(query)
    for (let i = 0; i < searches.length; i++) {
        const s = searches[i]
        emit({
            type: 'agent_searching',
            agent: 'aryabhata',
            searchQuery: s.query,
            layer: i + 1,
            layerLabel: s.label,
        })
        searchQueries.push(s.query)

        const result = await searchGoogle(s.query, '', undefined, 8, {})
        if (result.success && result.results.length > 0) {
            const raw = result.results.map(r => ({ title: r.name, url: r.url, snippet: r.snippet, datePublished: r.datePublished }))
            const scored = await scoreArticlesBatch(query, raw, 'aryabhata')
            for (const article of scored) {
                if (!allArticles.find(a => a.url === article.url)) {
                    allArticles.push(article)
                    emit({ type: 'agent_article', agent: 'aryabhata', article })
                }
            }
        }
    }

    // Compute probability: weight SQL data points more heavily than articles
    let sqlProbability = 50
    let sqlWeight = 0
    for (const dp of sqlDataPoints) {
        const w = dp.confidence
        sqlProbability += dp.probabilitySignal * 50 * w
        sqlWeight += w
    }
    if (sqlWeight > 0) sqlProbability = Math.max(5, Math.min(95, sqlProbability))

    const sorted = allArticles.sort((a, b) => (b.relevance * b.confidence) - (a.relevance * a.confidence))
    const articleProbability = computeWeightedProbability(sorted)

    // Blend: SQL data has higher weight than articles
    const sqlShare = sqlDataPoints.length > 0 ? 0.6 : 0
    const articleShare = 1 - sqlShare
    const rawProbability = Math.round(sqlProbability * sqlShare + articleProbability * articleShare)

    const overallConfidence = sqlDataPoints.length > 0 ? 0.85 : 0.55

    const { keyReasons, reasoning } = await synthesizeReport(query, sorted, sqlDataPoints, rawProbability)

    const report: AgentReport = {
        agent: 'aryabhata',
        probability: rawProbability,
        confidence: overallConfidence,
        keyReasons,
        articles: sorted,
        sqlDataPoints,
        searchQueries,
        reasoning,
    }

    emit({ type: 'agent_conclusion', agent: 'aryabhata', report })
    return report
}

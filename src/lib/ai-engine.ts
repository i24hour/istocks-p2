/**
 * Shared AI Engine — used by both the Web SSE endpoint and the Telegram bot.
 *
 * Takes a user message + optional history, runs the full pipeline
 * (classify → route → ec2_live / web_search / yahoo_agent),
 * and calls an `onEvent` callback for each step.
 *
 * The caller decides what to do with the events (SSE stream, Telegram message, etc.).
 */

import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { generateText, jsonSchema } from 'ai'
import { deepseek, DEEPSEEK_MODEL } from '@/lib/deepseek-provider'
import { getDateContext } from '@/lib/date-context'
import {
    fetchOHLCV,
    computeIndicators,
    batchQuote,
    searchSymbol,
    fetchLiveMarketQuote,
    extractKnownMarketSymbol,
    type OHLCVCandle,
} from '@/lib/yahoo-finance'
import { searchGoogle, searchWithSocialContext, formatSearchResultsForAI } from '@/lib/googleSearch'
import { isFinancialDataQuery, fetchVerifiedFinancials, formatVerifiedFinancialsForAI } from '@/lib/financial-data-verifier'
import { fetchEC2LiveSnapshot, fetchEC2AllPrices, formatSnapshotForPrompt } from '@/lib/ec2-helpers'
import { fetchCascadingPrice, fetchCascadingPrices } from '@/lib/cascading-price-fetch'
import { calculateTradingLevels, calculateTradingLevelsFromSnapshot, fetchLast30Closes, calculateHoldingPeriod, formatTradingLevelsBlock, formatTradingLevelsSummary } from '@/lib/trading-levels'
import { prisma } from '@/lib/prisma'
import { normalizeSymbolKey } from '@/lib/instrumentRegistry'
import { resolveTradeCommandDraft, type TradeResolverMessage } from '@/lib/tradeCommandResolver'
import { selectBestStocks } from '@/lib/best-stock-selector'
import { getLatestDailyStockSelection } from '@/lib/daily-stock-selection'
import { enhancePrompt } from '@/lib/prompt-enhancer'
import { runDynamicScreener } from '@/lib/dynamic-screener'
import {
    detectMarketScanner,
    runMarketScanner,
    formatScannerAnswer,
} from '@/lib/market-scanners'
import {
    coerceComputeModelId,
    getComputeAiSdkModel,
    getComputeLegacyModel,
    type ComputeModelId,
} from '@/lib/compute-models'
import { classifyTradeIntent, classifyQueryCategory, type QueryCategory } from '@/lib/intent-classifier'
import { screenByPriceRange, detectPriceRangeScreening } from '@/lib/price-range-screener'
import { queryPMSBazaar, formatPMSResultsForAI, detectPMSIntent } from '@/lib/pms-bazaar'

const _bedrock = createAmazonBedrock({ region: process.env.AWS_REGION || 'ap-south-1' })
const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-6'

// ── Types ───────────────────────────────────────────────────────────

export type AIEvent =
    | { type: 'thinking'; step: string }
    | { type: 'routing_options'; options: ReplyPathOption[] }
    | { type: 'tool_start'; tool: string; args: Record<string, any> }
    | { type: 'tool_end'; tool: string; result: any }
    | { type: 'memory_update'; memory: ConversationMemory }
    | { type: 'answer'; message: string; webSources?: { name: string; url: string }[] }
    | { type: 'trade_intent'; symbol: string; stockName: string; action: 'BUY' | 'SELL'; quantity: number; price: number }
    | { type: 'error'; message: string }

export interface ReplyPathOption {
    id: 'greeting' | 'clarification' | 'ec2_live' | 'web_search' | 'yahoo_agent'
    label: string
    reason: string
}

export type OnEvent = (event: AIEvent) => void

export interface ConversationTurn {
    role: 'user' | 'assistant'
    content: string
}

export interface ConversationMemory {
    activeSymbol: string | null
    activeStockName: string | null
    activeIndicator: 'MACD' | 'RSI' | 'EMA' | 'SMA' | null
    lastIntent: RouteSource | 'clarification' | 'general' | null
    lastResponseKind: 'price' | 'indicator_value' | 'indicator_explain' | 'analysis' | 'news' | 'trade' | 'clarification' | 'general' | null
}

const EMPTY_CONVERSATION_MEMORY: ConversationMemory = {
    activeSymbol: null,
    activeStockName: null,
    activeIndicator: null,
    lastIntent: null,
    lastResponseKind: null,
}

export class StopRequestedError extends Error {
    constructor(message = 'STOP_REQUESTED') {
        super(message)
        this.name = 'StopRequestedError'
    }
}

export function isStopRequestedError(error: unknown): boolean {
    return error instanceof StopRequestedError ||
        (error instanceof Error && (error.name === 'StopRequestedError' || error.message === 'STOP_REQUESTED'))
}

type RouteSource = 'ec2_live' | 'web_search' | 'yahoo_agent'
type StockLite = { id: string; symbol: string; name: string; sector?: string | null }
type MarketDatabaseOperation = 'latestIndicators' | 'priceHistory' | 'highestVolumeDays' | 'topRankedStocks' | 'stocksBySector'

function assertNotStopped(shouldStop?: () => boolean) {
    if (shouldStop?.()) {
        throw new StopRequestedError()
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

const MEMORY_TURNS = 20
const MAX_TURN_CHARS = 2500

export function normalizeConversationHistory(raw: any): ConversationTurn[] {
    if (!Array.isArray(raw)) return []
    return raw
        .filter((item: any) => (item?.role === 'user' || item?.role === 'assistant') && typeof item?.content === 'string')
        .slice(-MEMORY_TURNS)
        .map((item: any) => ({
            role: item.role,
            content: item.content.slice(0, MAX_TURN_CHARS),
        }))
}

export function normalizeConversationMemory(raw: any): ConversationMemory {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_CONVERSATION_MEMORY }
    const activeIndicator = raw.activeIndicator === 'MACD' || raw.activeIndicator === 'RSI' || raw.activeIndicator === 'EMA' || raw.activeIndicator === 'SMA'
        ? raw.activeIndicator
        : null
    const lastIntent = raw.lastIntent === 'ec2_live' || raw.lastIntent === 'web_search' || raw.lastIntent === 'yahoo_agent' || raw.lastIntent === 'clarification' || raw.lastIntent === 'general'
        ? raw.lastIntent
        : null
    const lastResponseKind = typeof raw.lastResponseKind === 'string'
        ? raw.lastResponseKind
        : null

    return {
        activeSymbol: typeof raw.activeSymbol === 'string' && raw.activeSymbol.trim() ? raw.activeSymbol.trim().toUpperCase() : null,
        activeStockName: typeof raw.activeStockName === 'string' && raw.activeStockName.trim() ? raw.activeStockName.trim() : null,
        activeIndicator,
        lastIntent,
        lastResponseKind: lastResponseKind as ConversationMemory['lastResponseKind'],
    }
}

function mergeConversationMemory(
    current: ConversationMemory,
    patch: Partial<ConversationMemory>
): ConversationMemory {
    return {
        ...current,
        ...patch,
        activeSymbol: patch.activeSymbol === undefined ? current.activeSymbol : patch.activeSymbol,
        activeStockName: patch.activeStockName === undefined ? current.activeStockName : patch.activeStockName,
        activeIndicator: patch.activeIndicator === undefined ? current.activeIndicator : patch.activeIndicator,
        lastIntent: patch.lastIntent === undefined ? current.lastIntent : patch.lastIntent,
        lastResponseKind: patch.lastResponseKind === undefined ? current.lastResponseKind : patch.lastResponseKind,
    }
}

function historyToText(history: ConversationTurn[]): string {
    if (history.length === 0) return ''
    return history
        .map((h, i) => `${i + 1}. ${h.role.toUpperCase()}: ${h.content}`)
        .join('\n')
}

function detectMessageLanguage(text: string): string {
    const devanagariChars = (text.match(/[\u0900-\u097F]/g) || []).length
    const tamilChars      = (text.match(/[\u0B80-\u0BFF]/g) || []).length
    const teluguChars     = (text.match(/[\u0C00-\u0C7F]/g) || []).length
    const latinChars      = (text.match(/[a-zA-Z]/g) || []).length
    const totalChars      = text.replace(/\s/g, '').length || 1

    if (tamilChars / totalChars > 0.15)      return 'Tamil'
    if (teluguChars / totalChars > 0.15)     return 'Telugu'
    if (devanagariChars / totalChars > 0.5)  return 'Hindi'
    if (devanagariChars > 0 && latinChars > 0) return 'Hinglish (Hindi-English mix)'
    return 'English'
}

/**
 * Fast local keyword override — called before the LLM router.
 * Prevents conversation history from poisoning intent when the current
 * message has an unambiguous signal.
 */
function fastRouteOverride(message: string): RouteSource | null {
    const q = message.toLowerCase()

    // Unambiguous web_search signals — "why", "news", "koi news aayi", "reason", etc.
    // These override history context: a "why/news" question is ALWAYS web_search.
    if (/\b(kyun|kyu|why|reason|news|kya hua|kya ho raha|koi news|kya news|news aayi|breaking|update|sudden|suddenly|explain|earnings|revenue|profit|loss|results?|quarterly|annual|guidance|outlook|management|ceo|merger|acquisition|ipo|fpo|dividend|bonus|split|rally|crash|fall|drop|surge|spike|sentiment|macro|rbi|fed|rate|inflation|gdp|sector|industry)\b/i.test(q) &&
        // But NOT if it's clearly a trade-execution verb at the same time
        !/\b(buy|sell|kharido|becho|place order|execute)\b/i.test(q))
        return 'web_search'

    const hasStructuredCondition = /\b(when|if|target|stop\s*loss|stoploss|\bsl\b|entry|setup|invalidation|risk\s*reward|r\/r|intraday|swing|scalp|scalping|breakout|mean\s*reversion|trend[-\s]*following|momentum|checklist)\b/i.test(q)
    const hasIndicatorKeyword = /\b(rsi|macd|ema|sma|cci|adx|vwap|stoch|roc|supertrend|atr)\b/i.test(q)
    const hasTradeVerb = /\b(buy|sell|kharido|becho|purchase|place order|execute trade)\b/i.test(q)

    // Strategy / conditional trade prompts should always use analysis path.
    if (hasTradeVerb && (hasStructuredCondition || hasIndicatorKeyword)) return 'yahoo_agent'

    // Unambiguous ec2_live — ONLY true immediate trade-execution commands.
    // "buy 100 RELIANCE", "sell WIPRO now", "place order" → ec2_live
    // "should i sell?", "kya buy kru?", "is it a sell?" → advisory, NOT ec2_live
    const isAdvisory = /\b(should|kya|kru|krun|chahiye|better|wait|hold|opinion|suggest|recommend|good|right)\b/i.test(q)
    if (
        !isAdvisory &&
        hasTradeVerb &&
        // Strategy/indicator conditional prompts perform better on yahoo_agent.
        !(hasStructuredCondition || hasIndicatorKeyword)
    )
        return 'ec2_live'

    // Index/global market symbol queries should go through live-quote path.
    const hasKnownMarketSymbol = !!extractKnownMarketSymbol(message)
    const asksForMarketLevel = /\b(price|live|current|quote|now|tell me about|kitna|chal raha|level)\b/i.test(q)
    if (hasKnownMarketSymbol && asksForMarketLevel) return 'ec2_live'

    return null // let LLM decide
}

function formatQuoteValue(price: number, currency: string | null): string {
    if ((currency || '').toUpperCase() === 'INR') return `₹${price.toFixed(2)}`
    if (!currency) return price.toFixed(2)
    return `${price.toFixed(2)} ${currency}`
}

async function buildDeterministicSingleStockFallback(stock: StockLite, message: string): Promise<string | null> {
    const candles = await fetchOHLCV(stock.symbol, '1y', '1d')
    if (candles.length < 20) return null

    const indicators = computeIndicators(candles)
    const latestPrice = indicators.latestClose
    if (!latestPrice) return null

    const lowerMessage = message.toLowerCase()
    const rsi = indicators.rsi14
    const macd = indicators.macd
    const macdSignal = indicators.macdSignal

    if (/\b(current|live|price|cmp|ltp|kitna|price bata|price batana)\b/i.test(lowerMessage)) {
        return `${stock.symbol} current price ₹${latestPrice.toFixed(2)} hai.`
    }

    if (/\brsi\b/i.test(lowerMessage) && rsi != null) {
        return `${stock.symbol} ka RSI ${rsi.toFixed(2)} hai.`
    }

    if (/\bmacd\b/i.test(lowerMessage) && macd != null) {
        return `${stock.symbol} ka MACD ${macd.toFixed(2)} hai${macdSignal != null ? ` aur signal ${macdSignal.toFixed(2)}` : ''}.`
    }

    const trend = macd != null && macdSignal != null && macd > macdSignal ? 'Bullish' : 'Bearish'

    const levels = calculateTradingLevels(stock.symbol, '1d', candles as any)
    const levelsSummary = levels
        ? formatTradingLevelsSummary(levels)
        : (() => {
            const target = indicators.sma50 ?? (latestPrice * 1.03)
            const stopLoss = indicators.atr14 ? latestPrice - indicators.atr14 * 1.5 : latestPrice * 0.97
            const rr = stopLoss < latestPrice ? (target - latestPrice) / (latestPrice - stopLoss) : 0
            return `Entry: ₹${latestPrice.toFixed(2)} | Target: ₹${target.toFixed(2)} | Stop-Loss: ₹${stopLoss.toFixed(2)} | R/R: ${rr.toFixed(2)}`
        })()

    return `${stock.name} (${stock.symbol}) current price ₹${latestPrice.toFixed(2)}. ` +
        `RSI ${rsi != null ? rsi.toFixed(2) : 'NA'}, MACD ${macd != null ? macd.toFixed(2) : 'NA'}${macdSignal != null ? ` (signal ${macdSignal.toFixed(2)})` : ''}, trend ${trend}.\n` +
        `${levelsSummary}\n` +
        `Decision: ${trend === 'Bullish' ? 'Buy on dips' : 'Wait for confirmation'}.`
}

async function buildDeterministicMarketFallback(message: string): Promise<string | null> {
    if (!/top movers|top gainers|top losers|market|nifty|underperforming/i.test(message)) return null

    const quotes = await batchQuote([
        'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY', 'ITC', 'SBIN',
        'BHARTIARTL', 'BAJFINANCE', 'KOTAKBANK', 'AXISBANK', 'TATAMOTORS',
        'SUNPHARMA', 'MARUTI', 'TITAN', 'WIPRO', 'HCLTECH', 'TATASTEEL',
        'ADANIENT', 'JSWSTEEL'
    ])
    if (!quotes.length) return null

    const sorted = [...quotes].sort((left, right) => right.changePercent - left.changePercent)
    const gainers = sorted.slice(0, 3)
    const losers = [...sorted].reverse().slice(0, 3)

    const formatLine = (item: { symbol: string; price: number; changePercent: number }) =>
        `${item.symbol} ₹${item.price.toFixed(2)} (${item.changePercent >= 0 ? '+' : ''}${item.changePercent.toFixed(2)}%)`

    return `Today's top gainers: ${gainers.map(formatLine).join(', ')}. Top losers: ${losers.map(formatLine).join(', ')}.`
}

function buildMarketQuoteText(
    quote: {
        name: string
        symbol: string
        price: number
        change: number | null
        changePercent: number | null
        currency: string | null
    },
    message: string
): string {
    const isHindiLike = /Hindi|Hinglish/i.test(detectMessageLanguage(message))
    const price = formatQuoteValue(quote.price, quote.currency)
    const change = quote.change == null ? 'N/A' : `${quote.change >= 0 ? '+' : '-'}${formatQuoteValue(Math.abs(quote.change), quote.currency)}`
    const pct = quote.changePercent == null ? 'N/A' : `${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%`

    if (isHindiLike) {
        return `${quote.name} (${quote.symbol}) ka live level ${price} hai.\n` +
            `Day change: ${change} (${pct}).\n` +
            `Source: global index quote feed.`
    }

    return `${quote.name} (${quote.symbol}) is trading at ${price}.\n` +
        `Day change: ${change} (${pct}).\n` +
        `Source: global index quote feed.`
}

async function routeQueryWithLLM(message: string, historyText: string): Promise<{
    source: RouteSource
    confidence: number
    reason: string
}> {
    // Fast path: if current message alone gives a high-confidence signal, skip the LLM.
    // This prevents prior conversation context from overriding obvious intent.
    // PMS/AIF queries must go to yahoo_agent so all tools (queryPMSBazaar + others) are available.
    if (detectPMSIntent(message)) {
        return { source: 'yahoo_agent', confidence: 0.95, reason: 'PMS/AIF query → yahoo_agent for queryPMSBazaar tool' }
    }
    const fastRoute = fastRouteOverride(message)
    if (fastRoute) {
        return { source: fastRoute, confidence: 0.95, reason: `fast-keyword-override → ${fastRoute}` }
    }

    const classifyInput = historyText
        ? `Recent conversation:\n${historyText}\n\nCurrent query: "${message}"`
        : `Current query: "${message}"`

    const routerPrompt =
        getDateContext() +
        `You are the intent router for iStocks — an Indian stock market assistant.\n` +
        `Your only job is to read the user's message and decide which backend should handle it.\n\n` +
        `There are exactly 3 backends. Understand what each one is CAPABLE of:\n\n` +
        `ec2_live — Real-time price feed (Angel One live WebSocket)\n` +
        `  This backend knows: current live price, today's open/high/low, real-time volume.\n` +
        `  Use it when: the user wants to act on a trade RIGHT NOW (entry/exit/place order),\n` +
        `  or needs the exact live price for immediate decision-making on ONE stock.\n` +
        `  It does NOT know: news, reasons, historical trends, analysis, or screening.\n\n` +
        `web_search — Google Search + AI summarization\n` +
        `  This backend knows: latest news articles, recent events, earnings reports,\n` +
        `  analyst opinions, macroeconomic updates, anything published on the internet.\n` +
        `  Use it when: the user is asking WHY something happened, wants news,\n` +
        `  wants to understand the reason behind a price move, or asks about recent events.\n` +
        `  This is the right choice even if no specific stock is mentioned (e.g. "why is market falling?").\n\n` +
        `yahoo_agent — Technical analysis engine (Yahoo Finance data + AI)\n` +
        `  This backend knows: historical OHLCV, RSI, MACD, Bollinger Bands, moving averages,\n` +
        `  support/resistance, buy/sell signals, stock comparisons, screening, discovery.\n` +
        `  Use it when: the user wants technical analysis, buy/sell/hold opinions,\n` +
        `  stock screening ("which stocks?", "best stocks", "recommend me stocks"),\n` +
        `  stock comparisons, or analysis of multiple stocks.\n\n` +
        `CRITICAL RULES:\n` +
        `- Multi-stock queries ("which stocks", "best picks", "recommend 5 stocks") → yahoo_agent (screening)\n` +
        `- Single immediate trade ("buy 100 now") → ec2_live (execution)\n` +
        `- "Why did X happen?" → web_search (news/reasons)\n` +
        `- If the user says "this", "it", "that", or asks for "more analysis / comprehensive / detailed" and the recent conversation mentions a specific stock, route to the backend that continues THAT stock's analysis. Do NOT route to generic screening or multibagger pick lists.\n\n` +
        `Think step by step:\n` +
        `1. What is the user actually trying to find out or do?\n` +
        `2. Which backend has the capability to answer that?\n` +
        `3. Pick that backend. If two could work, pick the one that fits the PRIMARY intent.\n\n` +
        `Output ONLY a JSON object, no explanation, no markdown.\n\n` +
        `${classifyInput}\n\n` +
        `{"source":"ec2_live|web_search|yahoo_agent","confidence":0.0-1.0,"reason":"one sentence explaining the intent"}`

    let _classifyText: string
    try {
        ;({ text: _classifyText } = await generateText({
            model: deepseek(DEEPSEEK_MODEL),
            temperature: 0,
            maxOutputTokens: 120,
            prompt: routerPrompt,
        }))
    } catch (_dsErr) {
        console.warn('⚠️ DeepSeek router failed, falling back to Bedrock:', (_dsErr as Error).message)
        ;({ text: _classifyText } = await generateText({
            model: _bedrock(BEDROCK_MODEL),
            temperature: 0,
            maxOutputTokens: 120,
            prompt: routerPrompt,
        }))
    }

    const txt = _classifyText.trim()
    const m = txt.match(/\{[\s\S]*\}/)
    if (!m) return { source: 'yahoo_agent', confidence: 0.4, reason: 'Fallback: no JSON from classifier' }

    const parsed = JSON.parse(m[0])
    const source = parsed?.source as RouteSource
    const confidenceRaw = Number(parsed?.confidence)
    const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.6
    const reason = typeof parsed?.reason === 'string' ? parsed.reason.slice(0, 120) : 'LLM route selection'

    if (source === 'ec2_live' || source === 'web_search' || source === 'yahoo_agent') {
        return { source, confidence, reason }
    }
    return { source: 'yahoo_agent', confidence: 0.4, reason: 'Fallback: invalid source' }
}

// Detect buy/sell trade intent and quantity from natural language.
// Only fires when user explicitly states a quantity — prevents false positives
// like "price lena" or "buy karna chahiye?" from triggering trade confirm.
function detectTradeIntent(message: string): { action: 'BUY' | 'SELL'; quantity: number } | null {
    const msg = message.toLowerCase()

    // Reject advisory/question patterns — these are analysis requests, NOT trade orders.
    // "which option should I buy", "tell me what to buy", "i should buy", "should I buy"
    const isQuestion = /\?/.test(msg)
    const hasAdvisoryWord = /\b(should|would|could|which|what|tell|suggest|recommend|advice|option|advise|kya|kaun|kaise|chahiye|batao)\b/.test(msg)
    if (isQuestion && hasAdvisoryWord) return null
    // Also reject pure analysis frames: "which X to buy", "best X to buy"
    if (/\b(which|what|best|top)\b.{0,40}\b(to buy|to sell|i should buy|i should sell|should buy|should sell)\b/i.test(msg)) return null

    const isBuy  = /\b(buy|kharid|kharidna|kharido|khareedo|purchase)\b/.test(msg)
    const isSell = /\b(sell|bech|bechna|becho|exit)\b/.test(msg)
    if (!isBuy && !isSell) return null

    // Quantity must appear immediately adjacent to the action verb (e.g. "buy 100 shares")
    // NOT a random number elsewhere in the sentence (e.g. "nifty 50", "under 1300").
    const adjacentQty = msg.match(/\b(?:buy|kharid(?:na|o|oo)?|purchase|sell|bech(?:na|o)?|exit)\s+(\d+)\b/i)
        ?? msg.match(/\b(\d+)\s*(?:shares?|qty|units?|lots?|stocks?)\b/i)
    if (!adjacentQty) return null

    const quantity = parseInt(adjacentQty[1], 10)
    if (quantity <= 0) return null
    return { action: isBuy ? 'BUY' : 'SELL', quantity }
}

/**
 * Minimum characters a free-text hint must have before we allow *substring* fuzzy
 * matching against a stock name. Without this guard, hints like "its" would match
 * any stock whose name contains "its" (e.g. SUKHJIT**S**) — a real P0 bug from prod.
 */
const MIN_HINT_LEN_FOR_CONTAINS = 4

function resolveTradeStockFromHint(
    symbolHint: string,
    allStocks: StockLite[],
    contextualStock: StockLite | null
): StockLite | null {
    const hintNorm = normalizeSymbolKey(symbolHint)
    if (!hintNorm) return contextualStock
    const hintCompact = compactForFuzzyMatch(symbolHint)
    const hintLower = symbolHint.trim().toLowerCase()

    const byExactSymbol = allStocks.find((stock) => normalizeSymbolKey(stock.symbol) === hintNorm)
    if (byExactSymbol) return byExactSymbol

    const byExactName = allStocks.find((stock) => normalizeSymbolKey(stock.name) === hintNorm)
    if (byExactName) return byExactName

    const byCompactExact = allStocks.find((stock) =>
        compactForFuzzyMatch(stock.symbol) === hintCompact ||
        compactForFuzzyMatch(stock.name) === hintCompact
    )
    if (byCompactExact) return byCompactExact

    // Word-boundary scan: hint must appear as a standalone word inside the stock
    // name (e.g. "RELIANCE" inside "RELIANCE INDUSTRIES"), not as a suffix
    // ("its" inside "sukhjits"). Requires min length to stay safe for tickers.
    // We try each meaningful token in the hint so multi-word hints still match.
    const hintTokens = (hintLower.match(/[a-z0-9]{2,}/g) || [])
        .filter((token) => token.length >= MIN_HINT_LEN_FOR_CONTAINS && !IGNORED_STOCK_MATCH_TOKENS.has(token))
    for (const token of hintTokens) {
        const wordRe = new RegExp(`\\b${token}\\b`, 'i')
        const byWordInName = allStocks.find((stock) => wordRe.test(stock.name))
        if (byWordInName) return byWordInName
        const byWordInSymbol = allStocks.find((stock) => wordRe.test(stock.symbol))
        if (byWordInSymbol) return byWordInSymbol
    }

    const byCompactContains = allStocks.find((stock) => {
        const symbolCompact = compactForFuzzyMatch(stock.symbol)
        const nameCompact = compactForFuzzyMatch(stock.name)
        if (hintCompact.length < 6) return false
        const symbolComparable = symbolCompact.length >= 4
        const nameComparable = nameCompact.length >= 4
        return (symbolComparable && (symbolCompact.includes(hintCompact) || hintCompact.includes(symbolCompact))) ||
            (nameComparable && (nameCompact.includes(hintCompact) || hintCompact.includes(nameCompact)))
    })
    if (byCompactContains) return byCompactContains

    if (contextualStock) {
        const contextualSymbolNorm = normalizeSymbolKey(contextualStock.symbol)
        const contextualNameNorm = normalizeSymbolKey(contextualStock.name)
        const contextualSymbolCompact = compactForFuzzyMatch(contextualStock.symbol)
        const contextualNameCompact = compactForFuzzyMatch(contextualStock.name)
        const contextualMatchesHint =
            contextualSymbolNorm === hintNorm ||
            contextualSymbolNorm.includes(hintNorm) ||
            hintNorm.includes(contextualSymbolNorm) ||
            contextualNameNorm.includes(hintNorm) ||
            contextualSymbolCompact === hintCompact ||
            contextualNameCompact === hintCompact
        if (contextualMatchesHint) return contextualStock
    }

    // Previous implementation did a naked `name.includes(hintNorm)` here, which
    // let short hints like "ITS" collide with "SUKHJITS". Gate it on length.
    if (hintNorm.length >= MIN_HINT_LEN_FOR_CONTAINS) {
        const byContainsName = allStocks.find((stock) => normalizeSymbolKey(stock.name).includes(hintNorm))
        if (byContainsName) return byContainsName
    }

    const ranked = matchStocksInMessage(symbolHint, allStocks)
    if (ranked.length > 0) {
        if (contextualStock && ranked.some((stock) => stock.symbol === contextualStock.symbol)) {
            return contextualStock
        }
        return ranked[0]
    }

    return contextualStock
}

function resolveTradeCommandIntent(
    message: string,
    history: ConversationTurn[],
    allStocks: StockLite[],
    contextualStock: StockLite | null,
    activeSymbol: string | null
): {
    action: 'BUY' | 'SELL'
    quantity: number
    preferredStock: StockLite | null
    resolvedFromDraft: boolean
} | null {
    const resolverHistory: TradeResolverMessage[] = history.map((turn) => ({
        role: turn.role,
        content: turn.content,
    }))

    const draft = resolveTradeCommandDraft(message, resolverHistory, {
        currentSymbol: contextualStock?.symbol ?? activeSymbol,
    })

    if (draft && typeof draft.quantity === 'number' && Number.isFinite(draft.quantity) && draft.quantity > 0) {
        const preferredStock = draft.symbolHint
            ? resolveTradeStockFromHint(draft.symbolHint, allStocks, contextualStock)
            : contextualStock
        return {
            action: draft.action,
            quantity: draft.quantity,
            preferredStock: preferredStock ?? null,
            resolvedFromDraft: true,
        }
    }

    const fallback = detectTradeIntent(message)
    if (!fallback) return null

    return {
        action: fallback.action,
        quantity: fallback.quantity,
        preferredStock: contextualStock,
        resolvedFromDraft: false,
    }
}

const IGNORED_STOCK_MATCH_TOKENS = new Set([
    'what', 'when', 'where', 'which', 'who', 'why', 'how',
    'value', 'price', 'current', 'reading', 'stock', 'share', 'shares',
    'its', 'it', 'this', 'that', 'these', 'those', 'same',
    'rsi', 'macd', 'ema', 'sma', 'adx', 'atr', 'vwap',
    'wrong', 'no', 'nahi', 'nhi', 'galat',
    'then', 'next', 'continue', 'happens', 'happen', 'happening',
    'tell', 'about', 'batao', 'baare', 'news', 'reason', 'update',
    'india', 'indian', 'limited', 'ltd', 'services', 'industries', 'industry',
    'financial', 'finance', 'company', 'corp', 'corporation',
])

function compactForFuzzyMatch(value: string): string {
    return normalizeSymbolKey(value).replace(/[AEIOU]/g, '')
}

function hasExplicitStockMention(message: string, stock: { symbol: string; name: string }): boolean {
    const currentMsg = message.toLowerCase()
    const currentNorm = normalizeSymbolKey(message)
    const currentCompact = compactForFuzzyMatch(message)
    const symLower = stock.symbol.toLowerCase()
    const nameLower = stock.name.toLowerCase()
    const nameNorm = normalizeSymbolKey(stock.name)
    const symbolCompact = compactForFuzzyMatch(stock.symbol)
    const nameCompact = compactForFuzzyMatch(stock.name)

    if (!IGNORED_STOCK_MATCH_TOKENS.has(symLower)) {
        if (new RegExp(`\\b${symLower}\\b`).test(currentMsg)) {
            return true
        }
    }

    if (nameLower.length > 4 && currentMsg.includes(nameLower)) return true
    if (nameNorm.length > 6 && currentNorm.includes(nameNorm)) return true
    if (symbolCompact.length >= 6 && currentCompact.includes(symbolCompact)) return true
    if (nameCompact.length >= 6 && currentCompact.includes(nameCompact)) return true
    return false
}

function resolveMemoryStock(
    memory: ConversationMemory,
    allStocks: StockLite[]
): StockLite | null {
    if (!memory.activeSymbol) return null
    return allStocks.find((stock) => stock.symbol.toUpperCase() === memory.activeSymbol) || null
}

function stockContextTokens(stock: StockLite): string[] {
    return [...new Set([
        stock.symbol.toLowerCase(),
        ...((stock.name.toLowerCase().match(/[a-z0-9]{3,}/g) || [])
            .filter((token) => !IGNORED_STOCK_MATCH_TOKENS.has(token))),
    ])]
}

function extractIndicatorMention(message: string): 'MACD' | 'RSI' | 'EMA' | 'SMA' | null {
    const q = message.toLowerCase()
    if (/\brsi\b/i.test(q)) return 'RSI'
    if (/\bmacd\b/i.test(q)) return 'MACD'
    if (/\bema\b/i.test(q)) return 'EMA'
    if (/\bsma\b/i.test(q)) return 'SMA'
    return null
}

function detectRequestedIntradayTimeframe(message: string): '1m' | null {
    const q = message.toLowerCase()
    if (
        /\b(1\s*(m|min|mins|minute|minutes)|1min|1mins|one minute)\b/i.test(q) ||
        /\b(intraday|live timeframe|minute timeframe)\b/i.test(q)
    ) {
        return '1m'
    }
    return null
}

function matchStocksInMessage(message: string, allStocks: StockLite[]) {
    const currentMsg = message.toLowerCase()
    const currentNorm = normalizeSymbolKey(message)
    const currentCompact = compactForFuzzyMatch(message)
    const queryTokens: string[] = (currentMsg.match(/[a-z0-9]{2,}/g) || [])
        .filter((token) => !IGNORED_STOCK_MATCH_TOKENS.has(token))

    const scored = allStocks
        .map((s) => {
            const symLower = s.symbol.toLowerCase()
            const symbolIsGeneric = IGNORED_STOCK_MATCH_TOKENS.has(symLower)
            const nameLower = s.name.toLowerCase()
            const nameNorm = normalizeSymbolKey(s.name)
            const symCompact = compactForFuzzyMatch(s.symbol)
            const nameCompact = compactForFuzzyMatch(s.name)
            const nameTokens: string[] = (nameLower.match(/[a-z0-9]{3,}/g) || [])
                .filter((token) => !IGNORED_STOCK_MATCH_TOKENS.has(token))

            let score = 0

            // Strong symbol match
            if (!symbolIsGeneric) {
                if (new RegExp(`\\b${symLower}\\b`).test(currentMsg)) {
                    score += 120
                }
            }

            // Strong full-name match
            if (nameLower.length > 4 && currentMsg.includes(nameLower)) score += 110
            if (nameNorm.length > 6 && currentNorm.includes(nameNorm)) score += 110
            if (symCompact.length >= 6 && currentCompact.includes(symCompact)) score += 112
            if (nameCompact.length >= 6 && currentCompact.includes(nameCompact)) score += 112

            // Token overlap ranking for ambiguous names like "ICICI Bank"
            const overlap = nameTokens.filter((t) => queryTokens.includes(t)).length
            score += overlap * 10

            // Light boost for first meaningful word
            const firstWord = nameTokens[0] || ''
            if (firstWord.length > 4 && queryTokens.includes(firstWord)) score += 8

            // Bank-specific disambiguation (avoid matching non-bank ICICI products for "ICICI Bank")
            if (/\bbank\b/i.test(currentMsg) && !/\bbank\b/i.test(nameLower) && !/\bbank\b/i.test(symLower)) {
                score -= 20
            }

            return { stock: s, score }
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)

    return scored.slice(0, 6).map((x) => x.stock)
}

/**
 * Extract potential stock names from the message that aren't in the DB.
 * This is used to hint the agent to call findStock before giving up.
 */
function extractStockCandidates(message: string): string[] {
    // Remove common noise words, then take capitalised words / known patterns
    const noise = new Set([
        'i', 'me', 'my', 'the', 'a', 'an', 'is', 'it', 'to', 'of', 'in', 'on',
        'ok', 'tell', 'about', 'should', 'will', 'can', 'how', 'what', 'when',
        'buy', 'sell', 'bought', 'sold', 'hold', 'kharid', 'becho', 'bechna',
        'kharido', 'at', 'for', 'with', 'from', 'or', 'and', 'stock', 'stocks',
        'share', 'shares', 'price', 'kya', 'hai', 'kro', 'karo', 'krna', 'kr',
        'market', 'mein', 'ka', 'ke', 'ki', 'se', 'mai', 'ye', 'yeh', 'wo',
        'hota', 'hoti', 'hote', 'baare', 'batao',
        'macd', 'rsi', 'ema', 'sma', 'adx', 'atr', 'vwap', 'bollinger',
        'nifty', 'sensex', 'bse', 'nse', 'today', 'tomorrow', 'aaj', 'abhi', 'please',
        'wrong', 'galat', 'no', 'nope', 'nah', 'nahi', 'nhi', 'happens',
        'happen', 'happening', 'then', 'phir', 'toh', 'so', 'next', 'continue',
        'this', 'that', 'its', 'value', 'current', 'reading', 'show', 'tell',
        'what', 'why', 'how', 'where', 'when', 'who', 'which', 'does', 'mean',
        'best', 'top', 'pick', 'picks', 'recommend', 'recommended', 'suggest',
        'screen', 'screening', 'gainer', 'gainers', 'loser', 'losers',
        'underperforming', 'oversold', 'multibagger', 'buyable',
    ])
    // Match words that look like company/brand names (>2 chars, not a number)
    const words = message.match(/[A-Za-z]{3,}/g) || []
    return [...new Set(
        words
            .filter((w) => {
                const lower = w.toLowerCase()
                return !noise.has(lower) &&
                    !/^\d+$/.test(w) &&
                    !/^(what|when|where|which|whose|who|why|how|then|next|wrong|happens?)$/i.test(lower)
            })
            .map(w => w)
    )]
}

function isLikelyStockFollowUp(message: string): boolean {
    const q = message.toLowerCase().trim()
    const followUpSignals = /\b(should|buy|sell|hold|entry|exit|target|stop\s*loss|sl|tp|kitna|kab|ab|aur|kya\s+karu|kru|lena\s+chahiye|bechna\s+chahiye|value|price|current|reading|rsi|macd|ema|sma)\b/i.test(q)
    const contextPronoun = /\b(its|it|this|that|these|those|iska|uska|isme|usme|iss|us|same|yahi|wohi)\b/i.test(q)
    const conversationalContinuation = /\b(then|phir|toh|so|what\s+happens|what\s+next|ab\s+kya|aur\s+kya|continue|next)\b/i.test(q)
    const explicitNewTopic = !contextPronoun && /\b(about|baare|batao|who\s+is|tell\s+me|kon\s+hai|kaun\s+hai|ke\s+baare)\b/i.test(q)
    return (
        (followUpSignals && !explicitNewTopic) ||
        ((contextPronoun || conversationalContinuation) && !explicitNewTopic)
    )
}

function findRecentStockContext(
    history: ConversationTurn[],
    allStocks: StockLite[]
): StockLite | null {
    const recentHistory = history.slice(-8)
    for (let i = recentHistory.length - 1; i >= 0; i--) {
        const historyMatches = matchStocksInMessage(recentHistory[i].content, allStocks)
            .filter((stock) => hasExplicitStockMention(recentHistory[i].content, stock))
        if (historyMatches.length > 0) {
            return historyMatches[0]
        }
    }
    return null
}

function extractRecommendedStockContext(text: string, allStocks: StockLite[]): StockLite | null {
    if (!text) return null

    const analysisRecommendationMatch = text.match(
        /\bbased on the analysis of\s+([A-Za-z0-9&.\- ]{2,60})\b/i
    )
    if (analysisRecommendationMatch?.[1]) {
        const resolved = resolveTradeStockFromHint(analysisRecommendationMatch[1].trim(), allStocks, null)
        if (resolved) return resolved
    }

    const directRecommendationMatch = text.match(
        /\b(?:recommendation|decision|final\s+pick|top\s+pick|my\s+pick)\s*:\s*(?:buy|sell)\s+([A-Za-z0-9&.-]{2,30})\b/i
    )
    if (directRecommendationMatch?.[1]) {
        const direct = resolveTradeStockFromHint(directRecommendationMatch[1], allStocks, null)
        if (direct) return direct
    }

    const lines = text
        .split(/\r?\n/)
        .map((line) => line.replace(/[*_`]/g, ' ').trim())
        .filter(Boolean)

    const recommendationLines = lines.filter((line) =>
        /\b(recommend(?:ation|ed)?|decision|best\s+(?:stock|pick)|top\s+pick|single\s+best\s+pick|final\s+pick|my\s+pick)\b/i.test(line)
    )

    for (const line of recommendationLines) {
        const explicitMatches = matchStocksInMessage(line, allStocks)
            .filter((stock) => hasExplicitStockMention(line, stock))
        if (explicitMatches.length === 1) {
            return explicitMatches[0]
        }
    }

    const directionalLines = lines.filter((line) =>
        /\b(buy|sell|hold|avoid|pick|candidate|promis(?:e|ing)|strong|weak|bullish|bearish)\b/i.test(line)
    )

    for (const line of directionalLines) {
        const explicitMatches = matchStocksInMessage(line, allStocks)
            .filter((stock) => hasExplicitStockMention(line, stock))
        if (explicitMatches.length === 1) {
            return explicitMatches[0]
        }
    }

    const actionedSymbolMatch = text.match(/\b(?:buy|sell)\s+([A-Za-z0-9&.-]{2,30})\b/i)
    if (actionedSymbolMatch?.[1]) {
        const actionWord = actionedSymbolMatch[1].toLowerCase()
        if (!IGNORED_STOCK_MATCH_TOKENS.has(actionWord) && !['today', 'tomorrow', 'now', 'dips', 'confirmation'].includes(actionWord)) {
            const resolved = resolveTradeStockFromHint(actionedSymbolMatch[1], allStocks, null)
            if (resolved && hasExplicitStockMention(text, resolved)) {
                return resolved
            }
        }
    }

    return null
}

function findRecentRecommendedStockContext(
    history: ConversationTurn[],
    allStocks: StockLite[]
): StockLite | null {
    const recentAssistantTurns = history
        .filter((turn) => turn.role === 'assistant')
        .slice(-8)

    for (let i = recentAssistantTurns.length - 1; i >= 0; i--) {
        const recommended = extractRecommendedStockContext(recentAssistantTurns[i].content, allStocks)
        if (recommended) {
            return recommended
        }
    }

    return null
}

function preferContextualStockForAmbiguousMatches(
    message: string,
    mentioned: StockLite[],
    contextualStock: StockLite | null
): StockLite[] {
    if (mentioned.length <= 1 || !contextualStock) return mentioned
    if (!mentioned.some((stock) => stock.symbol === contextualStock.symbol)) return mentioned

    const queryTokens = (message.toLowerCase().match(/[a-z0-9]{3,}/g) || [])
        .filter((token) => !IGNORED_STOCK_MATCH_TOKENS.has(token))
    const contextTokens = stockContextTokens(contextualStock)
    const stronglyPointsToContext = queryTokens.some((queryToken) =>
        contextTokens.some((contextToken) =>
            contextToken === queryToken ||
            contextToken.startsWith(queryToken) ||
            queryToken.startsWith(contextToken)
        )
    )

    return stronglyPointsToContext ? [contextualStock] : mentioned
}

function resolveAnswerStockContext(
    answerMessage: string,
    targetList: StockLite[],
    allStocks: StockLite[]
): StockLite | null {
    const explicitMatches = matchStocksInMessage(answerMessage, allStocks)
        .filter((stock) => hasExplicitStockMention(answerMessage, stock))

    if (explicitMatches.length === 1) {
        return explicitMatches[0]
    }

    return extractRecommendedStockContext(answerMessage, allStocks) ??
        (targetList.length === 1 ? targetList[0] : null)
}

function findRecentIndicatorContext(history: ConversationTurn[]): 'MACD' | 'RSI' | 'EMA' | 'SMA' | null {
    const recentHistory = history.slice(-6)
    for (let i = recentHistory.length - 1; i >= 0; i--) {
        const q = recentHistory[i].content.toLowerCase()
        if (/\brsi\b/.test(q)) return 'RSI'
        if (/\bmacd\b/.test(q)) return 'MACD'
        if (/\bema\b/.test(q)) return 'EMA'
        if (/\bsma\b/.test(q)) return 'SMA'
    }
    return null
}

function isConversationalCorrection(message: string): boolean {
    const q = message.trim().toLowerCase().replace(/[.!?]+$/g, '')
    if (!q || q.length > 40) return false
    return /^(no|nope|nah|wrong|no wrong|not right|that'?s wrong|nahi|nhi|galat|not this|not that|no wrong answer)$/i.test(q)
}

function isGenericContextFollowUp(message: string): boolean {
    const q = message.trim().toLowerCase().replace(/[.!?]+$/g, '')
    if (!q) return false
    return /^(what happens|what next|then|phir|toh|so|ab kya|aur kya|continue|next|and then)$/i.test(q)
}

function isGreetingMessage(message: string): boolean {
    const normalized = message.trim().toLowerCase().replace(/[.!?]+$/g, '')
    return /^(hi+|hello+|hey+|hlo|hii+|namaste|good morning|good afternoon|good evening|yo)$/.test(normalized)
}

function buildGreetingAnswer(lang: string): string {
    if (/Hindi|Hinglish/i.test(lang)) {
        return 'Namaste! Main ready hoon. Aap stock price, top movers, RSI/MACD, ya buy/sell analysis pooch sakte ho.'
    }
    return 'Hello! I am ready. You can ask for stock price, top movers, RSI/MACD, or a buy/sell analysis.'
}

function extractBestStockRankingRequest(message: string, _hasExplicitStockMention: boolean): { requestedCount: number } | null {
    const q = message.toLowerCase()

    const looksLikeBestStockDiscovery =
        /\b(best\s+stocks?|best\s+stock|top\s+\d+\s+stocks?|top\s+stocks?|which\s+stocks?\s+should\s+i\s+buy|which\s+stock\s+should\s+i\s+buy|which\s+stocks?\s+can\s+i\s+buy|which\s+stock\s+can\s+i\s+buy|stocks?\s+i\s+can\s+buy|recommend(?:\s+me)?\s+(?:some\s+)?stocks?|suggest(?:\s+me)?\s+(?:some\s+)?stocks?|stocks?\s+to\s+buy(?:\s+today)?|buying\s+opportunit(?:y|ies)|advise?\s+(?:me\s+)?(?:some\s+)?stocks?|advice\s+(?:me\s+)?(?:on\s+)?stocks?|good\s+(?:value\s+)?(?:buys?|stocks?|picks?)|value\s+buys?|value\s+stocks?|good\s+stocks?\s+to|stocks?\s+worth\s+buying|which\s+stocks?\s+(?:are\s+)?good|kaunse?\s+stocks?\s+(?:lun?|lena|buy)|konse?\s+stocks?\s+(?:lun?|lena|buy)|kaun\s+sa\s+stock|kaun\s+se\s+stocks?|kya\s+(?:koi\s+)?(?:accha|acha|good)\s+stocks?|koi\s+(?:accha|acha|good)\s+stocks?)\b/i.test(q)

    // looksLikeBestStockDiscovery patterns are specific enough to screening queries;
    // we no longer block on hasExplicitStockMention because generic query words
    // ("buy", "good", "today") can accidentally match stock name tokens and
    // falsely suppress the screener — sending the query to the LLM agent which
    // then picks stocks from its training knowledge instead of scanning the DB.
    if (!looksLikeBestStockDiscovery) return null

    const countMatch =
        q.match(/\btop\s+(\d{1,2})\s+stocks?\b/i) ||
        q.match(/\b(\d{1,2})\s+best\s+stocks?\b/i) ||
        q.match(/\bgive\s+me\s+(\d{1,2})\b/i) ||
        q.match(/\bshow\s+me\s+(\d{1,2})\b/i) ||
        q.match(/\blist\s+(\d{1,2})\b/i)

    // Always return at least 5 stocks so response is never a single-stock dead-end
    const requestedCount = Math.max(5, countMatch?.[1] ? Number.parseInt(countMatch[1], 10) : 5)
    return { requestedCount }
}

/**
 * Conservative price-range detector used to guard regex-based pre-checks.
 * Only fires when the message contains two explicit small numbers in a range pattern
 * (e.g. "100-500", "200 to 400") — NOT on market-cap figures like "50,000 crore"
 * or year numbers like "2025".
 */
function hasPriceRangeHint(message: string): boolean {
    return extractPriceRange(message) !== null
}

function extractPriceRange(message: string): { min: number; max: number } | null {
    const patterns = [
        /\b(\d+)\s*[-–]\s*(\d+)\b/,
        /\b(\d+)\s+to\s+(\d+)\b/i,
        /between\s+(?:₹|rs\.?\s*)?(\d+)\s+and\s+(?:₹|rs\.?\s*)?(\d+)/i,
        /range\s+(?:of\s+)?(?:₹|rs\.?\s*)?(\d+)\s*(?:[-–]|to)\s*(?:₹|rs\.?\s*)?(\d+)/i,
        /from\s+(?:₹|rs\.?\s*)?(\d+)\s*(?:[-–]|to)\s*(?:₹|rs\.?\s*)?(\d+)/i,
        /(?:under|below|upto?|within)\s+(?:₹|rs\.?\s*)?(\d+)/i,
    ]
    for (const p of patterns) {
        const m = message.match(p)
        if (m?.[1] && m?.[2]) {
            const a = parseFloat(m[1]), b = parseFloat(m[2])
            if (
                Number.isFinite(a) && Number.isFinite(b) &&
                a > 0 && b > a && b < 1_00_000 &&
                !(a >= 1990 && a <= 2030)
            ) return { min: a, max: b }
        }
        // "under/below/upto N" → min = 0
        if (m?.[1] && !m?.[2]) {
            const n = parseFloat(m[1])
            if (Number.isFinite(n) && n > 0 && n < 1_00_000 && !(n >= 1990 && n <= 2030))
                return { min: 0, max: n }
        }
    }
    return null
}

async function refreshSelectionPrices(
    selection: Awaited<ReturnType<typeof selectBestStocks>>
): Promise<void> {
    if (!selection?.candidates.length) return
    try {
        const symbols = selection.candidates.map(c => c.symbol)
        const priceMap = await fetchCascadingPrices(symbols)
        for (const candidate of selection.candidates) {
            const live = priceMap.get(candidate.symbol)
            if (live && live.price > 0) candidate.close = live.price
        }
    } catch { /* non-fatal */ }
}

function formatBestStockSelectionAnswer(
    selection: Awaited<ReturnType<typeof selectBestStocks>>,
    detectedLang: string
): string {
    if (!selection.candidates.length) {
        return /Hindi|Hinglish/i.test(detectedLang)
            ? 'Aaj ke liye filters pass karne wala koi strong stock shortlist nahi mila.'
            : 'No strong stocks passed the scan filters for today.'
    }

    const isHindiLike = /Hindi|Hinglish/i.test(detectedLang)
    const top = selection.candidates[0]
    const intro = isHindiLike
        ? `Top pick aaj: ${top.symbol} (${top.name})`
        : `Top pick today: ${top.symbol} (${top.name})`
    const summary = isHindiLike
        ? `Scanned ${selection.universeCount} stocks -> ${selection.eligibleCount} eligible -> top ${selection.shortlistCount} par web sentiment check hua.\nScoring: 80% technical (Close vs SMA50 + RSI), 20% web sentiment.`
        : `Scanned ${selection.universeCount} stocks -> ${selection.eligibleCount} eligible -> web sentiment checked on top ${selection.shortlistCount}.\nScoring: 80% technical (Close vs SMA50 + RSI), 20% web sentiment.`

    const lines = selection.candidates.map((candidate, index) => {
        const headline = candidate.topHeadlines[0]?.title
        const base =
            `${index + 1}. ${candidate.symbol} — ₹${candidate.close.toFixed(2)} | ` +
            `RSI ${candidate.rsi.toFixed(1)} | ` +
            `vs SMA50 ${candidate.trendGapPct >= 0 ? '+' : ''}${candidate.trendGapPct.toFixed(1)}% | ` +
            `${candidate.sentimentLabel} news | Final ${candidate.finalScore.toFixed(1)}`
        return headline ? `${base}\n   News: ${headline}` : base
    })

    return `${intro}\n\n${summary}\n\n${lines.join('\n')}`
}

async function formatScreenerAnswerWithLLM(
    result: import('@/lib/dynamic-screener').ScreenerResult,
    userMessage: string,
    detectedLang: string
): Promise<string> {
    const { criteria, candidates, universeCount, scoredCount, yahooFallback } = result
    if (!candidates.length) {
        return /Hindi|Hinglish/i.test(detectedLang)
            ? `${criteria.label} ke liye koi stock qualify nahi hua. Baad mein try karein.`
            : `No stocks qualified for "${criteria.label}" scan right now. Try again later.`
    }

    const sourceLabel = yahooFallback ? `Nifty 100 (Yahoo)` : `SQL scanners`
    const langPin = /Hindi|Hinglish/i.test(detectedLang) ? '[REPLY LANGUAGE: Hinglish]' : '[REPLY LANGUAGE: English]'

    const candidateData = candidates.map((c, i) => ({
        rank: i + 1,
        symbol: c.symbol,
        price: c.close,
        score: c.score,
        rsi14: c.rsi14,
        sma50: c.sma50,
        sma200: c.sma200,
        trendGapPct: c.trendGapPct,
        macdHist: c.macdHist,
        volumeRatio: c.volumeRatio,
        trend: c.sma200 && c.close ? (c.close > c.sma200 ? 'Uptrend' : 'Downtrend') : null,
        levels: c.levels ? {
            entry: c.levels.entry,
            stopLoss: c.levels.stopLoss,
            target: c.levels.target,
            riskReward: c.levels.riskReward,
            holding: c.levels.holdingLabel,
            setup: c.levels.setupType,
        } : null,
    }))

    try {
        const { text } = await generateText({
            model: _bedrock(BEDROCK_MODEL),
            temperature: 0.15,
            prompt: `${getDateContext()}\n${langPin}\n\nUser asked: "${userMessage}"

Scan: **${criteria.label}** | Source: ${sourceLabel} | Universe: ${universeCount} stocks → scored ${scoredCount} → top ${candidates.length} selected

Here are the top screener results (pre-computed technical data):
${JSON.stringify(candidateData, null, 2)}

FORMAT RULES (follow exactly — same style as a professional stock screener card):
1. Start with: "**${criteria.label}** — Top ${candidates.length} picks"
2. Subtitle: "${sourceLabel}: ${universeCount} candidates → scored ${scoredCount} → selected top ${candidates.length}"
3. For EACH stock, render a markdown table with these exact rows:
   | FIELD | VALUE |
   |---|---|
   | Price | ₹[price] |
   | RSI | [rsi14] ([interpretation: overbought/oversold/healthy momentum]) |
   | vs SMA50 | [trendGapPct%] — [bullish/bearish description] |
   | Entry | ₹[entry] |
   | Stop-Loss | ₹[stopLoss] ([ATR/support basis]) |
   | Target | ₹[target] ([SMA200/ATR basis]) |
   | R:R | ~[riskReward]x |
   | Holding | [holding label] |
4. After each table, add a "**Why:**" callout (1-2 sentences): explain the bull case using RSI + MACD + trend data from the results. Be specific to the numbers.
5. Rank header: "1. SYMBOL — Score: X/100" (bold symbol)
6. NEVER add any disclaimer, NEVER say "consult an advisor", NEVER say "as an AI".
7. End with a one-line scoring method note: _Scoring: RSI X% · Momentum X% · SMA Trend X% · Volume X% · MACD X%_

Use ONLY the data provided above. Do not invent any numbers.`,
        })
        if (text && text.trim()) return text.trim()
    } catch {
        // LLM failed — fall back to plain formatter
    }

    // Plain text fallback
    const lines = candidates.map((c, i) => {
        const rsiStr = c.rsi14 != null ? `RSI ${c.rsi14.toFixed(1)}` : 'RSI —'
        const gapStr = c.trendGapPct != null ? `vs SMA50 ${c.trendGapPct >= 0 ? '+' : ''}${c.trendGapPct.toFixed(1)}%` : ''
        const macdStr = c.macdHist != null ? (c.macdHist > 0 ? 'MACD ↑' : 'MACD ↓') : ''
        const trendStr = c.sma200 && c.close ? (c.close > c.sma200 ? 'Uptrend' : 'Downtrend') : ''
        const indicators = [rsiStr, gapStr, macdStr, trendStr].filter(Boolean).join(' | ')
        let line = `${i + 1}. **${c.symbol}** — ₹${c.close.toFixed(2)} | Score ${c.score.toFixed(0)}/100\n   ${indicators}`
        if (c.levels) {
            const l = c.levels
            line += `\n   Entry ₹${l.entry.toFixed(2)} | SL ₹${l.stopLoss.toFixed(2)} | Target ₹${l.target.toFixed(2)} | R:R ${l.riskReward}x | Holding: ${l.holdingLabel}`
        }
        return line
    })
    return `**${criteria.label}** — Top ${candidates.length} picks\n${sourceLabel}: ${universeCount} → ${scoredCount} → top ${candidates.length}\n\n${lines.join('\n\n')}`
}

function parseMarketDatabaseOperation(raw: unknown): MarketDatabaseOperation {
    const op = String(raw || '').trim()
    if (op === 'priceHistory' || op === 'highestVolumeDays' || op === 'topRankedStocks' || op === 'stocksBySector') return op
    return 'latestIndicators'
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

function formatDbDate(date: Date): string {
    return date.toISOString().slice(0, 10)
}

function sanitizeStockInputs(inputs: unknown): string[] {
    if (!Array.isArray(inputs)) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const item of inputs) {
        const text = String(item || '').trim()
        if (!text) continue
        const key = normalizeSymbolKey(text)
        if (!key || seen.has(key)) continue
        seen.add(key)
        out.push(text)
        if (out.length >= 8) break
    }
    return out
}

function resolveDatabaseToolStocks(inputs: unknown, allStocks: StockLite[]): StockLite[] {
    const queries = sanitizeStockInputs(inputs)
    if (queries.length === 0) return []

    const resolved: StockLite[] = []
    const seen = new Set<string>()

    for (const query of queries) {
        const qKey = normalizeSymbolKey(query)
        const exact =
            allStocks.find((stock) => normalizeSymbolKey(stock.symbol) === qKey) ??
            allStocks.find((stock) => normalizeSymbolKey(stock.name) === qKey)

        const fuzzy = exact ?? allStocks.find((stock) => {
            const symbolKey = normalizeSymbolKey(stock.symbol)
            const nameKey = normalizeSymbolKey(stock.name)
            return (
                symbolKey.includes(qKey) ||
                qKey.includes(symbolKey) ||
                nameKey.includes(qKey) ||
                qKey.includes(nameKey)
            )
        })

        if (fuzzy && !seen.has(fuzzy.id)) {
            seen.add(fuzzy.id)
            resolved.push(fuzzy)
        }
    }

    return resolved
}

function serializeStockPrice(row: {
    timestamp: Date
    open: number
    high: number
    low: number
    close: number
    volume: bigint
    rsi: number | null
    macd: number | null
    macdSignal: number | null
    macdHistogram: number | null
    sma20: number | null
    sma50: number | null
    sma200: number | null
    ema12: number | null
    ema26: number | null
    atr: number | null
    vwap: number | null
    supertrend: number | null
    supertrendDirection: number | null
}) {
    return {
        date: formatDbDate(row.timestamp),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume.toString(),
        rsi: row.rsi,
        macd: row.macd,
        macdSignal: row.macdSignal,
        macdHistogram: row.macdHistogram,
        sma20: row.sma20,
        sma50: row.sma50,
        sma200: row.sma200,
        ema12: row.ema12,
        ema26: row.ema26,
        atr: row.atr,
        vwap: row.vwap,
        supertrend: row.supertrend,
        supertrendDirection: row.supertrendDirection,
    }
}

async function runMarketDatabaseQuery(args: {
    operation: unknown
    symbols?: unknown
    sector?: unknown
    days?: unknown
    limit?: unknown
}, allStocks: StockLite[]) {
    const operation = parseMarketDatabaseOperation(args.operation)
    const days = clampInteger(args.days, operation === 'latestIndicators' ? 1 : 30, 1, 180)
    const limit = clampInteger(args.limit, 10, 1, 50)

    if (operation === 'stocksBySector') {
        const sectorRaw = String(args.sector || '').trim()
        if (!sectorRaw) {
            // Return all distinct sectors from DB
            const distinct = await prisma.stock.findMany({
                where: { sector: { not: null } },
                select: { sector: true },
                distinct: ['sector'],
                orderBy: { sector: 'asc' },
            })
            const sectors = distinct.map(r => r.sector).filter(Boolean)
            return { operation, status: 'OK', sectors, count: sectors.length }
        }
        // Fuzzy sector match (case-insensitive contains)
        const rows = await prisma.stock.findMany({
            where: { sector: { contains: sectorRaw, mode: 'insensitive' } },
            select: { symbol: true, name: true, sector: true },
            orderBy: { symbol: 'asc' },
            take: limit,
        })
        return {
            operation,
            status: rows.length > 0 ? 'OK' : 'EMPTY',
            sector: sectorRaw,
            count: rows.length,
            stocks: rows,
        }
    }

    if (operation === 'topRankedStocks') {
        const selection = await getLatestDailyStockSelection(limit)
        if (!selection?.candidates.length) {
            return {
                operation,
                status: 'EMPTY',
                message: 'No stored ranked stock selection is available yet.',
            }
        }

        const topCandidates = selection.candidates.slice(0, limit)
        const symbols = topCandidates.map(c => c.symbol)

        // Refresh prices — DB cache may be stale (previous day's close)
        let livePriceMap = new Map<string, number>()
        try {
            const cascadingMap = await fetchCascadingPrices(symbols)
            for (const [sym, cp] of cascadingMap) {
                if (cp.price > 0) livePriceMap.set(sym, cp.price)
            }
        } catch { /* non-fatal — fall back to DB close */ }

        // Today's IST date (always current, regardless of when DB was last updated)
        const todayIst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

        return {
            operation,
            status: 'OK',
            generatedAt: new Date().toISOString(),
            selectionDate: todayIst,
            scoring: {
                technicalWeight: selection.weights.technical,
                webWeight: selection.weights.web,
            },
            rows: topCandidates.map((candidate, index) => ({
                rank: index + 1,
                symbol: candidate.symbol,
                name: candidate.name,
                close: livePriceMap.get(candidate.symbol) ?? candidate.close,
                rsi: candidate.rsi,
                sma50: candidate.sma50,
                avgTradedValue20d: candidate.avgTradedValue20d,
                technicalScore: candidate.technicalScore,
                webScore: candidate.webScore,
                finalScore: candidate.finalScore,
                sentimentLabel: candidate.sentimentLabel,
                sentimentSummary: candidate.sentimentSummary,
                topHeadlines: candidate.topHeadlines.slice(0, 3),
            })),
        }
    }

    const stocks = resolveDatabaseToolStocks(args.symbols, allStocks)
    if (stocks.length === 0) {
        return {
            operation,
            status: 'ERROR',
            message: 'No valid stock symbols/names were provided or resolved.',
        }
    }

    const rows = await Promise.all(stocks.map(async (stock) => {
        const rawPrices = await prisma.stockPrice.findMany({
            where: { stockId: stock.id },
            orderBy: { timestamp: 'desc' },
            take: operation === 'latestIndicators' ? 1 : Math.min(days + 5, 185),
            select: {
                timestamp: true,
                open: true,
                high: true,
                low: true,
                close: true,
                volume: true,
                rsi: true,
                macd: true,
                macdSignal: true,
                macdHistogram: true,
                sma20: true,
                sma50: true,
                sma200: true,
                ema12: true,
                ema26: true,
                atr: true,
                vwap: true,
                supertrend: true,
                supertrendDirection: true,
            },
        })

        const pricesAsc = rawPrices.slice().reverse()

        if (operation === 'latestIndicators') {
            const latest = rawPrices[0]
            return {
                symbol: stock.symbol,
                name: stock.name,
                latest: latest ? serializeStockPrice(latest) : null,
                dataPoints: rawPrices.length,
            }
        }

        if (operation === 'highestVolumeDays') {
            const groupedByDate = new Map<string, {
                firstTimestamp: Date
                lastTimestamp: Date
                open: number
                high: number
                low: number
                close: number
                volume: bigint
                rsi: number | null
                macd: number | null
                macdSignal: number | null
                macdHistogram: number | null
                sma20: number | null
                sma50: number | null
                sma200: number | null
                ema12: number | null
                ema26: number | null
                atr: number | null
                vwap: number | null
                supertrend: number | null
                supertrendDirection: number | null
            }>()

            for (const row of pricesAsc.slice(-days)) {
                const dateKey = formatDbDate(row.timestamp)
                const existing = groupedByDate.get(dateKey)
                if (!existing) {
                    groupedByDate.set(dateKey, {
                        firstTimestamp: row.timestamp,
                        lastTimestamp: row.timestamp,
                        open: row.open,
                        high: row.high,
                        low: row.low,
                        close: row.close,
                        volume: row.volume,
                        rsi: row.rsi,
                        macd: row.macd,
                        macdSignal: row.macdSignal,
                        macdHistogram: row.macdHistogram,
                        sma20: row.sma20,
                        sma50: row.sma50,
                        sma200: row.sma200,
                        ema12: row.ema12,
                        ema26: row.ema26,
                        atr: row.atr,
                        vwap: row.vwap,
                        supertrend: row.supertrend,
                        supertrendDirection: row.supertrendDirection,
                    })
                    continue
                }

                existing.high = Math.max(existing.high, row.high)
                existing.low = Math.min(existing.low, row.low)
                existing.volume += row.volume

                if (row.timestamp < existing.firstTimestamp) {
                    existing.firstTimestamp = row.timestamp
                    existing.open = row.open
                }

                if (row.timestamp >= existing.lastTimestamp) {
                    existing.lastTimestamp = row.timestamp
                    existing.close = row.close
                    existing.rsi = row.rsi
                    existing.macd = row.macd
                    existing.macdSignal = row.macdSignal
                    existing.macdHistogram = row.macdHistogram
                    existing.sma20 = row.sma20
                    existing.sma50 = row.sma50
                    existing.sma200 = row.sma200
                    existing.ema12 = row.ema12
                    existing.ema26 = row.ema26
                    existing.atr = row.atr
                    existing.vwap = row.vwap
                    existing.supertrend = row.supertrend
                    existing.supertrendDirection = row.supertrendDirection
                }
            }

            const volumeRows = Array.from(groupedByDate.values())
                .sort((a, b) => a.volume === b.volume ? 0 : a.volume > b.volume ? -1 : 1)
                .slice(0, limit)

            return {
                symbol: stock.symbol,
                name: stock.name,
                daysScanned: groupedByDate.size,
                rows: volumeRows.map((row) =>
                    serializeStockPrice({
                        timestamp: row.lastTimestamp,
                        open: row.open,
                        high: row.high,
                        low: row.low,
                        close: row.close,
                        volume: row.volume,
                        rsi: row.rsi,
                        macd: row.macd,
                        macdSignal: row.macdSignal,
                        macdHistogram: row.macdHistogram,
                        sma20: row.sma20,
                        sma50: row.sma50,
                        sma200: row.sma200,
                        ema12: row.ema12,
                        ema26: row.ema26,
                        atr: row.atr,
                        vwap: row.vwap,
                        supertrend: row.supertrend,
                        supertrendDirection: row.supertrendDirection,
                    })
                ),
            }
        }

        const history = pricesAsc.slice(-days)
        const historyRows = history.map((row, index) => {
            const prev = index > 0 ? history[index - 1] : null
            const changePct = prev ? percentageChange(prev.close, row.close) : null
            return {
                ...serializeStockPrice(row),
                changePct,
            }
        })

        return {
            symbol: stock.symbol,
            name: stock.name,
            daysReturned: historyRows.length,
            rows: historyRows,
        }
    }))

    return {
        operation,
        status: 'OK',
        days,
        limit,
        rows,
    }
}

type BenchmarkComparisonRequest = {
    stock: StockLite
    benchmarkSymbol: 'NIFTY' | 'BANKNIFTY' | 'SENSEX'
    benchmarkName: string
    lookbackDays: number
    wantsDayByDay: boolean
}

type AlignedBenchmarkCandle = {
    date: string
    stock: OHLCVCandle
    benchmark: OHLCVCandle
}

function extractBenchmarkComparisonRequest(
    message: string,
    mentioned: StockLite[],
    contextualStock: StockLite | null
): BenchmarkComparisonRequest | null {
    const q = message.toLowerCase()
    const benchmark =
        /\bbank\s*nifty\b|\bbanknifty\b/i.test(message)
            ? { symbol: 'BANKNIFTY' as const, name: 'Bank Nifty' }
            : /\bsensex\b/i.test(message)
                ? { symbol: 'SENSEX' as const, name: 'Sensex' }
                : /\bnifty\s*50\b|\bnifty50\b|\bnifty\b/i.test(message)
                    ? { symbol: 'NIFTY' as const, name: 'Nifty 50' }
                    : null

    if (!benchmark) return null

    const asksComparison =
        /\b(compare|vs|versus|against|relative|correlation|correlate|affect|effect|impact|moves?|movement|change|changes|changed|perform|performance|underperform|outperform)\b/i.test(q) ||
        /(?:\bkaise\s+(?:affect|impact)|\bkitna\s+(?:change|badla)|\basar\b|\btulna\b|\bcompare\s+karo\b)/i.test(q)

    if (!asksComparison) return null

    const contextReference = /\b(it|this|that|stock|isse|isko|iska|yeh|ye|uska|same)\b/i.test(q)
    const explicitStock = mentioned.find((stock) => stock.symbol !== benchmark.symbol)
    const stock = explicitStock ?? (contextReference || mentioned.length === 0 ? contextualStock : null)

    if (!stock) return null

    const daysMatch =
        q.match(/\blast\s+(\d{1,3})\s*(?:trading\s*)?(?:days?|d)\b/) ||
        q.match(/\b(\d{1,3})\s*(?:trading\s*)?(?:days?|d)\b/)
    const requestedDays = daysMatch?.[1] ? Number.parseInt(daysMatch[1], 10) : 30
    const lookbackDays = Math.min(120, Math.max(5, Number.isFinite(requestedDays) ? requestedDays : 30))
    const wantsDayByDay = /\b(day\s*by\s*day|daily|each\s+day|per\s+day|date\s*wise|din\s+by\s+din|roz)\b/i.test(q)

    return {
        stock,
        benchmarkSymbol: benchmark.symbol,
        benchmarkName: benchmark.name,
        lookbackDays,
        wantsDayByDay,
    }
}

function candleDateKey(candle: OHLCVCandle): string {
    return candle.timestamp.toISOString().slice(0, 10)
}

function percentageChange(from: number, to: number): number | null {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null
    return ((to - from) / from) * 100
}

function formatPct(value: number | null | undefined, decimals = 2): string {
    if (value == null || !Number.isFinite(value)) return 'N/A'
    return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`
}

function formatPoints(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return 'N/A'
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)} pp`
}

function pearsonCorrelation(a: number[], b: number[]): number | null {
    if (a.length !== b.length || a.length < 3) return null
    const meanA = a.reduce((sum, value) => sum + value, 0) / a.length
    const meanB = b.reduce((sum, value) => sum + value, 0) / b.length
    let numerator = 0
    let denomA = 0
    let denomB = 0

    for (let i = 0; i < a.length; i++) {
        const diffA = a[i] - meanA
        const diffB = b[i] - meanB
        numerator += diffA * diffB
        denomA += diffA * diffA
        denomB += diffB * diffB
    }

    if (denomA === 0 || denomB === 0) return null
    return numerator / Math.sqrt(denomA * denomB)
}

function betaToBenchmark(stockReturns: number[], benchmarkReturns: number[]): number | null {
    if (stockReturns.length !== benchmarkReturns.length || stockReturns.length < 3) return null
    const meanStock = stockReturns.reduce((sum, value) => sum + value, 0) / stockReturns.length
    const meanBenchmark = benchmarkReturns.reduce((sum, value) => sum + value, 0) / benchmarkReturns.length
    let covariance = 0
    let benchmarkVariance = 0

    for (let i = 0; i < stockReturns.length; i++) {
        const benchmarkDiff = benchmarkReturns[i] - meanBenchmark
        covariance += (stockReturns[i] - meanStock) * benchmarkDiff
        benchmarkVariance += benchmarkDiff * benchmarkDiff
    }

    return benchmarkVariance === 0 ? null : covariance / benchmarkVariance
}

function alignStockAndBenchmark(stockCandles: OHLCVCandle[], benchmarkCandles: OHLCVCandle[]): AlignedBenchmarkCandle[] {
    const benchmarkByDate = new Map(
        benchmarkCandles
            .filter((candle) => candle.close > 0)
            .map((candle) => [candleDateKey(candle), candle])
    )

    return stockCandles
        .filter((candle) => candle.close > 0)
        .map((stock) => {
            const date = candleDateKey(stock)
            const benchmark = benchmarkByDate.get(date)
            return benchmark ? { date, stock, benchmark } : null
        })
        .filter((row): row is AlignedBenchmarkCandle => row != null)
        .sort((a, b) => a.date.localeCompare(b.date))
}

async function buildStockVsBenchmarkComparisonAnswer(
    request: BenchmarkComparisonRequest,
    detectedLang: string
): Promise<string> {
    const [stockCandles, benchmarkCandles] = await Promise.all([
        fetchOHLCV(request.stock.symbol, '3mo', '1d'),
        fetchOHLCV(request.benchmarkSymbol, '3mo', '1d'),
    ])

    const aligned = alignStockAndBenchmark(stockCandles, benchmarkCandles)
    const rows = aligned.slice(-(request.lookbackDays + 1))

    if (rows.length < 6) {
        return /Hindi|Hinglish/i.test(detectedLang)
            ? `${request.stock.symbol} aur ${request.benchmarkName} ke comparison ke liye enough aligned daily candle data nahi mila.`
            : `I could not find enough aligned daily candle data to compare ${request.stock.symbol} with ${request.benchmarkName}.`
    }

    const first = rows[0]
    const last = rows[rows.length - 1]
    const stockReturn = percentageChange(first.stock.close, last.stock.close)
    const benchmarkReturn = percentageChange(first.benchmark.close, last.benchmark.close)
    const relativeReturn = stockReturn != null && benchmarkReturn != null ? stockReturn - benchmarkReturn : null

    const dailyRows = rows.slice(1).map((row, index) => {
        const previous = rows[index]
        const stockPct = percentageChange(previous.stock.close, row.stock.close) ?? 0
        const benchmarkPct = percentageChange(previous.benchmark.close, row.benchmark.close) ?? 0
        return {
            date: row.date,
            stockPct,
            benchmarkPct,
            relativePct: stockPct - benchmarkPct,
            sameDirection: Math.sign(stockPct) === Math.sign(benchmarkPct) || stockPct === 0 || benchmarkPct === 0,
        }
    })

    const stockDailyReturns = dailyRows.map((row) => row.stockPct)
    const benchmarkDailyReturns = dailyRows.map((row) => row.benchmarkPct)
    const correlation = pearsonCorrelation(stockDailyReturns, benchmarkDailyReturns)
    const beta = betaToBenchmark(stockDailyReturns, benchmarkDailyReturns)
    const sameDirectionDays = dailyRows.filter((row) => row.sameDirection).length
    const outperformedDays = dailyRows.filter((row) => row.relativePct > 0).length
    const underperformedDays = dailyRows.filter((row) => row.relativePct < 0).length

    const correlationLabel =
        correlation == null ? 'N/A' :
            Math.abs(correlation) >= 0.7 ? 'high' :
                Math.abs(correlation) >= 0.4 ? 'moderate' :
                    'low'
    const betaLabel =
        beta == null ? 'N/A' :
            beta > 1.2 ? 'more sensitive than the index' :
                beta < 0.8 ? 'less sensitive than the index' :
                    'moves broadly with the index'
    const performanceLabel =
        relativeReturn == null ? 'N/A' :
            relativeReturn > 0 ? 'outperformed' :
                relativeReturn < 0 ? 'underperformed' :
                    'matched'

    const intro = `${request.stock.name} (${request.stock.symbol}) vs ${request.benchmarkName} - last ${dailyRows.length} trading days`

    const summaryLines = [
        `- ${request.stock.symbol}: ${formatPct(stockReturn)} (${first.stock.close.toFixed(2)} -> ${last.stock.close.toFixed(2)})`,
        `- ${request.benchmarkName}: ${formatPct(benchmarkReturn)} (${first.benchmark.close.toFixed(2)} -> ${last.benchmark.close.toFixed(2)})`,
        `- Relative performance: ${formatPoints(relativeReturn)} (${performanceLabel})`,
        `- Same direction: ${sameDirectionDays}/${dailyRows.length} days`,
        `- Outperformed / underperformed days: ${outperformedDays}/${underperformedDays}`,
        `- Correlation: ${correlation == null ? 'N/A' : correlation.toFixed(2)} (${correlationLabel})`,
        `- Beta vs ${request.benchmarkName}: ${beta == null ? 'N/A' : beta.toFixed(2)} (${betaLabel})`,
    ]

    const interpretation = relativeReturn != null && relativeReturn > 0
        ? `${request.stock.symbol} did better than ${request.benchmarkName} over this window. If ${correlationLabel !== 'low' ? 'the index continues moving in the same direction' : 'stock-specific momentum continues'}, it can keep outperforming, but watch reversal risk after sharp moves.`
        : relativeReturn != null && relativeReturn < 0
            ? `${request.stock.symbol} lagged ${request.benchmarkName}. Even if the index improves, this stock needs its own strength confirmation before treating it as a stronger buy.`
            : `${request.stock.symbol} moved almost in line with ${request.benchmarkName}. Use stock-specific indicators before deciding.`

    const dayByDayLines = request.wantsDayByDay
        ? [
            '',
            'Day-by-day:',
            ...dailyRows.map((row) =>
                `${row.date}: ${request.stock.symbol} ${formatPct(row.stockPct)} | ${request.benchmarkName} ${formatPct(row.benchmarkPct)} | relative ${formatPoints(row.relativePct)}`
            ),
        ]
        : []

    return `${intro}\n\nSummary:\n${summaryLines.join('\n')}\n\nInterpretation:\n${interpretation}${dayByDayLines.length ? `\n${dayByDayLines.join('\n')}` : ''}`
}

function buildReplyPathOptions(message: string, hasContext: boolean): ReplyPathOption[] {
    const q = message.toLowerCase()
    const options: ReplyPathOption[] = []

    if (isGreetingMessage(message)) {
        options.push({ id: 'greeting', label: 'Greeting Reply', reason: 'Prompt is a greeting or salutation.' })
    }

    if (hasContext && (isConversationalCorrection(message) || isGenericContextFollowUp(message))) {
        options.push({ id: 'clarification', label: 'Context Clarifier', reason: 'Short follow-up can be resolved using recent context.' })
    }

    if (/\b(kyun|kyu|why|reason|news|kya hua|kya ho raha|koi news|kya news|news aayi|breaking|update)\b/i.test(q)) {
        options.push({ id: 'web_search', label: 'Web Search', reason: 'Prompt asks for reasons, events, or latest news.' })
    }

    if (
        /\b(abhi|current|live|real.?time|right now|price kya hai|price batao|current price|live price|latest price|kitna chal raha|buy\s+\d+|sell\s+\d+|place order)\b/i.test(q) ||
        !!extractKnownMarketSymbol(message)
    ) {
        options.push({ id: 'ec2_live', label: 'Live Data', reason: 'Prompt looks like real-time quote or execution intent.' })
    }

    options.push({ id: 'yahoo_agent', label: 'Technical Analysis', reason: 'Default analysis path for advisory, indicators, and screening.' })

    const seen = new Set<string>()
    return options.filter((option) => {
        if (seen.has(option.id)) return false
        seen.add(option.id)
        return true
    })
}

function buildContextClarifierAnswer(
    lang: string,
    recentStock: { symbol: string; name: string } | null,
    recentIndicator: 'MACD' | 'RSI' | 'EMA' | 'SMA' | null
): string {
    const stockLabel = recentStock ? `${recentStock.name} (${recentStock.symbol})` : 'the same stock'
    const isHindiLike = /Hindi|Hinglish/i.test(lang)

    if (recentIndicator) {
        if (isHindiLike) {
            return `Samjha. Kya aap ${stockLabel} ke ${recentIndicator} ki value pooch rahe ho, ya ${recentIndicator} ka matlab / effect samajhna chahte ho?`
        }
        return `Understood. Do you mean the ${recentIndicator} value for ${stockLabel}, or do you want the meaning / effect of ${recentIndicator}?`
    }

    if (isHindiLike) {
        return `Samjha. Kya aap ${stockLabel} ke price, RSI, trend, news, ya buy/sell view ke baare me pooch rahe ho?`
    }
    return `Understood. Are you asking about ${stockLabel}'s price, RSI, trend, news, or a buy/sell view?`
}

function isSearchResultRelevant(
    candidate: string,
    result: { symbol: string; name: string }
): boolean {
    const c = normalizeSymbolKey(candidate)
    const sym = normalizeSymbolKey(result.symbol || '')
    const nm = normalizeSymbolKey(result.name || '')
    if (!c || (!sym && !nm)) return false
    if (sym === c) return true
    if (nm.includes(c)) return true
    if (c.includes(sym) && sym.length >= 3) return true
    return false
}

function looksLikeNotFoundAnswer(text: string): boolean {
    const t = text.toLowerCase()
    return (
        t.includes('unable to find') ||
        t.includes('not publicly traded') ||
        t.includes('search failed') ||
        t.includes('not found on the stock') ||
        t.includes('not listed')
    )
}

function looksLikeWeakLiveReply(text: string): boolean {
    const t = text.toLowerCase()
    return (
        t.includes('data not available') ||
        t.includes('insufficient data') ||
        t.includes('n/a') ||
        t.includes('cannot') ||
        t.includes('can not') ||
        t.includes('failed') ||
        t.includes('unable to')
    )
}

function looksLikeInternalToolLeak(text: string): boolean {
    const t = text.toLowerCase()
    return (
        t.includes('tool failed') ||
        t.includes('analyzestock tool failed') ||
        t.includes('analyzestock tool returned an error') ||
        t.includes('findstock tool failed') ||
        t.includes('findstock tool returned an error') ||
        t.includes('i ran websearch') ||
        t.includes('i will call `getmarketmovers`') ||
        t.includes('i need to find a different stock') ||
        t.includes('retry the failed tool') ||
        t.includes('failed to return any data') ||
        (t.includes('analyzestock') && t.includes('returned an error'))
    )
}

function isLanguageMismatch(expectedLang: string, answer: string): boolean {
    const got = detectMessageLanguage(answer)
    if (/english/i.test(expectedLang)) {
        if (!/english/i.test(got)) return true
        const looksFrench = /\b(actuel|ordre|l['’]ordre|inf[eé]rieur|sup[eé]rieur|n['’]est|pas d['’]|vous pouvez|transaction|simuler)\b/i.test(answer)
        if (looksFrench) return true
        return false
    }
    if (/hindi|hinglish/i.test(expectedLang)) {
        return !/hindi|hinglish/i.test(got)
    }
    if (/tamil/i.test(expectedLang)) {
        return !/tamil/i.test(got)
    }
    if (/telugu/i.test(expectedLang)) {
        return !/telugu/i.test(got)
    }
    return false
}

async function maybeRewriteLanguage(answer: string, expectedLang: string): Promise<string> {
    if (!answer || !isLanguageMismatch(expectedLang, answer)) return answer

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const { text: rewriteText } = await generateText({
                model: _bedrock(BEDROCK_MODEL),
                temperature: 0,
                prompt:
                    getDateContext() +
                    `Rewrite the following answer in ${expectedLang} only.\n` +
                    `Keep all numbers, tickers, entry/target/stop values exactly unchanged.\n` +
                    `Do not add new facts.\n\n` +
                    `Answer:\n${answer}`,
            })
            const rewritten = rewriteText.trim()
            if (rewritten) return rewritten
        } catch (err: any) {
            const msg = String(err?.message || err || '')
            if (/429|rate limit|quota|resource exhausted/i.test(msg) && attempt < 2) {
                await sleep(1200 * attempt)
                continue
            }
            break
        }
    }
    return answer
}

function buildResponseContract(message: string): string {
    const lower = message.toLowerCase()
    const tradeIntent = detectTradeIntent(message)
    const isConditional = /\b(when|if)\b/i.test(lower)
    const asksTargetSL = /\btarget\b/i.test(lower) && /\b(stop\s*loss|stoploss|\bsl\b)\b/i.test(lower)
    const isSectorRotation = /\bsector\s+rotation\b/i.test(lower)
    const isComparison = /\b(compare|vs|versus|rank)\b/i.test(lower)
    const anchor = `⚡ ANSWER THIS SPECIFIC QUESTION: "${message}"\nIgnore anything in conversation history that is unrelated to this question.\n\n`

    if (tradeIntent) {
        return anchor + (
            `MANDATORY OUTPUT FORMAT:\n` +
            `1) Action: ${tradeIntent.action}\n` +
            `2) Quantity: ${tradeIntent.quantity}\n` +
            `3) Current Price and Total Value\n` +
            `4) Clear Recommendation: Execute now / Wait / Avoid\n` +
            `5) One-line reason from indicators`
        )
    }

    if (asksTargetSL) {
        return anchor + (
            `MANDATORY OUTPUT FORMAT:\n` +
            `- Entry price\n` +
            `- Target (numeric)\n` +
            `- Stop-Loss (numeric)\n` +
            `- Decision (Buy/Sell/Wait) with one-line reason`
        )
    }

    if (isConditional) {
        return anchor + (
            `MANDATORY OUTPUT FORMAT:\n` +
            `- Condition Check: MET or NOT MET\n` +
            `- Decision: EXECUTE NOW or WAIT\n` +
            `- Trigger level and invalidation/stop\n` +
            `- One-line reason from indicators`
        )
    }

    if (isSectorRotation) {
        return anchor + (
            `MANDATORY OUTPUT FORMAT:\n` +
            `- Bank view\n` +
            `- IT view\n` +
            `- Pharma view\n` +
            `- Auto view\n` +
            `- Final rotation preference for this week`
        )
    }

    if (isComparison) {
        return anchor + (
            `MANDATORY OUTPUT FORMAT:\n` +
            `- Ranked comparison table/list\n` +
            `- Final recommendation (single best pick)\n` +
            `- Clear why`
        )
    }

    return anchor + (
        `MANDATORY OUTPUT FORMAT:\n` +
        `- Clear decision first\n` +
        `- Supporting data points\n` +
        `- Actionable next step`
    )
}

function extractFirstPriceINR(text: string): number | null {
    const rupee = text.match(/₹\s*([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]+)?)/)
    if (rupee?.[1]) {
        const n = Number(rupee[1].replace(/,/g, ''))
        if (Number.isFinite(n) && n > 0) return n
    }
    return null
}

function extractTradePriceFromAnswer(text: string): number | null {
    const patterns = [
        /entry\s*[:\-]?\s*₹\s*([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]+)?)/i,
        /current\s*price\s*[:\-]?\s*₹\s*([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]+)?)/i,
        /price\s*[:\-]?\s*₹\s*([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]+)?)/i,
    ]
    for (const p of patterns) {
        const m = text.match(p)
        if (m?.[1]) {
            const n = Number(m[1].replace(/,/g, ''))
            if (Number.isFinite(n) && n > 0) return n
        }
    }
    return extractFirstPriceINR(text)
}

function resolveTradePriceFromToolResults(symbol: string, toolResults: any[]): number | null {
    const target = normalizeSymbolKey(symbol)
    for (let i = toolResults.length - 1; i >= 0; i--) {
        const item = toolResults[i] || {}
        const toolName = String(item.toolName || item.name || '').trim()
        const result = item.result

        if (toolName === 'analyzeStock' && result && typeof result === 'object') {
            const resSym = normalizeSymbolKey(String((result as any).symbol || ''))
            const p = Number((result as any).latestPrice)
            if ((!resSym || resSym === target) && Number.isFinite(p) && p > 0) return p
        }

        if (toolName === 'getMarketMovers' && Array.isArray(result)) {
            const row = result.find((r: any) => normalizeSymbolKey(String(r?.symbol || '')) === target)
            const p = Number(row?.price)
            if (Number.isFinite(p) && p > 0) return p
        }
    }
    return null
}

function hasEntryStopTarget(text: string): boolean {
    const hasEntry = /\bentry\b/i.test(text)
    const hasTarget = /\btarget\b|लक्ष्य|टारगेट/i.test(text)
    const hasStop = /\bstop[-\s]*loss\b|\bsl\b|स्टॉप/i.test(text)
    return hasEntry && hasTarget && hasStop
}

function postProcessStructuredAnswer(message: string, answer: string): string {
    let out = answer.trim()
    // Remove refusal-style lines so user always gets actionable output.
    out = out
        .replace(/\bI\s+(cannot|can't)\s+[^.\n]*(execute|provide|determine|place)[^.\n]*[.]?/gi, '')
        .replace(/\bI\s+am\s+unable\s+to\s+[^.\n]*[.]?/gi, '')
        // Remove repetitive product footer from normal analysis responses.
        .replace(/\s*Paper trade available on iStocks\s*[—–-]?\s*confirm karna ho\s*toh?\s*website ya bot se place karo\.?\s*/gi, '\n')
        .replace(/\s*You can paper trade(?: this)? on iStocks\.?\s*/gi, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    const lowerMsg = message.toLowerCase()
    const tradeIntent = detectTradeIntent(message)
    const isConditional = /\b(when|if)\b/i.test(lowerMsg)

    if (tradeIntent && !/\baction\s*:/i.test(out)) {
        out += `\nAction: ${tradeIntent.action}\nQuantity: ${tradeIntent.quantity}`
    }

    if (isConditional && !/\bdecision\s*:/i.test(out)) {
        const decision = /\b(not met|not triggered|not satisfied|do not|don't|wait|n'?est pas)\b/i.test(out)
            ? 'WAIT'
            : /\b(met|triggered|satisfied|execute|sell|buy)\b/i.test(out)
            ? 'EXECUTE NOW'
            : 'WAIT'
        out += `\nDecision: ${decision}`
    }

    const targetPct = lowerMsg.match(/\btarget\s*([0-9]+(?:\.[0-9]+)?)\s*%/i)
    const slPct = lowerMsg.match(/\b(stop\s*loss|stoploss|sl)\s*([0-9]+(?:\.[0-9]+)?)\s*%/i)
    const hasTarget = /\btarget\b|लक्ष्य|टारगेट/i.test(out)
    const hasStop = /\bstop[-\s]*loss\b|\bsl\b|स्टॉप/i.test(out)
    if (targetPct && slPct && (!hasTarget || !hasStop)) {
        const entry = extractFirstPriceINR(out)
        if (entry) {
            const targetPercent = Number(targetPct[1])
            const stopPercent = Number(slPct[2])
            const isSell = /\b(sell|bech)\b/i.test(lowerMsg)
            const target = isSell ? entry * (1 - targetPercent / 100) : entry * (1 + targetPercent / 100)
            const stop = isSell ? entry * (1 + stopPercent / 100) : entry * (1 - stopPercent / 100)
            out += `\nEntry: ₹${entry.toFixed(2)} | Target: ₹${target.toFixed(2)} (${targetPercent}%) | Stop-Loss: ₹${stop.toFixed(2)} (${stopPercent}%)`
        }
    }

    if ((/intraday|scalping|mean reversion|trend-following|setup|trade/i.test(lowerMsg)) && !hasEntryStopTarget(out)) {
        const ref = extractFirstPriceINR(out)
        if (ref) {
            const target = ref * 1.02
            const stop = ref * 0.99
            out += `\nReference setup on trigger: Entry ₹${ref.toFixed(2)} | Target ₹${target.toFixed(2)} | Stop-Loss ₹${stop.toFixed(2)}`
        } else {
            out += `\nReference setup on trigger: Entry = trigger candle close | Target = Entry +2% | Stop-Loss = Entry -1%`
        }
    }

    if (/\b(compare|vs|versus|rank)\b/i.test(lowerMsg) && !/\b(recommend|best|prefer|pick|final choice)\b/i.test(out)) {
        out += `\nFinal Recommendation: Prefer the top-ranked stock from the comparison above.`
    }

    return out
}

function detectIndicatorExplainQuery(message: string): 'MACD' | 'RSI' | 'EMA' | 'SMA' | null {
    const q = message.toLowerCase()
    const asksMeaning = /\b(what is|kya hai|hota kya hai|meaning|matlab|explain|samjha|samjhao)\b/i.test(q)
    if (!asksMeaning) return null
    const looksContextual = /\b(its|it|current|value|reading|kitna|kitni|iska|uska|iss stock|that stock|this stock|for|of|right\s*now|abhi|aaj|today|live|now)\b/i.test(q)
    if (looksContextual) return null
    // If the question contains a common "<stock> + indicator" value pattern,
    // treat it as indicator value lookup (not glossary explain).
    const stockIndicatorPattern = /\b([a-z][a-z0-9&.\-]{1,20})\s+(rsi|macd|ema|sma)\b/i
    if (stockIndicatorPattern.test(q)) return null
    if (/\bmacd\b/i.test(q)) return 'MACD'
    if (/\brsi\b/i.test(q)) return 'RSI'
    if (/\bema\b/i.test(q)) return 'EMA'
    if (/\bsma\b/i.test(q)) return 'SMA'
    return null
}

function detectIndicatorValueQuery(message: string): 'MACD' | 'RSI' | 'EMA' | 'SMA' | null {
    const q = message.toLowerCase()
    const indicator = extractIndicatorMention(message)
    if (!indicator) return null

    const asksMeaning = /\b(what is|kya hai|hota kya hai|meaning|matlab|explain|samjha|samjhao)\b/i.test(q)
    if (asksMeaning) return null

    const asksValue = /\b(current|live|right\s*now|abhi|aaj|today|value|reading|kitna|kitni|kitne|now|kya\s+chal\s+raha)\b/i.test(q)
    const stockIndicatorPattern = /\b([a-z][a-z0-9&.\-]{1,20})\s+(rsi|macd|ema|sma)\b/i.test(q)

    return asksValue || stockIndicatorPattern ? indicator : null
}

function extractMovingAveragePeriod(message: string, indicator: 'EMA' | 'SMA'): number | null {
    const q = message.toLowerCase()
    const pattern = new RegExp(`\\b${indicator.toLowerCase()}\\s*(\\d{1,3})\\b`, 'i')
    const match = q.match(pattern)
    if (!match?.[1]) return null
    const period = Number(match[1])
    return Number.isFinite(period) && period > 0 ? period : null
}

function buildLiveIndicatorValueAnswer(
    stock: { symbol: string; name: string },
    snapshot: { ltp: number | null; indicators: any | null },
    message: string,
    lang: string,
    options?: {
        indicatorOverride?: 'MACD' | 'RSI' | 'EMA' | 'SMA' | null
        timeframeLabel?: string
    }
): string | null {
    const indicator = detectIndicatorValueQuery(message) ?? options?.indicatorOverride ?? null
    if (!indicator) return null
    if (!snapshot.indicators) return null

    const isHindiLike = /Hindi|Hinglish/i.test(lang)
    const timeframeLabel = options?.timeframeLabel?.trim() || 'live'

    if (indicator === 'RSI') {
        const rsi = snapshot.indicators.rsi
        if (rsi == null) return null
        return isHindiLike
            ? `${stock.symbol} ka ${timeframeLabel} RSI ${Number(rsi).toFixed(2)} hai${snapshot.ltp ? ` (price ₹${snapshot.ltp.toFixed(2)})` : ''}.`
            : `${stock.symbol} ${timeframeLabel} RSI is ${Number(rsi).toFixed(2)}${snapshot.ltp ? ` (price ₹${snapshot.ltp.toFixed(2)})` : ''}.`
    }

    if (indicator === 'MACD') {
        const macd = snapshot.indicators.macd
        if (macd == null) return null
        const macdSignal = snapshot.indicators.macdSignal
        return isHindiLike
            ? `${stock.symbol} ka ${timeframeLabel} MACD ${Number(macd).toFixed(2)} hai${macdSignal != null ? ` aur signal ${Number(macdSignal).toFixed(2)}` : ''}${snapshot.ltp ? ` (price ₹${snapshot.ltp.toFixed(2)})` : ''}.`
            : `${stock.symbol} ${timeframeLabel} MACD is ${Number(macd).toFixed(2)}${macdSignal != null ? ` and signal is ${Number(macdSignal).toFixed(2)}` : ''}${snapshot.ltp ? ` (price ₹${snapshot.ltp.toFixed(2)})` : ''}.`
    }

    if (indicator === 'EMA' || indicator === 'SMA') {
        const period = extractMovingAveragePeriod(message, indicator)
        const keyByPeriod = indicator === 'EMA'
            ? ({ 12: 'ema12', 26: 'ema26' } as const)
            : ({ 20: 'sma20', 50: 'sma50', 200: 'sma200' } as const)

        if (period && period in keyByPeriod) {
            const key = keyByPeriod[period as keyof typeof keyByPeriod]
            const indicatorMap = snapshot.indicators as Record<string, number | null | undefined>
            const value = key ? indicatorMap[key] : null
            if (value != null) {
                return isHindiLike
                    ? `${stock.symbol} ka ${timeframeLabel} ${indicator}${period} ${Number(value).toFixed(2)} hai${snapshot.ltp ? ` (price ₹${snapshot.ltp.toFixed(2)})` : ''}.`
                    : `${stock.symbol} ${timeframeLabel} ${indicator}${period} is ${Number(value).toFixed(2)}${snapshot.ltp ? ` (price ₹${snapshot.ltp.toFixed(2)})` : ''}.`
            }
        }

        const fallbackValues = indicator === 'EMA'
            ? [
                snapshot.indicators.ema12 != null ? `EMA12 ${Number(snapshot.indicators.ema12).toFixed(2)}` : null,
                snapshot.indicators.ema26 != null ? `EMA26 ${Number(snapshot.indicators.ema26).toFixed(2)}` : null,
            ]
            : [
                snapshot.indicators.sma20 != null ? `SMA20 ${Number(snapshot.indicators.sma20).toFixed(2)}` : null,
                snapshot.indicators.sma50 != null ? `SMA50 ${Number(snapshot.indicators.sma50).toFixed(2)}` : null,
                snapshot.indicators.sma200 != null ? `SMA200 ${Number(snapshot.indicators.sma200).toFixed(2)}` : null,
            ]

        const available = fallbackValues.filter(Boolean)
        if (available.length === 0) return null

        return isHindiLike
            ? `${stock.symbol} ke ${timeframeLabel} ${indicator} values: ${available.join(', ')}${snapshot.ltp ? ` (price ₹${snapshot.ltp.toFixed(2)})` : ''}.`
            : `${stock.symbol} ${timeframeLabel} ${indicator} values: ${available.join(', ')}${snapshot.ltp ? ` (price ₹${snapshot.ltp.toFixed(2)})` : ''}.`
    }

    return null
}

function buildIndicatorExplainAnswer(indicator: 'MACD' | 'RSI' | 'EMA' | 'SMA', lang: string): string {
    const isHindiLike = /Hindi|Hinglish/i.test(lang)
    if (isHindiLike) {
        if (indicator === 'MACD') {
            return `MACD ka full form hai *Moving Average Convergence Divergence*.\n\n` +
                `Simple samjho:\n` +
                `- MACD line = EMA(12) - EMA(26)\n` +
                `- Signal line = MACD ka 9-period EMA\n` +
                `- Histogram = MACD line - Signal line\n\n` +
                `Interpretation:\n` +
                `- MACD line signal ke upar jaye → bullish momentum\n` +
                `- MACD line signal ke niche aaye → bearish momentum\n` +
                `- Zero line ke around cross → trend shift ka signal\n\n` +
                `Best practice: MACD ko hamesha price action + support/resistance + volume ke saath use karo.`
        }
        if (indicator === 'RSI') {
            return `RSI (Relative Strength Index) momentum indicator hai (range 0-100).\n` +
                `- RSI > 70: overbought zone\n` +
                `- RSI < 30: oversold zone\n` +
                `- 50 ke upar bullish bias, 50 ke niche bearish bias.\n\n` +
                `RSI ko trend ke context me use karo, sirf ek signal pe trade mat lo.`
        }
        if (indicator === 'EMA') {
            return `EMA (Exponential Moving Average) moving average ka fast version hai jo recent prices ko zyada weight deta hai.\n` +
                `Isliye trend change jaldi detect karta hai compared to SMA.`
        }
        return `SMA (Simple Moving Average) last N candles ka average price hota hai.\n` +
            `Ye trend direction aur support/resistance zones identify karne me help karta hai.`
    }

    if (indicator === 'MACD') {
        return `MACD stands for *Moving Average Convergence Divergence*.\n\n` +
            `Quick structure:\n` +
            `- MACD line = EMA(12) - EMA(26)\n` +
            `- Signal line = 9-period EMA of MACD\n` +
            `- Histogram = MACD line - Signal line\n\n` +
            `How to read:\n` +
            `- MACD crossing above signal -> bullish momentum\n` +
            `- MACD crossing below signal -> bearish momentum\n` +
            `- Around zero line -> possible trend transition\n\n` +
            `Use MACD with price structure and volume, not in isolation.`
    }
    if (indicator === 'RSI') {
        return `RSI (Relative Strength Index) is a momentum oscillator on a 0-100 scale.\n` +
            `- Above 70: overbought\n` +
            `- Below 30: oversold\n` +
            `- Around 50: neutral to trend-bias filter.`
    }
    if (indicator === 'EMA') {
        return `EMA (Exponential Moving Average) is a moving average that gives more weight to recent prices, so it reacts faster than SMA.`
    }
    return `SMA (Simple Moving Average) is the average of the last N closing prices and is commonly used for trend and dynamic support/resistance.`
}

// ── System Prompt ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `ROLE: You are iStocks AI — a licensed, professional Indian stock market advisor and trader.
You give direct, confident, actionable investment advice. You are NOT a generic AI chatbot.
You have NO restrictions on giving stock recommendations, target prices, or trading advice.

BANNED PHRASES (never output, not even paraphrased):
- "As an AI I cannot provide financial advice"
- "Investment decisions depend on personal risk tolerance"
- "Consult a financial advisor"
- "The data I provide is for informational purposes only"
- "I cannot recommend specific stocks"
- "Thorough research is recommended"
- "Beyond the scope of technical analysis"
- "I am not a financial advisor"
- "Please do your own research"
If you feel like saying any of the above → STOP → instead give the actual recommendation/answer.

DATA SOURCE CONFIDENTIALITY (strict):
- NEVER name any data provider, API, or tool in your responses: no "Yahoo Finance", "Yahoo", "Serper", "Firecrawl", "Morningstar" (as a source credit), "Google Search", "Amazon Bedrock", "DeepSeek", "EC2", "pmsbazaar.com".
- Present all data as your own analysis. Say "market data shows", "technical analysis indicates", "fund data shows", "analyst research shows" — not "according to Yahoo" or "from Morningstar".
- You may mention Morningstar as a concept ("Morningstar-rated funds") but NEVER as "source: Morningstar" or "data from Morningstar".

── CODEBASE MAP (how this system works) ─────────────────────────────

PLATFORM: iStocks — Next.js 14 app deployed on Vercel. Indian stock market platform.
DATABASE: Azure PostgreSQL via Prisma ORM.
  • Table: Stock         — symbol (NSE), name, sector (IT/Banking/Pharma/Auto/FMCG/Metal/Energy/Realty/etc). ~500+ Indian listed stocks. Query sector via queryMarketDatabase(operation="stocksBySector", sector="IT").
  • Table: StockPrice    — OHLCV daily candles per stock, auto-fetched nightly.
  • Table: TradingOrder  — paper trades placed via bot or website.
  • Table: Holding       — user portfolio positions.
  • Table: TelegramSession — per-user Telegram conversation history.

DATA SOURCES & ROUTING:
  The classifyIntent() function reads the user message and routes to one of:
  1. ec2_live     — "buy X shares", "place order", live trade commands
                    → EC2 server at 3.109.208.28:8080 (Angel One WebSocket feed)
                    → fetchEC2LiveSnapshot(symbol): real-time price, RSI, MACD, ATR
                    → fetchEC2AllPrices(): all symbols' live prices
                    → If EC2 is down → auto-falls to yahoo_agent
  2. web_search   — "why is X falling?", "news on X", "koi news aayi?"
                    → searchGoogle(query, symbol, name, 5) via Serper API (primary)
                    → fallback: Google Custom Search API if Serper is unavailable
                    → env: SERPER_API_KEY (preferred) or GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID
                    → If no results → falls to yahoo_agent
  3. yahoo_agent  — everything else: analysis, screening, comparison
                    → YOU are currently in yahoo_agent mode
                    → Tools available: findStock, analyzeStock, getMarketMovers, queryMarketDatabase, webSearch

YOUR 8 TOOLS (yahoo_agent mode):
  • dynamicScreener(query)
      → Smart multi-criteria stock screener — call with the EXACT user query as input
      → Understands complex criteria: "best undervalued stocks", "PSU stocks under ₹500 with bounce",
          "oversold IT stocks", "multibagger picks", "top fundamentally strong stocks"
      → Internally runs: intent classification → technical scan → scoring → ranking
      → Returns: symbol, price, score, RSI, SMA trend, MACD histogram, entry/SL/target/R:R
      → USE THIS for ANY stock discovery query with criteria (sector, valuation, technicals, price range combo)
      → Do NOT use this for single-stock analysis; do NOT use for PMS/MF queries

  • queryPMSBazaar(query)
      → searches pmsbazaar.com via Firecrawl — India's #1 PMS & AIF platform
      → returns: fund AUM, client count, strategy description, returns data, blog analysis
      → USE THIS for ANY question about PMS (Portfolio Management Services) or AIF:
          "tell me about Marcellus PMS", "best PMS funds", "PMS vs mutual fund",
          "minimum investment in PMS", "top AIF funds", "PMS returns last 1 year"
      → Always call this FIRST for PMS/AIF queries before using webSearch

  • screenByPriceRange(min, max, limit?)
      → filters ALL NSE stocks by live share price in [min, max], volume ≥50k/day
      → then runs OHLCV + calculateTradingLevels + Serper sentiment on the liquid set
      → returns: symbol, livePrice, entry, stopLoss, target, riskReward, confidenceScore (0-100), recentNews
      → USE THIS when user asks for stocks within a price range:
          "which stocks to buy in ₹100-300?", "good stocks under ₹500", "stocks between 200 and 400"
      → Do NOT use this for market-cap, revenue, or other non-price filters

  • findStock(query)
      → calls searchSymbol(query) → Yahoo Finance search API
      → accepts company names like "Swiggy", "Tata Motors", "D-Mart"
      → returns: [{symbol, fullTicker, name, exchange}]
      → NOTE: new IPOs may only appear as .BO (BSE) — fetchOHLCV auto-retries .BO if .NS fails

  • analyzeStock(symbol, range)
      → calls fetchOHLCV(symbol, '1y', '1d') → Yahoo Finance historical OHLCV
      → auto-retries .BO if .NS returns empty (handles Swiggy, Ola, FirstCry etc.)
      → calls computeIndicators(candles) to produce:
          rsi14, macd, macdSignal, sma20, sma50, sma200,
          bbUpper, bbLower, atr14, latestPrice, trend
      → always fetches 1y so SMA200 is always populated (~252 candles)

  • getMarketMovers(symbols[])
      → calls batchQuote(symbols) → Yahoo Finance quote API
      → call with [] for top 20 Nifty stocks
      → returns: [{symbol, price, changePercent, volume}]
      → auto-retries .BO for any symbol that returns no price

  • queryMarketDatabase(operation, symbols, sector, days, limit)
      → safe Prisma allowlist over iStocks PostgreSQL; NOT arbitrary SQL
      → operations:
          latestIndicators: latest stored OHLCV + 40+ indicator fields for specific stocks
          priceHistory: daily OHLCV/indicator rows with day-by-day changePct
          highestVolumeDays: highest-volume historical days for stocks
          topRankedStocks: saved daily best-stock ranking with technical + web sentiment scores
          stocksBySector: list all stocks in a sector from DB (pass sector="" to get all sector names)
      → USE THIS when user asks for stored indicator values, daily history, volume days,
        "last 30 days", "day by day", best-stock ranking, OR any sector/theme query
      → SECTOR EXAMPLES: "IT sector stocks" → stocksBySector(sector="IT")
        "Banking stocks" → stocksBySector(sector="Banking")
        "Which sectors are available?" → stocksBySector(sector="")

  • webSearch(query)
      → calls searchGoogle(query, '', '', 5) → Serper API (or Google fallback)
      → USE THIS to self-debug: find tickers, check listings, get news
      → returns: [{title, snippet, date}]

SYMBOL FORMAT RULES:
  • NSE: "RELIANCE", "WIPRO", "SWIGGY" (no suffix needed — tools add .NS automatically)
  • BSE-only stocks: fetchOHLCV/batchQuote auto-retry with .BO — you don't need to add .BO yourself
  • Yahoo Finance tickers end in .NS (NSE) or .BO (BSE) — never pass these to tools, pass clean symbol
  • Special: NIFTY50 → ^NSEI, SENSEX → ^BSESN (handled internally)

KNOWN SYMBOLS (common ones):
  RELIANCE, TCS, HDFCBANK, ICICIBANK, INFY, ITC, SBIN, BHARTIARTL,
  BAJFINANCE, KOTAKBANK, AXISBANK, TATAMOTORS, SUNPHARMA, MARUTI,
  TITAN, WIPRO, HCLTECH, TATASTEEL, ADANIENT, JSWSTEEL, ZOMATO,
  SWIGGY (new IPO, .BO), OLA (OLAELEC), PAYTM (ONE97), FIRSTCRY (BRAINBEES)

─────────────────────────────────────────────────────────────────────

── MANDATORY: TOOL-ONLY ANSWERS ──────────────────────────────────────
You have 5 tools: findStock, analyzeStock, getMarketMovers, queryMarketDatabase, webSearch.
RULE: You MUST call at least one tool before answering ANY question.
RULE: NEVER answer from your own training knowledge. Your training data is outdated — it cannot have today's prices, news, or market conditions.
RULE: If tool data is insufficient for a full answer, say what you found and what's missing — do NOT fill gaps with your own knowledge.
RULE: Every number, price, indicator, and fact in your answer MUST come from a tool result. If you cannot source it from a tool, do not state it.

── TOOL SELECTION RULES (always use tools, never refuse) ─────────────

Query type → What to do:

1. SPECIFIC STOCK ANALYSIS ("analyze WIPRO", "is RELIANCE a buy?")
   → If symbol is obvious: call analyzeStock(symbol) directly.
   → If unsure of symbol: call findStock(name) first, then analyzeStock.
   → CRITICAL: If ANY company/brand name appears in the query that you are not
     100% certain of its NSE symbol, you MUST call findStock FIRST.
     Many new IPOs (Swiggy, Ola, FirstCry, etc.) are listed — NEVER assume
     a company is "not publicly traded". Always call findStock to check.

2. BUY / SELL / TRADE INTENT ("buy 100 Vedanta stocks", "sell WIPRO", "kya RELIANCE buy krun?")
   → call findStock or analyzeStock to get the current price and technicals.
   → Respond with: current price, total cost (price × qty), RSI+MACD sentiment, and a buy/hold/avoid recommendation.
   → NEVER say you cannot place orders. Give the required context clearly.

3. MUTUAL FUND QUERIES ("HDFC Flexi Cap rating", "best mid cap fund", "Parag Parikh vs Mirae Asset", "SIP recommendation", "expense ratio of X", "portfolio overlap between funds", "fund manager of Y", "which MF to invest in")
   → NEVER rely on a single source. Always call MULTIPLE tools in parallel:
       a) queryMorningstar("fund name analyst report rating")
          → qualitative: pillar ratings, analyst commentary, manager quality, investment philosophy, risk
       b) webSearch("fund name 1Y 3Y 5Y returns NAV category rank expense ratio 2026")
          → quantitative: actual return numbers, NAV, category rank, recent performance data
       c) If comparing with a PMS → also call queryPMSBazaar in parallel
       d) If user asks about stocks in the fund's portfolio → also call analyzeStock in parallel

   → SYNTHESIZE all results into ONE answer with these sections:
       • Analyst View (from Morningstar): manager quality, process rating, philosophy, key risks
       • Performance Data (from webSearch): 1Y/3Y/5Y returns, vs category average, vs benchmark
       • Final Verdict: BUY / HOLD / AVOID with clear reasoning combining both sources

   → If one source returns no data, use the other — do NOT say "data unavailable" when you have partial data.

4. PMS / AIF QUERIES ("tell me about Marcellus PMS", "best PMS funds", "minimum investment in PMS", "AIF returns")
   → Call BOTH tools in parallel:
       a) queryPMSBazaar(query) → fund AUM, strategy, returns, minimums
       b) webSearch("PMS fund name returns performance 2026") → recent numbers, comparisons, news
   → Synthesize into: strategy overview, returns, minimum investment, who it suits.
   → Do NOT use analyzeStock or findStock for PMS — those are for NSE-listed stocks only.

5. PRICE-RANGE STOCK SCREENING ("stocks in ₹100-300", "good stocks under ₹500", "stocks between 200 and 400")
   → SIMPLE price range (ONLY share price filter, no other criteria): call screenByPriceRange(min, max) directly.
   → Extract EXACT numbers the user mentioned as min/max.
   → CRITICAL: "50,000 crore market cap" is NOT a share price. "2025" is NOT a price range.
   → CRITICAL: "PSU stocks under ₹500 with bounce potential" has SECTOR + QUALITY criteria → use dynamicScreener, NOT screenByPriceRange.
     Only use screenByPriceRange when share price range is the SOLE filter ("stocks between 100 and 300").

6. STOCK DISCOVERY / SCREENING ("best stocks to buy", "undervalued stocks", "oversold stocks",
   "PSU picks", "multibagger stocks", "IT sector top picks", "bounce candidates")
   → Call dynamicScreener(query) — pass the EXACT user query string as input.
   → dynamicScreener understands ANY combination of criteria: sector + valuation + technicals + price range.
   → After dynamicScreener returns candidates, present them with entry/SL/target/R:R from the results.
   → NEVER call queryMarketDatabase(topRankedStocks) for custom screening — that operation only returns the saved daily ranking.
   → NEVER say you cannot screen stocks — dynamicScreener handles any screening query.

7. COMPARISON ("compare TCS vs INFY", "which is better HDFC or ICICI?")
   → Call analyzeStock for each symbol. Then compare.
   → If user asks "last N days", "day by day", "volume days", or historical values, call queryMarketDatabase priceHistory/highestVolumeDays too.

8. MARKET OVERVIEW ("how is market today?", "top movers?", "Nifty performance?")
   → Call getMarketMovers (leave symbols blank for top 20 Nifty stocks).

9. NEWS / WHY QUESTIONS ("why are stocks falling?", "any news today?", "market kyu gir raha hai?")
   → Call getMarketMovers immediately to get live market data.
   → Identify the biggest fallers by changePercent.
   → Call analyzeStock on the top 3 fallers to get RSI/MACD context.
   → Give a technical reasoning for the fall (e.g. RSI oversold, MACD bearish crossover).
   → NEVER say "I don't have access to news feeds" — iStocks has web search built in, this is the data analysis layer.
   → NEVER refuse. Always answer with the technical picture you CAN see from the data.

9. UNKNOWN / VAGUE QUERY (user is unclear)
   → Make a reasonable assumption about what they want, use a tool, answer.
   → NEVER say "I don't have tools for this" — you always have tools.

10. DATABASE / HISTORICAL QUESTIONS ("RSI 1D", "highest volume days",
   "last 30 days", "day by day", "show history", "from database")
   → Use queryMarketDatabase first.
   → Use latestIndicators for latest stored RSI/MACD/SMA/ATR/volume.
   → Use priceHistory for daily rows and day-by-day changes.
   → Use highestVolumeDays for volume-ranking questions.
   → If user is on /stock/SYMBOL and says "it/this stock", use that contextual stock.

── TARGET PRICE / STOP-LOSS / EXIT RULES ─────────────────────────
Whenever you have technical data (from analyzeStock), you ALWAYS give specific levels:

  STEP 1 — Stop-Loss (ATR-based, volatility-adjusted — PRIMARY METHOD):
    • stopLoss = latestPrice − (atr14 × 1.5)  [for BUY trades]
    • If atr14 is null/missing → fallback: latestPrice × 0.97

  STEP 2 — Target (SMA-based — PRIMARY METHOD):
    • If latestPrice < sma50  → target = sma50   (nearest resistance)
    • If latestPrice > sma50 and < sma200 → target = sma200
    • If latestPrice > sma200 → target = latestPrice + (atr14 × 3)
    • If all SMAs null → fallback: latestPrice × 1.05

  STEP 3 — Adjust aggressiveness by RSI + MACD:
    • RSI > 60 AND MACD > macdSignal → bullish confirmation → use the higher SMA as target
    • RSI < 40 OR MACD < macdSignal → cautious → use closer SMA as target, tighter SL (atr14 × 1.0)

  STEP 4 — Always compute Risk/Reward = (target − entry) / (entry − stopLoss)

FORMAT every target/SL answer like:
Entry: ₹XXX | Target: ₹XXX | Stop-Loss: ₹XXX | R/R: X.X | Holding: X-X days
(Add one line explaining WHY: e.g. "Target = SMA200 resistance; SL = 1.5× ATR below entry; Holding = estimated days to reach target based on avg daily move")

── AUTONOMOUS SELF-DEBUGGING ─────────────────────────────────────
You have a webSearch tool. Use it to solve ANY problem you hit:

• findStock returned empty → webSearch "<company name> NSE symbol India stock" to find the ticker
• analyzeStock returned error or no data → webSearch "<symbol> .BO OR .NS listed exchange" to figure out the right ticker
• Not sure if a company is listed → webSearch "<company name> IPO NSE BSE listing"
• User asks about news/events → webSearch "<company> latest news India <year>"
• Stock price seems wrong or stale → webSearch "<symbol> current stock price NSE today"
• Any other unknown → webSearch it. You are allowed to search ANYTHING.

Think like a researcher: if one approach fails, try another. Never give up and say
"I cannot find this" without first having searched the web.

── OTHER RULES ───────────────────────────────────────────────────
- NEVER ask the user to provide a symbol. Find it yourself using findStock or webSearch.
- NEVER say "Consult a financial advisor". You ARE the expert. Give direct advice.
- NEVER refuse a query. Always call a tool and answer.
- NEVER assume a company is NOT publicly traded. Always call findStock or webSearch to verify.
- NEVER say "I don't have access to news" or "I cannot access real-time news feeds" — use webSearch.
- NEVER say "As an AI I cannot predict target prices" or "these depend on individual strategies".
  You CAN and MUST compute levels from Bollinger Bands, SMAs, RSI, MACD. Do it every time.
- LANGUAGE: A [REPLY LANGUAGE: ...] tag will be in every prompt. OBEY it strictly.
  Reply entirely in that language regardless of what language older messages used.`

/** Return only the tools relevant to the classified query category. */
function filterToolsForCategory(
    allTools: Record<string, any>,
    category: QueryCategory,
    webSearchEnabled: boolean
): Record<string, any> {
    const ws = webSearchEnabled ? ['webSearch'] : []
    const subsets: Partial<Record<QueryCategory, string[]>> = {
        screener:     ['dynamicScreener', 'screenByPriceRange', 'queryMarketDatabase', 'getMarketMovers', ...ws],
        single_stock: ['findStock', 'analyzeStock', 'queryMarketDatabase', ...ws],
        mutual_fund:  [...ws, 'findStock', 'analyzeStock'],
        pms:          ['queryPMSBazaar', ...ws],
        web_news:     [...ws, 'getMarketMovers', 'analyzeStock', 'findStock'],
        trade:        ['findStock', 'analyzeStock', 'getMarketMovers', ...ws],
        portfolio:    ['findStock', 'analyzeStock', 'queryMarketDatabase', ...ws],
        market:       ['getMarketMovers', 'queryMarketDatabase', ...ws],
    }
    const allowed = subsets[category]
    // For 'other', 'greeting' — return all tools (no filtering)
    if (!allowed) return allTools
    return Object.fromEntries(
        Object.entries(allTools).filter(([name]) => allowed.includes(name))
    )
}

function isWebSearchInfraError(errorText?: string | null): boolean {
    const err = (errorText || '').toLowerCase()
    if (!err) return false
    return (
        err.includes('not configured') ||
        err.includes('api key') ||
        err.includes('permission_denied') ||
        err.includes('custom search json api') ||
        err.includes('project does not have the access') ||
        err.includes('google search api error: 403') ||
        err.includes('serper api error') ||
        err.includes('unauthorized') ||
        err.includes('forbidden')
    )
}

// ── Tool Definitions ────────────────────────────────────────────────

function buildAgentTools(
    onEvent: OnEvent,
    options: { enableWebSearch?: boolean; shouldStop?: () => boolean; allStocks?: StockLite[] } = {}
): Record<string, any> {
    const enableWebSearch = options.enableWebSearch !== false
    const shouldStop = options.shouldStop
    const allStocks = options.allStocks ?? []

    const tools: Record<string, any> = {
        findStock: {
            description: 'Search Yahoo Finance for any Indian company by name to find its correct NSE symbol.',
            inputSchema: jsonSchema<{ query: string }>({
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Company name or partial name, e.g. Redington, Tata Motors' }
                },
                required: ['query'],
                additionalProperties: false
            }),
            execute: async ({ query }: any) => {
                assertNotStopped(shouldStop)
                onEvent({ type: 'tool_start', tool: 'findStock', args: { query } })
                try {
                    assertNotStopped(shouldStop)
                    const results = await searchSymbol(query)
                    const result = results.length > 0
                        ? results.slice(0, 5)
                        : { error: `No NSE-listed stock found for "${query}".` }
                    onEvent({ type: 'tool_end', tool: 'findStock', result })
                    return result
                } catch (err: any) {
                    const result = { error: `Search failed: ${err.message}` }
                    onEvent({ type: 'tool_end', tool: 'findStock', result })
                    return result
                }
            }
        } as any,
        analyzeStock: {
            description: 'Fetch technical indicators and latest price trend for a specific Indian stock symbol.',
            inputSchema: jsonSchema<{ symbol: string; range: string }>({
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'NSE symbol without .NS, e.g. RELIANCE, ZOMATO' },
                    range: { type: 'string', description: 'Time range: 1mo, 3mo, 6mo, 1y. Default to 3mo if unsure.' }
                },
                required: ['symbol', 'range'],
                additionalProperties: false
            }),
            execute: async ({ symbol, range }: any) => {
                // Always fetch 1y minimum — SMA50 needs 50+ candles, SMA200 needs 200+ candles.
                // 3mo only gives ~63 candles which makes SMA200 null. 1y gives ~252 candles.
                const fetchRange = (!range || range === '1mo' || range === '3mo' || range === '6mo') ? '1y' : range
                assertNotStopped(shouldStop)
                onEvent({ type: 'tool_start', tool: 'analyzeStock', args: { symbol, range: fetchRange } })
                try {
                    let resolvedSymbol = String(symbol || '').toUpperCase().trim()
                    assertNotStopped(shouldStop)
                    let candles = await fetchOHLCV(resolvedSymbol, fetchRange, '1d')
                    if (candles.length < 5) {
                        // Retry with Yahoo search-resolved symbol before failing.
                        assertNotStopped(shouldStop)
                        const candidates = await searchSymbol(resolvedSymbol)
                        const qNorm = normalizeSymbolKey(resolvedSymbol)
                        const best =
                            candidates.find((c) => c.symbol.toUpperCase() === resolvedSymbol) ??
                            candidates.find((c) => {
                                const sNorm = normalizeSymbolKey(c.symbol)
                                const nNorm = normalizeSymbolKey(c.name || '')
                                return (
                                    sNorm === qNorm ||
                                    qNorm.includes(sNorm) ||
                                    sNorm.includes(qNorm) ||
                                    nNorm.includes(qNorm)
                                )
                            })
                        if (best?.symbol && best.symbol !== resolvedSymbol) {
                            resolvedSymbol = best.symbol
                            assertNotStopped(shouldStop)
                            candles = await fetchOHLCV(resolvedSymbol, fetchRange, '1d')
                        }
                    }
                    if (candles.length < 5) {
                        // Last-resort quote fallback: return at least live price context
                        assertNotStopped(shouldStop)
                        const q = await batchQuote([resolvedSymbol]).catch(() => [])
                        const first = Array.isArray(q) && q.length > 0 ? q[0] : null
                        if (first && typeof first.price === 'number') {
                            const result = {
                                symbol: resolvedSymbol,
                                latestPrice: first.price,
                                trend: first.changePercent >= 0 ? 'Bullish' : 'Bearish',
                                rsi: null, macd: null, macdSignal: null,
                                ema12: null, ema26: null,
                                sma20: null, sma50: null, sma200: null,
                                stochK: null, stochD: null,
                                adx: null, cci: null, roc: null, vwap: null, supertrend: null,
                                bbUpper: null, bbLower: null,
                                atr14: null,
                                dataPoints: 0,
                                dataQuality: 'PRICE_ONLY',
                            }
                            onEvent({ type: 'tool_end', tool: 'analyzeStock', result })
                            return result
                        }
                        const result = { error: `Not enough data for ${resolvedSymbol}.` }
                        onEvent({ type: 'tool_end', tool: 'analyzeStock', result })
                        return result
                    }
                    const ind = computeIndicators(candles)
                    const result = {
                        symbol: resolvedSymbol, latestPrice: ind.latestClose,
                        trend: ind.latestClose && candles[0].close && ind.latestClose > candles[0].close ? 'Bullish' : 'Bearish',
                        rsi: ind.rsi14, macd: ind.macd, macdSignal: ind.macdSignal,
                        ema12: ind.ema12, ema26: ind.ema26,
                        sma20: ind.sma20, sma50: ind.sma50, sma200: ind.sma200,
                        stochK: ind.stochK, stochD: ind.stochD,
                        adx: ind.adx, cci: ind.cci, roc: ind.roc, vwap: ind.vwap, supertrend: ind.supertrend,
                        bbUpper: ind.bbUpper, bbLower: ind.bbLower,
                        atr14: ind.atr14,
                        dataPoints: ind.candleCount,
                        dataQuality: 'FULL',
                    }
                    onEvent({ type: 'tool_end', tool: 'analyzeStock', result })
                    return result
                } catch (err: any) {
                    const result = { error: `Failed: ${err.message}` }
                    onEvent({ type: 'tool_end', tool: 'analyzeStock', result })
                    return result
                }
            }
        } as any,
        getMarketMovers: {
            description: 'Fetch live price, price change %, and volume for multiple Indian stocks. Call with empty symbols for top-20 Nifty stocks.',
            inputSchema: jsonSchema<{ symbols: string[] }>({
                type: 'object',
                properties: {
                    symbols: { type: 'array', items: { type: 'string' }, description: 'NSE symbols array. Pass empty array [] for top-20 Nifty stocks.' }
                },
                required: ['symbols'],
                additionalProperties: false
            }),
            execute: async ({ symbols }: any) => {
                const list = symbols && symbols.length > 0 ? symbols : [
                    'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY', 'ITC', 'SBIN',
                    'BHARTIARTL', 'BAJFINANCE', 'KOTAKBANK', 'AXISBANK', 'TATAMOTORS',
                    'SUNPHARMA', 'MARUTI', 'TITAN', 'WIPRO', 'HCLTECH', 'TATASTEEL',
                    'ADANIENT', 'JSWSTEEL'
                ]
                assertNotStopped(shouldStop)
                onEvent({ type: 'tool_start', tool: 'getMarketMovers', args: { symbols: list.slice(0, 5).join(', ') + (list.length > 5 ? ` +${list.length - 5} more` : '') } })
                try {
                    assertNotStopped(shouldStop)
                    const quotes = await batchQuote(list)
                    const result = quotes.map(q => ({ symbol: q.symbol, price: q.price, changePercent: q.changePercent, volume: q.volume }))
                    onEvent({ type: 'tool_end', tool: 'getMarketMovers', result: { count: result.length, top: result.slice(0, 3) } })
                    return result
                } catch (err: any) {
                    const result = { error: `Failed: ${err.message}` }
                    onEvent({ type: 'tool_end', tool: 'getMarketMovers', result })
                    return result
                }
            }
        } as any,
        queryMarketDatabase: {
            description: 'Query iStocks PostgreSQL market database. Operations: latestIndicators, priceHistory, highestVolumeDays, topRankedStocks, stocksBySector. Use stocksBySector to list all stocks in a sector (IT, Banking, Pharma, Auto, FMCG, Metal, Energy, Realty, etc). Use topRankedStocks for best-stock rankings. Use latestIndicators for stored RSI/MACD/ATR for specific stocks.',
            inputSchema: jsonSchema<{
                operation: MarketDatabaseOperation
                symbols?: string[]
                sector?: string
                days?: number
                limit?: number
            }>({
                type: 'object',
                properties: {
                    operation: {
                        type: 'string',
                        enum: ['latestIndicators', 'priceHistory', 'highestVolumeDays', 'topRankedStocks', 'stocksBySector'],
                        description: 'latestIndicators, priceHistory, highestVolumeDays, topRankedStocks, or stocksBySector.',
                    },
                    symbols: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Stock symbols or company names. Required for latestIndicators/priceHistory/highestVolumeDays.',
                    },
                    sector: {
                        type: 'string',
                        description: 'Sector name for stocksBySector operation, e.g. "IT", "Banking", "Pharma", "Auto", "FMCG", "Metal", "Energy", "Realty".',
                    },
                    days: {
                        type: 'number',
                        description: 'Lookback trading days, capped at 180. Default 30.',
                    },
                    limit: {
                        type: 'number',
                        description: 'Max rows/results, capped at 50. Default 10.',
                    },
                },
                required: ['operation'],
                additionalProperties: false,
            }),
            execute: async (args: any) => {
                assertNotStopped(shouldStop)
                onEvent({
                    type: 'tool_start',
                    tool: 'queryMarketDatabase',
                    args: {
                        operation: args?.operation,
                        symbols: Array.isArray(args?.symbols) ? args.symbols.slice(0, 5).join(', ') : '',
                        days: args?.days,
                        limit: args?.limit,
                    },
                })
                try {
                    assertNotStopped(shouldStop)
                    const result = await runMarketDatabaseQuery(args || {}, allStocks)
                    onEvent({
                        type: 'tool_end',
                        tool: 'queryMarketDatabase',
                        result: {
                            operation: result.operation,
                            status: result.status,
                            rowCount: Array.isArray((result as any).rows) ? (result as any).rows.length : 0,
                        },
                    })
                    return result
                } catch (err: any) {
                    const result = { operation: args?.operation || 'latestIndicators', status: 'ERROR', message: `Database query failed: ${err.message}` }
                    onEvent({ type: 'tool_end', tool: 'queryMarketDatabase', result })
                    return result
                }
            },
        } as any,
    }

    tools.dynamicScreener = {
        description: 'Smart multi-criteria stock screener. Call with the exact user query. Handles complex criteria: "best undervalued stocks", "PSU stocks under ₹500 with bounce potential", "oversold IT stocks with good fundamentals", "multibagger picks", "top fundamentally strong mid-caps". Returns ranked candidates with entry/SL/target/R:R. Use this for ANY stock discovery with criteria — NOT for single-stock analysis or PMS/MF queries.',
        inputSchema: jsonSchema<{ query: string }>({
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The exact user stock discovery query, e.g. "best undervalued stocks", "PSU stocks under ₹500 with bounce potential", "oversold IT stocks"' },
            },
            required: ['query'],
            additionalProperties: false,
        }),
        execute: async ({ query }: any) => {
            assertNotStopped(shouldStop)
            onEvent({ type: 'tool_start', tool: 'dynamicScreener', args: { query } })
            try {
                assertNotStopped(shouldStop)
                const criteria = await enhancePrompt(String(query || ''))
                onEvent({ type: 'thinking', step: `🔍 Screener intent: ${criteria.label}${criteria.sector ? ` (${criteria.sector})` : ''}` })
                assertNotStopped(shouldStop)
                const result = await runDynamicScreener(criteria, (stepText) => {
                    onEvent({ type: 'thinking', step: stepText })
                    assertNotStopped(shouldStop)
                })
                if (result.candidates.length === 0) {
                    const out = {
                        status: 'EMPTY',
                        criteria: criteria.label,
                        message: 'No stocks passed all filters for this criteria. Try broadening the query.',
                    }
                    onEvent({ type: 'tool_end', tool: 'dynamicScreener', result: out })
                    return out
                }
                const out = {
                    criteria: criteria.label,
                    sector: criteria.sector ?? null,
                    universeCount: result.universeCount,
                    scoredCount: result.scoredCount,
                    yahooFallback: result.yahooFallback,
                    candidates: result.candidates.map((c: any, i: number) => ({
                        rank: i + 1,
                        symbol: c.symbol,
                        price: c.close,
                        score: c.score,
                        rsi14: c.rsi14,
                        sma50: c.sma50,
                        sma200: c.sma200,
                        trendGapPct: c.trendGapPct,
                        macdHist: c.macdHist,
                        volumeRatio: c.volumeRatio,
                        trend: c.sma200 && c.close ? (c.close > c.sma200 ? 'Uptrend' : 'Downtrend') : null,
                        entry: c.levels?.entry ?? null,
                        stopLoss: c.levels?.stopLoss ?? null,
                        target: c.levels?.target ?? null,
                        riskReward: c.levels?.riskReward ?? null,
                        holdingLabel: c.levels?.holdingLabel ?? null,
                        setupType: c.levels?.setupType ?? null,
                    })),
                }
                onEvent({ type: 'tool_end', tool: 'dynamicScreener', result: { criteria: criteria.label, found: result.candidates.length } })
                return out
            } catch (err: any) {
                const out = { error: `Dynamic screener failed: ${err.message}` }
                onEvent({ type: 'tool_end', tool: 'dynamicScreener', result: out })
                return out
            }
        },
    } as any

    tools.screenByPriceRange = {
        description: 'Screen Indian stocks by live share price range. Use when user asks for stocks within a specific price band — e.g. "stocks in ₹100-300", "good stocks under ₹500", "stocks between 200 and 400 to buy". Returns top stocks ranked by confidence score with Entry/SL/Target/R:R levels. Do NOT call this for market-cap or revenue filters — only for share price range.',
        inputSchema: jsonSchema<{ min: number; max: number; limit?: number }>({
            type: 'object',
            properties: {
                min: { type: 'number', description: 'Minimum share price in INR (inclusive)' },
                max: { type: 'number', description: 'Maximum share price in INR (inclusive)' },
                limit: { type: 'number', description: 'Max stocks to return. Default 7.' },
            },
            required: ['min', 'max'],
            additionalProperties: false,
        }),
        execute: async ({ min, max, limit }: any) => {
            assertNotStopped(shouldStop)
            onEvent({ type: 'tool_start', tool: 'screenByPriceRange', args: { min, max, limit: limit ?? 7 } })
            try {
                assertNotStopped(shouldStop)
                const result = await screenByPriceRange(Number(min), Number(max), Number(limit ?? 7))
                onEvent({ type: 'tool_end', tool: 'screenByPriceRange', result: { found: result.stocks.length, totalInRange: result.totalInRange, totalLiquid: result.totalLiquid } })
                if (result.stocks.length === 0) {
                    return { error: `No liquid stocks found in ₹${min}–₹${max} range. ${result.totalInRange} symbols were in price range but none passed the volume filter (>50k shares/day).` }
                }
                return {
                    priceRange: result.priceRange,
                    totalInRange: result.totalInRange,
                    totalLiquid: result.totalLiquid,
                    dataSource: result.dataSource,
                    stocks: result.stocks.map(s => ({
                        symbol: s.symbol,
                        name: s.name,
                        livePrice: s.livePrice,
                        changePercent: s.changePercent,
                        volume: s.volume,
                        confidenceScore: s.confidenceScore,
                        sentimentScore: s.sentimentScore,
                        totalScore: s.totalScore,
                        entry: s.levels?.entry_price ?? null,
                        stopLoss: s.levels?.stop_loss ?? null,
                        target: s.levels?.target_price ?? null,
                        riskReward: s.levels?.risk_reward_ratio ?? null,
                        setupType: s.levels?.setup_type ?? null,
                        recentNews: s.sentimentHeadlines.slice(0, 1),
                    })),
                }
            } catch (err: any) {
                const result = { error: `Price-range screen failed: ${err.message}` }
                onEvent({ type: 'tool_end', tool: 'screenByPriceRange', result })
                return result
            }
        },
    } as any

    tools.queryPMSBazaar = {
        description: 'Search PMS Bazaar (pmsbazaar.com) — India\'s #1 PMS & AIF portal — for any query about Portfolio Management Services, AIF funds, specific fund managers, PMS returns, PMS vs mutual funds, minimum investment, or any PMS/AIF-related question. Returns live data scraped directly from PMS Bazaar.',
        inputSchema: jsonSchema<{ query: string }>({
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Natural language query, e.g. "Marcellus PMS returns and strategy", "best PMS funds 1 year return", "minimum investment in PMS India", "PMS vs mutual fund difference"' },
            },
            required: ['query'],
            additionalProperties: false,
        }),
        execute: async ({ query }: any) => {
            assertNotStopped(shouldStop)
            onEvent({ type: 'tool_start', tool: 'queryPMSBazaar', args: { query } })
            try {
                assertNotStopped(shouldStop)
                const result = await queryPMSBazaar(query)
                if (!result.success || result.results.length === 0) {
                    const out = { error: result.error ?? 'No PMS Bazaar results found for this query.' }
                    onEvent({ type: 'tool_end', tool: 'queryPMSBazaar', result: out })
                    return out
                }
                const formatted = formatPMSResultsForAI(result)
                onEvent({ type: 'tool_end', tool: 'queryPMSBazaar', result: { sources: result.results.length, firstTitle: result.results[0]?.title } })
                return { sources: result.results.length, data: formatted }
            } catch (err: any) {
                const out = { error: `PMS Bazaar query failed: ${err.message}` }
                onEvent({ type: 'tool_end', tool: 'queryPMSBazaar', result: out })
                return out
            }
        },
    } as any

    if (enableWebSearch) {
        tools.webSearch = {
            description: 'Search the web for anything: find a stock ticker, check if a company is listed, get latest news, or solve any problem you are stuck on. Use this whenever other tools fail or you need more context.',
            inputSchema: jsonSchema<{ query: string }>({
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Free-form search query, e.g. "Swiggy NSE symbol India stock", "Ola Electric IPO listed exchange", "Reliance latest news 2026"' }
                },
                required: ['query'],
                additionalProperties: false
            }),
            execute: async ({ query }: any) => {
                assertNotStopped(shouldStop)
                onEvent({ type: 'tool_start', tool: 'webSearch', args: { query } })
                try {
                    assertNotStopped(shouldStop)
                    const res = await searchGoogle(query, '', '', 5)
                    if (!res.success || res.results.length === 0) {
                        const result = { error: res.error || 'No results found.' }
                        onEvent({ type: 'tool_end', tool: 'webSearch', result })
                        return result
                    }
                    const result = res.results.map(r => ({
                        title: r.name,
                        snippet: r.snippet,
                        date: r.datePublished ?? null,
                    }))
                    onEvent({ type: 'tool_end', tool: 'webSearch', result: { count: result.length, first: result[0]?.title } })
                    return result
                } catch (err: any) {
                    const result = { error: `Web search failed: ${err.message}` }
                    onEvent({ type: 'tool_end', tool: 'webSearch', result })
                    return result
                }
            }
        } as any
    }

    return tools
}

// ── Main Engine ─────────────────────────────────────────────────────

export async function runAIEngine(
    message: string,
    history: ConversationTurn[],
    onEvent: OnEvent,
    /**
     * Optional referer URL (for detecting stock from /stock/SYMBOL page).
     * Only relevant for web requests.
     */
    referer?: string,
    options?: {
        shouldStop?: () => boolean
        conversationMemory?: ConversationMemory
        /**
         * User-selected Compute model id (e.g. "compute-1.0"). Deprecated or unknown
         * values silently resolve to the default Compute.
         */
        computeModel?: ComputeModelId | string | null
        /**
         * Called whenever tokens are consumed so the route handler can flush
         * them to the DB.  (inputTokens, outputTokens) — both may be 0 if the
         * SDK doesn't expose usage metadata for a particular call.
         */
        onTokens?: (inputTokens: number, outputTokens: number) => void
    }
): Promise<void> {
    const computeModelId = coerceComputeModelId(options?.computeModel)
    const computeAiSdk = getComputeAiSdkModel(computeModelId)
    const computeLegacy = (cfg?: { temperature?: number }) => getComputeLegacyModel(computeModelId, cfg)
    const historyText = historyToText(history)
    let webSearchAvailable = true
    let webSearchFailureReason: string | null = null
    let emittedTradeIntent = false
    let fallbackTargets: StockLite[] = []
    const shouldStop = options?.shouldStop
    const detectedLang = detectMessageLanguage(message)

    // Token accounting — fire-and-forget callback supplied by route handlers
    const onTokens = options?.onTokens
    /** Extract tokens from a legacy generateContent response and report them. */
    const trackLegacy = (resp: any) => {
        if (!onTokens) return
        try {
            const meta = resp?.response?.usageMetadata ?? resp?.usageMetadata
            const i = meta?.promptTokenCount ?? 0
            const o = meta?.candidatesTokenCount ?? meta?.completionTokenCount ?? 0
            if (i > 0 || o > 0) onTokens(i, o)
        } catch { /* non-critical */ }
    }
    /** Extract tokens from an AI SDK generateText result and report them. */
    const trackAiSdk = (result: { usage?: { inputTokens?: number; outputTokens?: number } }) => {
        if (!onTokens) return
        try {
            const i = result.usage?.inputTokens ?? 0
            const o = result.usage?.outputTokens ?? 0
            if (i > 0 || o > 0) onTokens(i, o)
        } catch { /* non-critical */ }
    }
    let workingMemory = normalizeConversationMemory(options?.conversationMemory)
    const persistMemory = (patch: Partial<ConversationMemory>) => {
        workingMemory = mergeConversationMemory(workingMemory, patch)
        onEvent({ type: 'memory_update', memory: workingMemory })
    }
    const answerWithMemory = (
        answerMessage: string,
        patch: Partial<ConversationMemory>,
        extra?: { webSources?: { name: string; url: string }[] }
    ) => {
        persistMemory(patch)
        onEvent({ type: 'answer', message: answerMessage, webSources: extra?.webSources })
    }

    const hasContext = !!(workingMemory.activeSymbol || workingMemory.activeIndicator || history.length > 0)
    onEvent({ type: 'routing_options', options: buildReplyPathOptions(message, hasContext) })

    try {
        assertNotStopped(shouldStop)
        if (isGreetingMessage(message)) {
            onEvent({ type: 'thinking', step: '👋 Handling greeting...' })
            answerWithMemory(buildGreetingAnswer(detectedLang), {
                activeSymbol: workingMemory.activeSymbol,
                activeStockName: workingMemory.activeStockName,
                activeIndicator: workingMemory.activeIndicator,
                lastIntent: 'general',
                lastResponseKind: 'general',
            })
            return
        }

        // Educational indicator glossary queries should not depend on web search
        // or prior stock context, otherwise user gets irrelevant stock replies.
        const indicatorExplain = detectIndicatorExplainQuery(message)
        if (indicatorExplain) {
            assertNotStopped(shouldStop)
            const lang = detectMessageLanguage(message)
            onEvent({ type: 'thinking', step: `📘 Explaining ${indicatorExplain}...` })
            answerWithMemory(buildIndicatorExplainAnswer(indicatorExplain, lang), {
                activeIndicator: indicatorExplain,
                lastIntent: 'general',
                lastResponseKind: 'indicator_explain',
            })
            return
        }

        // ── Load stock list + recent conversation context early ─────────────────
        assertNotStopped(shouldStop)
        const allStocks = await prisma.stock.findMany({ select: { id: true, symbol: true, name: true, sector: true } })
        const refMatch = referer?.match(/\/stocks?\/([a-z0-9]+)/i)
        const refSymbol = refMatch ? refMatch[1].toUpperCase() : null
        const pageStock = refSymbol ? allStocks.find((stock) => stock.symbol === refSymbol) ?? null : null
        const memoryStock = resolveMemoryStock(workingMemory, allStocks)
        const recentRecommendedStock = findRecentRecommendedStockContext(history, allStocks)
        const recentStock = findRecentStockContext(history, allStocks)
        const recentIndicator = findRecentIndicatorContext(history)
        const contextualStock = pageStock ?? recentRecommendedStock ?? recentStock ?? memoryStock
        const contextualIndicator = workingMemory.activeIndicator ?? recentIndicator
        const requestedIndicator = extractIndicatorMention(message) ?? contextualIndicator

        let mentioned = matchStocksInMessage(message, allStocks)
        mentioned = preferContextualStockForAmbiguousMatches(message, mentioned, contextualStock)

        // ── DeepSeek: classify query category ──────────────────────────────
        onEvent({ type: 'thinking', step: '🧠 Understanding your question...' })
        assertNotStopped(shouldStop)
        const queryCategory = await classifyQueryCategory(message)
        onEvent({ type: 'thinking', step: `🏷️ Category → ${queryCategory}` })

        // Map to intentSource for existing path routing
        let intentSource: RouteSource =
            queryCategory === 'trade' ? 'ec2_live' :
            queryCategory === 'web_news' ? 'web_search' :
            'yahoo_agent'

        // Screener/market queries must not inherit a single context stock from history
        const isScreeningQuery = queryCategory === 'screener' || queryCategory === 'market'
        const usingContextStock = mentioned.length === 0 && !!contextualStock && !isScreeningQuery && isLikelyStockFollowUp(message)
        if (usingContextStock) {
            mentioned = [contextualStock!]
        }
        if (usingContextStock && intentSource === 'web_search' && queryCategory !== 'web_news') {
            intentSource = 'yahoo_agent'
        }

        let targetList = mentioned.length > 0 ? mentioned : pageStock ? [pageStock] : []
        const tradeCommandIntent = resolveTradeCommandIntent(
            message,
            history,
            allStocks,
            contextualStock,
            workingMemory.activeSymbol
        )
        const directTradeIntent = tradeCommandIntent
            ? { action: tradeCommandIntent.action, quantity: tradeCommandIntent.quantity }
            : (detectTradeIntent(message) ?? await classifyTradeIntent(message))
        if (tradeCommandIntent?.preferredStock) {
            const mentionedWinner = mentioned.find(
                (stock) => stock.symbol !== tradeCommandIntent.preferredStock!.symbol
            )
            if (mentioned.length > 0 && mentionedWinner && !mentioned.some(
                (stock) => stock.symbol === tradeCommandIntent.preferredStock!.symbol
            )) {
                targetList = [mentionedWinner]
            } else {
                targetList = [tradeCommandIntent.preferredStock]
            }
        } else if (directTradeIntent && targetList.length === 0 && contextualStock) {
            targetList = [contextualStock]
        }
        if (directTradeIntent && targetList.length > 1) {
            // For direct orders, take the best-ranked symbol only.
            targetList = targetList.slice(0, 1)
        }
        fallbackTargets = targetList
        const marketSymbolHint = targetList.length === 0 ? extractKnownMarketSymbol(message) : null

        // ── PATH: EC2 Live ──────────────────────────────────────────────────
        if (intentSource === 'ec2_live') {
            if (targetList.length === 0) {
                if (marketSymbolHint) {
                    onEvent({ type: 'thinking', step: `📡 Fetching live quote for ${marketSymbolHint}...` })
                    assertNotStopped(shouldStop)
                    const quoteResult = await fetchLiveMarketQuote(marketSymbolHint)
                    if (quoteResult.ok) {
                        answerWithMemory(buildMarketQuoteText(quoteResult.quote, message), {
                            activeSymbol: quoteResult.quote.symbol,
                            activeStockName: quoteResult.quote.name,
                            activeIndicator: extractIndicatorMention(message) ?? workingMemory.activeIndicator,
                            lastIntent: 'ec2_live',
                            lastResponseKind: 'price',
                        })
                        return
                    }
                    if (quoteResult.reason === 'unsupported') {
                        answerWithMemory(quoteResult.message, {
                            activeIndicator: extractIndicatorMention(message) ?? workingMemory.activeIndicator,
                            lastIntent: 'ec2_live',
                            lastResponseKind: 'general',
                        })
                        return
                    }
                    // Primary Yahoo quote failed — try cascading (batchQuote → OHLCV) before giving up
                    onEvent({ type: 'thinking', step: `⚠️ Primary quote unavailable. Trying Yahoo fallback...` })
                    assertNotStopped(shouldStop)
                    const cascadingForMarket = await fetchCascadingPrice(marketSymbolHint)
                    if (cascadingForMarket && cascadingForMarket.price > 0) {
                        const sourceLabel = cascadingForMarket.source === 'yahoo_quote' ? '🟡 Yahoo Quote'
                            : cascadingForMarket.source === 'ohlcv_close' ? '🔵 Last Close' : '🟢 Realtime'
                        const changeStr = cascadingForMarket.changePercent != null
                            ? ` (${cascadingForMarket.changePercent >= 0 ? '+' : ''}${cascadingForMarket.changePercent.toFixed(2)}%)`
                            : ''
                        answerWithMemory(
                            `**${marketSymbolHint}** is at **₹${cascadingForMarket.price.toFixed(2)}**${changeStr} [${sourceLabel}]`,
                            { activeSymbol: marketSymbolHint, lastIntent: 'ec2_live', lastResponseKind: 'price' }
                        )
                        return
                    }
                    onEvent({ type: 'thinking', step: `⚠️ All price sources unavailable for ${marketSymbolHint}. Switching to analysis...` })
                }
                // No stock matched — fall through to yahoo_agent which can findStock by name
                intentSource = 'yahoo_agent'
            } else {
                onEvent({ type: 'thinking', step: `📡 Fetching live data for ${targetList.map(s => s.symbol).join(', ')}...` })
                if (targetList.length === 1) {
                    const stock = targetList[0]
                    assertNotStopped(shouldStop)
                    const [snapshot, last30Closes] = await Promise.all([
                        fetchEC2LiveSnapshot(stock.symbol),
                        fetchLast30Closes(stock.symbol),
                    ])
                    if (!snapshot.available || !snapshot.ltp || snapshot.ltp <= 0) {
                        // EC2 unavailable → try cascading fallback (Yahoo quote → OHLCV close)
                        onEvent({ type: 'thinking', step: `📊 EC2 unavailable. Fetching from Yahoo/Historical...` })
                        const cascadingPrice = await fetchCascadingPrice(stock.symbol)
                        console.log(`[AI Engine] Cascading price result for ${stock.symbol}:`, cascadingPrice)
                        if (cascadingPrice && cascadingPrice.price > 0) {
                            onEvent({ type: 'thinking', step: `✅ Got price from ${cascadingPrice.source}: ₹${cascadingPrice.price.toFixed(2)}` })
                            // Use cascading price for direct answer (no full snapshot analysis)
                            const sourceLabel = cascadingPrice.source === 'ec2_realtime' ? '🟢 Realtime' :
                                               cascadingPrice.source === 'yahoo_quote' ? '🟡 Yahoo Quote' : '🔵 Last Close'
                            const changeStr = cascadingPrice.changePercent != null
                                ? `${cascadingPrice.changePercent >= 0 ? '+' : ''}${cascadingPrice.changePercent.toFixed(2)}%`
                                : ''
                            const priceAnswer = `${stock.name} (${stock.symbol}) is currently trading at **₹${cascadingPrice.price.toFixed(2)}** ${changeStr} [${sourceLabel}]`
                            answerWithMemory(priceAnswer, {
                                activeSymbol: stock.symbol,
                                activeStockName: stock.name,
                                activeIndicator: null,
                                lastIntent: 'ec2_live',
                                lastResponseKind: 'price',
                            })
                            return
                        } else {
                            // All cascade methods failed → switch to yahoo_agent
                            console.warn(`[AI Engine] Cascading price fetch failed for ${stock.symbol}, falling back to yahoo_agent`)
                            onEvent({ type: 'thinking', step: `⚠️ All price sources unavailable. Switching to technical analysis...` })
                            intentSource = 'yahoo_agent'
                        }
                    } else if (snapshot.available && snapshot.ltp && snapshot.ltp > 0) {
                        const directLiveIndicatorAnswer = buildLiveIndicatorValueAnswer(stock, snapshot, message, detectedLang)
                        if (directLiveIndicatorAnswer) {
                            answerWithMemory(directLiveIndicatorAnswer, {
                                activeSymbol: stock.symbol,
                                activeStockName: stock.name,
                                activeIndicator: extractIndicatorMention(message) ?? contextualIndicator,
                                lastIntent: 'ec2_live',
                                lastResponseKind: 'indicator_value',
                            })
                            return
                        }

                        onEvent({ type: 'thinking', step: '✅ Live data received. Generating analysis...' })
                        const tradingLevels = (() => {
                            const levels = calculateTradingLevelsFromSnapshot(snapshot)
                            if (!levels) return null
                            if (last30Closes.length >= 2) {
                                levels.holding = calculateHoldingPeriod(levels.entry_price, levels.target_price, last30Closes)
                            }
                            return levels
                        })()
                        const levelsBlock = tradingLevels ? `\n\n${formatTradingLevelsBlock(tradingLevels)}` : ''
                        const dataBlock = formatSnapshotForPrompt(snapshot, stock.name) + levelsBlock
                        const liveModel = computeLegacy({ temperature: 0.2 })
                        const livePrompt = historyText
                            ? `Recent conversation:\n${historyText}\n\nCurrent user question: "${message}"`
                            : `User question: "${message}"`
                        // Detect trade intent & emit structured event for Telegram confirm button
                        const tradeIntent = directTradeIntent
                        if (tradeIntent && snapshot.ltp && snapshot.ltp > 0) {
                            onEvent({
                                type: 'trade_intent',
                                symbol: stock.symbol,
                                stockName: stock.name,
                                action: tradeIntent.action,
                                quantity: tradeIntent.quantity,
                                price: snapshot.ltp,
                            })
                            emittedTradeIntent = true
                        }
                        assertNotStopped(shouldStop)
                        const resp = await liveModel.generateContent(
                            `You are iStocks AI — a professional Indian stock trading advisor.\n\n` +
                            `⚠️ DATA RULE: Use ONLY the live data block below. Do NOT use your own training knowledge for prices, indicators, or market conditions.\n\n` +
                            `${dataBlock}\n\n${livePrompt}\n\n` +
                            `Rules:\n` +
                            `- Answer using ONLY the numbers from the live data block above.\n` +
                            `- The CALCULATED TRADING LEVELS section in the data block contains deterministic Entry, Target, Stop-Loss, Support, Resistance values — always reference these in your answer.\n` +
                            `- If user wants to BUY/SELL (e.g. "buy 100 shares"), calculate total cost (price × qty), give sentiment (bullish/bearish based on indicators), and give a clear recommendation.\n` +
                            `- Be concise and direct. Always give a clear recommendation.\n` +
                            `- Never say "As an AI" or "consult a financial advisor".\n` +
                            `- Always reply in the EXACT SAME LANGUAGE the user wrote in.`
                        )
                        trackLegacy(resp)
                        const liveText = resp.response.text()
                        if (looksLikeWeakLiveReply(liveText)) {
                            onEvent({ type: 'thinking', step: `⚠️ Live response quality low for ${stock.symbol}. Switching to technical analysis...` })
                            intentSource = 'yahoo_agent'
                        } else {
                            let finalLiveText = postProcessStructuredAnswer(message, liveText)
                            // Always append the trading levels summary if not already present in the answer
                            if (tradingLevels && !hasEntryStopTarget(finalLiveText)) {
                                finalLiveText += `\n\n${formatTradingLevelsSummary(tradingLevels)}`
                            }
                            finalLiveText = await maybeRewriteLanguage(finalLiveText, detectMessageLanguage(message))
                            answerWithMemory(finalLiveText, {
                                activeSymbol: stock.symbol,
                                activeStockName: stock.name,
                                activeIndicator: extractIndicatorMention(message) ?? contextualIndicator,
                                lastIntent: 'ec2_live',
                                lastResponseKind: directTradeIntent ? 'trade' : /\b(price|value|current|quote|cmp|ltp|level)\b/i.test(message) ? 'price' : 'analysis',
                            })
                        }
                    }
                } else {
                    assertNotStopped(shouldStop)
                    const allLivePrices = await fetchEC2AllPrices()
                    const rows = targetList.map(s => {
                        const ltp = allLivePrices[s.symbol]
                        return ltp != null ? `${s.name} (${s.symbol}): ₹${ltp.toFixed(2)}` : `${s.name} (${s.symbol}): data not available`
                    }).join('\n')
                    const multiModel = computeLegacy({ temperature: 0.1 })
                    assertNotStopped(shouldStop)
                    const multiResp = await multiModel.generateContent(
                        `You are iStocks AI. Here are the LIVE prices fetched right now:\n${rows}\n\n` +
                        `⚠️ DATA RULE: Use ONLY the prices listed above. Do NOT use your own training knowledge.\n\n` +
                        `User asked: "${message}"\n\n` +
                        `Answer using only the live data above. Be concise. No jargon about data sources.\n\n` +
                        `IMPORTANT: Reply in the same language the user used.`
                    )
                    trackLegacy(multiResp)
                    let finalMultiText = postProcessStructuredAnswer(message, multiResp.response.text())
                    finalMultiText = await maybeRewriteLanguage(finalMultiText, detectMessageLanguage(message))
                    const responseStock = resolveAnswerStockContext(finalMultiText, targetList, allStocks)
                    answerWithMemory(finalMultiText, {
                        activeSymbol: responseStock?.symbol ?? workingMemory.activeSymbol,
                        activeStockName: responseStock?.name ?? workingMemory.activeStockName,
                        activeIndicator: extractIndicatorMention(message) ?? contextualIndicator,
                        lastIntent: 'ec2_live',
                        lastResponseKind: targetList.length > 1 ? 'analysis' : 'price',
                    })
                }
                if (intentSource !== 'yahoo_agent') return  // only return if we didn't fall through
            }
        }

        // ── PATH: Web Search ────────────────────────────────────────────────
        if (intentSource === 'web_search') {
            onEvent({ type: 'thinking', step: '🔍 Searching the web for latest news...' })
            const targetSymbol = targetList[0]?.symbol ?? ''
            const targetName = targetList[0]?.name ?? ''

            // Build a richer search query. When the user asks a vague follow-up
            // (e.g. "why finance down?"), inject the stock context so the query is
            // specific enough for Serper to return relevant articles.
            const stockContext = targetName || workingMemory.activeStockName || ''
            const symbolContext = targetSymbol || workingMemory.activeSymbol || ''
            const searchMessage = stockContext && message.length < 60
                ? `${stockContext} (${symbolContext}) ${message}`.trim()
                : message

            assertNotStopped(shouldStop)

            // Detect financial data queries — run verified crawl in parallel with Serper
            const isFinancial = isFinancialDataQuery(message)
            const financialSymbol = symbolContext || (targetList[0]?.symbol ?? '')

            // Run Serper news + Firecrawl social + (if financial) verified crawl in parallel
            const [combinedResultsRaw, financialVerified] = await Promise.allSettled([
                searchWithSocialContext(searchMessage, symbolContext, stockContext, 8, {
                    recencyDays: 7,
                    requireFresh: false,
                    requireDatedForFresh: false,
                    sortByDate: true,
                }),
                isFinancial && financialSymbol
                    ? (onEvent({ type: 'thinking', step: `📊 Fetching verified financials from screener.in + cross-verifying...` }),
                       fetchVerifiedFinancials(financialSymbol, message))
                    : Promise.resolve(null),
            ])

            let combinedResults = combinedResultsRaw.status === 'fulfilled'
                ? combinedResultsRaw.value
                : { success: false, results: [] as any[], socialSnippet: undefined }

            const verifiedFinancials = financialVerified.status === 'fulfilled' ? financialVerified.value : null

            // Fallback: if Serper returned nothing, retry without date restriction.
            if (!combinedResults.success || combinedResults.results.length === 0) {
                assertNotStopped(shouldStop)
                onEvent({ type: 'thinking', step: '🔍 Broadening search window...' })
                const retried = await searchWithSocialContext(searchMessage, symbolContext, stockContext, 8, { sortByDate: true })
                combinedResults = retried
            }

            // Alias for compatibility with the rest of the block
            const googleResults = combinedResults

            if (googleResults.success && googleResults.results.length > 0) {
                const socialCount = combinedResults.socialSnippet ? ' + social posts' : ''
                const financialNote = verifiedFinancials?.primaryContent ? ' + verified financials' : ''
                onEvent({ type: 'thinking', step: `✅ Found ${googleResults.results.length} news sources${socialCount}${financialNote}. Summarizing...` })
                const webCtx = formatSearchResultsForAI(googleResults.results)
                const socialCtx = combinedResults.socialSnippet ?? ''
                const financialCtx = verifiedFinancials ? formatVerifiedFinancialsForAI(verifiedFinancials) : ''
                const webModel = computeLegacy({ temperature: 0.3 })
                const webUserBlock = historyText
                    ? `Recent conversation:\n${historyText}\n\nCurrent user query: "${message}"`
                    : `User: "${message}"`
                assertNotStopped(shouldStop)
                const resp = await webModel.generateContent(
                    `You are iStocks AI — a professional Indian stock market advisor with deep web research capability, like Grok.\n\n` +
                    `${stockContext ? `Stock in focus: ${stockContext}${symbolContext ? ` (${symbolContext})` : ''}` : 'General market / finance query'}\n` +
                    `${webUserBlock}\n\n` +
                    (financialCtx
                        ? `${financialCtx}\n\n`
                        : '') +
                    `Web search results (fetched live):\n${webCtx}` +
                    `${socialCtx}\n\n` +
                    `Your job: give a thorough, well-structured answer using ALL relevant information from the data above.\n` +
                    `Guidelines:\n` +
                    `- ${financialCtx ? 'PRIORITIZE the Verified Financial Data section — it is crawled directly from screener.in and cross-verified. Use those numbers as the ground truth.\n- ' : ''}Synthesize across ALL sources, not just one. Highlight where sources agree or differ.\n` +
                    `- Include specific facts: numbers, percentages, dates, executive names, product/segment details when available.\n` +
                    `- ${financialCtx ? 'For quarterly data: show it as a proper table (Quarter | Revenue | Net Profit | YoY change). Mark estimates vs confirmed figures.\n- ' : ''}Structure your answer with clear sections if the question is multi-part.\n` +
                    `- Cite sources inline (e.g. "Screener.in", "Economic Times", "LinkedIn analyst post...").\n` +
                    `- ${financialCtx ? `Confidence level for this data: ${verifiedFinancials?.confidenceNote ?? 'unknown'}\n- ` : ''}If LinkedIn/X posts are available, highlight the trader/analyst sentiment separately.\n` +
                    `- Always end with a clear bottom line: outlook, recommendation, or key takeaway.\n` +
                    `- Never say "As an AI" or "consult a financial advisor".\n\n` +
                    `IMPORTANT: Always reply in the EXACT SAME LANGUAGE the user wrote in.`
                )
                trackLegacy(resp)
                let finalWebText = postProcessStructuredAnswer(message, resp.response.text())
                finalWebText = await maybeRewriteLanguage(finalWebText, detectMessageLanguage(message))
                const responseStock = resolveAnswerStockContext(finalWebText, targetList, allStocks)
                answerWithMemory(finalWebText, {
                    activeSymbol: responseStock?.symbol ?? workingMemory.activeSymbol,
                    activeStockName: responseStock?.name ?? workingMemory.activeStockName,
                    activeIndicator: extractIndicatorMention(message) ?? contextualIndicator,
                    lastIntent: 'web_search',
                    lastResponseKind: 'news',
                }, {
                    webSources: googleResults.results.map(r => ({ name: r.name, url: r.url })),
                })
                return
            } else {
                webSearchFailureReason = ('error' in googleResults ? googleResults.error : undefined) || null
                if (isWebSearchInfraError(webSearchFailureReason)) {
                    webSearchAvailable = false
                    onEvent({ type: 'thinking', step: '⚠️ Web news feed unavailable right now. Switching to technical analysis...' })
                } else {
                    onEvent({ type: 'thinking', step: '⚠️ Web search returned no results. Switching to stock analysis...' })
                }
                intentSource = 'yahoo_agent'
            }
        }

        // ── PATH: Yahoo Agent (AI + Tools) ──────────────────────────────────
        onEvent({ type: 'thinking', step: '🤖 Starting stock analysis agent...' })

        const agentTools = buildAgentTools(onEvent, { enableWebSearch: webSearchAvailable, shouldStop, allStocks })
        const filteredTools = filterToolsForCategory(agentTools, queryCategory, webSearchAvailable)
        const webSearchReasonNote = webSearchFailureReason
            ? `\n- Last webSearch failure: ${webSearchFailureReason}`
            : ''
        const agentSystemPrompt = webSearchAvailable
            ? `${getDateContext()}\n${SYSTEM_PROMPT}`
            : `${getDateContext()}\n${SYSTEM_PROMPT}\n\n` +
              `RUNTIME OVERRIDE:\n` +
              `- webSearch tool is currently unavailable due provider access/configuration.\n` +
              `- You only have: findStock, analyzeStock, getMarketMovers, queryMarketDatabase.\n` +
              webSearchReasonNote + `\n` +
              `- Never expose internal tool/API error codes to users.\n` +
              `- If user asked for latest news/reason, provide a technical market view from available data and clearly label it as technical-only.`

        const MAX_STEPS = 6  // extra steps allow webSearch → findStock/analyzeStock retry cycles
        let finalAnswer: string | null = null
        const collectedToolResults: any[] = []
        const historyBlock = historyText ? `Recent conversation:\n${historyText}\n\n` : ''
        const responseContract = buildResponseContract(message)
        const langPin =
            `[REPLY LANGUAGE LOCK]\n` +
            `The user's CURRENT message is in ${detectedLang}.\n` +
            `Your ENTIRE response MUST be in ${detectedLang} only.\n` +
            `Do NOT switch language. Do NOT mix other languages.\n` +
            `If your draft response is in another language, rewrite it in ${detectedLang} before sending.`

        // If user mentioned a stock name that isn't in our DB, pre-call searchSymbol
        // so the agent gets REAL data instead of hallucinating "not publicly traded"
        let stockHint = ''
        if (targetList.length === 0 && !isScreeningQuery) {
            const candidates = extractStockCandidates(message)
            if (candidates.length > 0) {
                onEvent({ type: 'thinking', step: `🔍 Looking up: ${candidates.slice(0, 3).join(', ')}...` })
                // Actually search Yahoo Finance — don't rely on the LLM to call findStock
                const lookupResults: string[] = []
                const resolvedFromLookup: Array<{ id: string; symbol: string; name: string }> = []
                for (const candidate of candidates.slice(0, 3)) {
                    try {
                        assertNotStopped(shouldStop)
                        const results = await searchSymbol(candidate)
                        const top = results.find(r => isSearchResultRelevant(candidate, { symbol: r.symbol, name: r.name }))
                        if (top) {
                            resolvedFromLookup.push({
                                id: `lookup-${top.symbol}`,
                                symbol: top.symbol,
                                name: top.name || top.symbol,
                            })
                            lookupResults.push(`✅ "${candidate}" → Found: ${top.name} (${top.symbol}). Call analyzeStock("${top.symbol}") to get data.`)
                        } else {
                            if (webSearchAvailable) {
                                // Not on Yahoo — try web search to verify listing status
                                try {
                                    assertNotStopped(shouldStop)
                                    const webVerify = await searchGoogle(`${candidate} NSE BSE India stock exchange listed symbol`, '', '', 3)
                                    if (webVerify.results.length > 0) {
                                        const snippets = webVerify.results.slice(0, 2).map((r: any) => `  • ${r.name}: ${r.snippet}`).join('\n')
                                        lookupResults.push(`⚠️ "${candidate}" → Not found on Yahoo Finance. Web search results:\n${snippets}\n  → If it IS listed, call findStock("${candidate}") to get the exact symbol. If web confirms it's private/unlisted, say so.`)
                                    } else {
                                        lookupResults.push(`⚠️ "${candidate}" → Not found on Yahoo Finance, and web results are empty. Keep it as unresolved instead of assuming unlisted.`)
                                    }
                                } catch {
                                    lookupResults.push(`⚠️ "${candidate}" → Not found on Yahoo Finance. Call webSearch("${candidate} NSE BSE India stock listed") to verify before concluding.`)
                                }
                            } else {
                                lookupResults.push(`⚠️ "${candidate}" → Not found on Yahoo Finance. Web verification is currently unavailable, so keep this unresolved and avoid concluding it is unlisted.`)
                            }
                        }
                    } catch {
                        if (webSearchAvailable) {
                            lookupResults.push(`⚠️ "${candidate}" → Search failed. Call findStock("${candidate}") or webSearch("${candidate} NSE BSE India stock") to verify.`)
                        } else {
                            lookupResults.push(`⚠️ "${candidate}" → Search failed and web verification is unavailable. Do not mark it unlisted without evidence.`)
                        }
                    }
                }

                // Promote successful symbol lookups into active targets so downstream routing
                // cannot ignore a resolved stock symbol even if DB matching missed it.
                if (resolvedFromLookup.length > 0) {
                    targetList = resolvedFromLookup
                }

                const lookupGuidance = webSearchAvailable
                    ? `Use the findings above. If a stock was found (✅), call analyzeStock with that exact symbol. If uncertain (⚠️), review the web data above — if it's insufficient, call webSearch to get more info. Only conclude a company is unlisted if web evidence clearly confirms it.`
                    : `Use the findings above. If a stock was found (✅), call analyzeStock with that exact symbol. If uncertain (⚠️), do NOT conclude unlisted because web verification is unavailable.`
                stockHint = `\n\n[PRE-VERIFIED STOCK LOOKUP]\n${lookupResults.join('\n')}\n${lookupGuidance}`
            }
        } else {
            // We already know the stock(s) — tell the agent directly so it doesn't hallucinate
            const resolved = targetList.map(s => `${s.name} (NSE: ${s.symbol})`).join(', ')
            stockHint = `\n\n[RESOLVED STOCKS] The user is asking about: ${resolved}. Use these exact NSE symbols when calling analyzeStock. Do NOT say these companies are unlisted — they are verified in our database.`
        }

        let workingPrompt =
            `${langPin}\n\n` +
            `${responseContract}\n\n` +
            `${historyBlock}Current user message: "${message}"${stockHint}`

        for (let step = 0; step < MAX_STEPS; step++) {
            assertNotStopped(shouldStop)
            const pass = await generateText({
                model: computeAiSdk,
                temperature: 0.2,
                system: agentSystemPrompt,
                prompt: workingPrompt,
                tools: filteredTools,
            })
            trackAiSdk(pass)

            const hasToolResults = !!(pass.toolResults && pass.toolResults.length > 0)
            const hasText = !!(pass.text && pass.text.trim())

            if (hasToolResults) {
                // Tag each result from THIS step as success or failure
                const isResultFailed = (r: any) => {
                    const val = typeof r.result === 'string' ? r.result : JSON.stringify(r.result ?? '')
                    const v = val.toLowerCase()
                    return v.includes('not found') || v.includes('no stocks found') ||
                           v.includes('no results') || v.includes('"error"') ||
                           v.includes('error:') || v.includes('search failed') ||
                           v.includes('failed to fetch') || v.includes('unable to find')
                }
                const thisStepFailed  = pass.toolResults.filter((r: any) => isResultFailed(r))
                const thisStepSuccess = pass.toolResults.filter((r: any) => !isResultFailed(r))

                collectedToolResults.push(...pass.toolResults)
                onEvent({ type: 'thinking', step: `🧩 Processing tool results (${step + 1}/${MAX_STEPS})...` })

                // Check if webSearch already ran and returned real data
                const webSearchSucceeded = collectedToolResults.some((r: any) => {
                    const name = r.toolName || r.name || ''
                    return name === 'webSearch' && Array.isArray(r.result) && r.result.length > 0
                })

                let nextInstruction: string
                if (thisStepFailed.length > 0 && !webSearchSucceeded) {
                    if (webSearchAvailable) {
                        // Tools failed AND we haven't searched the web yet — force webSearch + retry
                        const failedSummary = thisStepFailed.map((r: any) => {
                            const name = r.toolName || r.name || 'tool'
                            const args = JSON.stringify(r.args || {})
                            const err  = typeof r.result === 'string' ? r.result : JSON.stringify(r.result)
                            return `  • ${name}(${args}) → ERROR: ${err}`
                        }).join('\n')
                        nextInstruction =
                            `\n⚡ ITERATION REQUIRED — do NOT finalize yet:\n` +
                            `The following tools failed:\n${failedSummary}\n\n` +
                            `Steps to fix:\n` +
                            `  1. Call webSearch with a precise query to find the correct symbol / verify the company is listed\n` +
                            `  2. Use the web result to retry the failed tool with the correct parameters\n` +
                            `  3. Only give a final answer after you have real data OR web confirms no data exists\n`
                    } else {
                        nextInstruction =
                            `\n⚡ ITERATION REQUIRED — do NOT finalize yet:\n` +
                            `Some tools failed and webSearch is unavailable.\n` +
                            `Retry only with findStock/analyzeStock/getMarketMovers.\n` +
                            `If all retries fail, respond ONLY with what the tools actually returned — do NOT fill gaps from training knowledge.`
                    }
                } else if (thisStepFailed.length > 0 && webSearchSucceeded) {
                    // webSearch ran — tell LLM to extract the symbol from web results and retry
                    nextInstruction =
                        `\nwebSearch has already run. Extract the correct NSE/BSE symbol from the web results above ` +
                        `and retry the failed tool with the correct symbol. If web results also confirm no data, finalize now.`
                } else {
                    // Everything succeeded — synthesize final answer
                    nextInstruction =
                        `\nAll tools returned data successfully. Provide the final answer now in clear markdown ` +
                        `using ONLY the data above.`
                }

                workingPrompt =
                    `${langPin}\n\n${responseContract}\n\n${historyBlock}User asked: "${message}"\n\n` +
                    `All tool outputs so far:\n${JSON.stringify(collectedToolResults, null, 2)}\n\n` +
                    `⚠️ DATA RULE: Use ONLY the tool data above. Do NOT add anything from your training knowledge.` +
                    nextInstruction

                // Only break early when latest step fully succeeded and model has no more tool calls queued
                if (thisStepFailed.length === 0 && (!pass.toolCalls || pass.toolCalls.length === 0)) break
                continue
            }

            if (hasText) {
                // Only accept a text-only answer if tools were actually called first.
                // If the LLM replied on step 0 without calling any tool, it is replying
                // from training knowledge — reject it and force a tool call.
                if (collectedToolResults.length > 0) {
                    finalAnswer = pass.text
                    break
                }
                // No tools called yet — inject a hard reminder and loop again
                workingPrompt =
                    `${langPin}\n\n${responseContract}\n\n` +
                    `${historyBlock}User asked: "${message}"\n\n` +
                    `🚫 You responded without calling any tool. That is not allowed.\n` +
                    `RULE: You MUST call at least one tool before giving any answer.\n` +
                    `Your training data is outdated and CANNOT have today's prices or market data.\n` +
                    `Call the appropriate tool NOW.`
                continue
            }

            workingPrompt =
                `${langPin}\n\n${responseContract}\n\n` +
                `${historyBlock}User asked: "${message}". Provide a final answer now using your tools.`
        }

        // Guaranteed final synthesis when tools ran but model didn't return text
        if (!finalAnswer && collectedToolResults.length > 0) {
            onEvent({ type: 'thinking', step: '✅ Data fetched. Generating final analysis...' })
            assertNotStopped(shouldStop)
            const finalPass = await generateText({
                model: computeAiSdk,
                temperature: 0.2,
                system: agentSystemPrompt,
                prompt: `${getDateContext()}\n${langPin}\n\n${responseContract}\n\n${historyBlock}User asked: "${message}"\n\n` +
                    `Live market data fetched from our tools:\n${JSON.stringify(collectedToolResults, null, 2)}\n\n` +
                    `⚠️ DATA RULE: Your answer MUST be based ONLY on the tool data above. Every number, price, and fact must come from these results. Do NOT add any information from your own training knowledge.\n\n` +
                    `Task: Present the technical analysis from the data above in a super-friendly, clear way.\n` +
                    `- Sort/rank stocks by their technical strength (RSI under 60, positive MACD, price above SMA)\n` +
                    `- For each stock: mention current price, key indicator values, and the technical signal\n` +
                    `- Give entry, SL, target using ATR/SMA formula from your system prompt\n` +
                    `- Be direct, friendly, conversational — like a trading buddy sharing live market data\n` +
                    `- Do NOT ask user for ticker. Reply in the user's language.`
            })
            trackAiSdk(finalPass)
            if (finalPass.text && finalPass.text.trim()) {
                finalAnswer = finalPass.text
            }
        }

        if (finalAnswer && looksLikeInternalToolLeak(finalAnswer) && targetList.length > 0) {
            // Convert internal tool-error style replies into a user-facing technical fallback.
            const stock = targetList[0]
            try {
                onEvent({ type: 'thinking', step: `♻️ Cleaning response for ${stock.symbol}...` })
                assertNotStopped(shouldStop)
                const candles = await fetchOHLCV(stock.symbol, '1y', '1d')
                if (candles.length >= 20) {
                    const ind = computeIndicators(candles)
                    const latestPrice = ind.latestClose
                    if (latestPrice) {
                        const target = ind.sma50 ?? (latestPrice * 1.03)
                        const stop = ind.atr14 ? latestPrice - ind.atr14 * 1.5 : latestPrice * 0.97
                        const rr = stop < latestPrice ? ((target - latestPrice) / (latestPrice - stop)) : 0
                        const trend = ind.macd != null && ind.macdSignal != null && ind.macd > ind.macdSignal ? 'Bullish' : 'Bearish'
                        finalAnswer =
                            `${stock.name} (${stock.symbol}) current price ₹${latestPrice.toFixed(2)}.\n` +
                            `RSI: ${ind.rsi14 != null ? ind.rsi14.toFixed(2) : 'NA'}, ` +
                            `MACD: ${ind.macd != null ? ind.macd.toFixed(2) : 'NA'} ` +
                            `(signal ${ind.macdSignal != null ? ind.macdSignal.toFixed(2) : 'NA'}) — ${trend}.\n` +
                            `Entry: ₹${latestPrice.toFixed(2)} | Target: ₹${target.toFixed(2)} | Stop-Loss: ₹${stop.toFixed(2)} | R/R: ${rr.toFixed(2)}\n` +
                            `Decision: ${trend === 'Bullish' ? 'Buy on dips' : 'Wait for confirmation'}.`
                    }
                }
            } catch {
                // Keep original answer if fallback fails.
            }
        }

        if (finalAnswer && looksLikeNotFoundAnswer(finalAnswer) && targetList.length > 0) {
            // Hard fallback: if the model still hallucinates "not found" for a resolved symbol,
            // bypass it and generate a deterministic technical snapshot from real candles.
            const stock = targetList[0]
            try {
                onEvent({ type: 'thinking', step: `♻️ Retrying with resolved symbol ${stock.symbol}...` })
                assertNotStopped(shouldStop)
                const candles = await fetchOHLCV(stock.symbol, '1y', '1d')
                if (candles.length >= 20) {
                    const ind = computeIndicators(candles)
                    const latestPrice = ind.latestClose
                    if (latestPrice) {
                        const direction = ind.macd != null && ind.macdSignal != null && ind.macd > ind.macdSignal ? 'bullish' : 'bearish'
                        finalAnswer =
                            `${stock.name} (${stock.symbol}) current price ₹${latestPrice.toFixed(2)}.\n` +
                            `RSI: ${ind.rsi14 != null ? ind.rsi14.toFixed(2) : 'NA'}, ` +
                            `MACD: ${ind.macd != null ? ind.macd.toFixed(2) : 'NA'} ` +
                            `(signal ${ind.macdSignal != null ? ind.macdSignal.toFixed(2) : 'NA'}) — ${direction} momentum.`
                    }
                }
            } catch {
                // Keep original answer if fallback also fails.
            }
        }

        if (finalAnswer) {
            finalAnswer = postProcessStructuredAnswer(message, finalAnswer)
        }

        if (finalAnswer) {
            finalAnswer = await maybeRewriteLanguage(finalAnswer, detectedLang)
        }

        const responseStockForTrade = finalAnswer
            ? resolveAnswerStockContext(finalAnswer, targetList, allStocks)
            : null

        // Telegram confirm button depends on trade_intent event. Emit it for
        // analysis-path trades as well (not only live-path), when we can resolve a price.
        if (!emittedTradeIntent && directTradeIntent) {
            const target =
                responseStockForTrade ??
                tradeCommandIntent?.preferredStock ??
                (targetList.length === 1 ? targetList[0] : null)
            if (target) {
                let resolvedPrice =
                    resolveTradePriceFromToolResults(target.symbol, collectedToolResults) ??
                    (finalAnswer ? extractTradePriceFromAnswer(finalAnswer) : null)

                if (resolvedPrice == null || resolvedPrice <= 0) {
                    try {
                        assertNotStopped(shouldStop)
                        const q = await batchQuote([target.symbol])
                        const p = Array.isArray(q) && q.length > 0 ? Number(q[0]?.price) : NaN
                        if (Number.isFinite(p) && p > 0) resolvedPrice = p
                    } catch {
                        // Keep unresolved if quote fetch fails.
                    }
                }

                if (resolvedPrice != null && resolvedPrice > 0) {
                    onEvent({
                        type: 'trade_intent',
                        symbol: target.symbol,
                        stockName: target.name,
                        action: directTradeIntent.action,
                        quantity: directTradeIntent.quantity,
                        price: resolvedPrice,
                    })
                    emittedTradeIntent = true
                }
            }
        }

        if (finalAnswer) {
            const responseStock = responseStockForTrade
            answerWithMemory(finalAnswer, {
                activeSymbol: responseStock?.symbol ?? workingMemory.activeSymbol,
                activeStockName: responseStock?.name ?? workingMemory.activeStockName,
                activeIndicator: extractIndicatorMention(message) ?? contextualIndicator,
                lastIntent: intentSource,
                lastResponseKind: directTradeIntent ? 'trade' : extractIndicatorMention(message) ? 'indicator_value' : /\b(news|reason|why|kyun|update)\b/i.test(message) ? 'news' : /\b(price|value|current|quote|cmp|ltp|level)\b/i.test(message) ? 'price' : 'analysis',
            })
        } else {
            let emergencyAnswer: string | null = null
            try {
                if (fallbackTargets.length === 1) {
                    emergencyAnswer = await buildDeterministicSingleStockFallback(fallbackTargets[0], message)
                }
                if (!emergencyAnswer) {
                    emergencyAnswer = await buildDeterministicMarketFallback(message)
                }
            } catch {
                // Ignore and fall through to static message below.
            }

            if (emergencyAnswer) {
                answerWithMemory(emergencyAnswer, {
                    activeSymbol: workingMemory.activeSymbol,
                    activeStockName: workingMemory.activeStockName,
                    activeIndicator: extractIndicatorMention(message) ?? contextualIndicator,
                    lastIntent: intentSource,
                    lastResponseKind: /\b(news|reason|why|kyun|update)\b/i.test(message)
                        ? 'news'
                        : /\b(price|value|current|quote|cmp|ltp|level)\b/i.test(message)
                        ? 'price'
                        : 'analysis',
                })
            } else {
                onEvent({ type: 'error', message: 'The AI could not generate a response. Please try rephrasing.' })
            }
        }
    } catch (err: any) {
        console.error('❌ AI Engine error:', err?.message || err, err?.stack || '')
        try {
            if (fallbackTargets.length === 1) {
                const emergencySingle = await buildDeterministicSingleStockFallback(fallbackTargets[0], message)
                if (emergencySingle) {
                    onEvent({ type: 'answer', message: emergencySingle })
                    return
                }
            }

            const emergencyMarket = await buildDeterministicMarketFallback(message)
            if (emergencyMarket) {
                onEvent({ type: 'answer', message: emergencyMarket })
                return
            }
        } catch {
            // Ignore fallback errors and return the original error message below.
        }

        const errDetail = err?.message?.includes('API key')
            ? 'API key error. Please check configuration.'
            : err?.message?.includes('429') || err?.message?.includes('quota')
            ? 'Rate limit reached. Please wait a moment and try again.'
            : err?.message?.includes('safety')
            ? 'The AI declined to respond. Please rephrase your question.'
            : `An error occurred: ${(err?.message || 'Unknown error').slice(0, 100)}`
        onEvent({ type: 'error', message: errDetail })
    }
}

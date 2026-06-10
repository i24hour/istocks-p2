/**
 * Intent Classifier
 * Uses AI to classify user queries into intent types and extract parameters.
 *
 * Also exports the 3-way source router (classifyIntent) used by all chatbots:
 *   database   → historical data / indicators analysis
 *   ec2_live   → real-time price, live indicators, trade execution
 *   web_search → news, sentiment, reasons for price movement
 */

import { generateText } from 'ai'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { deepseek, DEEPSEEK_MODEL } from '@/lib/deepseek-provider'
import { getDateContext } from '@/lib/date-context'

const _bedrock = createAmazonBedrock({ region: process.env.AWS_REGION || 'ap-south-1' })
const BEDROCK_FALLBACK = process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-6'

/** Try DeepSeek; if it throws, fall back to Bedrock. Returns the raw text response. */
async function generateWithFallback(params: {
  prompt: string
  temperature?: number
  maxOutputTokens?: number
}): Promise<string> {
  const datedPrompt = `${getDateContext()}\n${params.prompt}`
  const finalParams = { ...params, prompt: datedPrompt }
  try {
    const { text } = await generateText({ ...finalParams, model: deepseek(DEEPSEEK_MODEL) })
    return text
  } catch (err) {
    console.warn('⚠️ DeepSeek failed, falling back to Bedrock:', (err as Error).message)
    const { text } = await generateText({ ...finalParams, model: _bedrock(BEDROCK_FALLBACK) })
    return text
  }
}

// ─── 3-Way Source Router ─────────────────────────────────────────────────────

export type IntentSource = 'database' | 'ec2_live' | 'web_search'

export interface IntentResult {
  source: IntentSource
  confidence: 'high' | 'medium' | 'low'
  reason: string
  /** Optimised Google search keywords (only set when source === 'web_search') */
  searchQuery?: string
}

/**
 * Fast local keyword classification — returns null when ambiguous.
 * IMPORTANT: "today" / "aaj" queries → ec2_live (not database),
 * because the DB may be stale and live data is more accurate for intraday.
 */
function classifySourceLocal(query: string): IntentResult | null {
  const q = query.toLowerCase().trim()

  // ── Advisory / Recommendation / Market-overview queries → database analysis (NOT trade execution) ──
  // Must be checked BEFORE the buy/sell trade rule AND before the today/aaj rule below.
  // "best stock to buy", "top movers today", "gainers losers", etc.
  // These are analytical questions answered from historical DB + web, not live trade execution.
  if (
    /\b(best\s+stock|top\s+stock|suggest\s+(a\s+)?stock|recommend|sabse\s+accha|sabse\s+better|konsa\s+stock|kaun\s+sa\s+stock|which\s+stock|stock\s+to\s+(buy|invest)|worth\s+(buying|investing)|should\s+i\s+(buy|invest)|kya\s+(kharidun|lu|lena\s+chahiye))\b/i.test(q) ||
    /\b(top\s+(gainers?|losers?|movers?|performers?|stocks?)|biggest\s+(gainers?|losers?|movers?)|market\s+(movers?|overview|summary|recap)|aaj\s+ke\s+(best|top|gainers?|losers?)|best\s+performing|worst\s+performing|most\s+active|high\s+volume\s+stocks?|zyada\s+badhe|zyada\s+gire)\b/i.test(q)
  )
    return { source: 'database', confidence: 'high', reason: 'advisory-recommendation-query' }

  // ── EC2 / Live / Trading ──────────────────────────────────────────────────
  if (/\b(buy|sell|kharido|becho|purchase|order|trade execute|place order|entry\s+karo|exit\s+karo)\b/i.test(q))
    return { source: 'ec2_live', confidence: 'high', reason: 'trade-execution-verb' }

  // "today" / "aaj" intraday analysis → always live
  if (
    /\b(today|aaj|intraday|abhi|abhi ka|right now|current|live|real.?time|kitna chal raha|aaj ka price)\b/i.test(q)
  )
    return { source: 'ec2_live', confidence: 'high', reason: 'today-or-live-keyword' }

  if (
    /\b(live\s+(rsi|macd|sma|ema|supertrend|indicator|price|adx|vwap|cci|stoch))\b/i.test(q) ||
    /\b(current\s+(rsi|macd|sma|ema|supertrend|indicator|price|adx|vwap|cci|stoch))\b/i.test(q) ||
    /\b(price\s+(kya hai|batao|abhi|now))\b/i.test(q) ||
    /\b(latest\s+price|live\s+price|current\s+price)\b/i.test(q)
  )
    return { source: 'ec2_live', confidence: 'high', reason: 'live-data-keyword' }

  // Conditional future trade
  if (
    /\b(kal|parso|tomorrow|jab.*ho jaaye|condition.*ho|when.*reaches?|jaise hi|as soon as)\b/i.test(q) &&
    /\b(buy|sell|trade|order|entry|exit)\b/i.test(q)
  )
    return { source: 'ec2_live', confidence: 'high', reason: 'conditional-future-trade' }

  // Stop-loss / profit target on live position
  if (
    /\b(stop.?loss|target|1%|2%|profit.*exit|exit.*profit|trailing)\b/i.test(q) &&
    /\b(buy|sell|hold|position|trade)\b/i.test(q)
  )
    return { source: 'ec2_live', confidence: 'high', reason: 'live-trade-target' }

  // ── Web Search / News / Sentiment ─────────────────────────────────────────
  if (/\b(kyun|kyu|why|reason|news|kya hua|kya ho raha|gira kyun|utha kyun|rally kyun|crash kyun|fall kyun|drop kyun)\b/i.test(q))
    return { source: 'web_search', confidence: 'high', reason: 'reason-or-news-keyword' }

  if (/\b(revenue|earnings|result|quarterly|annual.?report|profit loss|management|ceo|board|ipo|listing|nifty kyun|sensex kyun|market down kyun|market up kyun)\b/i.test(q))
    return { source: 'web_search', confidence: 'high', reason: 'financial-event-keyword' }

  if (/\b(sentiment|market.?crash|circuit|ban|halt|suspended|rbi|sebi|policy|budget|election|geopolit|war|sanctions|news today)\b/i.test(q))
    return { source: 'web_search', confidence: 'high', reason: 'macro-event-keyword' }

  // ── Database / Historical ─────────────────────────────────────────────────
  if (
    /\b(last|past|pichhle|pichhla|pichle|pichla)\b.*\b(\d+|ek|do|teen|char|paanch)?\s*(days?|weeks?|months?|years?|din|hafte|mahine|saal)\b/i.test(q) ||
    /\b(\d+)\s*(days?|weeks?|months?|years?|din|hafte|mahine|saal)\s*(mein|ka|ke|ki|ago|back|pehle)\b/i.test(q)
  )
    return { source: 'database', confidence: 'high', reason: 'historical-time-range' }

  if (/\b(probability|chance|likelihood|kitni\s+baar|how\s+many\s+times|how\s+often|backt?est)\b/i.test(q))
    return { source: 'database', confidence: 'high', reason: 'probability-backtest' }

  if (
    /\b(highest|lowest|max|min|maximum|minimum|sabse\s+zyada|sabse\s+kam|peak|bottom)\b.*\b(rsi|macd|ema|sma|price|close|high|low|volume|vwap|adx|supertrend)\b/i.test(q) ||
    /\b(rsi|macd|ema|sma|supertrend|adx|bollinger|atr|obv|vwap|cci|stoch|william)\b.*\b(highest|lowest|max|min|kab|when|kya tha|what was|history|historical)\b/i.test(q)
  )
    return { source: 'database', confidence: 'high', reason: 'historical-indicator-extremes' }

  if (
    /\b(gain|return|kitna\s+badha|kitna\s+gira|grown|fell|percent|%)\b.*\b(\d+|ek|do|teen)?\s*(days?|weeks?|months?|years?|din|hafte|mahine|saal)\b/i.test(q)
  )
    return { source: 'database', confidence: 'high', reason: 'historical-gain-return' }

  return null // Ambiguous — let AI decide
}

const CLASSIFICATION_PROMPT = `You are a query router for a stock market platform. Classify the user query into EXACTLY ONE source:

1. "database" — Historical analysis, statistics, patterns from past data, backtesting, AND advisory/recommendation queries ("best stock to buy", "suggest a stock", "which stock should I invest in", "top stocks today").
2. "ec2_live" — Real-time/trading: current price right now, live indicators, intraday data, conditional trades, profit targets. ONLY use this for specific trade-execution queries like "buy RELIANCE now", "sell HDFC at market", "what is NIFTY price right now", "TODAY's analysis for [specific stock]".
3. "web_search" — News/reasons: why market moved, company news, earnings, macro events, sentiment.

CRITICAL DISTINCTION:
- "best stock to buy today" / "suggest a stock" / "recommend stocks" → "database" (advisory, needs analysis)
- "top movers today" / "biggest gainers" / "top losers" / "market overview" → "database" (market overview, needs analysis)
- "buy RELIANCE" / "sell HDFC now" / "place order for NIFTY" → "ec2_live" (specific trade execution)
- "today" alone in an advisory/overview context → "database", NOT "ec2_live"
- "today" in a price-check context ("NIFTY price today", "aaj ka price") → "ec2_live"

RULES:
- Advisory recommendation (best/suggest/recommend/which stock/worth buying) → ALWAYS "database"
- Market overview (top movers/gainers/losers/most active/market summary) → ALWAYS "database"
- Specific trade verb on specific stock (buy TICKER/sell TICKER now) → ALWAYS "ec2_live"
- "kyun/why/news" → ALWAYS "web_search"
- past time period (last N months) → ALWAYS "database"
- ambiguous → prefer "database"

Query: "{QUERY}"

Reply ONLY as valid JSON (no markdown):
{"source":"database|ec2_live|web_search","reason":"one short sentence","searchQuery":"3-5 Google keywords if web_search, else null"}`

async function classifySourceWithAI(query: string, _apiKey?: string): Promise<IntentResult> {
  try {
    const text = await generateWithFallback({
      prompt: CLASSIFICATION_PROMPT.replace('{QUERY}', query),
      temperature: 0,
      maxOutputTokens: 150,
    })
    const match = text.trim().match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      const source = parsed.source as IntentSource
      if (['database', 'ec2_live', 'web_search'].includes(source)) {
        return { source, confidence: 'medium', reason: parsed.reason || 'ai-classified', searchQuery: parsed.searchQuery || undefined }
      }
    }
  } catch (err) {
    console.warn('⚠️ classifySourceWithAI failed, using fallback:', err)
  }
  return { source: 'database', confidence: 'low', reason: 'ai-fallback' }
}

/**
 * Main 3-way classifier used by /api/chat and /api/stocks/[symbol]/analyze.
 * Phase 1: local keyword match (zero latency).
 * Phase 2: Gemini AI (only when Phase 1 is ambiguous).
 */
export async function classifyIntent(query: string, apiKey: string): Promise<IntentResult> {
  const local = classifySourceLocal(query)
  if (local) {
    console.log(`🎯 [Classifier] Phase-1 → ${local.source} (${local.reason})`)
    return local
  }
  console.log(`🤖 [Classifier] Phase-2 AI for: "${query.slice(0, 80)}"`)
  const ai = await classifySourceWithAI(query, apiKey)
  console.log(`🎯 [Classifier] Phase-2 → ${ai.source} (${ai.reason})`)
  return ai
}

// ─── LLM Trade Intent Classifier ─────────────────────────────────────────────

export interface TradeIntentResult {
  action: 'BUY' | 'SELL'
  quantity: number
}

const TRADE_INTENT_PROMPT = `You are a trade-order parser for a stock market platform. Determine if the user message is a DIRECT TRADE ORDER.

A DIRECT TRADE ORDER must have ALL THREE:
1. An explicit BUY or SELL action verb (buy, sell, kharido, becho, purchase, exit)
2. An explicit numeric quantity (number of shares/units/lots)
3. A specific stock/index symbol or name

NOT a trade order (return null):
- Advisory/analysis: "which option should I buy", "suggest a stock", "best stock to buy"
- Price questions: "what is NIFTY price", "where will RELIANCE go"
- Conditional future: "when RELIANCE reaches 500, should I buy?" — advisory, not a direct order
- Questions with ? about what to buy/sell — these are recommendations requests

Examples:
- "buy 100 RELIANCE" → BUY, qty=100
- "sell 50 shares of HDFC" → SELL, qty=50
- "kharido 200 NIFTY50" → BUY, qty=200
- "which option should I buy under 1300?" → null (advisory question)
- "tell me best stock to buy" → null (advisory)
- "buy NIFTY when it reaches 500" → null (conditional, no explicit quantity)
- "nifty 50 me kaun sa option lena chahiye 1300 ke neeche?" → null (advisory)

User message: "{MESSAGE}"

Reply ONLY as valid JSON (no markdown, no explanation):
{"isTradeCommand":true,"action":"BUY","quantity":100}
OR
{"isTradeCommand":false}`

/**
 * LLM-powered trade intent classifier.
 * Fast-path: skips LLM if no buy/sell keyword exists.
 * Returns same shape as detectTradeIntent for drop-in compatibility.
 */
export async function classifyTradeIntent(
  message: string
): Promise<TradeIntentResult | null> {
  const lower = message.toLowerCase()
  const hasTradeverb = /\b(buy|sell|kharid(?:na|o|oo)?|purchase|bech(?:na|o)?|exit)\b/.test(lower)
  if (!hasTradeverb) return null

  try {
    const text = await generateWithFallback({
      prompt: TRADE_INTENT_PROMPT.replace('{MESSAGE}', message),
      temperature: 0,
      maxOutputTokens: 60,
    })
    const match = text.trim().match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0])
    if (!parsed.isTradeCommand) return null
    const action = parsed.action === 'SELL' ? 'SELL' : 'BUY'
    const quantity = parseInt(String(parsed.quantity), 10)
    if (!quantity || quantity <= 0) return null
    return { action, quantity }
  } catch (err) {
    console.warn('⚠️ classifyTradeIntent LLM failed, falling back to null:', err)
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ClassifiedIntent {
    intentType: string | null  // null if no matching pattern
    params: Record<string, unknown>
    confidence: number
    rawQuery: string
}

// Intent patterns for classification
const INTENT_PATTERNS = [
    { pattern: /probability.*clos(?:e|ing).*(?:above|greater|>|over)\s*(\d+)/i, intent: 'prob_close_above', extractors: { threshold: 1 } },
    { pattern: /probability.*clos(?:e|ing).*(?:below|less|<|under)\s*(\d+)/i, intent: 'prob_close_below', extractors: { threshold: 1 } },
    { pattern: /probability.*open(?:ing)?.*(?:above|greater|>|over)\s*(\d+)/i, intent: 'prob_open_above', extractors: { threshold: 1 } },
    { pattern: /(?:average|avg|mean)\s*volume/i, intent: 'avg_volume', extractors: {} },
    { pattern: /(?:highest|max|maximum)\s*price/i, intent: 'max_price', extractors: {} },
    { pattern: /(?:lowest|min|minimum)\s*price/i, intent: 'min_price', extractors: {} },
    { pattern: /rsi.*(?:above|over|>)\s*70|overbought/i, intent: 'rsi_overbought', extractors: {} },
    { pattern: /rsi.*(?:below|under|<)\s*30|oversold/i, intent: 'rsi_oversold', extractors: {} },
    { pattern: /support.*level/i, intent: 'support_level', extractors: {} },
    { pattern: /resistance.*level/i, intent: 'resistance_level', extractors: {} },
    { pattern: /(?:average|avg).*(?:daily|day).*range/i, intent: 'avg_daily_range', extractors: {} },
    { pattern: /(?:volatility|volatile)/i, intent: 'volatility', extractors: {} },
    { pattern: /(?:green|positive).*days/i, intent: 'green_days_pct', extractors: {} },
    { pattern: /supertrend.*(?:bullish|green|up)/i, intent: 'supertrend_bullish_pct', extractors: {} },
    { pattern: /price\s*change/i, intent: 'price_change_pct', extractors: {} },
]

// Timeframe extraction patterns
const TIMEFRAME_PATTERNS = [
    { pattern: /(\d+)\s*year/i, format: (m: string[]) => `${m[1]} year` },
    { pattern: /(\d+)\s*month/i, format: (m: string[]) => `${m[1]} month` },
    { pattern: /(\d+)\s*week/i, format: (m: string[]) => `${m[1]} week` },
    { pattern: /(\d+)\s*day/i, format: (m: string[]) => `${m[1]} day` },
    { pattern: /last\s*year/i, format: () => '1 year' },
    { pattern: /last\s*month/i, format: () => '1 month' },
    { pattern: /last\s*week/i, format: () => '1 week' },
]

/**
 * Extract timeframe from query, default to 1 year
 */
function extractTimeframe(query: string): string {
    for (const { pattern, format } of TIMEFRAME_PATTERNS) {
        const match = query.match(pattern)
        if (match) {
            return format(match)
        }
    }
    return '90 days' // Default
}

/**
 * Classify query using regex patterns (fast, local)
 */
export function classifyIntentLocal(query: string): ClassifiedIntent {
    const lowerQuery = query.toLowerCase()

    for (const { pattern, intent, extractors } of INTENT_PATTERNS) {
        const match = lowerQuery.match(pattern)
        if (match) {
            const params: Record<string, unknown> = {
                timeframe: extractTimeframe(query)
            }

            // Extract named parameters
            for (const [paramName, groupIndex] of Object.entries(extractors)) {
                if (typeof groupIndex === 'number' && match[groupIndex]) {
                    params[paramName] = parseFloat(match[groupIndex]) || match[groupIndex]
                }
            }

            return {
                intentType: intent,
                params,
                confidence: 0.9,
                rawQuery: query
            }
        }
    }

    // No match found
    return {
        intentType: null,
        params: { timeframe: extractTimeframe(query) },
        confidence: 0,
        rawQuery: query
    }
}

/**
 * Classify query using AI (slower, more accurate, for complex queries)
 */
export async function classifyIntentWithAI(query: string): Promise<ClassifiedIntent> {
    // First try local classification
    const localResult = classifyIntentLocal(query)
    if (localResult.intentType && localResult.confidence > 0.8) {
        return localResult
    }

    // If no local match, use AI
    try {
        const prompt = `Classify this stock market query into one of these intent types:
- prob_close_above: probability of closing above a price
- prob_close_below: probability of closing below a price  
- prob_open_above: probability of opening above a price
- avg_volume: average trading volume
- max_price: maximum/highest price
- min_price: minimum/lowest price
- rsi_overbought: RSI above 70 percentage
- rsi_oversold: RSI below 30 percentage
- support_level: support price level
- resistance_level: resistance price level
- avg_daily_range: average daily high-low range
- volatility: price volatility
- green_days_pct: percentage of green/positive days
- supertrend_bullish_pct: supertrend bullish percentage
- price_change_pct: price change over period
- OTHER: if none match

Query: "${query}"

Respond in JSON format:
{
  "intentType": "intent_name_or_OTHER",
  "params": {
    "threshold": number_if_applicable,
    "timeframe": "extracted timeframe like '1 year' or '3 months'"
  },
  "confidence": 0.0_to_1.0
}`

        const text = await generateWithFallback({ prompt })

        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            return {
                intentType: parsed.intentType === 'OTHER' ? null : parsed.intentType,
                params: parsed.params || {},
                confidence: parsed.confidence || 0.5,
                rawQuery: query
            }
        }
    } catch (e) {
        console.error('AI classification error:', e)
    }

    return {
        intentType: null,
        params: { timeframe: extractTimeframe(query) },
        confidence: 0,
        rawQuery: query
    }
}

// ─── Personal Portfolio Intent Classifier ────────────────────────────────────

/**
 * Returns true when the message is asking about the USER's own holdings/trades.
 * Returns false for generic financial queries that happen to use the word "portfolio"
 * (e.g. "portfolio overlap between HDFC Flexi Cap and Parag Parikh Flexi Cap").
 *
 * Fast local checks handle obvious cases; DeepSeek resolves ambiguous ones.
 */
const PORTFOLIO_INTENT_PROMPT = `You are a classifier for an Indian stock market platform called iStocks.

Your job: decide if the user's message requires fetching their PERSONAL portfolio data (their own holdings, paper trades, or broker account).

Answer ONLY "yes" or "no". Nothing else.

─── Answer "yes" ONLY when the user is asking about ───
• Their own holdings: "my portfolio", "mera portfolio", "my holdings", "my stocks", "my positions", "apna portfolio"
• Their paper trades: "my paper trades", "paper trading performance", "paper portfolio"
• Their broker holdings: "my Zerodha holdings", "broker portfolio", "my Groww portfolio"
• Their P&L: "my profit/loss", "kitna profit hua mera", "my PnL", "meri loss"
• Portfolio review of what THEY personally hold or have bought

─── Answer "no" for everything else, including ───
• Trade orders: "buy 100 RELIANCE", "sell 50 HDFC", "kharid 200 stocks", "place order"
• Mutual fund / ETF comparisons: "HDFC Flexi Cap vs Parag Parikh", "portfolio overlap between funds"
• Stock analysis: "analyse TATA Motors", "RSI of NIFTY", "technical analysis of X"
• Market queries: "why is market falling", "best stocks to buy", "undervalued stocks"
• Company's own portfolio (not user's): "HDFC fund portfolio", "fund's top holdings"
• Price queries: "what is RELIANCE price", "NIFTY level today"
• General advice: "should I buy X", "is X a good stock"

─── Examples ───
"buy 100 pradeep phosphate stocks"              → no  (trade order)
"my portfolio analysis"                          → yes
"analyse portfolio overlap between HDFC Flexi Cap vs Parag Parikh" → no  (fund comparison)
"mera portfolio dekho"                           → yes
"kitna profit hua mera"                          → yes
"HDFC Bank ke stocks kaisa hai"                  → no  (stock query)
"how is my paper trade performing"               → yes
"best stocks under 500"                          → no  (general screening)
"sell 50 shares of INFY"                         → no  (trade order)
"show me my holdings"                            → yes
"compare NIFTY vs SENSEX"                        → no  (index comparison)
"mere broker portfolio mein kya hai"             → yes

Message: "{MESSAGE}"

Answer (yes/no):`

// ─── Query Category Classifier (Option B architecture) ───────────────────────

export type QueryCategory =
  | 'screener'
  | 'single_stock'
  | 'mutual_fund'
  | 'pms'
  | 'web_news'
  | 'trade'
  | 'portfolio'
  | 'market'
  | 'greeting'
  | 'other'

const QUERY_CATEGORY_PROMPT = `You are a query router for an Indian stock market AI called iStocks.
Classify the user query into EXACTLY ONE category:

"screener"     → User wants a LIST of stocks matching some criteria: "best stocks to buy", "top 5 picks", "undervalued stocks", "PSU stocks under ₹500", "oversold stocks with bounce potential", "multibagger stocks", "which stocks should I invest in", "stocks in range 100-500", "stocks under ₹1000", "sector-specific stock picks"
"single_stock" → Analysis of ONE specific named stock, OR comparison of 2-3 named stocks: "analyze RELIANCE", "is WIPRO a buy?", "HDFC Bank RSI", "INFY vs TCS", "TATAMOTORS target price"
"mutual_fund"  → Mutual fund / SIP / MF queries: "HDFC Flexi Cap performance", "best mid cap fund", "SIP recommendation", "fund overlap", "expense ratio", "NAV of X fund"
"pms"          → PMS or AIF queries: "Marcellus PMS returns", "best PMS fund", "minimum investment in PMS", "AIF vs mutual fund"
"web_news"     → Why/news/reason queries: "why is market falling?", "kyu gira", "news on RELIANCE", "koi news aayi", "kyun badha", "SEBI announcement", "quarterly results", "earnings report"
"trade"        → Direct trade execution with explicit action + quantity: "buy 100 RELIANCE", "sell 50 WIPRO", "kharido 200 stocks", "place order for INFY", "becho 100 HDFC"
"portfolio"    → User's personal holdings/trades: "my portfolio", "my holdings", "mera portfolio", "my paper trades", "my P&L", "show my stocks", "apna portfolio"
"market"       → General market overview without specific stock criteria: "how is market today?", "top gainers today", "Nifty performance", "top movers", "market summary"
"greeting"     → Simple greetings only: "hi", "hello", "namaste"
"other"        → Doesn't clearly fit any category above

CRITICAL DISTINCTIONS:
- "best stocks to buy" / "top 5 picks" / "undervalued stocks" / "PSU stocks under ₹500" → "screener" (discovering stocks BY criteria)
- "analyze RELIANCE" / "is WIPRO good?" / "HDFC RSI" → "single_stock" (ONE specific named stock)
- "should I buy RELIANCE?" / "is RELIANCE a good buy?" → "single_stock" (advisory about a specific stock, NOT "trade")
- "buy 100 RELIANCE" (has explicit action + quantity) → "trade"
- "top gainers today" / "how is Nifty?" / "market overview" → "market"
- "why is RELIANCE falling?" / "news on Infosys" → "web_news"

User query: "{QUERY}"
Reply ONLY as valid JSON (no markdown, no explanation):
{"category":"screener|single_stock|mutual_fund|pms|web_news|trade|portfolio|market|greeting|other","reason":"one line"}`

export async function classifyQueryCategory(message: string): Promise<QueryCategory> {
  const validCategories: QueryCategory[] = [
    'screener', 'single_stock', 'mutual_fund', 'pms', 'web_news',
    'trade', 'portfolio', 'market', 'greeting', 'other',
  ]
  try {
    const text = await generateWithFallback({
      prompt: QUERY_CATEGORY_PROMPT.replace('{QUERY}', message.slice(0, 600)),
      temperature: 0,
      maxOutputTokens: 80,
    })
    const match = text.trim().match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      const category = parsed.category as QueryCategory
      if (validCategories.includes(category)) {
        console.log(`🏷️  [CategoryClassifier] "${message.slice(0, 60)}" → ${category} (${parsed.reason || ''})`)
        return category
      }
    }
  } catch (err) {
    console.warn('⚠️ classifyQueryCategory failed, defaulting to other:', (err as Error).message)
  }
  return 'other'
}

// ─────────────────────────────────────────────────────────────────────────────

export async function classifyPortfolioIntent(message: string): Promise<boolean> {
  // Only skip the LLM if there is truly no portfolio/trade context word at all —
  // this avoids burning API calls on pure price/news/analysis queries.
  const t = message.toLowerCase()
  const hasAnyRelevantWord = /\b(portfolio|holding|position|profit|loss|pnl|buy|sell|kharid|becho|trade|paper|broker)\b/i.test(t)
  if (!hasAnyRelevantWord) return false

  try {
    const text = await generateWithFallback({
      prompt: PORTFOLIO_INTENT_PROMPT.replace('{MESSAGE}', message),
      temperature: 0,
      maxOutputTokens: 5,
    })
    return text.trim().toLowerCase().startsWith('yes')
  } catch {
    // Fallback: only return true if there's an explicit first-person possessive + portfolio word
    return /\b(my\s+portfolio|my\s+holdings|mera\s+portfolio|apna\s+portfolio|mere\s+stocks?)\b/i.test(t)
  }
}

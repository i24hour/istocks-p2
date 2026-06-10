/**
 * POST /api/telegram/webhook
 *
 * Receives Telegram updates (messages + callback queries).
 * Routes them through the shared AI engine and replies via Telegram API.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
    TelegramUpdate,
    sendMessage,
    sendChatAction,
    editMessage,
    answerCallbackQuery,
    parseCommand,
} from '@/lib/telegram'
import {
    runAIEngine,
    normalizeConversationHistory,
    normalizeConversationMemory,
    isStopRequestedError,
    StopRequestedError,
    type AIEvent,
    type ConversationMemory,
    type ConversationTurn,
} from '@/lib/ai-engine'
import { prisma } from '@/lib/prisma'
import { fetchEC2AllPrices, fetchEC2LiveSnapshot } from '@/lib/ec2-helpers'
import { resolveCanonicalSymbol } from '@/lib/instrumentRegistry'
import { randomUUID } from 'crypto'
import { executeTradeForUser } from '@/lib/trading/executor'
import { processPendingPaperTrades } from '@/lib/pending-paper-trades'

export const maxDuration = 120 // 2 minutes for complex AI queries
export const runtime = 'nodejs'

const MAX_HISTORY_TURNS = 20 // max messages to keep (10 exchanges)
const EC2_BASE_URL = process.env.EC2_LIVE_SERVER_URL || 'http://3.109.208.28:8080'
const RAW_MAX_EC2_QUOTE_AGE_SECONDS = Number(process.env.MAX_EC2_QUOTE_AGE_SECONDS || 1800)
const MAX_EC2_QUOTE_AGE_SECONDS = Number.isFinite(RAW_MAX_EC2_QUOTE_AGE_SECONDS)
    ? RAW_MAX_EC2_QUOTE_AGE_SECONDS
    : 1800 // 30 min
const activeTelegramRuns = new Map<number, { runId: string; stopRequested: boolean; updatedAt: number }>()

function newTelegramRunId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function beginTelegramRun(chatId: number): string {
    const runId = newTelegramRunId()
    activeTelegramRuns.set(chatId, { runId, stopRequested: false, updatedAt: Date.now() })
    return runId
}

function requestTelegramStop(chatId: number) {
    const current = activeTelegramRuns.get(chatId)
    if (current) {
        activeTelegramRuns.set(chatId, { ...current, stopRequested: true, updatedAt: Date.now() })
        return
    }
    activeTelegramRuns.set(chatId, { runId: '', stopRequested: true, updatedAt: Date.now() })
}

function shouldStopTelegramRun(chatId: number, runId: string): boolean {
    const current = activeTelegramRuns.get(chatId)
    if (!current) return false
    if (current.stopRequested) return true
    return !!current.runId && current.runId !== runId
}

function finishTelegramRun(chatId: number, runId: string) {
    const current = activeTelegramRuns.get(chatId)
    if (!current) return
    if (current.runId === runId) {
        activeTelegramRuns.delete(chatId)
    }
}

function isStopMessage(text: string): boolean {
    const normalized = text.trim().toLowerCase()
    return normalized === 'stop' ||
        normalized === 'stop it' ||
        normalized === 'please stop' ||
        normalized === 'cancel' ||
        normalized === 'cancel it'
}

/**
 * Convert LLM Markdown output → Telegram HTML.
 * Telegram HTML supports only: <b>, <i>, <u>, <s>, <code>, <pre>, <a href>.
 * Markdown parse_mode is fragile (any unbalanced * or _ kills ALL formatting).
 */
function mdToHtml(text: string): string {
    return text
        // Escape HTML special chars FIRST (except in code spans handled below)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // Code blocks ```lang\n...\n```
        .replace(/```(?:\w+)?\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        // Inline code `...`
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        // Headers (# Header -> Bold)
        .replace(/^#+\s+(.+)$/gm, '<b>$1</b>')
        // Bold+Italic ***text*** or ___text___
        .replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>')
        // Bold **text** or __text__
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/__(.+?)__/g, '<b>$1</b>')
        // Italic *text* or _text_ (not inside words)
        .replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '<i>$1</i>')
        .replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '<i>$1</i>')
        // Strikethrough ~~text~~
        .replace(/~~(.+?)~~/g, '<s>$1</s>')
        // Bulleted lists (- item or * item) -> • item
        .replace(/^[\*\-]\s+(.+)$/gm, '• $1')
        // Replace multiple newlines with double newlines to keep spacing clean
        .replace(/\n{3,}/g, '\n\n')
}

function wrapByWords(text: string, maxLen: number): string[] {
    const words = text.split(/\s+/).filter(Boolean)
    const out: string[] = []
    let current = ''
    for (const word of words) {
        if (!current) {
            current = word
            continue
        }
        if ((current + ' ' + word).length <= maxLen) {
            current += ` ${word}`
        } else {
            out.push(current)
            current = word
        }
    }
    if (current) out.push(current)
    return out
}

function splitLongParagraph(paragraph: string, maxLen = 220): string[] {
    const clean = paragraph.trim()
    if (!clean) return []
    if (clean.length <= maxLen) return [clean]

    const sentenceChunks = clean
        .replace(/([.!?।])\s+/g, '$1\n')
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)

    if (sentenceChunks.length <= 1) {
        return wrapByWords(clean, maxLen)
    }

    const lines: string[] = []
    let current = ''
    for (const sentence of sentenceChunks) {
        if (!current) {
            current = sentence
            continue
        }
        if ((current + ' ' + sentence).length <= maxLen) {
            current += ` ${sentence}`
        } else {
            lines.push(current)
            current = sentence
        }
    }
    if (current) lines.push(current)
    return lines
}

function prettifyStockLine(line: string): string | null {
    const m = line.match(
        /^(\d+)[\.\)]\s*([A-Z0-9&.\-]+)\s*[:\-]\s*₹?\s*([0-9,]+(?:\.\d+)?)\s*,?\s*(?:change|chg|delta|Δ)\s*[:\-]\s*([+\-]?\d+(?:\.\d+)?)%?/i
    )
    if (!m) return null
    const rank = m[1]
    const symbol = m[2].toUpperCase()
    const price = m[3]
    const deltaNum = Number(m[4])
    const delta = Number.isFinite(deltaNum) ? deltaNum : 0
    const icon = delta >= 0 ? '🟢' : '🔴'
    const signed = delta > 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2)
    return `${rank}) **${symbol}** — ₹${price} (${icon} ${signed}%)`
}

function formatAnswerForTelegram(answer: string): string {
    const normalized = answer
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

    if (!normalized) return answer

    const lines = normalized.split('\n')
    const out: string[] = []
    let previousBlank = false

    for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) {
            if (!previousBlank) out.push('')
            previousBlank = true
            continue
        }
        previousBlank = false

        const stockLine = prettifyStockLine(line)
        if (stockLine) {
            out.push(stockLine)
            continue
        }

        if (/^#{1,6}\s+/.test(line)) {
            out.push(line.replace(/^#{1,6}\s+/, '**') + '**')
            continue
        }

        if (/^[-*]\s+/.test(line)) {
            out.push(`• ${line.replace(/^[-*]\s+/, '')}`)
            continue
        }

        if (/^\d+\.\s+/.test(line)) {
            out.push(line.replace(/^(\d+)\.\s+/, '$1) '))
            continue
        }

        if (/^(to determine|next step|action plan|what to do next)/i.test(line)) {
            out.push(`👉 ${line}`)
            continue
        }

        const wrapped = splitLongParagraph(line)
        out.push(...wrapped)
    }

    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ── DB-backed conversation history (survives serverless cold starts) ─
type TelegramSessionPayload = {
    turns: ConversationTurn[]
    context: ConversationMemory
    pendingTradeAction: PendingTelegramTradeAction | null
}

type TelegramTradeCondition = {
    indicator: string
    operator: '<' | '<=' | '>' | '>=' | '='
    threshold: number
    thresholdIndicator?: string
    currentValue?: number
    isMet?: boolean
}

type PendingTelegramTradeAction = {
    kind: 'WATCH'
    symbol: string
    stockName: string
    action: 'BUY' | 'SELL'
    quantity: number
    price: number
    indicatorTimeframe: string
    conditions: TelegramTradeCondition[]
    targetProfitPct?: number
    targetPrice?: number
    createdAt: string
}

type TelegramHoldingsCategory = 'LIVE' | 'CONDITION' | 'CLOSED'

type TelegramTradeParam = {
    key: string
    label: string
    value: string
}

function normalizeSessionPayload(raw: any): TelegramSessionPayload {
    if (Array.isArray(raw)) {
        return {
            turns: normalizeConversationHistory(raw),
            context: normalizeConversationMemory(null),
            pendingTradeAction: null,
        }
    }

    if (raw && typeof raw === 'object') {
        return {
            turns: normalizeConversationHistory(raw.turns ?? raw.history ?? []),
            context: normalizeConversationMemory(raw.context),
            pendingTradeAction: normalizePendingTradeAction(raw.pendingTradeAction),
        }
    }

    return {
        turns: [],
        context: normalizeConversationMemory(null),
        pendingTradeAction: null,
    }
}

async function getSessionState(chatId: number): Promise<TelegramSessionPayload> {
    try {
        const session = await prisma.telegramSession.findUnique({
            where: { chatId: BigInt(chatId) },
        })
        if (!session) return normalizeSessionPayload(null)
        return normalizeSessionPayload(session.history)
    } catch {
        return normalizeSessionPayload(null)
    }
}

function normalizeTradeConditions(raw: unknown): TelegramTradeCondition[] {
    if (!Array.isArray(raw)) return []
    const normalized: TelegramTradeCondition[] = []
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue
        const condition = item as Record<string, unknown>
        const operator = condition.operator
        if (operator !== '<' && operator !== '<=' && operator !== '>' && operator !== '>=' && operator !== '=') {
            continue
        }
        const indicator = typeof condition.indicator === 'string' ? condition.indicator.trim().toUpperCase() : ''
        if (!indicator) continue
        const threshold = Number(condition.threshold ?? 0)
        normalized.push({
            indicator,
            operator,
            threshold: Number.isFinite(threshold) ? threshold : 0,
            thresholdIndicator: typeof condition.thresholdIndicator === 'string'
                ? condition.thresholdIndicator.trim().toUpperCase()
                : undefined,
            currentValue: typeof condition.currentValue === 'number' && Number.isFinite(condition.currentValue)
                ? condition.currentValue
                : undefined,
            isMet: typeof condition.isMet === 'boolean' ? condition.isMet : undefined,
        })
    }
    return normalized
}

function normalizePendingTradeAction(raw: unknown): PendingTelegramTradeAction | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const item = raw as Record<string, unknown>
    if (item.kind !== 'WATCH') return null
    const action = item.action === 'SELL' ? 'SELL' : item.action === 'BUY' ? 'BUY' : null
    if (!action) return null
    const symbol = typeof item.symbol === 'string' ? item.symbol.trim().toUpperCase() : ''
    const stockName = typeof item.stockName === 'string' ? item.stockName.trim() : symbol
    const quantity = Number(item.quantity)
    const price = Number(item.price)
    const indicatorTimeframe = typeof item.indicatorTimeframe === 'string' && item.indicatorTimeframe.trim()
        ? item.indicatorTimeframe.trim()
        : '1m'
    if (!symbol || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) {
        return null
    }
    return {
        kind: 'WATCH',
        symbol,
        stockName,
        action,
        quantity,
        price,
        indicatorTimeframe,
        conditions: normalizeTradeConditions(item.conditions),
        targetProfitPct: typeof item.targetProfitPct === 'number' && Number.isFinite(item.targetProfitPct)
            ? item.targetProfitPct
            : undefined,
        targetPrice: typeof item.targetPrice === 'number' && Number.isFinite(item.targetPrice)
            ? item.targetPrice
            : undefined,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
    }
}

async function saveSessionState(
    chatId: number,
    history: ConversationTurn[],
    context: ConversationMemory,
    pendingTradeAction: PendingTelegramTradeAction | null
) {
    try {
        // Trim to last MAX_HISTORY_TURNS messages
        const trimmed = history.slice(-MAX_HISTORY_TURNS)
        const payload: TelegramSessionPayload = {
            turns: trimmed,
            context: normalizeConversationMemory(context),
            pendingTradeAction: normalizePendingTradeAction(pendingTradeAction),
        }
        await prisma.telegramSession.upsert({
            where: { chatId: BigInt(chatId) },
            create: { chatId: BigInt(chatId), history: payload as any },
            update: { history: payload as any },
        })
    } catch (e) {
        console.error('Failed to save Telegram history:', e)
    }
}

async function clearSessionState(chatId: number) {
    try {
        const payload: TelegramSessionPayload = {
            turns: [],
            context: normalizeConversationMemory(null),
            pendingTradeAction: null,
        }
        await prisma.telegramSession.upsert({
            where: { chatId: BigInt(chatId) },
            create: { chatId: BigInt(chatId), history: payload as any },
            update: { history: payload as any },
        })
    } catch { }
}

// ── Webhook Secret Verification ─────────────────────────────────────
function verifyWebhookSecret(request: NextRequest): boolean {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (!secret) return true // No secret configured, allow all
    const headerSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
    return headerSecret === secret
}

// ── Command Handlers ────────────────────────────────────────────────

const HELP_TEXT = `🤖 <b>iStocks AI Bot</b>

I'm your AI-powered Indian stock market assistant. Here's what I can do:

📊 <b>Stock Analysis</b>
Just ask me about any stock:
• "analyze WIPRO"
• "is RELIANCE a buy?"
• "compare TCS vs INFY"

💰 <b>Live Prices</b>
• "price of HDFC Bank"
• "current price SBIN"

📰 <b>Market News</b>
• "why is market falling?"
• "latest news on TATA Motors"

📈 <b>Market Overview</b>
• "how is market today?"
• "top movers"
• "best stocks to buy"

🔧 <b>Commands</b>
/start — Welcome message
/help — This help menu
/holdings — Show your holdings
/clear — Clear conversation history
/stop — Stop current processing instantly

💡 <b>Tip:</b> You can write in English, Hindi, or Hinglish — I'll reply in the same language!`

const WELCOME_TEXT = (firstName: string) => `👋 <b>Welcome, ${firstName}!</b>

You're now connected to <b>iStocks AI</b> — your intelligent Indian stock market assistant.

I can analyze stocks, fetch live prices, find market news, and give you trading insights.

🚀 Try asking:
• "analyze RELIANCE"
• "how is market today?"
• "buy or sell WIPRO?"

Use /help to see all features.`

type TelegramTradeCard = {
    symbol: string
    action: 'BUY' | 'SELL'
    quantity: number
    avgPrice: number
    marketPrice: number
    returns: number
    investedAmount: number
    isLive?: boolean
    priceSource?: string
    strategyParams?: TelegramTradeParam[]
    conditions?: TelegramTradeCondition[]
    targetProfitPct?: number
    targetPrice?: number
    currentProfitPct?: number
    targetProgressPct?: number
}

type TelegramHoldingItem = {
    holdingId: string
    symbol: string
    action: 'BUY' | 'SELL'
    quantity: number
    avgPrice: number
    marketPrice: number
    returns: number
    investedAmount: number
    isLive: boolean
    status: TelegramHoldingsCategory
    kind: 'POSITION' | 'WATCH'
    priceSource: string
    conditions: TelegramTradeCondition[]
    targetProfitPct?: number
    targetPrice?: number
    strategyParams: TelegramTradeParam[]
}

type ParsedTelegramStrategy = {
    conditions: TelegramTradeCondition[]
    strategyParams: TelegramTradeParam[]
    targetProfitPct?: number
    indicatorTimeframe: string
}

type TelegramTradeOutcome =
    | { mode: 'EXECUTE'; pendingAction: null }
    | { mode: 'WATCH'; pendingAction: PendingTelegramTradeAction; summaryText: string }
    | { mode: 'BLOCKED'; pendingAction: null; summaryText: string }

// ── Auth helpers ────────────────────────────────────────────────────

async function getLinkedUser(chatId: number) {
    return prisma.user.findUnique({
        where: { telegramId: BigInt(chatId) },
        select: { id: true, name: true, email: true },
    })
}

async function sendLoginLink(chatId: number, firstName: string) {
    // Create a 15-minute magic link token
    const token = await prisma.telegramLinkToken.create({
        data: {
            chatId: BigInt(chatId),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
    })

    const baseUrl = process.env.NEXTAUTH_URL || 'https://www.istocks.codes'
    const link = `${baseUrl}/api/telegram/link?token=${token.token}`

    await sendMessage(
        chatId,
        `👋 Hi <b>${firstName}</b>!\n\nTo use iStocks AI bot, please login with your iStocks account first.\n\n🔗 <b>Click below to connect:</b>\n${link}\n\n⏱ This link expires in <b>15 minutes</b>.\nAfter logging in, send any message to continue!`,
        { parseMode: 'HTML' }
    )
}

function formatCurrencyINR(value: number): string {
    return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value)
}

function formatMaybeCurrencyINR(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A'
    return `₹${formatCurrencyINR(value)}`
}

function normalizeIndicatorName(raw: string): string {
    return raw.replace(/\s+/g, '').toUpperCase()
}

function compareCondition(left: number, operator: TelegramTradeCondition['operator'], right: number): boolean {
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

function parseIndicatorTimeframe(text: string): string {
    const lower = text.toLowerCase()
    if (/\b1\s*d(?:ay)?\b|\bdaily\b/.test(lower)) return '1d'
    if (/\b1\s*w(?:eek)?\b|\bweekly\b/.test(lower)) return '1w'
    if (/\b1\s*h(?:our)?\b|\bhourly\b/.test(lower)) return '1h'
    const match = lower.match(/\b(\d+)\s*min(?:ute)?s?\b/)
    if (match) return `${match[1]}m`
    return '1m'
}

function parseTelegramStrategyParameters(content: string): ParsedTelegramStrategy {
    const text = content.toLowerCase()
    const conditions: TelegramTradeCondition[] = []
    const strategyParams: TelegramTradeParam[] = []
    const operatorMap: Record<string, TelegramTradeCondition['operator']> = {
        below: '<',
        'less than': '<',
        above: '>',
        'greater than': '>',
        '<': '<',
        '<=': '<=',
        '>': '>',
        '>=': '>=',
        '=': '=',
    }

    const indPat = `(?:rsi|macd|ema\\s*\\d+|sma\\s*\\d+|adx|stochk|stochd|cci|williamsr|roc|vwap|supertrend)`
    const opPat = `(<=|>=|<|>|=|below|above|less\\s+than|greater\\s+than)`
    const fillerPat = `(?:is|goes|drops|falls|rises|gets|reaches|crosses)?`

    const crossRegex = new RegExp(`(${indPat})\\s*${fillerPat}\\s*${opPat}\\s*(${indPat})`, 'gi')
    const vsNumRegex = new RegExp(`(${indPat})\\s*${fillerPat}\\s*${opPat}\\s*([0-9]+(?:\\.[0-9]+)?)`, 'gi')

    const crossMatched = new Set<string>()
    let match: RegExpExecArray | null

    crossRegex.lastIndex = 0
    while ((match = crossRegex.exec(text)) !== null) {
        const indicator = normalizeIndicatorName(match[1])
        const operator = operatorMap[match[2].replace(/\s+/g, ' ').toLowerCase()]
        const thresholdIndicator = normalizeIndicatorName(match[3])
        if (!operator || indicator === thresholdIndicator) continue
        crossMatched.add(indicator)
        conditions.push({ indicator, operator, threshold: 0, thresholdIndicator })
        strategyParams.push({
            key: `${indicator}-vs-${thresholdIndicator}`,
            label: `${indicator} condition`,
            value: `${indicator} ${operator} ${thresholdIndicator}`,
        })
    }

    vsNumRegex.lastIndex = 0
    while ((match = vsNumRegex.exec(text)) !== null) {
        const indicator = normalizeIndicatorName(match[1])
        if (crossMatched.has(indicator)) continue
        const operator = operatorMap[match[2].replace(/\s+/g, ' ').toLowerCase()]
        const threshold = Number(match[3])
        if (!operator || Number.isNaN(threshold)) continue
        conditions.push({ indicator, operator, threshold })
        strategyParams.push({
            key: `${indicator}-${conditions.length}`,
            label: `${indicator} condition`,
            value: `${indicator} ${operator} ${threshold}`,
        })
    }

    const targetMatch =
        text.match(/(?:book|target|take\s*profit|tp)\s*(?:at|of)?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i) ||
        text.match(/([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:profit|tp)/i)

    const targetProfitPct = targetMatch ? Number(targetMatch[1]) : undefined
    if (targetProfitPct && Number.isFinite(targetProfitPct)) {
        strategyParams.push({ key: 'target-profit', label: 'Target', value: `${targetProfitPct}% profit` })
    }

    return {
        conditions,
        strategyParams,
        targetProfitPct,
        indicatorTimeframe: parseIndicatorTimeframe(content),
    }
}

function getIndicatorSnapshotValue(indicators: unknown, indicator: string): number | undefined {
    if (!indicators || typeof indicators !== 'object') return undefined
    const record = indicators as Record<string, unknown>
    const normalized = normalizeIndicatorName(indicator)
    const mapKey = (() => {
        if (normalized === 'RSI') return 'rsi'
        if (normalized === 'MACD') return 'macd'
        if (normalized === 'ADX') return 'adx'
        if (normalized === 'VWAP') return 'vwap'
        if (normalized === 'CCI') return 'cci'
        if (normalized === 'ROC') return 'roc'
        if (normalized === 'SUPERTREND') return 'supertrend'
        if (normalized === 'STOCHK') return 'stochK'
        if (normalized === 'STOCHD') return 'stochD'
        if (normalized === 'WILLIAMSR') return 'williamsR'
        if (/^EMA\d+$/.test(normalized)) return `ema${normalized.slice(3)}`
        if (/^SMA\d+$/.test(normalized)) return `sma${normalized.slice(3)}`
        return normalized.toLowerCase()
    })()
    const value = record[mapKey]
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isWaitDecisionAnswer(answerText: string): boolean {
    return /\b(?:decision|action|recommendation)\s*:\s*wait\b/i.test(answerText) ||
        /\bcondition(?:s)?\s+(?:is|are)\s+not\s+met\b/i.test(answerText) ||
        /\bclear\s+recommendation\s*:\s*wait\b/i.test(answerText)
}

function hasConditionalLanguage(text: string): boolean {
    return /\b(when|jab|jaise\s*hi|as\s*soon\s*as|if|agar|once)\b/i.test(text)
}

function textLooksLikeMatchingTradeRequest(
    text: string,
    symbol: string,
    action: 'BUY' | 'SELL',
    quantity: number
): boolean {
    const lower = text.toLowerCase()
    const symbolLower = symbol.toLowerCase()
    const qtyMatch = lower.match(/\b(\d+)\b/)
    const qty = qtyMatch ? Number(qtyMatch[1]) : null
    const actionMatches = action === 'BUY'
        ? /\b(buy|kharid|kharido|purchase)\b/i.test(lower)
        : /\b(sell|becho|bechna|exit|nikal)\b/i.test(lower)

    return actionMatches && qty === quantity && lower.includes(symbolLower)
}

function findRecentMatchingTradePrompt(
    history: ConversationTurn[],
    symbol: string,
    action: 'BUY' | 'SELL',
    quantity: number
): string | null {
    for (let i = history.length - 1; i >= 0; i--) {
        const turn = history[i]
        if (turn.role !== 'user') continue
        if (textLooksLikeMatchingTradeRequest(turn.content, symbol, action, quantity)) {
            return turn.content
        }
    }
    return null
}

function formatTelegramCondition(condition: TelegramTradeCondition): string {
    if (condition.indicator === 'MARKET_OPEN') {
        const openNow = typeof condition.currentValue === 'number' ? condition.currentValue >= 1 : false
        const icon = condition.isMet === true ? '✅' : condition.isMet === false ? '⏳' : '•'
        return `${icon} Market Open | current ${openNow ? 'OPEN' : 'CLOSED'}`
    }

    const currentValue = typeof condition.currentValue === 'number' ? condition.currentValue.toFixed(2) : 'N/A'
    const thresholdValue = condition.thresholdIndicator
        ? `${condition.thresholdIndicator}${typeof condition.threshold === 'number' && Number.isFinite(condition.threshold) ? ` (${condition.threshold.toFixed(2)})` : ''}`
        : condition.threshold.toFixed(2)
    const icon = condition.isMet === true ? '✅' : condition.isMet === false ? '⏳' : '•'
    return `${icon} ${condition.indicator} ${condition.operator} ${thresholdValue} | current ${currentValue}`
}

async function prepareTelegramTradeOutcome(
    text: string,
    trade: { symbol: string; stockName: string; action: 'BUY' | 'SELL'; quantity: number; price: number },
    answerText: string
): Promise<TelegramTradeOutcome> {
    const symbol = await resolveCanonicalSymbol(trade.symbol)
    const parsedStrategy = parseTelegramStrategyParameters(text)
    const conditionalText = hasConditionalLanguage(text)

    if (parsedStrategy.conditions.length === 0 && !conditionalText) {
        return { mode: 'EXECUTE', pendingAction: null }
    }

    if (parsedStrategy.conditions.length === 0 && conditionalText) {
        if (!isWaitDecisionAnswer(answerText)) {
            return { mode: 'EXECUTE', pendingAction: null }
        }
        return {
            mode: 'BLOCKED',
            pendingAction: null,
            summaryText:
                `⚠️ <b>Conditional trade detected</b>\n\n` +
                `I understood this as a wait-based trade, but I could not parse the exact rule for auto-watch.\n` +
                `Rephrase like: <i>buy 100 ${symbol} when RSI above 50</i>.`,
        }
    }

    const snapshot = await fetchEC2LiveSnapshot(symbol)
    const currentPrice = snapshot.ltp ?? snapshot.indicators?.vwap ?? trade.price
    const evaluatedConditions = parsedStrategy.conditions.map((condition) => {
        if (condition.thresholdIndicator) {
            const currentValue = getIndicatorSnapshotValue(snapshot.indicators || {}, condition.indicator)
            const thresholdValue = getIndicatorSnapshotValue(snapshot.indicators || {}, condition.thresholdIndicator)
            return {
                ...condition,
                currentValue,
                threshold: thresholdValue ?? condition.threshold,
                isMet: typeof currentValue === 'number' && typeof thresholdValue === 'number'
                    ? compareCondition(currentValue, condition.operator, thresholdValue)
                    : undefined,
            }
        }
        const currentValue = getIndicatorSnapshotValue(snapshot.indicators || {}, condition.indicator)
        return {
            ...condition,
            currentValue,
            isMet: typeof currentValue === 'number'
                ? compareCondition(currentValue, condition.operator, condition.threshold)
                : undefined,
        }
    })

    const conditionsPassed =
        evaluatedConditions.length > 0 &&
        evaluatedConditions.every((condition) => condition.isMet === true)

    if (conditionsPassed) {
        return { mode: 'EXECUTE', pendingAction: null }
    }

    const targetPrice = typeof parsedStrategy.targetProfitPct === 'number'
        ? trade.action === 'BUY'
            ? currentPrice * (1 + parsedStrategy.targetProfitPct / 100)
            : currentPrice * (1 - parsedStrategy.targetProfitPct / 100)
        : undefined

    const pendingAction: PendingTelegramTradeAction = {
        kind: 'WATCH',
        symbol,
        stockName: trade.stockName,
        action: trade.action,
        quantity: trade.quantity,
        price: currentPrice,
        indicatorTimeframe: parsedStrategy.indicatorTimeframe,
        conditions: evaluatedConditions,
        targetProfitPct: parsedStrategy.targetProfitPct,
        targetPrice,
        createdAt: new Date().toISOString(),
    }

    const summaryText = [
        `👀 <b>Wait &amp; Watch Summary</b>`,
        '',
        `${trade.action === 'BUY' ? '🟢' : '🔴'} <b>${trade.stockName}</b> (${symbol})`,
        `Qty: ${trade.quantity} shares`,
        `Current Price: ₹${currentPrice.toFixed(2)}`,
        '',
        '<b>Condition not met yet:</b>',
        ...evaluatedConditions.map(formatTelegramCondition),
        typeof parsedStrategy.targetProfitPct === 'number'
            ? `🎯 Target after entry: ${parsedStrategy.targetProfitPct.toFixed(2)}%${typeof targetPrice === 'number' ? ` (₹${targetPrice.toFixed(2)})` : ''}`
            : '',
        '',
        '<i>Choose Wait &amp; Watch to register a paper watch order. It will appear under /holdings → Conditional.</i>',
    ].filter(Boolean).join('\n')

    return { mode: 'WATCH', pendingAction, summaryText }
}

function getISTTimeParts(now: Date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(now)

    const weekday = parts.find((p) => p.type === 'weekday')?.value || 'Sun'
    const hour = Number(parts.find((p) => p.type === 'hour')?.value || '0')
    const minute = Number(parts.find((p) => p.type === 'minute')?.value || '0')
    return { weekday, hour, minute }
}

function isNSEMarketSessionLive(now: Date = new Date()): boolean {
    const { weekday, hour, minute } = getISTTimeParts(now)
    if (weekday === 'Sat' || weekday === 'Sun') return false
    const mins = hour * 60 + minute
    const openMins = 9 * 60 + 15
    const closeMins = 15 * 60 + 30
    return mins >= openMins && mins <= closeMins
}

function parsePossibleTimestamp(value: unknown): Date | null {
    if (value == null) return null

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        // 13-digit: ms epoch, 10-digit: sec epoch
        const ms = value > 1e12 ? value : value * 1000
        const d = new Date(ms)
        return Number.isNaN(d.getTime()) ? null : d
    }

    if (typeof value === 'string' && value.trim().length > 0) {
        const numeric = Number(value)
        if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
            const ms = numeric > 1e12 ? numeric : numeric * 1000
            const d = new Date(ms)
            if (!Number.isNaN(d.getTime())) return d
        }
        const d = new Date(value)
        return Number.isNaN(d.getTime()) ? null : d
    }

    return null
}

type EC2ExitQuoteCheck =
    | { ok: true; price: number; ageSeconds: number | null }
    | { ok: false; reason: string }

async function getEC2LiveExitQuote(symbol: string): Promise<EC2ExitQuoteCheck> {
    try {
        const response = await fetch(`${EC2_BASE_URL}/prices`, {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(6000),
        })
        if (!response.ok) {
            return { ok: false, reason: 'EC2 live feed unreachable.' }
        }

        const body = await response.json()
        const quote = body?.data?.[symbol]
        const ltp = Number(quote?.ltp)
        if (!Number.isFinite(ltp) || ltp <= 0) {
            return { ok: false, reason: `No valid EC2 live price for ${symbol}.` }
        }

        const quoteTs =
            parsePossibleTimestamp(quote?.timestamp) ||
            parsePossibleTimestamp(quote?.lastUpdated) ||
            parsePossibleTimestamp(quote?.updatedAt) ||
            parsePossibleTimestamp(quote?.exchangeTimestamp) ||
            parsePossibleTimestamp(quote?.time) ||
            parsePossibleTimestamp(body?.timestamp)

        if (!quoteTs) {
            // If EC2 does not expose timestamp, rely on market session check.
            return { ok: true, price: ltp, ageSeconds: null }
        }

        const ageSeconds = Math.floor((Date.now() - quoteTs.getTime()) / 1000)
        if (ageSeconds > MAX_EC2_QUOTE_AGE_SECONDS) {
            return { ok: false, reason: `EC2 quote is stale (${Math.max(ageSeconds, 0)}s old).` }
        }

        return { ok: true, price: ltp, ageSeconds: Math.max(ageSeconds, 0) }
    } catch {
        return { ok: false, reason: 'EC2 live feed timeout/error.' }
    }
}

async function getTelegramHoldings(userId: string): Promise<TelegramHoldingItem[]> {
    await processPendingPaperTrades({ userId }).catch(() => {
        // Best-effort execution pass. Holdings should still render even on transient failures.
    })

    const [positionOrders, watchOrders] = await Promise.all([
        prisma.tradingOrder.findMany({
            where: {
                userId,
                status: 'EXECUTED',
                tradingMode: 'PAPER',
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                symbol: true,
                orderType: true,
                quantity: true,
                executedPrice: true,
                positionValue: true,
                entryCondition: true,
                brokerStatus: true,
                rawBrokerResponse: true,
            },
        }),
        prisma.tradingOrder.findMany({
        where: {
            userId,
            status: 'PENDING',
            tradingMode: 'PAPER',
        },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            symbol: true,
            orderType: true,
            quantity: true,
            entryCondition: true,
        },
        }),
    ])

    const livePrices = await fetchEC2AllPrices()

    const executedHoldings: TelegramHoldingItem[] = positionOrders.map((order) => {
        const action = order.orderType === 'SELL' ? 'SELL' : 'BUY'
        const avgPrice = Number(order.executedPrice || 0)
        const investedAmount = Number(order.positionValue || 0) || avgPrice * order.quantity
        const livePrice = livePrices[order.symbol.toUpperCase()]
        const entry = order.entryCondition as Record<string, unknown> | null
        const conditions = normalizeTradeConditions(entry?.conditions)
        const rawMeta = (order.rawBrokerResponse || {}) as Record<string, unknown>
        const isClosed = order.brokerStatus === 'CLOSED'
        const closedPrice = typeof rawMeta.exitPrice === 'number' && Number.isFinite(rawMeta.exitPrice)
            ? rawMeta.exitPrice
            : avgPrice
        const finalReturns = typeof rawMeta.finalReturns === 'number' && Number.isFinite(rawMeta.finalReturns)
            ? rawMeta.finalReturns
            : (closedPrice - avgPrice) * order.quantity * (action === 'BUY' ? 1 : -1)
        const marketPrice = isClosed
            ? closedPrice
            : typeof livePrice === 'number' && livePrice > 0
                ? livePrice
                : avgPrice
        const returns = isClosed
            ? finalReturns
            : (marketPrice - avgPrice) * order.quantity * (action === 'BUY' ? 1 : -1)

        return {
            holdingId: order.id,
            symbol: order.symbol,
            action,
            quantity: order.quantity,
            avgPrice,
            marketPrice,
            returns,
            investedAmount,
            isLive: !isClosed,
            status: isClosed ? 'CLOSED' : 'LIVE',
            kind: 'POSITION',
            priceSource: isClosed ? 'Closed' : 'EC2 WebSocket',
            conditions,
            targetProfitPct: typeof entry?.targetProfitPct === 'number' ? entry.targetProfitPct : undefined,
            targetPrice: typeof entry?.targetPrice === 'number' ? entry.targetPrice : undefined,
            strategyParams: [],
        }
    })

    const conditionalWatchHoldings = watchOrders.map((order) => {
        const entry = order.entryCondition as Record<string, unknown> | null
        const conditions = normalizeTradeConditions(entry?.conditions)
        const targetProfitPct = typeof entry?.targetProfitPct === 'number' && Number.isFinite(entry.targetProfitPct)
            ? entry.targetProfitPct
            : undefined
        const targetPrice = typeof entry?.targetPrice === 'number' && Number.isFinite(entry.targetPrice)
            ? entry.targetPrice
            : undefined
        const ltp = livePrices[order.symbol.toUpperCase()]
        return {
            holdingId: `watch:${order.id}`,
            symbol: order.symbol,
            action: order.orderType === 'SELL' ? 'SELL' : 'BUY',
            quantity: order.quantity,
            avgPrice: 0,
            marketPrice: typeof ltp === 'number' && ltp > 0 ? ltp : 0,
            returns: 0,
            investedAmount: 0,
            isLive: false,
            status: 'CONDITION',
            kind: 'WATCH',
            priceSource: 'Watch Order',
            conditions,
            targetProfitPct,
            targetPrice,
            strategyParams: [],
        } satisfies TelegramHoldingItem
    })

    return [...conditionalWatchHoldings, ...executedHoldings]
}

function splitTelegramHoldings(holdings: TelegramHoldingItem[]) {
    return {
        live: holdings.filter((holding) => holding.status === 'LIVE'),
        conditional: holdings.filter((holding) => holding.status === 'CONDITION'),
        closed: holdings.filter((holding) => holding.status === 'CLOSED'),
    }
}

function buildTelegramHoldingsMenuMessage(holdings: TelegramHoldingItem[]): string {
    if (holdings.length === 0) {
        return `📭 <b>No holdings yet</b>\n\nAI chat se paper trade place karo, fir yahan <b>/holdings</b> me dikh jayega.`
    }

    const { live, conditional, closed } = splitTelegramHoldings(holdings)
    const invested = holdings
        .filter((holding) => holding.kind === 'POSITION')
        .reduce((sum, holding) => sum + holding.investedAmount, 0)
    const pnl = holdings
        .filter((holding) => holding.kind === 'POSITION')
        .reduce((sum, holding) => sum + holding.returns, 0)
    const pnlIcon = pnl >= 0 ? '🟢' : '🔴'
    const pnlText = `${pnl >= 0 ? '+' : ''}₹${formatCurrencyINR(pnl)}`

    return [
        '📊 <b>Your Holdings</b>',
        '',
        `Live: <b>${live.length}</b> | Conditional: <b>${conditional.length}</b> | Closed: <b>${closed.length}</b>`,
        `Invested: <b>₹${formatCurrencyINR(invested)}</b>`,
        `P&L: <b>${pnlText}</b> ${pnlIcon}`,
        '',
        '<i>Select which bucket you want to view:</i>',
    ].join('\n')
}

function labelForHoldingsCategory(category: TelegramHoldingsCategory): string {
    if (category === 'LIVE') return 'Live'
    if (category === 'CONDITION') return 'Conditional'
    return 'Closed'
}

function buildTelegramHoldingsKeyboard(
    holdings: TelegramHoldingItem[],
    activeCategory?: TelegramHoldingsCategory
) {
    const { live, conditional, closed } = splitTelegramHoldings(holdings)
    const withActive = (category: TelegramHoldingsCategory, label: string, count: number) => ({
        text: `${activeCategory === category ? '• ' : ''}${label} (${count})`,
        callback_data: `holdings_view:${category}`,
    })
    return [[
        withActive('LIVE', '📈 Live', live.length),
        withActive('CONDITION', '👀 Conditional', conditional.length),
        withActive('CLOSED', '⚪ Closed', closed.length),
    ]]
}

function buildTelegramHoldingsMessage(
    holdings: TelegramHoldingItem[],
    category: TelegramHoldingsCategory
): string {
    if (holdings.length === 0) {
        return `📭 <b>No holdings yet</b>\n\nAI chat se paper trade place karo, fir yahan <b>/holdings</b> me dikh jayega.`
    }

    const buckets = splitTelegramHoldings(holdings)
    const items = category === 'LIVE'
        ? buckets.live
        : category === 'CONDITION'
            ? buckets.conditional
            : buckets.closed

    const sectionTitle = category === 'LIVE'
        ? '📈 <b>Live Positions</b>'
        : category === 'CONDITION'
            ? '👀 <b>Conditional</b>'
            : '⚪ <b>Closed Positions</b>'

    const lines: string[] = [
        '📊 <b>Your Holdings</b>',
        '',
        `Viewing: <b>${labelForHoldingsCategory(category)}</b>`,
        `Live: <b>${buckets.live.length}</b> | Conditional: <b>${buckets.conditional.length}</b> | Closed: <b>${buckets.closed.length}</b>`,
        '',
        sectionTitle,
    ]

    if (items.length === 0) {
        lines.push(`No ${labelForHoldingsCategory(category).toLowerCase()} holdings.`)
        return lines.join('\n')
    }

    for (const holding of items.slice(0, 8)) {
        if (holding.kind === 'WATCH') {
            lines.push(`• <b>${holding.symbol}</b> (${holding.action}) | Qty ${holding.quantity} | Waiting for trigger`)
            if (holding.conditions.length > 0) {
                lines.push(`  ${holding.conditions.map(formatTelegramCondition).join(' | ')}`)
            }
            continue
        }

        const linePnl = `${holding.returns >= 0 ? '+' : ''}₹${formatCurrencyINR(holding.returns)}`
        lines.push(`• <b>${holding.symbol}</b> (${holding.action}) | Qty ${holding.quantity}`)
        lines.push(`  Avg ${formatMaybeCurrencyINR(holding.avgPrice)} | CMP ${formatMaybeCurrencyINR(holding.marketPrice)} | P&L ${linePnl}`)
        if (category === 'CONDITION' && holding.conditions.length > 0) {
            lines.push(`  ${holding.conditions.map(formatTelegramCondition).join(' | ')}`)
        }
    }

    if (items.length > 8) {
        lines.push(`…and ${items.length - 8} more ${labelForHoldingsCategory(category).toLowerCase()} items.`)
    }

    return lines.join('\n')
}

const MAX_TELEGRAM_EXIT_BUTTONS = 20

function buildTelegramHoldingCardText(holding: TelegramHoldingItem): string {
    if (holding.kind === 'WATCH') {
        return [
            `👀 <b>${holding.symbol}</b> (${holding.action})`,
            `Qty: <b>${holding.quantity}</b>`,
            `CMP: ${formatMaybeCurrencyINR(holding.marketPrice)}`,
            `Status: <b>Waiting for conditions</b>`,
            holding.conditions.length > 0
                ? `Conditions:\n${holding.conditions.map(formatTelegramCondition).join('\n')}`
                : null,
            typeof holding.targetProfitPct === 'number'
                ? `Target after entry: <b>${holding.targetProfitPct.toFixed(2)}%</b>${typeof holding.targetPrice === 'number' ? ` (₹${holding.targetPrice.toFixed(2)})` : ''}`
                : null,
        ].filter(Boolean).join('\n')
    }

    const linePnl = `${holding.returns >= 0 ? '+' : ''}₹${formatCurrencyINR(holding.returns)}`
    return [
        `📌 <b>${holding.symbol}</b> (${holding.action})`,
        `Qty: <b>${holding.quantity}</b>`,
        `Avg: ${formatMaybeCurrencyINR(holding.avgPrice)} | CMP: ${formatMaybeCurrencyINR(holding.marketPrice)}`,
        `P&L: <b>${linePnl}</b>`,
        holding.status === 'CONDITION' && holding.conditions.length > 0
            ? `Conditions:\n${holding.conditions.map(formatTelegramCondition).join('\n')}`
            : null,
    ].filter(Boolean).join('\n')
}

async function sendHoldingCards(chatId: number, holdings: TelegramHoldingItem[]) {
    if (holdings.length === 0) return

    const shown = holdings.slice(0, MAX_TELEGRAM_EXIT_BUTTONS)
    for (const holding of shown) {
        const inlineKeyboard = holding.kind === 'POSITION' && holding.isLive
            ? [[
                {
                    text: '🔻 Exit Position',
                    callback_data: `hold_exit:${holding.holdingId}`,
                },
            ]]
            : undefined
        await sendMessage(chatId, buildTelegramHoldingCardText(holding), {
            parseMode: 'HTML',
            inlineKeyboard,
        })
    }

    if (holdings.length > shown.length) {
        await sendMessage(
            chatId,
            `ℹ️ Showing first ${shown.length} items. Remaining: ${holdings.length - shown.length}.`
        )
    }
}

async function handleStopCommand(chatId: number, messageId?: number) {
    requestTelegramStop(chatId)
    const hasActiveRun = !!activeTelegramRuns.get(chatId)?.runId
    const text = hasActiveRun
        ? '🛑 Stopping current request.\n\nNo further API call, search, or AI processing will continue from the next step.'
        : '🛑 Stopped.\n\nNo API call, search, or AI processing was started for this message.'
    await sendMessage(chatId, text, messageId ? { replyToMessageId: messageId } : undefined)
}

// ── Main Handler ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
    // Verify webhook secret
    if (!verifyWebhookSecret(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    let update: TelegramUpdate
    try {
        update = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    // Handle callback queries (inline button taps)
    if (update.callback_query) {
        const cb = update.callback_query
        const chatId = cb.message?.chat.id
        if (!chatId) return NextResponse.json({ ok: true })
        const firstName = cb.from?.first_name || 'there'

        // ── Paper trade confirmation ─────────────────────────────
        if (cb.data?.startsWith('trade_confirm:')) {
            await answerCallbackQuery(cb.id, '⏳ Placing trade...')
            await handleTradeConfirm(chatId, cb.data, cb.message!.message_id)
            return NextResponse.json({ ok: true })
        }

        if (cb.data === 'trade_cancel') {
            await answerCallbackQuery(cb.id, '❌ Cancelled')
            const sessionState = await getSessionState(chatId)
            await saveSessionState(chatId, sessionState.turns, sessionState.context, null)
            if (cb.message?.message_id) {
                await editMessage(chatId, cb.message.message_id, '❌ Trade cancelled.')
            }
            return NextResponse.json({ ok: true })
        }

        if (cb.data?.startsWith('trade_watch:')) {
            await answerCallbackQuery(cb.id, '⏳ Registering watch order...')
            await handleTradeWatch(chatId, cb.data, cb.message?.message_id)
            return NextResponse.json({ ok: true })
        }

        if (cb.data?.startsWith('hold_exit:')) {
            await answerCallbackQuery(cb.id, '⏳ Exiting position...')
            await handleHoldingExit(chatId, cb.data, cb.message?.message_id)
            return NextResponse.json({ ok: true })
        }

        if (cb.data?.startsWith('holdings_view:')) {
            const linked = await getLinkedUser(chatId)
            if (!linked) {
                await sendLoginLink(chatId, firstName)
                return NextResponse.json({ ok: true })
            }
            await answerCallbackQuery(cb.id, '📊 Loading holdings...')
            await handleHoldingsCategoryView(chatId, linked.id, cb.data, cb.message?.message_id)
            return NextResponse.json({ ok: true })
        }

        // Regular callback → treat as text message
        await answerCallbackQuery(cb.id, '👍')
        if (cb.data) {
            await handleTextMessage(chatId, cb.data, firstName, cb.message?.message_id)
        }
        return NextResponse.json({ ok: true })
    }

    // Handle text messages
    if (update.message?.text) {
        const msg = update.message
        const chatId = msg.chat.id
        const text = msg.text!.trim()
        const firstName = msg.from?.first_name || 'there'

        if (isStopMessage(text)) {
            await handleStopCommand(chatId, msg.message_id)
            return NextResponse.json({ ok: true })
        }

        // Check for commands
        const cmd = parseCommand(msg)
        if (cmd) {
            switch (cmd.command) {
                case 'start': {
                    // Check if already linked
                    const linked = await getLinkedUser(chatId)
                    if (linked) {
                        await sendMessage(chatId, WELCOME_TEXT(linked.name || firstName), { parseMode: 'HTML' })
                    } else {
                        await sendLoginLink(chatId, firstName)
                    }
                    return NextResponse.json({ ok: true })
                }

                case 'help':
                    await sendMessage(chatId, HELP_TEXT, { parseMode: 'HTML' })
                    return NextResponse.json({ ok: true })

                case 'clear':
                    await clearSessionState(chatId)
                    await sendMessage(chatId, '🗑️ Conversation history and context cleared. Start fresh!')
                    return NextResponse.json({ ok: true })

                case 'stop':
                    await handleStopCommand(chatId, msg.message_id)
                    return NextResponse.json({ ok: true })

                case 'holdings': {
                    const linked = await getLinkedUser(chatId)
                    if (!linked) {
                        await sendLoginLink(chatId, firstName)
                        return NextResponse.json({ ok: true })
                    }

                    await sendChatAction(chatId)
                    const holdings = await getTelegramHoldings(linked.id)
                    const holdingsText = buildTelegramHoldingsMenuMessage(holdings)
                    await sendMessage(chatId, holdingsText, {
                        parseMode: 'HTML',
                        inlineKeyboard: holdings.length > 0 ? buildTelegramHoldingsKeyboard(holdings) : undefined,
                    })
                    return NextResponse.json({ ok: true })
                }

                default:
                    // Treat unknown commands as regular messages
                    // e.g. /price WIPRO → "price WIPRO"
                    const asText = cmd.args ? `${cmd.command} ${cmd.args}` : cmd.command
                    await handleTextMessage(chatId, asText, firstName, msg.message_id)
                    return NextResponse.json({ ok: true })
            }
        }

        // Regular text → check auth first
        await handleTextMessage(chatId, text, firstName, msg.message_id)
    }

    return NextResponse.json({ ok: true })
}

// ── Handle a text message through the AI engine ─────────────────────

async function handleTextMessage(chatId: number, text: string, firstName: string, replyToMsgId?: number) {
    // ── Auth gate: must be linked to an istocks account ─────────
    const linkedUser = await getLinkedUser(chatId)
    if (!linkedUser) {
        await sendLoginLink(chatId, firstName)
        return
    }
    await processPendingPaperTrades({ userId: linkedUser.id }).catch(() => {
        // Non-blocking: normal chat should continue even if processor fails.
    })
    const runId = beginTelegramRun(chatId)
    const shouldStop = () => shouldStopTelegramRun(chatId, runId)
    const throwIfStopped = () => {
        if (shouldStop()) {
            throw new StopRequestedError()
        }
    }

    let typingInterval: NodeJS.Timeout | null = null
    let thinkingMsgId: number | undefined

    // Send typing indicator
    throwIfStopped()
    await sendChatAction(chatId)

    // Send a "thinking" placeholder that we'll update
    const thinkingMsg = await sendMessage(chatId, '🧠 Thinking...')
    thinkingMsgId = thinkingMsg?.result?.message_id

    // Load history from DB (survives serverless restarts)
    throwIfStopped()
    const sessionState = await getSessionState(chatId)
    const history = sessionState.turns

    // Track the latest thinking status for updating the placeholder
    let answerText = ''
    let webSources: { name: string; url: string }[] = []
    // Use a ref-box so TypeScript tracks the mutation from inside the callback
    const tradeRef: { value: null | { symbol: string; stockName: string; action: 'BUY' | 'SELL'; quantity: number; price: number } } = { value: null }
    const memoryRef: { value: ConversationMemory } = { value: sessionState.context }
    const pendingTradeActionRef: { value: PendingTelegramTradeAction | null } = { value: sessionState.pendingTradeAction }

    try {
        // Keep typing indicator alive during processing
        typingInterval = setInterval(() => {
            if (!shouldStop()) {
                sendChatAction(chatId).catch(() => { })
            }
        }, 4000)

        await runAIEngine(text, history, (event: AIEvent) => {
            if (shouldStop() && event.type !== 'error') {
                throw new StopRequestedError()
            }
            switch (event.type) {
                case 'thinking':
                    // Update the thinking message with latest step
                    if (thinkingMsgId) {
                        editMessage(chatId, thinkingMsgId, `${event.step}`).catch(() => { })
                    }
                    break
                case 'trade_intent':
                    tradeRef.value = {
                        symbol: event.symbol,
                        stockName: event.stockName,
                        action: event.action,
                        quantity: event.quantity,
                        price: event.price,
                    }
                    break
                case 'memory_update':
                    memoryRef.value = event.memory
                    break
                case 'answer':
                    answerText = event.message
                    if (event.webSources) webSources = event.webSources
                    break
                case 'error':
                    answerText = `❌ ${event.message}`
                    break
            }
        }, undefined, { shouldStop, conversationMemory: memoryRef.value })

        if (answerText) {
            throwIfStopped()
            // Add sources footer if web search was used
            let finalText = answerText
            if (webSources.length > 0) {
                const sourceLinks = webSources.map(s => `• ${s.name}`).join('\n')
                finalText += `\n\n📰 Sources:\n${sourceLinks}`
            }

            finalText = formatAnswerForTelegram(finalText)

            // Replace the thinking message with the answer
            throwIfStopped()
            const htmlText = mdToHtml(finalText)
            if (thinkingMsgId) {
                try {
                    await editMessage(chatId, thinkingMsgId, htmlText, { parseMode: 'HTML' })
                } catch {
                    await sendMessage(chatId, htmlText, { parseMode: 'HTML' })
                }
            } else {
                await sendMessage(chatId, htmlText, { parseMode: 'HTML', replyToMessageId: replyToMsgId })
            }

            // ── If trade intent detected, send confirm button as a NEW message ──
            if (tradeRef.value) {
                throwIfStopped()
                const t = tradeRef.value  // non-null: checked above
                const tradeOutcome = await prepareTelegramTradeOutcome(text, t, answerText)
                pendingTradeActionRef.value = tradeOutcome.pendingAction

                if (tradeOutcome.mode === 'WATCH') {
                    await sendMessage(chatId, tradeOutcome.summaryText, {
                        parseMode: 'HTML',
                        inlineKeyboard: [
                            [
                                { text: '👀 Wait & Watch', callback_data: `trade_watch:${tradeOutcome.pendingAction.symbol}` },
                                { text: '❌ Cancel', callback_data: 'trade_cancel' },
                            ],
                        ],
                    })
                } else if (tradeOutcome.mode === 'BLOCKED') {
                    await sendMessage(chatId, tradeOutcome.summaryText, {
                        parseMode: 'HTML',
                        inlineKeyboard: [[
                            { text: '❌ Cancel', callback_data: 'trade_cancel' },
                        ]],
                    })
                } else {
                    const totalCost = (t.price * t.quantity).toLocaleString('en-IN', { maximumFractionDigits: 2 })
                    const callbackData = `trade_confirm:${t.symbol}:${t.action}:${t.quantity}:${t.price.toFixed(2)}`
                    const confirmText = `📋 <b>Paper Trade Summary</b>\n\n${t.action === 'BUY' ? '🟢 BUY' : '🔴 SELL'} <b>${t.stockName}</b> (${t.symbol})\nQty: ${t.quantity} shares\nPrice: ₹${t.price.toFixed(2)}\nTotal: ₹${totalCost}\n\n<i>Paper trade — no real money involved</i>`
                    await sendMessage(chatId, confirmText, {
                        parseMode: 'HTML',
                        inlineKeyboard: [
                            [
                                { text: `✅ Confirm ${t.action}`, callback_data: callbackData },
                                { text: '❌ Cancel', callback_data: 'trade_cancel' },
                            ]
                        ]
                    })
                }
            } else {
                pendingTradeActionRef.value = sessionState.pendingTradeAction
            }

            // Persist updated history to DB
            throwIfStopped()
            await saveSessionState(chatId, [
                ...history,
                { role: 'user', content: text.slice(0, 600) },
                { role: 'assistant', content: answerText.slice(0, 600) },
            ], memoryRef.value, pendingTradeActionRef.value)
        }
    } catch (err: any) {
        if (isStopRequestedError(err)) {
            const stopText = '🛑 Stopped.\n\nNo further API call, search, or AI processing will continue for this request.'
            if (thinkingMsgId) {
                await editMessage(chatId, thinkingMsgId, stopText).catch(() => { })
            } else {
                await sendMessage(chatId, stopText).catch(() => { })
            }
            return
        }
        console.error('❌ Telegram handler error:', err)
        const errMsg = '⚠️ Something went wrong. Please try again.'
        if (thinkingMsgId) {
            await editMessage(chatId, thinkingMsgId, errMsg).catch(() => { })
        } else {
            await sendMessage(chatId, errMsg)
        }
    } finally {
        if (typingInterval) clearInterval(typingInterval)
        finishTelegramRun(chatId, runId)
    }
}

// ── Place paper trade from Telegram confirm button ───────────────────

async function handleTradeConfirm(chatId: number, callbackData: string, msgId?: number) {
    try {
        // Parse: trade_confirm:SYMBOL:BUY:100:449.50
        const parts = callbackData.split(':')
        if (parts.length < 5) {
            await sendMessage(chatId, '❌ Invalid trade data. Please try again.')
            return
        }
        const [, symbol, action, qtyStr, priceStr] = parts
        const quantity = parseInt(qtyStr, 10)
        const execPrice = parseFloat(priceStr)

        if (!symbol || !action || isNaN(quantity) || isNaN(execPrice)) {
            await sendMessage(chatId, '❌ Could not parse trade details.')
            return
        }

        const normalizedAction = action === 'SELL' ? 'SELL' : 'BUY'
        const sessionState = await getSessionState(chatId)
        const recentTradePrompt = findRecentMatchingTradePrompt(sessionState.turns, symbol, normalizedAction, quantity)

        if (sessionState.pendingTradeAction &&
            sessionState.pendingTradeAction.symbol === symbol.toUpperCase() &&
            sessionState.pendingTradeAction.action === normalizedAction &&
            sessionState.pendingTradeAction.quantity === quantity) {
            const blockedText = [
                '⛔ <b>Trade blocked</b>',
                '',
                `Condition for <b>${symbol}</b> is still not met.`,
                'Use <b>Wait &amp; Watch</b> instead of immediate execution.',
            ].join('\n')
            if (msgId) {
                await editMessage(chatId, msgId, blockedText, { parseMode: 'HTML' }).catch(() =>
                    sendMessage(chatId, blockedText, { parseMode: 'HTML' })
                )
            } else {
                await sendMessage(chatId, blockedText, { parseMode: 'HTML' })
            }
            return
        }

        if (recentTradePrompt && hasConditionalLanguage(recentTradePrompt)) {
            const tradeOutcome = await prepareTelegramTradeOutcome(
                recentTradePrompt,
                { symbol, stockName: symbol, action: normalizedAction, quantity, price: execPrice },
                'Decision: WAIT'
            )

            if (tradeOutcome.mode !== 'EXECUTE') {
                await saveSessionState(chatId, sessionState.turns, sessionState.context, tradeOutcome.pendingAction)
                if (msgId) {
                    await editMessage(chatId, msgId, tradeOutcome.summaryText, {
                        parseMode: 'HTML',
                        inlineKeyboard: tradeOutcome.mode === 'WATCH'
                            ? [[
                                { text: '👀 Wait & Watch', callback_data: `trade_watch:${tradeOutcome.pendingAction.symbol}` },
                                { text: '❌ Cancel', callback_data: 'trade_cancel' },
                            ]]
                            : [[{ text: '❌ Cancel', callback_data: 'trade_cancel' }]],
                    }).catch(() =>
                        sendMessage(chatId, tradeOutcome.summaryText, {
                            parseMode: 'HTML',
                            inlineKeyboard: tradeOutcome.mode === 'WATCH'
                                ? [[
                                    { text: '👀 Wait & Watch', callback_data: `trade_watch:${tradeOutcome.pendingAction.symbol}` },
                                    { text: '❌ Cancel', callback_data: 'trade_cancel' },
                                ]]
                                : [[{ text: '❌ Cancel', callback_data: 'trade_cancel' }]],
                        })
                    )
                } else {
                    await sendMessage(chatId, tradeOutcome.summaryText, {
                        parseMode: 'HTML',
                        inlineKeyboard: tradeOutcome.mode === 'WATCH'
                            ? [[
                                { text: '👀 Wait & Watch', callback_data: `trade_watch:${tradeOutcome.pendingAction.symbol}` },
                                { text: '❌ Cancel', callback_data: 'trade_cancel' },
                            ]]
                            : [[{ text: '❌ Cancel', callback_data: 'trade_cancel' }]],
                    })
                }
                return
            }
        }

        // Find the linked user
        const user = await prisma.user.findUnique({
            where: { telegramId: BigInt(chatId) },
            select: { id: true, name: true },
        })
        if (!user) {
            await sendMessage(chatId, '❌ Your Telegram is not linked to any iStocks account.')
            return
        }

        const execution = await executeTradeForUser(user.id, {
            symbol,
            side: normalizedAction,
            quantity,
            mode: 'PAPER',
            productType: 'DELIVERY',
            orderType: 'MARKET',
            confirmed: true,
            idempotencyKey: `tg-confirm-${chatId}-${msgId || 0}-${symbol.toUpperCase()}-${normalizedAction}-${quantity}`,
            sessionId: `telegram:${chatId}`,
        })

        const isPending = execution.status === 'PENDING' || execution.deferred
        const finalPrice = Number(execution.executedPrice || execPrice || 0)
        const totalCost = (finalPrice * quantity).toLocaleString('en-IN', { maximumFractionDigits: 2 })

        const successText = isPending
            ? `⏳ <b>Trade queued in Conditional</b>\n\n` +
              `${normalizedAction === 'BUY' ? '🟢' : '🔴'} <b>${symbol.toUpperCase()}</b> | Qty: ${quantity}\n` +
              `Status: <b>Waiting for market open</b>\n\n` +
              `Your trade will be executed automatically when the market opens.\n` +
              `📊 View it in <b>/holdings → Conditional</b>\n` +
              `<i>Order ID: ${execution.orderId.slice(-8)}</i>`
            : `✅ <b>Paper Trade Placed!</b>\n\n` +
              `${normalizedAction === 'BUY' ? '🟢 Bought' : '🔴 Sold'} <b>${symbol.toUpperCase()}</b>\n` +
              `Qty: ${quantity} shares @ ₹${finalPrice.toFixed(2)}\n` +
              `Total: ₹${totalCost}\n\n` +
              `📊 View your holdings on iStocks → <b>Holdings</b> tab\n` +
              `<i>Order ID: ${execution.orderId.slice(-8)}</i>`

        // Edit the confirm message to show success (removes buttons)
        if (msgId) {
            await editMessage(chatId, msgId, successText, { parseMode: 'HTML' }).catch(() =>
                sendMessage(chatId, successText, { parseMode: 'HTML' })
            )
        } else {
            await sendMessage(chatId, successText, { parseMode: 'HTML' })
        }

        await saveSessionState(chatId, sessionState.turns, sessionState.context, null)
    } catch (err: any) {
        console.error('❌ Trade confirm error:', err)
        await sendMessage(chatId, '❌ Trade failed. Please try again.')
    }
}

async function handleTradeWatch(chatId: number, callbackData: string, msgId?: number) {
    try {
        const [, symbolFromCallback] = callbackData.split(':')
        const sessionState = await getSessionState(chatId)
        const pending = sessionState.pendingTradeAction

        if (!pending || pending.kind !== 'WATCH') {
            await sendMessage(chatId, '⚠️ This watch setup expired. Please send the trade condition again.')
            return
        }

        if (symbolFromCallback && pending.symbol !== symbolFromCallback.toUpperCase()) {
            await sendMessage(chatId, '⚠️ This watch setup no longer matches the latest pending trade. Please retry.')
            return
        }

        if (pending.conditions.length === 0) {
            await sendMessage(chatId, '⚠️ I need a concrete condition before I can register Wait & Watch.')
            return
        }

        const user = await prisma.user.findUnique({
            where: { telegramId: BigInt(chatId) },
            select: { id: true },
        })
        if (!user) {
            await sendMessage(chatId, '❌ Your Telegram is not linked to any iStocks account.')
            return
        }

        const watchOrder = await prisma.tradingOrder.create({
            data: {
                userId: user.id,
                symbol: pending.symbol,
                orderType: pending.action,
                productType: 'INTRADAY',
                quantity: pending.quantity,
                status: 'PENDING',
                tradingMode: 'PAPER',
                positionValue: 0,
                entryCondition: {
                    conditions: pending.conditions,
                    targetProfitPct: pending.targetProfitPct,
                    targetPrice: pending.targetPrice,
                    source: 'telegram',
                    createdAt: pending.createdAt,
                    indicatorTimeframe: pending.indicatorTimeframe,
                },
                idempotencyKey: `tg-watch-${randomUUID()}`,
            },
        })

        const successText = [
            '👀 <b>Wait &amp; Watch Registered</b>',
            '',
            `${pending.action === 'BUY' ? '🟢' : '🔴'} <b>${pending.stockName}</b> (${pending.symbol})`,
            `Qty: ${pending.quantity} shares`,
            `Current Price: ₹${pending.price.toFixed(2)}`,
            '',
            '<b>Monitoring:</b>',
            ...pending.conditions.map(formatTelegramCondition),
            typeof pending.targetProfitPct === 'number'
                ? `🎯 Target after entry: ${pending.targetProfitPct.toFixed(2)}%${typeof pending.targetPrice === 'number' ? ` (₹${pending.targetPrice.toFixed(2)})` : ''}`
                : '',
            '',
            `📊 View it in <b>/holdings → Conditional</b>`,
            `<i>Watch ID: ${watchOrder.id.slice(-8)}</i>`,
        ].filter(Boolean).join('\n')

        if (msgId) {
            await editMessage(chatId, msgId, successText, { parseMode: 'HTML' }).catch(() =>
                sendMessage(chatId, successText, { parseMode: 'HTML' })
            )
        } else {
            await sendMessage(chatId, successText, { parseMode: 'HTML' })
        }

        await saveSessionState(chatId, sessionState.turns, sessionState.context, null)
    } catch (err) {
        console.error('❌ Trade watch error:', err)
        await sendMessage(chatId, '❌ Wait & Watch registration failed. Please try again.')
    }
}

async function handleHoldingsCategoryView(
    chatId: number,
    userId: string,
    callbackData: string,
    msgId?: number
) {
    const [, rawCategory] = callbackData.split(':')
    const category: TelegramHoldingsCategory =
        rawCategory === 'CONDITION' || rawCategory === 'CONDITIONAL' ? 'CONDITION' :
        rawCategory === 'CLOSED' ? 'CLOSED' :
        'LIVE'

    const holdings = await getTelegramHoldings(userId)
    const summaryText = buildTelegramHoldingsMessage(holdings, category)
    const keyboard = buildTelegramHoldingsKeyboard(holdings, category)

    if (msgId) {
        await editMessage(chatId, msgId, summaryText, {
            parseMode: 'HTML',
            inlineKeyboard: keyboard,
        }).catch(async () => {
            await sendMessage(chatId, summaryText, {
                parseMode: 'HTML',
                inlineKeyboard: keyboard,
            })
        })
    } else {
        await sendMessage(chatId, summaryText, {
            parseMode: 'HTML',
            inlineKeyboard: keyboard,
        })
    }

    const bucket = splitTelegramHoldings(holdings)
    const items = category === 'LIVE'
        ? bucket.live
        : category === 'CONDITION'
            ? bucket.conditional
            : bucket.closed

    if (category !== 'CLOSED') {
        await sendHoldingCards(chatId, items)
    }
}

async function handleHoldingExit(chatId: number, callbackData: string, msgId?: number) {
    try {
        const parts = callbackData.split(':')
        if (parts.length < 2) {
            await sendMessage(chatId, '❌ Invalid exit request.')
            return
        }

        const holdingId = parts[1]
        if (!holdingId) {
            await sendMessage(chatId, '❌ Invalid holding reference.')
            return
        }

        const user = await prisma.user.findUnique({
            where: { telegramId: BigInt(chatId) },
            select: { id: true },
        })
        if (!user) {
            await sendMessage(chatId, '❌ Your Telegram is not linked to any iStocks account.')
            return
        }

        const order = await prisma.tradingOrder.findFirst({
            where: {
                id: holdingId,
                userId: user.id,
                tradingMode: 'PAPER',
                status: 'EXECUTED',
            },
            select: {
                id: true,
                symbol: true,
                orderType: true,
                quantity: true,
                executedPrice: true,
                brokerStatus: true,
                rawBrokerResponse: true,
            },
        })

        if (!order) {
            const legacyMsg = await prisma.chatMessage.findFirst({
                where: {
                    id: holdingId,
                    role: 'assistant',
                    content: { contains: '"messageType":"trade-summary"' },
                    session: { userId: user.id } as any,
                },
                select: {
                    id: true,
                    content: true,
                },
            })

            if (!legacyMsg) {
                const notFoundText = '❌ Holding not found or access denied.'
                if (msgId) {
                    await editMessage(chatId, msgId, notFoundText)
                } else {
                    await sendMessage(chatId, notFoundText)
                }
                return
            }

            let parsed: any
            try {
                parsed = JSON.parse(legacyMsg.content)
            } catch {
                await sendMessage(chatId, '❌ Invalid holding data.')
                return
            }

            if (!parsed?.__trade || parsed.messageType !== 'trade-summary' || !parsed.tradeCard) {
                await sendMessage(chatId, '❌ Invalid holding payload.')
                return
            }

            const card = parsed.tradeCard as TelegramTradeCard
            const alreadyClosed = card.priceSource === 'Closed' || card.isLive === false
            if (alreadyClosed) {
                const alreadyText = `⚪ <b>${card.symbol}</b> is already closed.`
                if (msgId) {
                    await editMessage(chatId, msgId, alreadyText, { parseMode: 'HTML' }).catch(() =>
                        sendMessage(chatId, alreadyText, { parseMode: 'HTML' })
                    )
                } else {
                    await sendMessage(chatId, alreadyText, { parseMode: 'HTML' })
                }
                return
            }

            if (!isNSEMarketSessionLive()) {
                const blockedText =
                    `⛔ <b>Exit blocked</b>\n\n` +
                    `Market is currently closed.\n` +
                    `Exit is allowed only during live market hours (Mon-Fri, 09:15-15:30 IST).`
                if (msgId) {
                    await editMessage(chatId, msgId, blockedText, { parseMode: 'HTML' }).catch(() =>
                        sendMessage(chatId, blockedText, { parseMode: 'HTML' })
                    )
                } else {
                    await sendMessage(chatId, blockedText, { parseMode: 'HTML' })
                }
                return
            }

            const quoteCheck = await getEC2LiveExitQuote(card.symbol.toUpperCase())
            if (!quoteCheck.ok) {
                const blockedText =
                    `⛔ <b>Exit blocked</b>\n\n` +
                    `Live exit needs fresh EC2 price.\n` +
                    `${quoteCheck.reason}\n\n` +
                    `Please try again when live feed is active.`
                if (msgId) {
                    await editMessage(chatId, msgId, blockedText, { parseMode: 'HTML' }).catch(() =>
                        sendMessage(chatId, blockedText, { parseMode: 'HTML' })
                    )
                } else {
                    await sendMessage(chatId, blockedText, { parseMode: 'HTML' })
                }
                return
            }

            const exitPrice = quoteCheck.price
            const finalReturns = (exitPrice - Number(card.avgPrice || 0)) * Number(card.quantity || 0) * (card.action === 'BUY' ? 1 : -1)
            parsed.tradeCard = {
                ...card,
                isLive: false,
                priceSource: 'Closed',
                marketPrice: exitPrice,
                returns: finalReturns,
            }

            await prisma.chatMessage.update({
                where: { id: legacyMsg.id },
                data: { content: JSON.stringify(parsed) },
            })

            const pnlText = `${finalReturns >= 0 ? '+' : ''}₹${formatCurrencyINR(finalReturns)}`
            const exitVerb = card.action === 'BUY' ? 'Sold' : 'Bought back'
            const successText =
                `✅ <b>Position Exited</b>\n\n` +
                `${card.action === 'BUY' ? '🔴' : '🟢'} ${exitVerb} <b>${card.symbol}</b>\n` +
                `Qty: ${card.quantity} shares @ ₹${exitPrice.toFixed(2)}\n` +
                `Final P&L: <b>${pnlText}</b>\n\n` +
                `<i>Updated in holdings.</i>`

            if (msgId) {
                await editMessage(chatId, msgId, successText, { parseMode: 'HTML' }).catch(() =>
                    sendMessage(chatId, successText, { parseMode: 'HTML' })
                )
            } else {
                await sendMessage(chatId, successText, { parseMode: 'HTML' })
            }
            return
        }

        if (order.brokerStatus === 'CLOSED') {
            const alreadyText = `⚪ <b>${order.symbol}</b> is already closed.`
            if (msgId) {
                await editMessage(chatId, msgId, alreadyText, { parseMode: 'HTML' }).catch(() =>
                    sendMessage(chatId, alreadyText, { parseMode: 'HTML' })
                )
            } else {
                await sendMessage(chatId, alreadyText, { parseMode: 'HTML' })
            }
            return
        }

        if (!isNSEMarketSessionLive()) {
            const blockedText =
                `⛔ <b>Exit blocked</b>\n\n` +
                `Market is currently closed.\n` +
                `Exit is allowed only during live market hours (Mon-Fri, 09:15-15:30 IST).`
            if (msgId) {
                await editMessage(chatId, msgId, blockedText, { parseMode: 'HTML' }).catch(() =>
                    sendMessage(chatId, blockedText, { parseMode: 'HTML' })
                )
            } else {
                await sendMessage(chatId, blockedText, { parseMode: 'HTML' })
            }
            return
        }

        const quoteCheck = await getEC2LiveExitQuote(order.symbol.toUpperCase())
        if (!quoteCheck.ok) {
            const blockedText =
                `⛔ <b>Exit blocked</b>\n\n` +
                `Live exit needs fresh EC2 price.\n` +
                `${quoteCheck.reason}\n\n` +
                `Please try again when live feed is active.`
            if (msgId) {
                await editMessage(chatId, msgId, blockedText, { parseMode: 'HTML' }).catch(() =>
                    sendMessage(chatId, blockedText, { parseMode: 'HTML' })
                )
            } else {
                await sendMessage(chatId, blockedText, { parseMode: 'HTML' })
            }
            return
        }

        const exitPrice = quoteCheck.price
        const action = order.orderType === 'SELL' ? 'SELL' : 'BUY'
        const avgPrice = Number(order.executedPrice || 0)
        const finalReturns = (exitPrice - avgPrice) * Number(order.quantity || 0) * (action === 'BUY' ? 1 : -1)
        const existingMeta = (order.rawBrokerResponse || {}) as Record<string, unknown>

        await prisma.tradingOrder.update({
            where: { id: order.id },
            data: {
                brokerStatus: 'CLOSED',
                rawBrokerResponse: {
                    ...existingMeta,
                    exitPrice,
                    finalReturns,
                    closedAt: new Date().toISOString(),
                    exitSource: 'telegram',
                },
            },
        })

        const pnlText = `${finalReturns >= 0 ? '+' : ''}₹${formatCurrencyINR(finalReturns)}`
        const exitVerb = action === 'BUY' ? 'Sold' : 'Bought back'
        const successText =
            `✅ <b>Position Exited</b>\n\n` +
            `${action === 'BUY' ? '🔴' : '🟢'} ${exitVerb} <b>${order.symbol}</b>\n` +
            `Qty: ${order.quantity} shares @ ₹${exitPrice.toFixed(2)}\n` +
            `Final P&L: <b>${pnlText}</b>\n\n` +
            `<i>Updated in holdings.</i>`

        if (msgId) {
            await editMessage(chatId, msgId, successText, { parseMode: 'HTML' }).catch(() =>
                sendMessage(chatId, successText, { parseMode: 'HTML' })
            )
        } else {
            await sendMessage(chatId, successText, { parseMode: 'HTML' })
        }
    } catch (err) {
        console.error('❌ Holding exit error:', err)
        await sendMessage(chatId, '❌ Exit failed. Please try again.')
    }
}

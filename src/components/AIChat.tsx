'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Send, Bot, User, Maximize2, Minimize2, History, Plus, Trash2, X, Square, Bookmark, Zap,
  CheckCircle2, CircleDashed, AlertTriangle, XCircle, Activity, LogOut,
  DollarSign, BarChart3, ShieldCheck, TrendingUp, TrendingDown
} from 'lucide-react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Loader from './Loader'
import TradeExecutionModal from './TradeExecutionModal'
import { AnimatedThinking } from './ui/animated-thinking'
import { resolveTradeCommandDraft, type TradeCommandDraft } from '@/lib/tradeCommandResolver'

// ── Trade types ──────────────────────────────────────────
interface TradeStep {
  label: string
  detail?: string
  status: 'pending' | 'completed' | 'failed'
}

interface TradeCondition {
  indicator: string
  operator: '<' | '<=' | '>' | '>=' | '='
  threshold: number
  thresholdIndicator?: string   // for cross-indicator conditions like EMA12 > EMA26
  currentValue?: number
  isMet?: boolean
}

interface TradeParam {
  key: string
  label: string
  value: string
}

interface TradeCard {
  symbol: string
  action: 'BUY' | 'SELL'
  quantity: number
  avgPrice: number
  marketPrice: number
  returns: number
  investedAmount: number
  isLive?: boolean
  priceSource?: string
  strategyParams?: TradeParam[]
  conditions?: TradeCondition[]
  targetProfitPct?: number
  targetPrice?: number
  currentProfitPct?: number
  targetProgressPct?: number
  liveIndicators?: Record<string, number>
}

interface TradePlan {
  symbol: string
  action: 'BUY' | 'SELL'
  quantity: number
  currentPrice: number | null
  estimatedCost: number
  conditions: TradeCondition[]
  conditionsPassed: boolean
  strategyParams: TradeParam[]
  targetProfitPct?: number
  liveIndicators?: Record<string, number>
  indicatorTimeframe?: string   // e.g. '1m', '1d', '5m', '1h'
  originalContent: string
  sessionId: string | null
}
// ─────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  sql?: string
  webSources?: { name: string; url: string }[]
  debug?: {
    context: string
    specificTimeRecords: number
    targetDate: string | null
    targetDateIST?: string
    extractedCode?: string
  }
  // Trade message fields
  messageType?: 'text' | 'trade-status' | 'trade-summary' | 'trade-plan-review'
  tradeSteps?: TradeStep[]
  tradeCard?: TradeCard
  tradePlan?: TradePlan
}

interface ChatSession {
  id: string
  title: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

interface AIChatProps {
  symbol: string
}

interface ThinkingTraceStep {
  type: string
  text: string
  data?: any
}

interface TradingSettingsSnapshot {
  tradingMode: 'PAPER' | 'LIVE'
  preferredLiveBroker: 'ZERODHA' | 'DHAN' | 'GROWW' | null
}

interface ResolvedTradeCommand {
  symbol: string | null
  action: 'BUY' | 'SELL'
  quantity: number | null
  resolvedFromContext: boolean
  needsQuantity: boolean
  needsSymbol: boolean
}

export default function AIChat({ symbol }: AIChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const messagesRef = useRef<Message[]>([])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [expandedDebug, setExpandedDebug] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [provider, setProvider] = useState<string>('compute-1.0')
  const [showProviderMenu, setShowProviderMenu] = useState(false)

  // Chat history state
  const [sessionId, setSessionIdRaw] = useState<string | null>(null)

  // Persist last-active session per stock so refresh restores it
  const lastSessionKey = `ai-chat-last-session-${symbol}`
  const setSessionId = (id: string | null) => {
    setSessionIdRaw(id)
    if (id) {
      try { sessionStorage.setItem(lastSessionKey, id) } catch { /* ignore */ }
    }
  }
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [loadingSession, setLoadingSession] = useState(true)

  // Timer for thinking indicator
  const [thinkingTime, setThinkingTime] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingTraceStep[]>([])

  // Save to Sangraha state
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveMessageId, setSaveMessageId] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('')
  const [saveDescription, setSaveDescription] = useState('')
  const [saveTags, setSaveTags] = useState('')
  const [saveVisibility, setSaveVisibility] = useState<'public' | 'private'>('private')
  const [isSaving, setIsSaving] = useState(false)

  // Trade Execution Modal state
  const [showTradeModal, setShowTradeModal] = useState(false)
  const [tradeSymbol, setTradeSymbol] = useState('')

  // Paper trading state
  const [pendingTradePlan, setPendingTradePlan] = useState<{ plan: TradePlan; messageId: string } | null>(null)
  const [isWatchingConditions, setIsWatchingConditions] = useState(false)

  const { data: session } = useSession()
  const router = useRouter()

  // AbortController for stopping generation
  const abortControllerRef = useRef<AbortController | null>(null)
  // Tracks message IDs where auto-exit has already been triggered (prevents double-exit)
  const autoExitTriggeredRef = useRef<Set<string>>(new Set())

  // Timer effect - counts up while loading
  useEffect(() => {
    if (isLoading) {
      setThinkingTime(0)
      timerRef.current = setInterval(() => {
        setThinkingTime(prev => prev + 1)
      }, 1000)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setThinkingTime(0)
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [isLoading])

  const computeLogo = (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="url(#angleGradient)" />
      <path d="M12 7L16.5 17H14.2L13.2 14.6H10.8L9.8 17H7.5L12 7ZM11.55 12.8H12.45L12 11.66L11.55 12.8Z" fill="white" />
      <defs>
        <linearGradient id="angleGradient" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop stopColor="#10B981" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>
    </svg>
  )

  const providers = [
    { id: 'compute-1.0' as const, name: 'Compute 1.0', color: 'bg-emerald-500' },
  ]

  const currentProvider = providers.find(p => p.id === provider) || providers[0]
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const conversationMemoryRef = useRef<any>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }


  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [input])

  // Load sessions on mount
  const loadSessions = useCallback(async () => {
    try {
      const response = await fetch(`/api/chat/sessions?stock=${symbol}`)
      const data = await response.json()
      if (data.success) {
        setSessions(data.data)
      }
    } catch (error) {
      console.error('Error loading sessions:', error)
    }
  }, [symbol])

  // Create new session
  const createSession = useCallback(async () => {
    try {
      console.log('[AIChat] Creating new session for:', symbol)
      const response = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockSymbol: symbol }),
      })
      const data = await response.json()
      console.log('[AIChat] Create session response:', data)

      if (data.success) {
        console.log('[AIChat] Session created with ID:', data.data.id)
        setSessionId(data.data.id)
        conversationMemoryRef.current = null
        setMessages([{
          id: '1',
          role: 'assistant',
          content: `Hello! I'm your AI stock analyst. I can help you analyze ${symbol} using 40+ technical indicators. Ask me about trends, patterns, momentum, or any specific indicators!`,
          timestamp: new Date(),
        }])
        loadSessions()
        return data.data.id
      } else {
        console.error('[AIChat] Failed to create session:', data.error)
      }
    } catch (error) {
      console.error('[AIChat] Error creating session:', error)
    }
    return null
  }, [symbol, loadSessions])

  // Load messages for a session
  const loadSessionMessages = useCallback(async (id: string) => {
    try {
      setLoadingSession(true)
      const response = await fetch(`/api/chat/sessions/${id}/messages`)
      const data = await response.json()
      if (data.success && data.data.length > 0) {
        setMessages(data.data.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.createdAt),
          sql: m.sql,
        })))
        setSessionId(id)
        conversationMemoryRef.current = null
      } else {
        // Session has no messages, add welcome message
        setMessages([{
          id: '1',
          role: 'assistant',
          content: `Hello! I'm your AI stock analyst. I can help you analyze ${symbol} using 40+ technical indicators. Ask me about trends, patterns, momentum, or any specific indicators!`,
          timestamp: new Date(),
        }])
        setSessionId(id)
        conversationMemoryRef.current = null
      }
    } catch (error) {
      console.error('Error loading messages:', error)
    } finally {
      setLoadingSession(false)
    }
  }, [symbol])

  // Initialize: restore exact last session, fall back to most recent, or create new
  useEffect(() => {
    const init = async () => {
      setLoadingSession(true)
      await loadSessions()

      const response = await fetch(`/api/chat/sessions?stock=${symbol}`)
      const data = await response.json()

      if (data.success && data.data.length > 0) {
        // Try to restore the exact session the user had open
        let sessionToLoad: string = data.data[0].id
        try {
          const saved = sessionStorage.getItem(lastSessionKey)
          if (saved && data.data.some((s: { id: string }) => s.id === saved)) {
            sessionToLoad = saved
          }
        } catch { /* ignore */ }
        await loadSessionMessages(sessionToLoad)
      } else {
        await createSession()
        setLoadingSession(false)
      }
    }
    init()
  }, [symbol]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save message to database
  const saveMessage = async (message: Message, sql?: string) => {
    if (!sessionId) return

    try {
      await fetch(`/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: message.role,
          content: message.content,
          sql: sql || null,
        }),
      })
      // Refresh sessions list to update lastUpdated
      loadSessions()
    } catch (error) {
      console.error('Error saving message:', error)
    }
  }

  // Delete session
  const deleteSession = async (id: string) => {
    try {
      await fetch(`/api/chat/sessions/${id}`, { method: 'DELETE' })

      // If deleting current session, create new one
      if (id === sessionId) {
        conversationMemoryRef.current = null
        await createSession()
      }
      loadSessions()
    } catch (error) {
      console.error('Error deleting session:', error)
    }
  }

  // Start new chat
  const startNewChat = async () => {
    await createSession()
    setShowHistory(false)
  }

  // Switch to session
  const switchSession = async (id: string) => {
    await loadSessionMessages(id)
    setShowHistory(false)
  }

  // ── Trade helper functions ────────────────────────────────

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)

  const getISTTimeParts = (now: Date = new Date()) => {
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

  const isNSEMarketSessionLive = (now: Date = new Date()) => {
    const { weekday, hour, minute } = getISTTimeParts(now)
    if (weekday === 'Sat' || weekday === 'Sun') return false
    const mins = hour * 60 + minute
    return mins >= (9 * 60 + 15) && mins <= (15 * 60 + 30)
  }

  const parsePossibleTimestamp = (value: unknown): Date | null => {
    if (value == null) return null
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
    if (typeof value === 'number' && Number.isFinite(value)) {
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

  const getFreshEC2ExitPrice = async (symbol: string): Promise<{ ok: true; price: number } | { ok: false; reason: string }> => {
    if (!isNSEMarketSessionLive()) {
      return { ok: false, reason: 'Market is closed (Mon-Fri, 09:15-15:30 IST).' }
    }
    try {
      const r = await fetch(`/api/live-price?symbol=${encodeURIComponent(symbol.toUpperCase())}`, { cache: 'no-store' })
      if (!r.ok) return { ok: false, reason: 'EC2 live feed unreachable.' }
      const j = await r.json()
      if (!j?.success || !j?.data) return { ok: false, reason: 'No live price payload.' }
      const d = j.data[symbol.toUpperCase()] || j.data
      const ltp = Number(d?.ltp)
      if (!Number.isFinite(ltp) || ltp <= 0) return { ok: false, reason: `No valid EC2 price for ${symbol}.` }
      if (String(d?.source || '').toUpperCase() === 'YAHOO') {
        return { ok: false, reason: 'EC2 live price unavailable (Yahoo fallback blocked for exit).' }
      }

      const ts =
        parsePossibleTimestamp(d?.timestamp) ||
        parsePossibleTimestamp(d?.lastUpdated) ||
        parsePossibleTimestamp(d?.updatedAt) ||
        parsePossibleTimestamp(j?.timestamp)
      if (ts) {
        const ageSeconds = Math.floor((Date.now() - ts.getTime()) / 1000)
        if (ageSeconds > 1800) {
          return { ok: false, reason: `EC2 quote is stale (${Math.max(ageSeconds, 0)}s old).` }
        }
      }
      return { ok: true, price: ltp }
    } catch {
      return { ok: false, reason: 'EC2 live feed timeout/error.' }
    }
  }

  const normalizeSymbol = (raw: string): string => {
    const key = raw.trim().toUpperCase()
    const aliasMap: Record<string, string> = {
      VEDANTA: 'VEDL', BAJAJFINANCE: 'BAJFINANCE', HDFC: 'HDFCBANK', ICICI: 'ICICIBANK', SBI: 'SBIN',
    }
    return aliasMap[key] || key
  }

  const computeReturns = (action: 'BUY' | 'SELL', avg: number, mkt: number, qty: number) =>
    (mkt - avg) * qty * (action === 'BUY' ? 1 : -1)

  const compareCondition = (value: number, operator: TradeCondition['operator'], threshold: number) => {
    switch (operator) {
      case '<': return value < threshold
      case '<=': return value <= threshold
      case '>': return value > threshold
      case '>=': return value >= threshold
      case '=': return Math.abs(value - threshold) < 0.0001
      default: return false
    }
  }

  const buildTradeClarificationMessage = (draft: TradeCommandDraft, resolvedSymbol: string | null) => {
    if (draft.needsSymbol && draft.needsQuantity) {
      return 'Trade samajh aa gaya, but stock aur quantity clear nahi hai. Example: `buy 50 RELIANCE` ya `buy 50 of this stock`.'
    }
    if (draft.needsSymbol) {
      return `Quantity ${draft.quantity ?? ''} samajh aa gayi, but kaunsa stock buy/sell karna hai woh clear nahi hai. Example: \`${draft.action.toLowerCase()} ${draft.quantity ?? 50} ${symbol}\`.`
    }
    if (draft.needsQuantity) {
      return `I understood you want to ${draft.action.toLowerCase()} ${resolvedSymbol ?? symbol}, but quantity missing hai. Example: \`${draft.action.toLowerCase()} 50 ${resolvedSymbol ?? symbol}\`.`
    }
    return 'Trade request ambiguous hai. Please stock aur quantity clearly likho.'
  }

  const resolveSymbolInput = async (rawSymbol: string): Promise<string | null> => {
    const normalizedCurrentSymbol = normalizeSymbol(symbol)
    try {
      const r = await fetch(`/api/stocks/resolve?q=${encodeURIComponent(rawSymbol)}`, { cache: 'no-store' })
      if (!r.ok) return normalizeSymbol(rawSymbol) === normalizedCurrentSymbol ? normalizedCurrentSymbol : null
      const j = await r.json()
      const resolved = j?.data?.symbol
      if (typeof resolved === 'string' && resolved.trim().length > 0) {
        return resolved.trim().toUpperCase()
      }
      return normalizeSymbol(rawSymbol) === normalizedCurrentSymbol ? normalizedCurrentSymbol : null
    } catch {
      return normalizeSymbol(rawSymbol) === normalizedCurrentSymbol ? normalizedCurrentSymbol : null
    }
  }

  const resolveTradeCommand = async (content: string): Promise<ResolvedTradeCommand | null> => {
    const allowContextSymbol = /\b(this|that|it|same(?:\s+(?:stock|one|trade|position))?|current\s+stock|iss?\s+stock|us\s+stock|then|phir|toh|so|go\s+ahead|proceed|do\s+it|continue|of\s+it|of\s+this)\b/i.test(content)
    const memorySymbol = conversationMemoryRef.current?.activeSymbol ?? null
    const draft = resolveTradeCommandDraft(content, messages, {
      currentSymbol: allowContextSymbol ? (memorySymbol || symbol) : null,
    })
    if (!draft) return null

    const resolvedSymbol = draft.symbolHint
      ? await resolveSymbolInput(draft.symbolHint)
      : allowContextSymbol
        ? normalizeSymbol(memorySymbol || symbol)
        : null

    return {
      symbol: resolvedSymbol,
      action: draft.action,
      quantity: draft.quantity,
      resolvedFromContext: draft.resolvedFromContext,
      needsQuantity: draft.needsQuantity,
      needsSymbol: draft.needsSymbol || !resolvedSymbol,
    }
  }

  const parseStrategyParameters = (content: string) => {
    const text = content.toLowerCase()
    const conditions: TradeCondition[] = []
    const strategyParams: TradeParam[] = []

    const operatorMap: Record<string, TradeCondition['operator']> = {
      below: '<', 'less than': '<', above: '>', 'greater than': '>',
      '<': '<', '<=': '<=', '>': '>', '>=': '>=', '=': '=',
    }

    const normalizeInd = (s: string) => s.replace(/\s+/g, '')
    const parseIndicatorTimeframe = (t: string): string => {
      const lower = t.toLowerCase()
      if (/\b1\s*d(?:ay)?\b|\bdaily\b/.test(lower)) return '1d'
      if (/\b1\s*w(?:eek)?\b|\bweekly\b/.test(lower)) return '1w'
      if (/\b1\s*h(?:our)?\b|\bhourly\b/.test(lower)) return '1h'
      const mm = lower.match(/\b(\d+)\s*min(?:ute)?s?\b/)
      if (mm) return `${mm[1]}m`
      return '1m'
    }
    const indPat    = `(?:rsi|macd|ema\\s*\\d+|sma\\s*\\d+|adx|stochk|stochd|cci|williamsr|roc|vwap|supertrend)`
    const opPat     = `(<=|>=|<|>|=|below|above|less\\s+than|greater\\s+than)`
    const fillerPat = `(?:is|goes|drops|falls|rises|gets|reaches|crosses)?`

    const crossRegex  = new RegExp(`(${indPat})\\s*${fillerPat}\\s*${opPat}\\s*(${indPat})`, 'gi')
    const vsNumRegex  = new RegExp(`(${indPat})\\s*${fillerPat}\\s*${opPat}\\s*([0-9]+(?:\\.[0-9]+)?)`, 'gi')

    const crossMatched = new Set<string>()
    let m: RegExpExecArray | null
    crossRegex.lastIndex = 0
    while ((m = crossRegex.exec(text)) !== null) {
      const indicator          = normalizeInd(m[1]).toUpperCase()
      const op                 = operatorMap[m[2].replace(/\s+/g, ' ').toLowerCase()]
      const thresholdIndicator = normalizeInd(m[3]).toUpperCase()
      if (!op || indicator === thresholdIndicator) continue
      crossMatched.add(indicator)
      conditions.push({ indicator, operator: op, threshold: 0, thresholdIndicator })
      strategyParams.push({ key: `${indicator}-vs-${thresholdIndicator}`, label: `${indicator} condition`, value: `${indicator} ${op} ${thresholdIndicator}` })
    }
    vsNumRegex.lastIndex = 0
    while ((m = vsNumRegex.exec(text)) !== null) {
      const indicator = normalizeInd(m[1]).toUpperCase()
      if (crossMatched.has(indicator)) continue
      const op        = operatorMap[m[2].replace(/\s+/g, ' ').toLowerCase()]
      const threshold = Number(m[3])
      if (!op || Number.isNaN(threshold)) continue
      conditions.push({ indicator, operator: op, threshold })
      strategyParams.push({ key: `${indicator}-${conditions.length}`, label: `${indicator} condition`, value: `${indicator} ${op} ${threshold}` })
    }
    const targetMatch = text.match(/(?:book|target|take\s*profit|tp)\s*(?:at|of)?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i)
      || text.match(/([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:profit|tp)/i)
    const targetProfitPct = targetMatch ? Number(targetMatch[1]) : undefined
    if (targetProfitPct && Number.isFinite(targetProfitPct)) {
      strategyParams.push({ key: 'target-profit', label: 'Target', value: `${targetProfitPct}% profit` })
    }
    return { conditions, strategyParams, targetProfitPct, indicatorTimeframe: parseIndicatorTimeframe(content) }
  }

  const fetchCurrentPrice = async (sym: string): Promise<number | null> => {
    try {
      const r = await fetch(`/api/live-price?symbol=${encodeURIComponent(normalizeSymbol(sym))}`, { cache: 'no-store' })
      if (!r.ok) return null
      const j = await r.json()
      if (!j?.success || !j?.data) return null
      const d = j.data[normalizeSymbol(sym)] || j.data
      return typeof d?.ltp === 'number' ? d.ltp : null
    } catch { return null }
  }

  const fetchTradingSettings = async (): Promise<TradingSettingsSnapshot> => {
    try {
      const r = await fetch('/api/trading/settings', { cache: 'no-store' })
      if (!r.ok) return { tradingMode: 'PAPER', preferredLiveBroker: null }
      const j = await r.json()
      const mode = j?.data?.tradingMode === 'LIVE' ? 'LIVE' : 'PAPER'
      const broker = j?.data?.preferredLiveBroker
      return {
        tradingMode: mode,
        preferredLiveBroker:
          broker === 'ZERODHA' || broker === 'DHAN' || broker === 'GROWW' ? broker : null,
      }
    } catch {
      return { tradingMode: 'PAPER', preferredLiveBroker: null }
    }
  }

  const makeIdempotencyKey = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  const fetchLiveIndicatorSnapshot = async (sym: string, timeframe = '1m'): Promise<{ indicators: Record<string, number>; timeframe: string } | null> => {
    try {
      const url = `/api/live-indicators?symbol=${encodeURIComponent(sym)}${timeframe !== '1m' ? `&timeframe=${encodeURIComponent(timeframe)}` : ''}`
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) return null
      const j = await r.json()
      if (!j?.success || !j?.data?.indicators) return null
      const requestedTimeframe = timeframe.toLowerCase()
      const responseTimeframe = typeof j?.data?.timeframe === 'string' ? j.data.timeframe.toLowerCase() : requestedTimeframe
      const isDefaultMinuteRequest = requestedTimeframe === '1m' || requestedTimeframe === '1min' || requestedTimeframe === 'intraday'
      if (isDefaultMinuteRequest && responseTimeframe !== '1m') return null
      return { indicators: j.data.indicators, timeframe: responseTimeframe }
    } catch { return null }
  }

  // Phase 1: Build and show Trade Plan Review card
  const processPaperTradeCommand = async (
    content: string,
    sid: string | null,
    resolvedCommand?: { symbol: string; action: 'BUY' | 'SELL'; quantity: number }
  ) => {
    const cmd = resolvedCommand ?? null
    if (!cmd) return
    const { symbol: sym, action, quantity } = cmd
    const planId = `${Date.now()}-plan`

    setMessages(p => [...p, { id: planId, role: 'assistant', content: 'Preparing trade plan...', timestamp: new Date(), messageType: 'text' }])
    setIsLoading(true)

    try {
      const parsedStrategy = parseStrategyParameters(content)
      const requestedTimeframe = parsedStrategy.indicatorTimeframe ?? '1m'
      const [lp, liveSnapshot] = await Promise.all([fetchCurrentPrice(sym), fetchLiveIndicatorSnapshot(sym, requestedTimeframe)])

      const evaluatedConditions: TradeCondition[] = parsedStrategy.conditions.map(condition => {
        if (condition.thresholdIndicator) {
          const raw1 = liveSnapshot?.indicators?.[condition.indicator.toLowerCase()]
          const raw2 = liveSnapshot?.indicators?.[condition.thresholdIndicator.toLowerCase()]
          const currentValue   = typeof raw1 === 'number' && Number.isFinite(raw1) ? raw1 : undefined
          const thresholdValue = typeof raw2 === 'number' && Number.isFinite(raw2) ? raw2 : undefined
          const isMet = (currentValue !== undefined && thresholdValue !== undefined)
            ? compareCondition(currentValue, condition.operator, thresholdValue)
            : undefined
          return { ...condition, currentValue, threshold: thresholdValue ?? condition.threshold, isMet }
        }
        const raw = liveSnapshot?.indicators?.[condition.indicator.toLowerCase()]
        const currentValue = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
        const isMet = typeof currentValue === 'number' ? compareCondition(currentValue, condition.operator, condition.threshold) : undefined
        return { ...condition, currentValue, isMet }
      })

      // If user wrote a conditional phrase but regex couldn't parse it, block immediate execution
      const hasConditionalLanguage = /\b(when|jab|jaise\s*hi|as\s*soon\s*as|if|agar|once)\b/i.test(content)
      const conditionsPassed =
        (evaluatedConditions.length === 0 && !hasConditionalLanguage) ||
        evaluatedConditions.every(c => c.isMet === true)
      const plan: TradePlan = {
        symbol: sym, action, quantity,
        currentPrice: lp,
        estimatedCost: lp ? lp * quantity : 0,
        conditions: evaluatedConditions, conditionsPassed,
        strategyParams: parsedStrategy.strategyParams,
        targetProfitPct: parsedStrategy.targetProfitPct,
        liveIndicators: liveSnapshot?.indicators,
        indicatorTimeframe: liveSnapshot?.timeframe ?? requestedTimeframe,
        originalContent: content, sessionId: sid,
      }

      const planMsg: Message = {
        id: planId, role: 'assistant', content: `Trade plan for ${sym}`,
        timestamp: new Date(), messageType: 'trade-plan-review', tradePlan: plan,
      }
      setMessages(prev => prev.map(m => m.id === planId ? planMsg : m))
      setPendingTradePlan({ plan, messageId: planId })
    } catch (err: any) {
      setMessages(prev => prev.map(m => m.id === planId ? { ...m, content: `Failed to prepare trade plan: ${err.message}` } : m))
    } finally {
      setIsLoading(false)
    }
  }

  // Phase 2: Execute after user clicks "Execute Trade"
  const executePendingTrade = async () => {
    if (!pendingTradePlan) return
    const { plan, messageId } = pendingTradePlan
    setPendingTradePlan(null)
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content: `Trade plan for ${plan.symbol} — Confirmed` } : m))

    const tradingSettings = await fetchTradingSettings()
    const liveMode = tradingSettings.tradingMode === 'LIVE'
    const hasConditions = plan.conditions.length > 0
    const conditionsMet = plan.conditionsPassed

    if (hasConditions && !conditionsMet) {
      if (liveMode) {
        setMessages(p => [...p, {
          id: `${Date.now()}-live-watch-blocked`,
          role: 'assistant',
          content: 'LIVE mode me conditional watch support abhi enabled nahi hai. Condition meet hone ke baad Execute Trade karo.',
          timestamp: new Date(),
          messageType: 'text',
        }])
        return
      }

      const watchId = `${Date.now()}-watch`
      const watchSteps: TradeStep[] = [
        { label: `Order confirmed: ${plan.action} ${plan.quantity} ${plan.symbol}`, status: 'completed' },
        { label: 'Registering server-side watcher...', status: 'pending' },
        { label: 'Execute on condition match', status: 'pending' },
      ]
      setMessages(p => [...p, { id: watchId, role: 'assistant', content: 'Setting up trade watcher...', timestamp: new Date(), messageType: 'trade-status', tradeSteps: watchSteps }])
      setIsWatchingConditions(true)
      try {
        const r = await fetch('/api/paper-trade', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: plan.symbol, action: plan.action, quantity: plan.quantity, productType: 'INTRADAY', orderType: 'MARKET', status: 'PENDING', conditions: plan.conditions, sessionId: plan.sessionId }),
        })
        const result = await r.json()
        if (!result.success) throw new Error(result.error || 'Failed to register watch order')
        setMessages(prev => prev.map(m => {
          if (m.id !== watchId || !m.tradeSteps) return m
          const u = [...m.tradeSteps]
          u[1] = { label: 'Watching for conditions (Server-side)', status: 'pending', detail: 'Trade will auto-execute when conditions are met, even if you go offline.' }
          return { ...m, tradeSteps: u }
        }))
      } catch (err: any) {
        setMessages(prev => prev.map(m => m.id === watchId ? { ...m, tradeSteps: [watchSteps[0], { ...watchSteps[1], status: 'failed', detail: err.message }, watchSteps[2]] } : m))
      }
      return
    }

    const tid = `${Date.now()}-timeline`
    const steps: TradeStep[] = [
      { label: `Order confirmed: ${plan.action} ${plan.quantity} ${plan.symbol}`, status: 'completed' },
      { label: 'Fetching execution price', detail: 'Source: EC2 WebSocket', status: 'pending' },
      { label: 'Executing trade', status: 'pending' },
    ]
    setMessages(p => [...p, { id: tid, role: 'assistant', content: 'Executing trade...', timestamp: new Date(), messageType: 'trade-status', tradeSteps: steps }])

    const lp = await fetchCurrentPrice(plan.symbol)
    const updatedStep1 = lp != null
      ? { ...steps[1], status: 'completed' as const, detail: `Source: Live price API • Current ${plan.symbol}: ₹${lp.toFixed(2)}` }
      : { ...steps[1], status: 'failed' as const, detail: `Live price unavailable for ${plan.symbol}. Market may be closed.` }
    setMessages(prev => prev.map(m => {
      if (m.id !== tid || !m.tradeSteps) return m
      const u = [...m.tradeSteps]; u[1] = updatedStep1; return { ...m, tradeSteps: u }
    }))

    try {
      const r = await fetch('/api/trading/execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: plan.symbol,
          side: plan.action,
          quantity: plan.quantity,
          productType: 'INTRADAY',
          orderType: 'MARKET',
          mode: liveMode ? 'LIVE' : 'PAPER',
          brokerName: liveMode ? tradingSettings.preferredLiveBroker : null,
          confirmed: true,
          sessionId: plan.sessionId,
          idempotencyKey: makeIdempotencyKey('aichat'),
        }),
      })
      const result = await r.json()
      if (!r.ok || !result.success) throw new Error(result.error || 'Trade execution failed')

      const execution = result.data || {}
      if (execution.status === 'PENDING' || execution.deferred) {
        const deferredReason = typeof execution.deferredReason === 'string' ? execution.deferredReason : ''
        const marketClosed = /market\s+is\s+currently\s+closed|market\s+is\s+closed/i.test(deferredReason)
        const pendingDetail = execution.message || (marketClosed
          ? 'Market is closed. Trade moved to Conditional. It will auto-execute when market opens.'
          : 'Live execution feed is temporarily unavailable. Trade moved to Conditional and will auto-execute during market hours once feed is available.')
        const finalStep2: TradeStep = { ...steps[2], status: 'completed', detail: pendingDetail }
        const statusMsg: Message = {
          id: tid,
          role: 'assistant',
          content: 'Trade queued in Conditional',
          timestamp: new Date(),
          messageType: 'trade-status',
          tradeSteps: [steps[0], updatedStep1, finalStep2],
        }
        const followUpMsg: Message = {
          id: `${tid}-queued`,
          role: 'assistant',
          content: marketClosed
            ? 'Market is currently closed. Trade has been placed under Conditional and will execute automatically when market opens.'
            : 'Live execution feed is temporarily unavailable. Trade has been placed under Conditional and will execute automatically during market hours once the feed is available.',
          timestamp: new Date(),
          messageType: 'text',
        }
        setMessages(prev => {
          const updated = prev.map(m => m.id === tid ? statusMsg : m)
          return [...updated, followUpMsg]
        })
        return
      }

      const execPrice = Number(execution.executedPrice || lp || 0)
      const mktPrice = Number(lp ?? execPrice)
      const invested = execPrice * plan.quantity
      const returns = computeReturns(plan.action, execPrice, mktPrice, plan.quantity)
      const parsedStrategy = parseStrategyParameters(plan.originalContent)
      const targetPrice = parsedStrategy.targetProfitPct
        ? plan.action === 'BUY' ? execPrice * (1 + parsedStrategy.targetProfitPct / 100) : execPrice * (1 - parsedStrategy.targetProfitPct / 100)
        : undefined
      const currentProfitPct = plan.action === 'BUY' ? ((mktPrice / execPrice) - 1) * 100 : ((execPrice / mktPrice) - 1) * 100
      const targetProgressPct = parsedStrategy.targetProfitPct ? (currentProfitPct / parsedStrategy.targetProfitPct) * 100 : undefined

      const finalStep2: TradeStep = { ...steps[2], status: 'completed', detail: `Trade executed: ${plan.action} ${plan.quantity} ${plan.symbol} @ ₹${execPrice.toFixed(2)}` }
      const statusMsg: Message = { id: tid, role: 'assistant', content: 'Trade executed', timestamp: new Date(), messageType: 'trade-status', tradeSteps: [steps[0], updatedStep1, finalStep2] }
      const summaryMsg: Message = {
        id: `${tid}-summary`, role: 'assistant', content: `${plan.symbol} paper trade summary`,
        timestamp: new Date(), messageType: 'trade-summary',
        tradeCard: {
          symbol: plan.symbol, action: plan.action, quantity: plan.quantity,
          avgPrice: execPrice, marketPrice: mktPrice, returns, investedAmount: invested,
          isLive: true, priceSource: 'EC2 WebSocket',
          strategyParams: plan.strategyParams, conditions: plan.conditions,
          targetProfitPct: plan.targetProfitPct, targetPrice, currentProfitPct, targetProgressPct,
          liveIndicators: plan.liveIndicators,
        },
      }
      setMessages(prev => { const updated = prev.map(m => m.id === tid ? statusMsg : m); return [...updated, summaryMsg] })
    } catch (err: any) {
      const failedStep: TradeStep = { ...steps[2], status: 'failed', detail: err.message }
      setMessages(prev => prev.map(m => m.id === tid ? { ...m, tradeSteps: [steps[0], updatedStep1, failedStep] } : m))
    }
  }

  const handleTradeIntentRequest = async (content: string, sessionIdToUse: string | null) => {
    const tradeCommand = await resolveTradeCommand(content)
    if (!tradeCommand) return false

    if (tradeCommand.needsSymbol || tradeCommand.needsQuantity || !tradeCommand.symbol || tradeCommand.quantity == null) {
      const clarificationMsg: Message = {
        id: `${Date.now()}-trade-clarify`,
        role: 'assistant',
        content: buildTradeClarificationMessage(
          {
            action: tradeCommand.action,
            quantity: tradeCommand.quantity,
            symbolHint: tradeCommand.symbol,
            resolvedFromContext: tradeCommand.resolvedFromContext,
            needsQuantity: tradeCommand.needsQuantity,
            needsSymbol: tradeCommand.needsSymbol,
          },
          tradeCommand.symbol
        ),
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, clarificationMsg])
      if (sessionIdToUse) {
        await saveMessage(clarificationMsg)
      }
      return true
    }

    await processPaperTradeCommand(content, sessionIdToUse, {
      symbol: tradeCommand.symbol,
      action: tradeCommand.action,
      quantity: tradeCommand.quantity,
    })
    return true
  }

  const cancelPendingTrade = () => {
    if (!pendingTradePlan) return
    const { messageId, plan } = pendingTradePlan
    setPendingTradePlan(null)
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content: `Trade plan for ${plan.symbol} — Cancelled` } : m))
    setMessages(p => [...p, { id: `${Date.now()}-cancel`, role: 'assistant', content: 'Trade cancelled. What would you like to do next?', timestamp: new Date(), messageType: 'text' }])
  }

  const stopConditionWatching = () => {
    setIsWatchingConditions(false)
    setMessages(p => [...p, { id: `${Date.now()}-stopwatch`, role: 'assistant', content: 'Condition watching stopped. Trade was not executed.', timestamp: new Date(), messageType: 'text' }])
  }

  const handleExitTrade = async (message: Message) => {
    const c = message.tradeCard
    if (!c) return
    const exitAction = c.action === 'BUY' ? 'SELL' : 'BUY'
    const tid = `${Date.now()}-exit`
    const steps: TradeStep[] = [
      { label: `Exit request: ${exitAction} ${c.quantity} ${c.symbol}`, status: 'completed' },
      { label: 'Fetching exit price', status: 'pending' },
      { label: 'Executing exit trade', status: 'pending' },
    ]
    setMessages(p => [...p, { id: tid, role: 'assistant', content: `Exiting ${c.symbol} position`, timestamp: new Date(), messageType: 'trade-status', tradeSteps: steps }])
    const quoteCheck = await getFreshEC2ExitPrice(c.symbol)
    const updatedStep1 = quoteCheck.ok
      ? { ...steps[1], status: 'completed' as const, detail: `Exit price (EC2 Live): ₹${quoteCheck.price.toFixed(2)}` }
      : { ...steps[1], status: 'failed' as const, detail: `Exit blocked: ${quoteCheck.reason}` }

    setMessages(prev => prev.map(m => {
      if (m.id !== tid || !m.tradeSteps) return m
      const u = [...m.tradeSteps]; u[1] = updatedStep1; return { ...m, tradeSteps: u }
    }))

    if (!quoteCheck.ok) {
      const failedStep2: TradeStep = { ...steps[2], status: 'failed', detail: 'Exit not executed.' }
      setMessages(prev => prev.map(m => {
        if (m.id !== tid || !m.tradeSteps) return m
        return { ...m, tradeSteps: [steps[0], updatedStep1, failedStep2] }
      }))
      return
    }

    setMessages(prev => prev.map(m =>
      m.id === message.id && m.tradeCard ? { ...m, tradeCard: { ...m.tradeCard, isLive: false } } : m
    ))

    const ep = quoteCheck.price
    const finalStep2: TradeStep = { ...steps[2], status: 'completed', detail: `${exitAction} ${c.quantity} ${c.symbol} @ ₹${ep.toFixed(2)}` }
    const closedMsg: Message = {
      id: `${tid}-closed`, role: 'assistant', content: `${c.symbol} position closed`,
      timestamp: new Date(), messageType: 'trade-summary',
      tradeCard: { symbol: c.symbol, action: c.action, quantity: c.quantity, avgPrice: c.avgPrice, marketPrice: ep, returns: computeReturns(c.action, c.avgPrice, ep, c.quantity), investedAmount: c.investedAmount, isLive: false, priceSource: 'Closed' },
    }
    setMessages(prev => { const updated = prev.map(m => m.id === tid ? { ...m, tradeSteps: [steps[0], updatedStep1, finalStep2] } : m); return [...updated, closedMsg] })
  }

  // ── Live P&L polling ──────────────────────────────────────
  const liveCount = useMemo(() => messages.filter(m => m.tradeCard?.isLive).length, [messages])

  useEffect(() => {
    if (liveCount === 0) return
    const update = async () => {
      try {
        const symSet = new Set<string>()
        messagesRef.current.forEach((m) => {
          if (m.tradeCard?.isLive) symSet.add(m.tradeCard.symbol.toUpperCase())
        })
        const symbols = Array.from(symSet)
        if (symbols.length === 0) return

        const r = await fetch('/api/live-price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols }),
          cache: 'no-store',
        })
        if (!r.ok) return
        const j = await r.json()
        if (!j?.success || !j?.data) return

        const toAutoExit: Message[] = []

        setMessages(prev => {
          const updated = prev.map(m => {
            const c = m.tradeCard
            if (!c?.isLive) return m
            const u = c.symbol.toUpperCase()
            const ld = j.data[c.symbol] ?? j.data[u]
            if (!ld || typeof ld.ltp !== 'number') return m
            const currentProfitPct = c.action === 'BUY' ? ((ld.ltp / c.avgPrice) - 1) * 100 : ((c.avgPrice / ld.ltp) - 1) * 100
            const targetProgressPct = c.targetProfitPct ? (currentProfitPct / c.targetProfitPct) * 100 : undefined
            const newCard = { ...c, marketPrice: ld.ltp, returns: computeReturns(c.action, c.avgPrice, ld.ltp, c.quantity), currentProfitPct, targetProgressPct }

            // Auto-exit when target profit reached
            if (c.targetProfitPct && currentProfitPct >= c.targetProfitPct && !autoExitTriggeredRef.current.has(m.id)) {
              autoExitTriggeredRef.current.add(m.id)
              toAutoExit.push({ ...m, tradeCard: newCard })
            }

            return { ...m, tradeCard: newCard }
          })

          // Trigger exits outside state updater
          if (toAutoExit.length > 0) {
            setTimeout(() => toAutoExit.forEach(msg => handleExitTrade(msg)), 0)
          }

          return updated
        })
      } catch { /* silent */ }
    }
    update()
    const iv = setInterval(update, 2000)
    return () => clearInterval(iv)
  }, [liveCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController()
    let requestTimeoutId: ReturnType<typeof setTimeout> | null = null

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    const userInput = input.toLowerCase().trim()
    setInput('')
    setIsLoading(true)

    // Save user message to DB
    await saveMessage(userMessage)

    try {
      // Handle casual greetings without calling API
      const greetings = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening', 'namaste']
      const thanks = ['thanks', 'thank you', 'thx', 'ty']

      if (greetings.includes(userInput)) {
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Hello! 👋 How can I help you analyze ${symbol} today? You can ask me about trends, technical indicators, or trading signals!`,
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, assistantMessage])
        await saveMessage(assistantMessage)
        setIsLoading(false)
        return
      }

      if (thanks.includes(userInput)) {
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `You're welcome! Feel free to ask me anything else about ${symbol}! 😊`,
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, assistantMessage])
        await saveMessage(assistantMessage)
        setIsLoading(false)
        return
      }

      // ── Detect "exit at X% profit" for an existing live position ──
      const exitProfitMatch = input.trim().match(
        /(\d+(?:\.\d+)?)\s*%?\s*(?:profit|p)?\s*(?:pr|par|pe|at|on|per|mein?|k(?:e)? baad)?\s*exit|exit\s+(?:le(?:lna|na|lo)?|karo|karna|dena)?\s*(?:\S+\s*)*?(\d+(?:\.\d+)?)\s*%\s*(?:profit|p)?/i
      )
      const exitPct = exitProfitMatch ? Number(exitProfitMatch[1] ?? exitProfitMatch[2]) : null
      if (exitPct && Number.isFinite(exitPct) && exitPct > 0) {
        const liveTrades = messages.filter(m => m.tradeCard?.isLive)
        if (liveTrades.length > 0) {
          const latestTrade = liveTrades[liveTrades.length - 1]
          const card = latestTrade.tradeCard!
          const targetPrice = card.action === 'BUY'
            ? card.avgPrice * (1 + exitPct / 100)
            : card.avgPrice * (1 - exitPct / 100)
          setMessages(prev => prev.map(m =>
            m.id === latestTrade.id && m.tradeCard
              ? { ...m, tradeCard: { ...m.tradeCard, targetProfitPct: exitPct } }
              : m
          ))
          const confirmMsg: Message = {
            id: `${Date.now()}-target-set`,
            role: 'assistant',
            content: `✅ **Target set!** Will auto-exit **${card.symbol}** when profit reaches **${exitPct}%** (target price ≈ ₹${targetPrice.toFixed(2)})\n\nMonitoring live P&L every 2 seconds — position will close automatically when target is hit. 👀`,
            timestamp: new Date(),
          }
          setMessages(prev => [...prev, confirmMsg])
          await saveMessage(confirmMsg)
          setIsLoading(false)
          return
        }
      }

      const tradeHandled = await handleTradeIntentRequest(input.trim(), sessionId)
      if (tradeHandled) {
        return
      }

      // Build conversation history (last 40 messages for context)
      const conversationHistory = messages.slice(-40).map(msg => ({
        role: msg.role,
        content: msg.content,
      }))

      setThinkingSteps([{ type: 'thinking', text: '🧠 Understanding your question...' }])

      // Auto-abort after 2 minutes to prevent infinite thinking spinner
      requestTimeoutId = setTimeout(() => {
        if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
          abortControllerRef.current.abort('timeout')
        }
      }, 120000)

      // Call streaming AI analysis API so the UI can show live backend steps
      const response = await fetch(`/api/stocks/${symbol}/analyze/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: input,
          timeframe: '1d',
          conversationHistory,
          conversationMemory: conversationMemoryRef.current,
          computeModel: provider,
        }),
        signal: abortControllerRef.current?.signal, // Add abort signal
      })

      // Check if aborted
      if (abortControllerRef.current?.signal.aborted) {
        setIsLoading(false)
        return
      }

      if (!response.ok) {
        let streamError = 'Streaming request failed'
        try {
          const errPayload = await response.json()
          if (typeof errPayload?.error === 'string' && errPayload.error.trim().length > 0) {
            streamError = errPayload.error
          }
        } catch {
          // Ignore parse failures.
        }
        if (response.status === 429) {
          // rate limit placeholder — no longer active
        }
        throw new Error(streamError)
      }

      if (!response.body) {
        throw new Error('Streaming is not supported in this environment. Please try again.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let answerText = ''
      let webSources: { name: string; url: string }[] = []
      let latestMemory: any = conversationMemoryRef.current
      let streamedTradeIntent: {
        symbol: string
        action: 'BUY' | 'SELL'
        quantity: number
      } | null = null
      let streamDone = false

      while (!streamDone) {
        const { value, done } = await reader.read()
        streamDone = done
        if (value) {
          buffer += decoder.decode(value, { stream: true })
        }

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue

          let event: any
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          if (event.type === 'thinking') {
            setThinkingSteps(prev => [...prev, { type: 'thinking', text: event.step }])
          } else if (event.type === 'routing_options') {
            const optionLabels: string[] = []
            if (Array.isArray(event.options)) {
              for (const option of event.options as Array<{ label?: unknown }>) {
                if (typeof option.label === 'string' && option.label.length > 0) {
                  optionLabels.push(option.label)
                }
              }
            }
            const count = optionLabels.length
            const detail = count > 0 ? ` (${optionLabels.join(', ')})` : ''
            setThinkingSteps(prev => [...prev, {
              type: 'routing_options',
              text: `🧭 Reply paths available: ${count}${detail}`,
              data: event.options,
            }])
          } else if (event.type === 'tool_start') {
            setThinkingSteps(prev => [...prev, {
              type: 'tool_start',
              text: `🔧 Calling ${event.tool}(${JSON.stringify(event.args)})`,
              data: event,
            }])
          } else if (event.type === 'tool_end') {
            setThinkingSteps(prev => [...prev, {
              type: 'tool_end',
              text: `✅ ${event.tool} returned data`,
              data: event.result,
            }])
          } else if (event.type === 'memory_update') {
            latestMemory = event.memory || null
          } else if (event.type === 'trade_intent') {
            const tradeSymbol = typeof event.symbol === 'string' ? event.symbol.trim().toUpperCase() : ''
            const quantity = Number(event.quantity)
            const action = event.action === 'SELL' ? 'SELL' : 'BUY'
            if (tradeSymbol && Number.isFinite(quantity) && quantity > 0) {
              streamedTradeIntent = {
                symbol: tradeSymbol,
                action,
                quantity: Math.max(1, Math.floor(quantity)),
              }
            }
          } else if (event.type === 'answer') {
            answerText = event.message || ''
            webSources = Array.isArray(event.webSources) ? event.webSources : []
          } else if (event.type === 'error') {
            throw new Error(event.message)
          }
        }
      }

      conversationMemoryRef.current = latestMemory || null

      if (streamedTradeIntent) {
        await processPaperTradeCommand(input, sessionId, {
          symbol: streamedTradeIntent.symbol,
          action: streamedTradeIntent.action,
          quantity: streamedTradeIntent.quantity,
        })
        return
      }

      let mainContent = answerText || 'I apologize, but I encountered an error analyzing the data. Please try again.'

      if (webSources.length > 0) {
        mainContent = `🌐 *Web search used*\n\n${mainContent}`
      }

      let extractedCode = null

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: mainContent,
        timestamp: new Date(),
        sql: undefined,
        webSources,
        debug: extractedCode ? {
          context: '',
          specificTimeRecords: 0,
          targetDate: null,
          extractedCode,
        } : undefined
      }

      setMessages((prev) => [...prev, assistantMessage])
      await saveMessage(assistantMessage)
    } catch (error: any) {
      // If aborted — distinguish between user-cancelled and timeout
      if (error.name === 'AbortError' || abortControllerRef.current?.signal.aborted) {
        const reason = (abortControllerRef.current?.signal as any)?.reason
        if (reason === 'timeout') {
          // Show timeout error — don't leave user hanging
          const timeoutMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `⏱️ **Request timed out** after 2 minutes. The AI is taking too long to respond right now.\n\nPlease try again, or rephrase your question more simply.`,
            timestamp: new Date(),
          }
          setMessages(prev => [...prev, timeoutMsg])
          await saveMessage(timeoutMsg)
        } else {
          console.log('Request cancelled by user')
        }
        setIsLoading(false)
        return
      }

      console.error('Chat error:', error)
      let errorContent = 'I apologize, but I encountered an error. Please try again later.'

      // Try to extract more detailed error message
      if (error.message) {
        errorContent += `\n\nError: ${error.message}`
      }

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: errorContent,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
      await saveMessage(errorMessage)
    } finally {
      if (requestTimeoutId) clearTimeout(requestTimeoutId)
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Save to Sangraha handler
  const handleSaveToSangraha = async (messageId: string) => {
    if (!session) {
      router.push('/login?callbackUrl=' + encodeURIComponent(window.location.pathname))
      return
    }

    const message = messages.find(m => m.id === messageId)
    if (!message) return

    // Find the user query that led to this response
    const messageIndex = messages.findIndex(m => m.id === messageId)
    const userQuery = messageIndex > 0 ? messages[messageIndex - 1]?.content : ''

    setSaveMessageId(messageId)
    setSaveName(`${symbol} Strategy - ${new Date().toLocaleDateString()}`)
    setSaveDescription('')
    setSaveTags(symbol.toLowerCase())
    setShowSaveModal(true)
  }

  const confirmSaveToSangraha = async () => {
    if (!saveMessageId || !saveName.trim()) return

    const message = messages.find(m => m.id === saveMessageId)
    if (!message) return

    const messageIndex = messages.findIndex(m => m.id === saveMessageId)
    const userQuery = messageIndex > 0 ? messages[messageIndex - 1]?.content : ''

    setIsSaving(true)

    try {
      const response = await fetch('/api/sangraha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveName,
          description: saveDescription,
          naturalInput: userQuery,
          strategyCode: {
            type: 'sql_query',
            sql: message.debug?.extractedCode || message.sql,
            response: message.content
          },
          sqlQuery: message.debug?.extractedCode || message.sql,
          stockSymbol: symbol,
          strategyType: 'probability',
          tags: saveTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
          visibility: saveVisibility
        })
      })

      const data = await response.json()

      if (data.success) {
        setShowSaveModal(false)
        router.push(`/sangraha/${data.data.id}`)
      } else {
        alert(data.error || 'Failed to save strategy')
      }
    } catch (error) {
      console.error('Error saving:', error)
      alert('Failed to save strategy')
    } finally {
      setIsSaving(false)
    }
  }

  const suggestedQuestions = [
    "What's the current trend?",
    "Analyze RSI and MACD",
    "How many weeks were positive?",
    "Show highest volume days",
  ]

  if (loadingSession) {
    return (
      <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl border border-white/10 h-full lg:h-[calc(100vh-120px)] flex items-center justify-center">
        <Loader size={48} />
      </div>
    )
  }

  return (
    <div
      className={`bg-dark-100/60 backdrop-blur-xl rounded-2xl lg:rounded-2xl border border-white/10 flex flex-col transition-all duration-300 ${isFullscreen
        ? 'fixed inset-4 z-50 h-auto'
        : 'h-full lg:h-[calc(100vh-120px)]'
        }`}
    >
      {/* Auth Required Overlay - Show when not logged in */}
      {!session?.user && (
        <div className="absolute inset-0 z-50 bg-dark-100/95 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center p-6">
          <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl flex items-center justify-center mb-4">
            <Bot className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Sign in to Chat</h3>
          <p className="text-gray-400 text-center mb-6 max-w-xs">
            Please sign in to use the AI chatbot and get intelligent stock analysis.
          </p>
          <button
            onClick={() => router.push('/login?callbackUrl=' + encodeURIComponent(window.location.pathname))}
            className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold rounded-xl hover:from-emerald-600 hover:to-green-700 transition-all"
          >
            Sign In
          </button>
          <p className="text-sm text-gray-500 mt-4">
            Don&apos;t have an account?{' '}
            <button
              onClick={() => router.push('/signup')}
              className="text-emerald-400 hover:text-emerald-300"
            >
              Create one
            </button>
          </p>
        </div>
      )}

      {/* Fullscreen overlay backdrop */}
      {isFullscreen && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsFullscreen(false)}
        />
      )}

      {/* History Sidebar */}
      {showHistory && (
        <div className="absolute inset-0 z-50 bg-dark-100 rounded-2xl flex flex-col">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <History className="w-5 h-5" />
              Chat History
            </h3>
            <button onClick={() => setShowHistory(false)} className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <button
              onClick={startNewChat}
              className="w-full flex items-center gap-2 p-3 mb-2 bg-emerald-500/20 hover:bg-emerald-500/30 rounded-xl text-emerald-400 font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Chat
            </button>
            {sessions.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No chat history yet</p>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors ${session.id === sessionId ? 'bg-white/10' : 'hover:bg-white/5'
                    }`}
                >
                  <div className="flex-1 min-w-0" onClick={() => switchSession(session.id)}>
                    <p className="text-sm font-medium text-white truncate">
                      {session.title || 'New Chat'}
                    </p>
                    <p className="text-xs text-gray-400">
                      {session.messageCount} messages • {new Date(session.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteSession(session.id)
                    }}
                    className="p-1 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className={`flex flex-col h-full ${isFullscreen ? 'relative z-50' : ''}`}>
        {/* Header */}
        <div className="p-4 border-b border-white/10 bg-gradient-to-r from-emerald-500/10 to-green-500/5 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center shadow-glow-green">
                <Bot className="w-6 h-6 text-white" />
              </div>
                <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white">AI Stock Analyst</h3>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setShowProviderMenu(!showProviderMenu)}
                    className="flex items-center gap-2 text-xs bg-dark-400/50 border border-white/10 rounded-lg px-2 py-1 hover:bg-white/10 text-gray-300 transition-colors"
                  >
                    {computeLogo}
                    <span>{currentProvider?.name || 'Compute 0.5'}</span>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showProviderMenu && (
                    <div className="absolute top-full left-0 mt-1 bg-dark-100 border border-white/10 rounded-xl shadow-lg z-50 min-w-[160px]">
                      {providers.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setProvider(p.id)
                            setShowProviderMenu(false)
                          }}
                          className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-300 hover:bg-white/10 transition-colors ${provider === p.id ? 'bg-white/10' : ''}`}
                        >
                          {computeLogo}
                          <span>{p.name}</span>
                          {provider === p.id && (
                            <svg className="w-3 h-3 ml-auto text-green-500" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {/* Action Buttons — hidden on mobile, visible on sm+ */}
            <div className="hidden sm:flex items-center gap-1">
              <button
                onClick={() => setShowHistory(true)}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                title="Chat History"
              >
                <History className="w-5 h-5 text-gray-400 hover:text-white" />
              </button>
              <button
                onClick={startNewChat}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                title="New Chat"
              >
                <Plus className="w-5 h-5 text-gray-400 hover:text-white" />
              </button>
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                title={isFullscreen ? 'Minimize' : 'Fullscreen'}
              >
                {isFullscreen ? (
                  <Minimize2 className="w-5 h-5 text-gray-400" />
                ) : (
                  <Maximize2 className="w-5 h-5 text-gray-400" />
                )}
              </button>
              {isFullscreen && (
                <button
                  onClick={() => setIsFullscreen(false)}
                  className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                  title="Close fullscreen"
                >
                  <span className="text-red-500 font-bold text-lg">✕</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.role === 'assistant' && (
                <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-white" />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${message.role === 'user'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-dark-400/50 text-gray-100'
                  }`}
              >
                {/* Trade Status Card */}
                {message.messageType === 'trade-status' && message.tradeSteps ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Trade Progress</p>
                    {message.tradeSteps.map((step, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="mt-0.5">
                          {step.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                          {step.status === 'pending' && <CircleDashed className="w-4 h-4 text-gray-500 animate-spin" />}
                          {step.status === 'failed' && <AlertTriangle className="w-4 h-4 text-red-400" />}
                        </div>
                        <div>
                          <p className="text-sm text-white">{step.label}</p>
                          {step.detail && <p className="text-xs text-gray-400">{step.detail}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : message.messageType === 'trade-plan-review' && message.tradePlan ? (() => {
                  const plan = message.tradePlan
                  const isConfirmed = message.content.includes('Confirmed')
                  const isCancelled = message.content.includes('Cancelled')
                  const isActionable = !isConfirmed && !isCancelled && pendingTradePlan?.messageId === message.id
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-emerald-500" />
                          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Trade Plan Review</p>
                        </div>
                        {isConfirmed && <span className="text-xs px-2 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600">Confirmed</span>}
                        {isCancelled && <span className="text-xs px-2 py-1 rounded-lg border border-red-500/30 bg-red-500/10 text-red-500">Cancelled</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-white/10 bg-dark-300/40 p-2">
                          <p className="text-[10px] text-gray-500 uppercase">Action</p>
                          <p className={`text-sm font-bold ${plan.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{plan.action}</p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-dark-300/40 p-2">
                          <p className="text-[10px] text-gray-500 uppercase">Qty</p>
                          <p className="text-sm text-white font-medium">{plan.quantity} shares</p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-dark-300/40 p-2">
                          <p className="text-[10px] text-gray-500 uppercase">Live Price</p>
                          <p className="text-sm text-white">{plan.currentPrice ? `₹${plan.currentPrice.toFixed(2)}` : 'N/A'}</p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-dark-300/40 p-2">
                          <p className="text-[10px] text-gray-500 uppercase">Est. Cost</p>
                          <p className="text-sm text-white">₹{plan.estimatedCost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                        </div>
                      </div>
                      {plan.conditions.length > 0 && (
                        <div className="rounded-lg border border-white/10 bg-dark-300/30 p-2 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <BarChart3 className="w-3.5 h-3.5 text-purple-400" />
                            <p className="text-[10px] text-gray-500 uppercase">Conditions</p>
                          </div>
                          {plan.conditions.map((c, i) => {
                            const passed = c.isMet === true
                            const failed = c.isMet === false
                            const isCross = !!c.thresholdIndicator
                            const lhsVal = typeof c.currentValue === 'number' ? c.currentValue.toFixed(2) : null
                            const rhsVal = isCross && typeof c.threshold === 'number' && c.threshold !== 0 ? c.threshold.toFixed(2) : null
                            return (
                              <div key={i} className={`rounded-md px-2 py-1.5 border space-y-1 ${passed ? 'border-emerald-500/30 bg-emerald-500/5' : failed ? 'border-red-500/30 bg-red-500/5' : 'border-white/10 bg-white/5'}`}>
                                {/* Row 1: icon + label + verdict */}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5">
                                    {passed ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : failed ? <XCircle className="w-3 h-3 text-red-400" /> : <CircleDashed className="w-3 h-3 text-gray-500" />}
                                    <span className="text-xs text-white font-medium">{c.indicator} {c.operator} {c.thresholdIndicator ?? c.threshold}</span>
                                  </div>
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${passed ? 'text-emerald-400 bg-emerald-500/10' : failed ? 'text-red-400 bg-red-500/10' : 'text-gray-500'}`}>
                                    {passed ? '✓ Met' : failed ? '✗ Not Met' : 'Pending'}
                                  </span>
                                </div>
                                {/* Row 2: live numeric values */}
                                {isCross ? (
                                  <div className="flex items-center gap-1.5 pl-4">
                                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${passed ? 'border-emerald-500/20 text-emerald-300' : failed ? 'border-red-500/20 text-red-300' : 'border-white/10 text-gray-400'}`}>
                                      {c.indicator}: <strong>{lhsVal ?? '…'}</strong>
                                    </span>
                                    <span className="text-[10px] text-gray-600">{c.operator}</span>
                                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${passed ? 'border-emerald-500/20 text-emerald-300' : failed ? 'border-red-500/20 text-red-300' : 'border-white/10 text-gray-400'}`}>
                                      {c.thresholdIndicator}: <strong>{rhsVal ?? '…'}</strong>
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 pl-4">
                                    <span className="text-[10px] text-gray-500">Current:</span>
                                    <span className={`text-[10px] font-mono font-semibold ${passed ? 'text-emerald-300' : failed ? 'text-red-300' : 'text-gray-400'}`}>{lhsVal ?? 'N/A'}</span>
                                    <span className="text-[10px] text-gray-600">(target: {c.operator} {c.threshold})</span>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {plan.conditions.length > 0 && !plan.conditionsPassed && (
                        <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-yellow-300">Conditions not met. Click <strong>Watch & Execute</strong> to monitor and auto-execute when conditions are satisfied.</p>
                        </div>
                      )}
                      {isWatchingConditions && isConfirmed && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 flex items-center gap-2 px-2.5 py-2 rounded-xl border border-yellow-500/20 bg-yellow-500/5">
                            <CircleDashed className="w-3.5 h-3.5 text-yellow-400 animate-spin" />
                            <span className="text-xs text-yellow-300">Watching for conditions...</span>
                          </div>
                          <button onClick={stopConditionWatching} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-500/30 hover:bg-red-500/10 text-red-400 text-xs font-medium transition-all" type="button">
                            <Square className="w-3.5 h-3.5" /> Stop
                          </button>
                        </div>
                      )}
                      {isActionable && !isWatchingConditions && (
                        <div className="flex items-center gap-2">
                          <button onClick={executePendingTrade} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-xs font-semibold transition-all" type="button">
                            <Zap className="w-3.5 h-3.5" /> {plan.conditionsPassed ? 'Execute Trade' : 'Watch & Execute'}
                          </button>
                          <button onClick={cancelPendingTrade} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-white/10 hover:border-red-500/30 hover:bg-red-500/5 text-gray-400 hover:text-red-300 text-xs font-medium transition-all" type="button">
                            <X className="w-3.5 h-3.5" /> Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })() : message.messageType === 'trade-summary' && message.tradeCard ? (() => {
                  const c = message.tradeCard
                  const pos = c.returns >= 0
                  const isClosed = !c.isLive
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-white font-semibold">{c.symbol} • {c.action} {c.quantity} shares</p>
                          <p className="text-xs text-gray-400">Avg: ₹{c.avgPrice.toFixed(2)}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isClosed ? (
                            <span className="text-xs px-2 py-1 rounded-lg border border-gray-500/30 bg-gray-500/10 text-gray-400">CLOSED</span>
                          ) : (
                            <>
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                                <Activity className="w-3 h-3" />LIVE
                              </span>
                              <button onClick={() => handleExitTrade(message)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors" type="button">
                                <LogOut className="w-3 h-3" />Exit
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-white/10 bg-dark-300/40 p-2">
                          <p className="text-[10px] text-gray-500 uppercase">Market Price</p>
                          <p className="text-sm text-white">₹{c.marketPrice.toFixed(2)}</p>
                          <p className="text-[10px] text-gray-500">{c.priceSource || 'EC2'}</p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-dark-300/40 p-2">
                          <p className="text-[10px] text-gray-500 uppercase">Returns</p>
                          <p className={`text-sm font-semibold ${pos ? 'text-emerald-400' : 'text-red-400'}`}>₹{pos ? '+' : ''}{c.returns.toFixed(2)}</p>
                          {typeof c.currentProfitPct === 'number' && (
                            <p className={`text-[10px] ${c.currentProfitPct >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                              {c.currentProfitPct >= 0 ? '+' : ''}{c.currentProfitPct.toFixed(2)}%
                            </p>
                          )}
                        </div>
                        <div className="rounded-lg border border-white/10 bg-dark-300/40 p-2">
                          <p className="text-[10px] text-gray-500 uppercase">Invested</p>
                          <p className="text-sm text-white">₹{c.investedAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-dark-300/40 p-2">
                          <p className="text-[10px] text-gray-500 uppercase">Qty</p>
                          <p className="text-sm text-white">{c.quantity} shares</p>
                        </div>
                      </div>
                      {c.strategyParams && c.strategyParams.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {c.strategyParams.map(p => (
                            <span key={p.key} className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-gray-300">{p.label}: {p.value}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })() : (
                  <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                )}
                <span className="text-xs opacity-70 mt-1 block">
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>

                {/* Web Search Sources */}
                {message.webSources && message.webSources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-700/50">
                    <p className="text-xs font-medium text-gray-400 mb-2">Sources:</p>
                    <div className="flex flex-wrap gap-2">
                      {message.webSources.map((source, idx) => (
                        <a
                          key={idx}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs bg-dark-300 hover:bg-dark-200 text-emerald-600 px-2 py-1 rounded border border-gray-700 transition-colors truncate max-w-[200px]"
                          title={source.name}
                        >
                          {source.name}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Debug Info Button - Only for assistant messages with debug data */}
                {message.role === 'assistant' && message.debug && (
                  <div className="mt-2 pt-2 border-t border-white/10">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandedDebug(expandedDebug === message.id ? null : message.id)}
                        className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1"
                      >
                        <span>{expandedDebug === message.id ? '🔽' : '▶️'}</span>
                        {expandedDebug === message.id ? 'Hide' : 'Show'} SQL
                      </button>
                      <button
                        onClick={() => handleSaveToSangraha(message.id)}
                        className="text-xs text-emerald-500 hover:text-emerald-400 font-medium flex items-center gap-1 ml-2"
                      >
                        <Bookmark className="w-3 h-3" />
                        Save to Sangraha
                      </button>
                    </div>

                    {expandedDebug === message.id && (
                      <div className="mt-2 p-3 bg-dark-300 rounded-xl text-xs font-mono overflow-x-auto max-h-96 overflow-y-auto border border-white/10">
                        {message.debug.targetDateIST && (
                          <div className="mb-2 text-gray-300">
                            <strong className="text-emerald-400">Target Date (IST):</strong> {message.debug.targetDateIST}
                          </div>
                        )}
                        {message.debug.specificTimeRecords > 0 && (
                          <div className="mb-2 text-gray-300">
                            <strong className="text-emerald-400">Records Found:</strong> {message.debug.specificTimeRecords}
                          </div>
                        )}
                        <div className="mb-1">
                          <strong className="text-emerald-400">💻 SQL Used:</strong>
                        </div>
                        <pre className="whitespace-pre-wrap text-[11px] bg-black text-emerald-400 p-3 rounded-xl border border-emerald-500/20 font-mono">
                          {message.debug.extractedCode || 'No code was generated for this query.'}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {message.role === 'user' && (
                <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-white" />
                </div>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0 max-w-[85%]">
                <AnimatedThinking steps={thinkingSteps} timer={thinkingTime} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Suggested Questions */}
        {messages.length <= 1 && (
          <div className="px-4 pb-3">
            <p className="text-xs text-gray-500 mb-2">Suggested questions:</p>
            <div className="flex flex-wrap gap-2">
              {suggestedQuestions.map((question, idx) => (
                <button
                  key={idx}
                  onClick={() => setInput(question)}
                  className="text-xs px-3 py-1.5 bg-dark-400/50 hover:bg-emerald-500/20 rounded-full text-gray-300 hover:text-emerald-400 border border-white/10 hover:border-emerald-500/30 transition-colors"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input - Now using textarea for multi-line support */}
        <div className="p-4 border-t border-white/10">
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Ask about technical indicators..."
              className="flex-1 px-4 py-3 bg-dark-400/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 resize-none min-h-[48px] max-h-[120px] transition-all"
              disabled={isLoading}
              rows={1}
            />
            {isLoading ? (
              <button
                onClick={() => {
                  abortControllerRef.current?.abort()
                  setIsLoading(false)
                }}
                className="px-4 py-3 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white rounded-xl transition-all h-[48px] shadow-lg"
                title="Stop generating"
              >
                <Square className="w-5 h-5 fill-current" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="px-4 py-3 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all h-[48px] shadow-glow-green"
              >
                <Send className="w-5 h-5" />
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-2 text-center">
            AI can make mistakes. Verify important information.
          </p>
        </div>
      </div>

      {/* Save to Sangraha Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSaveModal(false)} />
          <div className="relative bg-dark-100 rounded-2xl p-6 w-full max-w-md border border-white/10 shadow-2xl">
            <button
              onClick={() => setShowSaveModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
                <Bookmark className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Save to Sangraha</h3>
                <p className="text-sm text-gray-400">Store this strategy in your repository</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Strategy Name *</label>
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="e.g., NIFTY Probability Strategy"
                  className="w-full px-4 py-2.5 bg-dark-400/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Description</label>
                <textarea
                  value={saveDescription}
                  onChange={(e) => setSaveDescription(e.target.value)}
                  placeholder="Brief description of the strategy..."
                  rows={2}
                  className="w-full px-4 py-2.5 bg-dark-400/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={saveTags}
                  onChange={(e) => setSaveTags(e.target.value)}
                  placeholder="e.g., nifty, probability, momentum"
                  className="w-full px-4 py-2.5 bg-dark-400/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Visibility</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setSaveVisibility('private')}
                    className={`flex-1 py-2 px-4 rounded-xl font-medium transition-colors ${saveVisibility === 'private'
                      ? 'bg-gray-500/30 text-white border border-gray-500/50'
                      : 'bg-dark-400/30 text-gray-400 border border-white/10'
                      }`}
                  >
                    🔒 Private
                  </button>
                  <button
                    onClick={() => setSaveVisibility('public')}
                    className={`flex-1 py-2 px-4 rounded-xl font-medium transition-colors ${saveVisibility === 'public'
                      ? 'bg-emerald-500/30 text-emerald-400 border border-emerald-500/50'
                      : 'bg-dark-400/30 text-gray-400 border border-white/10'
                      }`}
                  >
                    🌐 Public
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowSaveModal(false)}
                className="flex-1 py-2.5 px-4 bg-dark-400/50 text-gray-300 rounded-xl font-medium hover:bg-dark-400 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmSaveToSangraha}
                disabled={!saveName.trim() || isSaving}
                className="flex-1 py-2.5 px-4 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {isSaving ? (
                  <>
                    <Loader size={18} />
                    Saving...
                  </>
                ) : (
                  'Save Strategy'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trade Execution Modal */}
      <TradeExecutionModal
        isOpen={showTradeModal}
        onClose={() => setShowTradeModal(false)}
        symbol={tradeSymbol || symbol}
      />
    </div>
  )
}

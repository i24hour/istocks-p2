'use client'

import { useState, useRef, useEffect, useMemo, useCallback, Fragment, type CSSProperties } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import {
  Send, User, Loader2, TrendingUp, Zap,
  History, ChevronLeft, ChevronRight, ChevronDown,
  Plus, Sparkles, LogOut, X, Square,
  CircleDashed, CheckCircle2, AlertTriangle, Activity, PanelLeft,
  ShieldCheck, XCircle, Clock, DollarSign, BarChart3,
  Copy, Check, Pencil, Share2, Search, Palette, Key, Bot, Info, MessageCircle,
} from 'lucide-react'
import TradeExecutionModal from './TradeExecutionModal'
import { MaybePriceRangeScreenerMarkdown } from '@/components/PriceRangeScreenerMessage'
import { useTheme, type ThemeMode } from '@/components/ThemeProvider'
import { APP_NAV_ITEMS } from '@/config/app-navigation'
import { StockSearchModal } from '@/components/StockSearchModal'
import { cn } from '@/lib/utils'
import { PromptInputBox, type AttachedFile } from './ui/ai-prompt-box'
import {
  parseChatAttachment,
  buildAttachmentContext,
  defaultPromptForAttachments,
  downloadMergedExcel,
  getExcelAttachments,
  isMergeRequestText,
  type ParsedChatAttachment,
} from '@/lib/chat-attachments'
import { AnimatedTradeCard } from './ui/animated-trade-card'
import { AnimatedThinking } from './ui/animated-thinking'
import { resolveTradeCommandDraft, type TradeCommandDraft } from '@/lib/tradeCommandResolver'
import {
  COMPUTE_MODEL_OPTIONS,
  DEFAULT_COMPUTE_MODEL,
  isComputeModelId,
  type ComputeModelId,
} from '@/lib/compute-models.client'

const COMPUTE_MODEL_STORAGE_KEY = 'istocks.computeModel'

const ISTOCKS_WHATSAPP_GROUP_URL = 'https://chat.whatsapp.com/JVABfjLPJs1HIdArP2iQlG'

function TradingAgentEmptyBrand({ theme }: { theme: ThemeMode }) {
  const isDark = theme === 'dark'
  const isClaude = theme === 'claude-code'
  const clay = isClaude && !isDark

  const wordmarkStyle: CSSProperties = {
    backgroundImage: isDark
      ? 'linear-gradient(to right, #34d399, #22c55e)'
      : clay
        ? 'linear-gradient(to right, #d97757, #b4532a)'
        : 'linear-gradient(to right, #52a88c, #6bb89a)',
  }

  return (
    <div className="mb-6 sm:mb-8 flex flex-col items-center gap-3 sm:gap-4" aria-label="iStocks Trading Agent">
      <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center sm:gap-4">
        {clay ? (
          <svg viewBox="0 0 40 32" className="h-12 w-12 shrink-0 sm:h-14 sm:w-14" fill="none" aria-hidden>
            <rect x="0" y="4" width="6" height="28" rx="1" fill="#d97757" />
            <rect x="8" y="0" width="6" height="32" rx="1" fill="#c45a3c" />
            <rect x="16" y="14" width="6" height="18" rx="1" fill="#e07a5f" />
            <rect x="24" y="8" width="6" height="24" rx="1" fill="#b4532a" />
            <rect x="32" y="2" width="6" height="30" rx="1" fill="#d97757" />
          </svg>
        ) : (
          <svg viewBox="0 0 40 32" className="h-12 w-12 shrink-0 sm:h-14 sm:w-14" fill="none" aria-hidden>
            <rect x="0" y="4" width="6" height="28" rx="1" fill="#52c49a" />
            <rect x="8" y="0" width="6" height="32" rx="1" fill="#ef4444" />
            <rect x="16" y="14" width="6" height="18" rx="1" fill="#52c49a" />
            <rect x="24" y="8" width="6" height="24" rx="1" fill="#ef4444" />
            <rect x="32" y="2" width="6" height="30" rx="1" fill="#52c49a" />
          </svg>
        )}
        <div className="flex flex-col items-center gap-1 sm:items-start">
          <span
            className="bg-clip-text font-mono text-[2rem] font-black leading-none tracking-tight text-transparent sm:text-4xl md:text-5xl"
            style={wordmarkStyle}
          >
            iStocks
          </span>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)] sm:text-xs">
            Trading Agent
          </span>
        </div>
      </div>
    </div>
  )
}

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
  entryPrice?: number | null  // explicit limit price from user ("at 208", "@ 208")
  estimatedCost: number
  conditions: TradeCondition[]
  conditionsPassed: boolean
  strategyParams: TradeParam[]
  targetProfitPct?: number
  liveIndicators?: Record<string, number>
  indicatorTimeframe?: string   // e.g. '1m', '1d', '5m', '1h'
  workflowStatus?: 'proposed' | 'watching' | 'processing' | 'executed' | 'cancelled' | 'failed'
  // The original user prompt and session context for execution
  originalContent: string
  sessionId: string | null
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  functionCalls?: any[]
  messageType?: 'text' | 'trade-status' | 'trade-summary' | 'trade-plan-review' | 'portfolio-choice'
  portfolioQuery?: string
  tradeSteps?: TradeStep[]
  tradeCard?: TradeCard
  tradePlan?: TradePlan
  /** Ephemeral ChatGPT-style chips; not persisted to DB */
  followUpSuggestions?: string[]
}

function stripFollowUpSuggestionsFromMessages(messages: Message[]): Message[] {
  return messages.map(m => ({ ...m, followUpSuggestions: undefined }))
}

function shouldSkipFollowUpSuggestionsContent(content: string): boolean {
  const t = content.trim()
  if (!t) return true
  if (t.startsWith('Error:')) return true
  if (/⏱️\s*\*\*Request timed out\*\*/.test(t)) return true
  if (/Request timed out/i.test(t)) return true
  if (/Daily limit reached/i.test(t)) return true
  return false
}

function shouldScheduleFollowUpForAssistant(m: Pick<Message, 'content' | 'messageType'>): boolean {
  const mt = m.messageType
  if (mt === 'portfolio-choice' || mt === 'trade-status' || mt === 'trade-summary' || mt === 'trade-plan-review') {
    return false
  }
  if (mt && mt !== 'text') return false
  return !shouldSkipFollowUpSuggestionsContent(m.content)
}

interface ChatSession {
  id: string
  title: string
  messageCount?: number
  createdAt: string
  updatedAt?: string
}

interface DatabaseChatProps {
  initialPrompt?: string
  initialSessionId?: string
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

type TradingMode = 'PAPER' | 'LIVE'
type BrokerName = 'ZERODHA' | 'DHAN' | 'GROWW'

export default function DatabaseChat({ initialPrompt, initialSessionId }: DatabaseChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [portfolioChoiceInput, setPortfolioChoiceInput] = useState<Record<string, string>>({})
  const [portfolioPanel, setPortfolioPanel] = useState<{ query: string; id: string } | null>(null)
  const [portfolioPanelInput, setPortfolioPanelInput] = useState('')
  const [isLoadingSession, setIsLoadingSession] = useState(false)
  const [timer, setTimer] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionIdRaw] = useState<string | null>(null)

  // Persist last-active session so refresh restores it (sessionStorage: survives refresh, clears on tab close)
  const LAST_SESSION_KEY = 'db-chat-last-session'
  const setActiveSessionId = (id: string | null) => {
    setActiveSessionIdRaw(id)
    try {
      if (id) sessionStorage.setItem(LAST_SESSION_KEY, id)
      else sessionStorage.removeItem(LAST_SESSION_KEY)
    } catch { /* ignore */ }
  }

  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const sidebarAccountSectionRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<Message[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const conversationMemoryRef = useRef<any>(null)
  const shouldAutoScrollRef = useRef(true)
  const abortControllerRef = useRef<AbortController | null>(null)
  // Track whether we've already auto-submitted the forwarded prompt
  const autoSubmittedRef = useRef(false)
  // Condition polling interval ref
  const conditionPollingRef = useRef<NodeJS.Timeout | null>(null)
  // Tracks message IDs where auto-exit has already been triggered (prevents double-exit)
  const autoExitTriggeredRef = useRef<Set<string>>(new Set())

  const [showTradeModal, setShowTradeModal] = useState(false)
  const [tradeSymbol, setTradeSymbol] = useState('')
  const [isMobile, setIsMobile] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [shareToast, setShareToast] = useState(false)
  const [shareModal, setShareModal] = useState<{ url: string } | null>(null)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareLinkCopied, setShareLinkCopied] = useState(false)
  // Pending trade plan for confirmation flow
  const [pendingTradePlan, setPendingTradePlan] = useState<{ plan: TradePlan; messageId: string; userPrompt?: string } | null>(null)
  // Whether we're actively polling for conditions
  const [isWatchingConditions, setIsWatchingConditions] = useState(false)
  // Thinking panel state
  const [thinkingSteps, setThinkingSteps] = useState<Array<{ type: string; text: string; data?: any }>>([])
  const [thinkingExpanded, setThinkingExpanded] = useState(false)
  const [tradeMode, setTradeMode] = useState<TradingMode>('PAPER')
  const [tradeBroker, setTradeBroker] = useState<BrokerName>('ZERODHA')
  const [computeModel, setComputeModel] = useState<ComputeModelId>(DEFAULT_COMPUTE_MODEL)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const parsedAttachmentsRef = useRef<ParsedChatAttachment[]>([])
  const [attachQuota, setAttachQuota] = useState<{
    available: boolean
    used: number
    limit: number
    remaining: number
  }>({
    available: false,
    used: 0,
    limit: 0,
    remaining: 0,
  })
  // Sidebar user badge
  const [userBadge, setUserBadge] = useState<{ name: string; plan: string }>({ name: 'User', plan: 'Free Plan' })
  const { theme } = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const { data: session } = useSession()
  const redirectToLogin = useCallback(() => {
    if (typeof window === 'undefined') return
    const path = `${window.location.pathname}${window.location.search || ''}`
    const safe = path.startsWith('/') && !path.startsWith('//') ? path : '/database-chat'
    router.replace(`/login?callbackUrl=${encodeURIComponent(safe)}`)
  }, [router])
  const [sidebarAccountOpen, setSidebarAccountOpen] = useState(false)
  const [stockSearchOpen, setStockSearchOpen] = useState(false)
  const isDark = theme === 'dark'
  const isClaude = theme === 'claude-code'

  const closeSidebarMobile = useCallback(() => {
    if (isMobile) setSidebarOpen(false)
  }, [isMobile])

  const openAccountFromProfile = useCallback(() => {
    setSidebarAccountOpen(true)
    requestAnimationFrame(() => {
      sidebarAccountSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }, [])

  useEffect(() => {
    fetch('/api/user/subscription', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))
      .then((data) => {
        if (data?.plan) {
          setUserBadge({
            name: data.name ?? 'User',
            plan: `${data.label || 'Free'} Plan`,
          })
        }
      })
      .catch(() => {
        // silently keep defaults when not authed or offline
      })
  }, [])

  const refreshAttachQuota = useCallback(() => {
    if (!session?.user?.id) return
    fetch('/api/user/usage', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.success && d.data?.attachments) {
          const a = d.data.attachments
          setAttachQuota({
            available: !!a.available,
            used: a.used ?? 0,
            limit: a.limit ?? 0,
            remaining: a.remaining ?? 0,
          })
        }
      })
      .catch(() => {})
  }, [session?.user?.id])

  useEffect(() => {
    refreshAttachQuota()
  }, [refreshAttachQuota])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = window.localStorage.getItem(COMPUTE_MODEL_STORAGE_KEY)
      if (isComputeModelId(stored)) setComputeModel(stored)
    } catch {
      // localStorage may be unavailable (SSR, private mode) — stay on default.
    }
  }, [])

  const handleComputeModelChange = useCallback((model: ComputeModelId) => {
    setComputeModel(model)
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(COMPUTE_MODEL_STORAGE_KEY, model)
    } catch {
      // Ignore storage failures — selection still applies for this session.
    }
  }, [])

  // ── File attachment handlers (Excel, PDF, image) ─────────

  const handleAttachFiles = useCallback(async (files: FileList) => {
    if (!attachQuota.available) return
    const incoming = Array.from(files)
    const slotsLeft = attachQuota.remaining - attachedFiles.length
    if (slotsLeft <= 0) return
    const toProcess = incoming.slice(0, slotsLeft)

    const newAttached: AttachedFile[] = []
    const newParsed: ParsedChatAttachment[] = []
    for (const file of toProcess) {
      const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      try {
        const parsed = await parseChatAttachment(file, id)
        if (!parsed) continue
        newAttached.push({ id, name: file.name, kind: parsed.kind })
        newParsed.push(parsed)
      } catch {
        // skip unparseable files
      }
    }
    if (newAttached.length === 0) return
    setAttachedFiles(prev => [...prev, ...newAttached])
    parsedAttachmentsRef.current = [...parsedAttachmentsRef.current, ...newParsed]
  }, [attachQuota.available, attachQuota.remaining, attachedFiles.length])

  const handleRemoveFile = useCallback((id: string) => {
    setAttachedFiles(prev => {
      parsedAttachmentsRef.current = parsedAttachmentsRef.current.filter(p => p.id !== id)
      return prev.filter(f => f.id !== id)
    })
  }, [])

  const handleDownloadMerged = useCallback(() => {
    const excel = getExcelAttachments(parsedAttachmentsRef.current)
    if (excel.length === 0) return
    downloadMergedExcel(excel)
  }, [])

  // ── helpers ──────────────────────────────────────────────

  const resizeTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, 160)
    el.style.height = `${next}px`
    el.style.overflowY = el.scrollHeight > 160 ? 'auto' : 'hidden'
  }

  const focusInput = () => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const scheduleFollowUpSuggestions = useCallback(
    (userQuestion: string, assistantMessageId: string, answerText: string, messageType?: Message['messageType']) => {
      if (!shouldScheduleFollowUpForAssistant({ content: answerText, messageType })) return
      void (async () => {
        try {
          const res = await fetch('/api/chat/follow-up-suggestions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userMessage: userQuestion, assistantMessage: answerText }),
          })
          if (!res.ok) return
          const data = await res.json().catch(() => null)
          const raw = data?.suggestions
          const suggestions: string[] = Array.isArray(raw)
            ? raw.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
            : []
          if (!suggestions.length) return
          setMessages(prev => prev.map(m =>
            m.id === assistantMessageId ? { ...m, followUpSuggestions: suggestions } : m
          ))
        } catch {
          /* ignore */
        }
      })()
    },
    []
  )

  const isNearBottom = (el: HTMLDivElement, threshold = 80) => {
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    return distanceFromBottom <= threshold
  }

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
    const cleaned = raw
      .trim()
      .toUpperCase()
      .replace(/\b(STOCK|STOCKS|SHARE|SHARES|COMPANY)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    return cleaned.replace(/[\s._&-]+/g, '')
  }

  // ── trade data serialization ──────────────────────────────

  const serializeTradeMessage = (msg: Omit<Message, 'id'>): string => {
    return JSON.stringify({
      __trade: true,
      messageType: msg.messageType,
      displayContent: msg.content,
      tradeSteps: msg.tradeSteps,
      tradeCard: msg.tradeCard ? { ...msg.tradeCard } : undefined,
      tradePlan: msg.tradePlan ? { ...msg.tradePlan } : undefined,
    })
  }

  const deserializeMessage = (raw: any): Message => {
    let parsed: any = null
    try {
      if (raw.content?.startsWith('{')) parsed = JSON.parse(raw.content)
    } catch { /* not JSON */ }

    if (parsed?.__trade) {
      const restoredTradeCard = parsed.tradeCard
        ? {
          ...parsed.tradeCard,
          isLive: parsed.tradeCard.priceSource === 'Closed'
            ? false
            : parsed.tradeCard.isLive !== false,
        }
        : undefined

      return {
        id: raw.id,
        role: raw.role,
        content: parsed.displayContent || '',
        timestamp: new Date(raw.createdAt),
        messageType: parsed.messageType,
        tradeSteps: parsed.tradeSteps,
        tradeCard: restoredTradeCard,
        tradePlan: parsed.tradePlan,
      }
    }
    return {
      id: raw.id,
      role: raw.role,
      content: raw.content,
      timestamp: new Date(raw.createdAt),
    }
  }

  // ── session helpers ──────────────────────────────────────

  const generateTitle = (text: string) => {
    const clean = text.replace(/[^a-zA-Z0-9\s]/g, '').trim()
    return clean.length > 40 ? clean.slice(0, 40) + '...' : clean || 'New Chat'
  }

  const loadSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/chat/sessions')
      const data = await response.json()
      if (data.success) {
        setSessions(data.data)
      }
    } catch {
      setSessions([])
    }
  }, [])

  const extractSymbol = (content: string): string => {
    const patterns = [
      /\banaly(?:s|z)ing\s+([A-Za-z][A-Za-z0-9&.\-\s]{1,60})/i,
      /\bstock[:\s]+([A-Za-z][A-Za-z0-9&.\-\s]{1,60})/i,
      /\b(?:buy|sell|exit|kharid(?:o)?|becho|bechna)\s+\d*\s*(?:shares?\s+of\s+)?([A-Za-z][A-Za-z0-9&.\-\s]{1,60})/i,
    ]
    for (const p of patterns) {
      const m = content.match(p)
      const candidate = m?.[1]?.trim()
      if (candidate) return normalizeSymbol(candidate)
    }
    return 'RELIANCE'
  }

  const createSession = useCallback(async (firstMessage?: string) => {
    const stockSymbol = extractSymbol(firstMessage || 'RELIANCE')
    try {
      const response = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockSymbol, title: firstMessage ? generateTitle(firstMessage) : undefined }),
      })
      const data = await response.json()
      if (data.success) {
        const newId = data.data.id as string
        // Persist to sessionStorage immediately — before loadSessions() — so a refresh
        // in the next few hundred ms still restores this session.
        try { sessionStorage.setItem(LAST_SESSION_KEY, newId) } catch { /* ignore */ }
        await loadSessions()
        return newId
      }
    } catch {
      return null
    }
    return null
  }, [loadSessions])

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    try {
      setIsLoadingSession(true)
      const response = await fetch(`/api/chat/sessions/${sessionId}/messages`)
      const data = await response.json()
      if (data.success) {
        const loaded: Message[] = data.data.map((m: any) => deserializeMessage(m))
        setMessages(loaded)
        setActiveSessionId(sessionId)
        conversationMemoryRef.current = null

        // Restore pendingTradePlan so the execute button shows for unconfirmed plans
        const lastPlan = [...loaded].reverse().find(
          m => m.messageType === 'trade-plan-review' &&
               m.tradePlan &&
               (m.tradePlan.workflowStatus ?? 'proposed') === 'proposed'
        )
        if (lastPlan?.tradePlan) {
          setPendingTradePlan({ plan: lastPlan.tradePlan, messageId: lastPlan.id })
        } else {
          setPendingTradePlan(null)
        }
      }
    } catch {
      setMessages([])
      conversationMemoryRef.current = null
    } finally {
      setIsLoadingSession(false)
    }
  }, [])

  const saveMessage = useCallback(async (sessionId: string, message: Message) => {
    try {
      const isTradeMsg = message.messageType === 'trade-status' || message.messageType === 'trade-summary' || message.messageType === 'trade-plan-review'
      const content = isTradeMsg ? serializeTradeMessage(message) : message.content
      const response = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: message.role,
          content,
        }),
      })
      const data = await response.json().catch(() => null)
      return data?.success ? (data.data.id as string) : null
    } catch {
      return null
    }
  }, [])

  const updateMessage = useCallback(async (sessionId: string, message: Message) => {
    try {
      const isTradeMsg = message.messageType === 'trade-status' || message.messageType === 'trade-summary' || message.messageType === 'trade-plan-review'
      const content = isTradeMsg ? serializeTradeMessage(message) : message.content
      const response = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: message.id,
          role: message.role,
          content,
        }),
      })
      return response.ok
    } catch {
      return false
    }
  }, [])

  const replaceMessageId = useCallback((fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return
    setMessages(prev => prev.map(m => m.id === fromId ? { ...m, id: toId } : m))
    setPendingTradePlan(prev => prev && prev.messageId === fromId ? { ...prev, messageId: toId } : prev)
  }, [])

  const syncTradePlanMessage = useCallback(async (
    messageId: string,
    sessionId: string | null,
    updater: (message: Message) => Message
  ) => {
    let updatedMessage: Message | null = null
    setMessages(prev => prev.map(message => {
      if (message.id !== messageId) return message
      updatedMessage = updater(message)
      return updatedMessage
    }))

    if (updatedMessage && sessionId) {
      await updateMessage(sessionId, updatedMessage)
      await loadSessions()
    }

    return updatedMessage
  }, [loadSessions, updateMessage])

  const getTradePlanWorkflowStatus = useCallback((message: Message) => {
    const status = message.tradePlan?.workflowStatus
    if (status) return status
    if (message.content.includes('Cancelled')) return 'cancelled' as const
    if (message.content.includes('Confirmed')) return 'executed' as const
    return 'proposed' as const
  }, [])

  const startNewChat = () => {
    setMessages([])
    setActiveSessionIdRaw(null) // clear without saving to sessionStorage
    conversationMemoryRef.current = null
    try { sessionStorage.removeItem(LAST_SESSION_KEY) } catch { /* ignore */ }
    shouldAutoScrollRef.current = true
    if (isMobile) setSidebarOpen(false)
    focusInput()
  }

  const switchSession = async (sessionId: string) => {
    await loadSessionMessages(sessionId)
    if (isMobile) setSidebarOpen(false)
  }

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()

    try {
      await fetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' })
    } catch {
      return
    }

    setSessions(prev => prev.filter(s => s.id !== sessionId))

    if (activeSessionId === sessionId) {
      setMessages([])
      setActiveSessionIdRaw(null)
      conversationMemoryRef.current = null
      try { sessionStorage.removeItem(LAST_SESSION_KEY) } catch { /* ignore */ }
    }
  }

  // ── effects ──────────────────────────────────────────────

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const sync = () => {
      const mobile = media.matches
      setIsMobile(mobile)
      setSidebarOpen(!mobile)
    }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const init = async () => {
      setIsLoadingSession(true)
      try {
        const response = await fetch('/api/chat/sessions')
        const data = await response.json()
        if (data.success && data.data.length > 0) {
          setSessions(data.data)
          // ChatGPT-style: default visit = new empty chat. Only restore when ?session=... is present.
          if (initialSessionId && data.data.some((s: ChatSession) => s.id === initialSessionId)) {
            await loadSessionMessages(initialSessionId)
          } else {
            setMessages([])
            setActiveSessionId(null)
            conversationMemoryRef.current = null
            try { sessionStorage.removeItem(LAST_SESSION_KEY) } catch { /* ignore */ }
          }
        } else {
          setSessions([])
          setMessages([])
          setActiveSessionId(null)
          conversationMemoryRef.current = null
        }
      } finally {
        setIsLoadingSession(false)
      }
    }

    init()
  }, [initialSessionId, loadSessionMessages]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container || !shouldAutoScrollRef.current) return
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    shouldAutoScrollRef.current = isNearBottom(container)
  }, [])

  useEffect(() => {
    resizeTextarea(inputRef.current)
  }, [input])

  useEffect(() => {
    let interval: NodeJS.Timeout
    if (isLoading) {
      setTimer(0)
      interval = setInterval(() => setTimer((p) => p + 0.1), 100)
    } else {
      setTimer(0)
    }
    return () => clearInterval(interval)
  }, [isLoading])

  useEffect(() => {
    let active = true
      ; (async () => {
        const settings = await fetchTradingSettings()
        if (!active) return
        setTradeMode(settings.tradingMode)
        if (settings.preferredLiveBroker) {
          setTradeBroker(settings.preferredLiveBroker)
        }
      })()
    return () => { active = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── stock helpers ────────────────────────────────────────

  const buildTradeClarificationMessage = (draft: TradeCommandDraft, resolvedSymbol: string | null) => {
    if (draft.needsSymbol && draft.needsQuantity) {
      return 'Trade samajh aa gaya, but stock aur quantity clear nahi hai. Example: `buy 50 HDFCBANK` ya `buy 50 of this stock`.'
    }
    if (draft.needsSymbol) {
      return `Quantity ${draft.quantity ?? ''} samajh aa gayi, but kaunsa stock buy/sell karna hai woh clear nahi hai. Example: \`${draft.action.toLowerCase()} ${draft.quantity ?? 50} HDFCBANK\`.`
    }
    if (draft.needsQuantity) {
      return `I understood you want to ${draft.action.toLowerCase()} ${resolvedSymbol ?? 'this stock'}, but quantity missing hai. Example: \`${draft.action.toLowerCase()} 50 ${resolvedSymbol ?? 'HDFCBANK'}\`.`
    }
    return 'Trade request ambiguous hai. Please stock aur quantity clearly likho.'
  }

  const resolveTradeCommand = async (content: string): Promise<ResolvedTradeCommand | null> => {
    const allowContextSymbol = /\b(this|that|it|same(?:\s+(?:stock|one|trade|position))?|current\s+stock|iss?\s+stock|us\s+stock|then|phir|toh|so|go\s+ahead|proceed|do\s+it|continue|of\s+it|of\s+this)\b/i.test(content)
    const draft = resolveTradeCommandDraft(content, messages, {
      currentSymbol: allowContextSymbol ? conversationMemoryRef.current?.activeSymbol ?? null : null,
    })
    if (!draft) return null

    const resolvedSymbol = draft.symbolHint
      ? await resolveSymbolFromDatabase(draft.symbolHint)
      : allowContextSymbol
        ? normalizeSymbol(conversationMemoryRef.current?.activeSymbol ?? '')
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

  // Normalise indicator name: "ema 12" → "ema12", "EMA 12" → "EMA12"
  const normalizeIndicatorName = (s: string) => s.replace(/\s+/g, '')

  // Parse the candle timeframe the user specified: "1D", "1min", "5min", "1h", etc.
  const parseIndicatorTimeframe = (text: string): string => {
    const t = text.toLowerCase()
    if (/\b1\s*d(?:ay)?\b|\bdaily\b/.test(t)) return '1d'
    if (/\b1\s*w(?:eek)?\b|\bweekly\b/.test(t)) return '1w'
    if (/\b1\s*h(?:our)?\b|\bhourly\b/.test(t)) return '1h'
    const minMatch = t.match(/\b(\d+)\s*min(?:ute)?s?\b/)
    if (minMatch) return `${minMatch[1]}m`
    return '1m' // default: 1-minute intraday
  }

  // Parse explicit entry price: "at 208", "@ 208", "₹208", "208 pe", "208 mein", "208 par"
  const parseEntryPrice = (content: string): number | null => {
    const m = content.match(/(?:@|at|₹|pe\b|par\b|mein\b|price\s+of)\s*₹?\s*(\d+(?:\.\d+)?)/i)
    if (!m) return null
    const v = Number(m[1])
    return Number.isFinite(v) && v > 0 ? v : null
  }

  const parseStrategyParameters = (content: string) => {
    const text = content.toLowerCase()
    const conditions: TradeCondition[] = []
    const strategyParams: TradeParam[] = []

    const operatorMap: Record<string, TradeCondition['operator']> = {
      below: '<', 'less than': '<',
      above: '>', 'greater than': '>',
      '<': '<', '<=': '<=', '>': '>', '>=': '>=', '=': '=',
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Natural-language indicator states → concrete RSI thresholds.
    // Users say "when reliance is oversold/underbought buy 100" and we want the
    // same conditional watch order as if they had typed "when RSI < 30".
    //
    // Convention (widely used in TA):
    //   RSI < 30  → oversold / underbought / undervalued (bullish reversal zone)
    //   RSI > 70  → overbought / overvalued (bearish reversal zone)
    // ──────────────────────────────────────────────────────────────────────────
    const naturalRsiPatterns: Array<{ re: RegExp; operator: TradeCondition['operator']; threshold: number; label: string }> = [
      { re: /\b(oversold|under\s*bought|undervalued|under\s*valued)\b/i, operator: '<', threshold: 30, label: 'RSI < 30 (oversold / underbought)' },
      { re: /\b(overbought|over\s*bought|overvalued|over\s*valued)\b/i, operator: '>', threshold: 70, label: 'RSI > 70 (overbought)' },
    ]

    const rsiAlreadySet = () => conditions.some((c) => c.indicator === 'RSI')
    for (const pat of naturalRsiPatterns) {
      if (pat.re.test(text) && !rsiAlreadySet()) {
        conditions.push({ indicator: 'RSI', operator: pat.operator, threshold: pat.threshold })
        strategyParams.push({
          key: `rsi-natural-${conditions.length}`,
          label: 'RSI condition',
          value: pat.label,
        })
      }
    }

    // Indicator sub-pattern — handles optional space: "ema12", "ema 12", "sma 50"
    const indPat = `(?:rsi|macd|ema\\s*\\d+|sma\\s*\\d+|adx|stochk|stochd|cci|williamsr|roc|vwap|supertrend)`
    const opPat = `(<=|>=|<|>|=|below|above|less\\s+than|greater\\s+than)`
    const fillerPat = `(?:is|goes|drops|falls|rises|gets|reaches|crosses)?`

    // Pattern A: indicator op indicator  (cross-indicator e.g. "ema 12 > ema 26")
    const crossRegex = new RegExp(
      `(${indPat})\\s*${fillerPat}\\s*${opPat}\\s*(${indPat})`,
      'gi'
    )
    // Pattern B: indicator op number  (e.g. "rsi < 30", "ema12 > 50")
    const vsNumRegex = new RegExp(
      `(${indPat})\\s*${fillerPat}\\s*${opPat}\\s*([0-9]+(?:\\.[0-9]+)?)`,
      'gi'
    )

    // Run cross-indicator first so those matches aren't half-consumed by vsNum
    let m: RegExpExecArray | null
    const crossMatched = new Set<string>()
    crossRegex.lastIndex = 0
    while ((m = crossRegex.exec(text)) !== null) {
      const indicator = normalizeIndicatorName(m[1]).toUpperCase()
      const rawOp = m[2].replace(/\s+/g, ' ').toLowerCase()
      const op = operatorMap[rawOp]
      const thresholdIndicator = normalizeIndicatorName(m[3]).toUpperCase()
      if (!op || indicator === thresholdIndicator) continue
      crossMatched.add(indicator)
      conditions.push({ indicator, operator: op, threshold: 0, thresholdIndicator })
      strategyParams.push({
        key: `${indicator}-vs-${thresholdIndicator}`,
        label: `${indicator} condition`,
        value: `${indicator} ${op} ${thresholdIndicator}`,
      })
    }

    vsNumRegex.lastIndex = 0
    while ((m = vsNumRegex.exec(text)) !== null) {
      const indicator = normalizeIndicatorName(m[1]).toUpperCase()
      // Don't double-add indicators already handled as cross-indicator
      if (crossMatched.has(indicator)) continue
      const rawOp = m[2].replace(/\s+/g, ' ').toLowerCase()
      const op = operatorMap[rawOp]
      const threshold = Number(m[3])
      if (!op || Number.isNaN(threshold)) continue
      conditions.push({ indicator, operator: op, threshold })
      strategyParams.push({
        key: `${indicator}-${conditions.length}`,
        label: `${indicator} condition`,
        value: `${indicator} ${op} ${threshold}`,
      })
    }

    const targetMatch = text.match(/(?:book|target|take\s*profit|tp)\s*(?:at|of)?\s*([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:profit)?/i)
      || text.match(/([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:profit|tp)/i)

    const stopLossMatch = text.match(/(?:stop\s*loss|sl)\s*(?:at|of)?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i)

    const targetProfitPct = targetMatch ? Number(targetMatch[1]) : undefined
    if (targetProfitPct && Number.isFinite(targetProfitPct)) {
      strategyParams.push({ key: 'target-profit', label: 'Target', value: `${targetProfitPct}% profit` })
    }

    if (stopLossMatch) {
      const stopLossPct = Number(stopLossMatch[1])
      if (Number.isFinite(stopLossPct)) {
        strategyParams.push({ key: 'stop-loss', label: 'Stop Loss', value: `${stopLossPct}%` })
      }
    }

    return {
      conditions,
      strategyParams,
      targetProfitPct,
      indicatorTimeframe: parseIndicatorTimeframe(content),
    }
  }

  const fetchLiveIndicatorSnapshot = async (symbol: string, timeframe = '1m'): Promise<{ indicators: Record<string, number>; timeframe: string } | null> => {
    try {
      const url = `/api/live-indicators?symbol=${encodeURIComponent(symbol)}${timeframe !== '1m' ? `&timeframe=${encodeURIComponent(timeframe)}` : ''}`
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) return null
      const j = await r.json()
      if (!j?.success || !j?.data?.indicators) return null
      const requestedTimeframe = timeframe.toLowerCase()
      const responseTimeframe = typeof j?.data?.timeframe === 'string' ? j.data.timeframe.toLowerCase() : requestedTimeframe
      const isDefaultMinuteRequest = requestedTimeframe === '1m' || requestedTimeframe === '1min' || requestedTimeframe === 'intraday'

      // Guard against timeframe drift (e.g. server returning daily values for a 1m request).
      if (isDefaultMinuteRequest && responseTimeframe !== '1m') return null

      return { indicators: j.data.indicators, timeframe: responseTimeframe }
    } catch {
      return null
    }
  }

  const fetchCurrentPrice = async (symbol: string): Promise<number | null> => {
    try {
      const normalizedSymbol = normalizeSymbol(symbol)
      const r = await fetch(`/api/live-price?symbol=${encodeURIComponent(normalizedSymbol)}`, { cache: 'no-store' })
      if (!r.ok) return null
      const j = await r.json()
      if (!j?.success || !j?.data) return null
      const d = j.data[normalizedSymbol] || j.data
      return typeof d?.ltp === 'number' ? d.ltp : null
    } catch {
      return null
    }
  }

  const resolveSymbolFromDatabase = async (rawSymbol: string): Promise<string | null> => {
    try {
      const r = await fetch(`/api/stocks/resolve?q=${encodeURIComponent(rawSymbol)}`, { cache: 'no-store' })
      if (!r.ok) return null
      const j = await r.json()
      const resolved = j?.data?.symbol
      if (typeof resolved === 'string' && resolved.trim().length > 0) {
        return resolved.trim().toUpperCase()
      }
      return null
    } catch {
      return null
    }
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

  const persistTradingSelection = async (mode: TradingMode, broker: BrokerName) => {
    try {
      await fetch('/api/trading/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradingMode: mode,
          preferredLiveBroker: broker,
        }),
      })
    } catch {
      // no-op: local dropdown selection still applies for current chat execution flow
    }
  }

  const handleTradeModeChange = (mode: TradingMode) => {
    setTradeMode(mode)
    void persistTradingSelection(mode, tradeBroker)
  }

  const handleTradeBrokerChange = (broker: BrokerName) => {
    setTradeBroker(broker)
    void persistTradingSelection(tradeMode, broker)
  }

  const triggerPendingTradeProcessor = async (): Promise<{ inspected: number; executed: number } | null> => {
    try {
      const response = await fetch('/api/paper-trade/process-pending', {
        method: 'POST',
        cache: 'no-store',
      })
      if (!response.ok) return null
      const result = await response.json()
      if (!result?.success) return null
      return {
        inspected: Number(result.inspected || 0),
        executed: Number(result.executed || 0),
      }
    } catch {
      return null
    }
  }

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    if (!isWatchingConditions) {
      if (conditionPollingRef.current) clearInterval(conditionPollingRef.current)
      conditionPollingRef.current = null
      return
    }

    const tick = async () => {
      const result = await triggerPendingTradeProcessor()
      if (!result || result.executed <= 0) return

      if (conditionPollingRef.current) clearInterval(conditionPollingRef.current)
      conditionPollingRef.current = null
      setIsWatchingConditions(false)

      const message: Message = {
        id: `${Date.now()}-autoexec`,
        role: 'assistant',
        content: `Condition met. Auto-executed ${result.executed} pending trade${result.executed > 1 ? 's' : ''}.`,
        timestamp: new Date(),
        messageType: 'text',
      }

      setMessages((prev) => [...prev, message])

      if (activeSessionId) {
        await saveMessage(activeSessionId, message)
        await loadSessions()
      }
    }

    void tick()
    conditionPollingRef.current = setInterval(() => {
      void tick()
    }, 5000)

    return () => {
      if (conditionPollingRef.current) clearInterval(conditionPollingRef.current)
      conditionPollingRef.current = null
    }
  }, [isWatchingConditions, activeSessionId, loadSessions, saveMessage])

  const makeIdempotencyKey = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  // ── paper trade flow (2-phase: Plan Review → Execute) ────

  const processPaperTradeCommand = async (
    content: string,
    sessionId: string | null,
    resolvedCommand?: { symbol: string; action: 'BUY' | 'SELL'; quantity: number }
  ) => {
    const cmd = resolvedCommand ?? null
    if (!cmd) return
    const { symbol, action, quantity } = cmd
    const planId = `${Date.now()}-plan`

    // Phase 1: Gather all info and show Plan Review card
    const loadingMsg: Message = {
      id: planId, role: 'assistant', content: 'Preparing trade plan...',
      timestamp: new Date(), messageType: 'text',
    }
    setMessages(p => [...p, loadingMsg])
    setIsLoading(true)

    try {
      const parsedStrategy = parseStrategyParameters(content)
      const requestedTimeframe = parsedStrategy.indicatorTimeframe ?? '1m'
      const [lp, liveSnapshot] = await Promise.all([
        fetchCurrentPrice(symbol),
        fetchLiveIndicatorSnapshot(symbol, requestedTimeframe),
      ])

      const evaluatedConditions: TradeCondition[] = parsedStrategy.conditions.map((condition) => {
        if (condition.thresholdIndicator) {
          // Cross-indicator comparison (e.g. EMA12 > EMA26)
          const raw1 = liveSnapshot?.indicators?.[condition.indicator.toLowerCase()]
          const raw2 = liveSnapshot?.indicators?.[condition.thresholdIndicator.toLowerCase()]
          const currentValue = typeof raw1 === 'number' && Number.isFinite(raw1) ? raw1 : undefined
          const thresholdValue = typeof raw2 === 'number' && Number.isFinite(raw2) ? raw2 : undefined
          const isMet = (currentValue !== undefined && thresholdValue !== undefined)
            ? compareCondition(currentValue, condition.operator, thresholdValue)
            : undefined
          return { ...condition, currentValue, threshold: thresholdValue ?? condition.threshold, isMet }
        }
        // Normal: indicator vs fixed number
        const raw = liveSnapshot?.indicators?.[condition.indicator.toLowerCase()]
        const currentValue = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
        const isMet = typeof currentValue === 'number'
          ? compareCondition(currentValue, condition.operator, condition.threshold)
          : undefined
        return { ...condition, currentValue, isMet }
      })

      // If user expressed a condition ("when", "jab", etc.) but regex couldn't parse it,
      // treat as PENDING — never execute immediately in an unknown state.
      const hasConditionalLanguage = /\b(when|jab|jaise\s*hi|as\s*soon\s*as|if|agar|once)\b/i.test(content)
      const conditionsPassed =
        (evaluatedConditions.length === 0 && !hasConditionalLanguage) ||
        evaluatedConditions.every(c => c.isMet === true)
      const entryPrice = parseEntryPrice(content)
      const estimatedCost = entryPrice ? entryPrice * quantity : (lp ? lp * quantity : 0)

      const plan: TradePlan = {
        symbol,
        action,
        quantity,
        currentPrice: lp,
        entryPrice,
        estimatedCost,
        conditions: evaluatedConditions,
        conditionsPassed,
        strategyParams: parsedStrategy.strategyParams,
        targetProfitPct: parsedStrategy.targetProfitPct,
        liveIndicators: liveSnapshot?.indicators,
        indicatorTimeframe: liveSnapshot?.timeframe ?? requestedTimeframe,
        workflowStatus: 'proposed',
        originalContent: content,
        sessionId,
      }

      const planMsg: Message = {
        id: planId, role: 'assistant',
        content: `Trade plan for ${symbol}`,
        timestamp: new Date(),
        messageType: 'trade-plan-review',
        tradePlan: plan,
      }

      setMessages(prev => prev.map(m => m.id === planId ? planMsg : m))
      setPendingTradePlan({ plan, messageId: planId, userPrompt: content })

      if (sessionId) {
        const savedId = await saveMessage(sessionId, planMsg)
        if (savedId) replaceMessageId(planId, savedId)
      }
    } catch (err: any) {
      const errorMsg: Message = {
        id: planId, role: 'assistant',
        content: `Failed to prepare trade plan: ${err.message}`,
        timestamp: new Date(), messageType: 'text',
      }
      setMessages(prev => prev.map(m => m.id === planId ? errorMsg : m))
    } finally {
      setIsLoading(false)
    }
  }

  // Phase 2: Execute after user clicks "Execute Trade"
  const executePendingTrade = async () => {
    if (!pendingTradePlan) return
    const { plan, messageId, userPrompt: tradeUserPrompt } = pendingTradePlan
    setPendingTradePlan(null)

    const liveMode = tradeMode === 'LIVE'
    const hasConditions = plan.conditions.length > 0
    const conditionsMet = plan.conditionsPassed
    const sessionId = plan.sessionId || activeSessionId
    const orderLabel = `${plan.action} ${plan.quantity} ${plan.symbol}`

    // If conditions exist but not met → start server-side watching
    if (hasConditions && !conditionsMet) {
      const watchSteps: TradeStep[] = [
        { label: `Order confirmed: ${orderLabel}`, status: 'completed' },
        { label: `Registering ${liveMode ? 'LIVE' : 'paper'} watcher…`, status: 'pending' },
        { label: 'Execute on condition match', status: 'pending' },
      ]
      setIsWatchingConditions(true)

      await syncTradePlanMessage(messageId, sessionId, (message) => ({
        ...message,
        content: `Watching ${plan.symbol} for execution`,
        timestamp: new Date(),
        tradePlan: {
          ...plan,
          workflowStatus: 'watching',
        },
        tradeSteps: watchSteps,
      }))

      try {
        // Register the watch order — LIVE or PAPER depending on current mode
        const r = await fetch('/api/paper-trade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: plan.symbol,
            action: plan.action,
            quantity: plan.quantity,
            productType: 'INTRADAY',
            orderType: plan.entryPrice ? 'LIMIT' : 'MARKET',
            price: plan.entryPrice || undefined,
            status: 'PENDING',
            conditions: plan.conditions,
            sessionId: plan.sessionId,
            userPrompt: tradeUserPrompt,
            mode: liveMode ? 'LIVE' : 'PAPER',
            brokerName: liveMode ? tradeBroker : undefined,
          }),
        })

        const result = await r.json()
        if (!result.success) throw new Error(result.error || 'Failed to register watch order')

        await syncTradePlanMessage(messageId, sessionId, (message) => ({
          ...message,
          content: `Watching ${plan.symbol} for execution`,
          timestamp: new Date(),
          tradePlan: {
            ...plan,
            workflowStatus: 'watching',
          },
          tradeSteps: [
            watchSteps[0],
            {
              label: 'Watching for conditions (Server-side)',
              status: 'pending',
              detail: `${liveMode ? 'LIVE via ' + tradeBroker + ' · ' : ''}Monitoring: ` + plan.conditions.map(c => `${c.indicator} ${c.operator} ${c.threshold}`).join(', '),
            },
            watchSteps[2],
          ],
        }))
      } catch (err: any) {
        const failedStep: TradeStep = { ...watchSteps[1], status: 'failed', detail: err.message }
        const finalSteps: TradeStep[] = [watchSteps[0], failedStep, watchSteps[2]]
        await syncTradePlanMessage(messageId, sessionId, (message) => ({
          ...message,
          content: `Failed to watch ${plan.symbol}`,
          timestamp: new Date(),
          tradePlan: {
            ...plan,
            workflowStatus: 'failed',
          },
          tradeSteps: finalSteps,
        }))
        setIsWatchingConditions(false)
      }

      return
    }

    // No conditions or conditions already met → execute immediately
    const steps: TradeStep[] = [
      { label: `Order confirmed: ${orderLabel}`, status: 'completed' },
      { label: 'Fetching execution price', detail: 'Source: EC2 WebSocket', status: 'pending' },
      { label: 'Executing trade', status: 'pending' },
    ]

    await syncTradePlanMessage(messageId, sessionId, (message) => ({
      ...message,
      content: `Executing ${plan.symbol}`,
      timestamp: new Date(),
      tradePlan: {
        ...plan,
        workflowStatus: 'processing',
      },
      tradeSteps: steps,
    }))

    const lp = await fetchCurrentPrice(plan.symbol)
    const updatedStep1 = lp != null
      ? { ...steps[1], status: 'completed' as const, detail: `Source: Live price API • Current ${plan.symbol}: ₹${lp.toFixed(2)}` }
      : { ...steps[1], status: 'failed' as const, detail: `Live price unavailable for ${plan.symbol}. Market may be closed.` }

    await syncTradePlanMessage(messageId, sessionId, (message) => ({
      ...message,
      timestamp: new Date(),
      tradePlan: {
        ...(message.tradePlan || plan),
        workflowStatus: 'processing',
      },
      tradeSteps: [steps[0], updatedStep1, steps[2]],
    }))

    try {
      const execStrategy = parseStrategyParameters(plan.originalContent || '')
      const r = await fetch('/api/trading/execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: plan.symbol,
          side: plan.action,
          quantity: plan.quantity,
          productType: 'INTRADAY',
          orderType: plan.entryPrice ? 'LIMIT' : 'MARKET',
          price: plan.entryPrice || null,
          mode: liveMode ? 'LIVE' : 'PAPER',
          brokerName: liveMode ? tradeBroker : null,
          confirmed: true,
          sessionId: plan.sessionId,
          idempotencyKey: makeIdempotencyKey('dbchat'),
          // Strategy metadata — stored in entryCondition for Holdings display
          userPrompt: tradeUserPrompt || plan.originalContent || undefined,
          targetProfitPct: execStrategy.targetProfitPct,
          strategyParams: execStrategy.strategyParams.length ? execStrategy.strategyParams : undefined,
          conditions: plan.conditions?.length ? plan.conditions : undefined,
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
        const finalSteps: TradeStep[] = [steps[0], updatedStep1, finalStep2]
        await syncTradePlanMessage(messageId, sessionId, (message) => ({
          ...message,
          content: `Conditional order set for ${plan.symbol}`,
          timestamp: new Date(),
          tradePlan: {
            ...(message.tradePlan || plan),
            workflowStatus: 'watching',
          },
          tradeSteps: finalSteps,
        }))
        setIsWatchingConditions(true)
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

      const conditionDetail = plan.conditions.length > 0
        ? ` | Conditions: ${plan.conditions.map(c => `${c.indicator} ${c.operator} ${c.threshold} (current: ${typeof c.currentValue === 'number' ? c.currentValue.toFixed(2) : 'NA'})`).join(', ')}`
        : ''
      const finalStep2: TradeStep = { ...steps[2], status: 'completed', detail: `Trade executed: ${plan.action} ${plan.quantity} ${plan.symbol} @ ₹${execPrice.toFixed(2)}${conditionDetail}` }
      const finalSteps: TradeStep[] = [steps[0], updatedStep1, finalStep2]
      await syncTradePlanMessage(messageId, sessionId, (message) => ({
        ...message,
        content: `Trade executed for ${plan.symbol}`,
        timestamp: new Date(),
        tradePlan: {
          ...(message.tradePlan || plan),
          workflowStatus: 'executed',
          currentPrice: mktPrice,
          estimatedCost: invested,
          conditionsPassed: true,
        },
        tradeSteps: finalSteps,
        tradeCard: {
          symbol: plan.symbol, action: plan.action, quantity: plan.quantity,
          avgPrice: execPrice, marketPrice: mktPrice, returns, investedAmount: invested,
          isLive: true, priceSource: 'EC2 WebSocket',
          strategyParams: plan.strategyParams, conditions: plan.conditions,
          targetProfitPct: plan.targetProfitPct, targetPrice, currentProfitPct, targetProgressPct,
          liveIndicators: plan.liveIndicators,
        },
      }))
    } catch (err: any) {
      const failedStep: TradeStep = { ...steps[2], status: 'failed', detail: err.message }
      const finalSteps: TradeStep[] = [steps[0], updatedStep1, failedStep]
      await syncTradePlanMessage(messageId, sessionId, (message) => ({
        ...message,
        content: `Trade execution failed for ${plan.symbol}`,
        timestamp: new Date(),
        tradePlan: {
          ...(message.tradePlan || plan),
          workflowStatus: 'failed',
        },
        tradeSteps: finalSteps,
      }))
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
        await saveMessage(sessionIdToUse, clarificationMsg)
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

  // Stop condition watching
  const stopConditionWatching = async () => {
    if (conditionPollingRef.current) clearInterval(conditionPollingRef.current)
    conditionPollingRef.current = null
    setIsWatchingConditions(false)
    const watchingMessage = [...messagesRef.current].reverse().find(
      (message) =>
        message.messageType === 'trade-plan-review' &&
        message.tradePlan?.workflowStatus === 'watching'
    )
    if (!watchingMessage?.tradePlan) return

    await syncTradePlanMessage(
      watchingMessage.id,
      watchingMessage.tradePlan.sessionId || activeSessionId,
      (message) => ({
        ...message,
        content: `Watching stopped for ${watchingMessage.tradePlan!.symbol}`,
        timestamp: new Date(),
        tradePlan: {
          ...watchingMessage.tradePlan!,
          workflowStatus: 'cancelled',
        },
        tradeSteps: [
          ...(message.tradeSteps || []),
          { label: 'Watching stopped by user', status: 'failed', detail: 'Trade was not executed.' },
        ],
      })
    )
  }

  // Cancel pending trade
  const cancelPendingTrade = async () => {
    if (!pendingTradePlan) return
    const { messageId, plan } = pendingTradePlan
    setPendingTradePlan(null)
    await syncTradePlanMessage(messageId, plan.sessionId || activeSessionId, (message) => ({
      ...message,
      content: `Trade cancelled for ${plan.symbol}`,
      timestamp: new Date(),
      tradePlan: {
        ...plan,
        workflowStatus: 'cancelled',
      },
    }))
  }

  // ── live P/L polling ─────────────────────────────────────

  const livePlanReviewCount = useMemo(
    () => messages.filter((m) =>
      m.messageType === 'trade-plan-review' &&
      m.tradePlan &&
      ['proposed', 'watching', 'processing'].includes(getTradePlanWorkflowStatus(m))
    ).length,
    [getTradePlanWorkflowStatus, messages]
  )

  useEffect(() => {
    if (livePlanReviewCount === 0) return

    const updateTradePlanIndicators = async () => {
      try {
        const currentMessages = messagesRef.current
        const planMessages = currentMessages.filter(
          (m) => m.messageType === 'trade-plan-review' && m.tradePlan && ['proposed', 'watching', 'processing'].includes(getTradePlanWorkflowStatus(m))
        )

        if (planMessages.length === 0) return

        const symbolSet = new Set<string>()
        const indicatorRequests = new Map<string, { symbol: string; timeframe: string }>()

        for (const msg of planMessages) {
          const plan = msg.tradePlan!
          const symbol = normalizeSymbol(plan.symbol)
          const timeframe = plan.indicatorTimeframe || '1m'
          symbolSet.add(symbol)
          indicatorRequests.set(`${symbol}::${timeframe}`, { symbol, timeframe })
        }

        const [priceResults, indicatorResults] = await Promise.all([
          Promise.all(
            Array.from(symbolSet).map(async (symbol) => {
              const price = await fetchCurrentPrice(symbol)
              return { symbol, price }
            })
          ),
          Promise.all(
            Array.from(indicatorRequests.entries()).map(async ([key, req]) => {
              const snapshot = await fetchLiveIndicatorSnapshot(req.symbol, req.timeframe)
              return { key, indicators: snapshot?.indicators }
            })
          ),
        ])

        const priceMap = new Map(
          priceResults
            .filter((item) => typeof item.price === 'number')
            .map((item) => [item.symbol, item.price as number])
        )

        const indicatorMap = new Map(
          indicatorResults
            .filter((item) => !!item.indicators)
            .map((item) => [item.key, item.indicators as Record<string, number>])
        )

        setMessages((prev) => prev.map((m) => {
          if (m.messageType !== 'trade-plan-review' || !m.tradePlan) return m
          if (!['proposed', 'watching', 'processing'].includes(getTradePlanWorkflowStatus(m))) return m

          const plan = m.tradePlan
          const symbol = normalizeSymbol(plan.symbol)
          const timeframe = plan.indicatorTimeframe || '1m'
          const indicators = indicatorMap.get(`${symbol}::${timeframe}`) || plan.liveIndicators
          const currentPrice = priceMap.get(symbol) ?? plan.currentPrice

          const conditions = plan.conditions.map((condition) => {
            const lhsRaw = indicators?.[condition.indicator.toLowerCase()]
            const lhsValue = typeof lhsRaw === 'number' && Number.isFinite(lhsRaw) ? lhsRaw : undefined

            if (condition.thresholdIndicator) {
              const rhsRaw = indicators?.[condition.thresholdIndicator.toLowerCase()]
              const rhsValue = typeof rhsRaw === 'number' && Number.isFinite(rhsRaw) ? rhsRaw : undefined
              const thresholdValue = rhsValue ?? condition.threshold
              const isMet = typeof lhsValue === 'number' && typeof rhsValue === 'number'
                ? compareCondition(lhsValue, condition.operator, rhsValue)
                : undefined
              return {
                ...condition,
                currentValue: lhsValue,
                threshold: thresholdValue,
                isMet,
              }
            }

            const isMet = typeof lhsValue === 'number'
              ? compareCondition(lhsValue, condition.operator, condition.threshold)
              : undefined

            return {
              ...condition,
              currentValue: lhsValue,
              isMet,
            }
          })

          const conditionsPassed = conditions.length === 0
            ? plan.conditionsPassed
            : conditions.every((c) => c.isMet === true)

          return {
            ...m,
            tradePlan: {
              ...plan,
              currentPrice,
              estimatedCost: typeof currentPrice === 'number' ? currentPrice * plan.quantity : plan.estimatedCost,
              liveIndicators: indicators || plan.liveIndicators,
              conditions,
              conditionsPassed,
            },
          }
        }))
      } catch {
        // Silent failures keep chat responsive even if a live endpoint is flaky.
      }
    }

    updateTradePlanIndicators()
    const iv = setInterval(updateTradePlanIndicators, 2000)
    return () => clearInterval(iv)
  }, [getTradePlanWorkflowStatus, livePlanReviewCount])

  const liveCount = useMemo(() => messages.filter(m => m.tradeCard?.isLive).length, [messages])

  useEffect(() => {
    if (liveCount === 0) return
    const update = async () => {
      try {
        const priceSyms = new Set<string>()
        messagesRef.current.forEach((m) => {
          if (m.tradeCard?.isLive) priceSyms.add(m.tradeCard.symbol.toUpperCase())
        })
        if (priceSyms.size === 0) return

        const r = await fetch('/api/live-price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: Array.from(priceSyms) }),
          cache: 'no-store',
        })
        if (!r.ok) return
        const j = await r.json()
        if (!j?.success || !j?.data) return

        // Collect unique symbols from live trade cards that have conditions
        const liveSymbols = new Set<string>()
        messagesRef.current.forEach(m => {
          if (m.tradeCard?.isLive && m.tradeCard.conditions?.length) {
            liveSymbols.add(m.tradeCard.symbol)
          }
        })

        let indicatorMap = new Map<string, Record<string, number>>()
        try {
          // Fetch indicators per-symbol using on-demand endpoint (works on serverless)
          const indicatorResults = await Promise.all(
            Array.from(liveSymbols).map(async (sym) => {
              try {
                const ir = await fetch(`/api/live-indicators?symbol=${encodeURIComponent(sym)}`, { cache: 'no-store' })
                if (!ir.ok) return null
                const ij = await ir.json()
                if (ij?.success && ij?.data?.indicators) {
                  return { symbol: sym, indicators: ij.data.indicators as Record<string, number> }
                }
              } catch { /* skip */ }
              return null
            })
          )
          indicatorResults
            .filter((item): item is { symbol: string; indicators: Record<string, number> } => item !== null)
            .forEach(item => indicatorMap.set(item.symbol.toUpperCase(), item.indicators))
        } catch {
          // silent fallback - price updates should continue even if indicator API fails
        }

        const missingSymbols = new Set<string>()
        const toAutoExit: Message[] = []

        setMessages(prev => {
          const updated = prev.map(m => {
            const c = m.tradeCard
            if (!c?.isLive) return m
            const ld = j.data[c.symbol] ?? j.data[c.symbol.toUpperCase()]
            if (!ld || typeof ld.ltp !== 'number') {
              missingSymbols.add(c.symbol)
              return m
            }

            const currentProfitPct = c.action === 'BUY'
              ? ((ld.ltp / c.avgPrice) - 1) * 100
              : ((c.avgPrice / ld.ltp) - 1) * 100

            const targetProgressPct = c.targetProfitPct
              ? (currentProfitPct / c.targetProfitPct) * 100
              : undefined

            const liveIndicators = indicatorMap.get(c.symbol)
            const conditions = c.conditions?.map((condition) => {
              const raw = liveIndicators?.[condition.indicator.toLowerCase()]
              const currentValue = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
              const isMet = typeof currentValue === 'number'
                ? compareCondition(currentValue, condition.operator, condition.threshold)
                : undefined
              return { ...condition, currentValue, isMet }
            })

            const newCard = {
              ...c,
              marketPrice: ld.ltp,
              returns: computeReturns(c.action, c.avgPrice, ld.ltp, c.quantity),
              currentProfitPct,
              targetProgressPct,
              liveIndicators: liveIndicators || c.liveIndicators,
              conditions,
            }

            // Auto-exit when target profit reached
            if (c.targetProfitPct && currentProfitPct >= c.targetProfitPct && !autoExitTriggeredRef.current.has(m.id)) {
              autoExitTriggeredRef.current.add(m.id)
              toAutoExit.push({ ...m, tradeCard: newCard })
            }

            return { ...m, tradeCard: newCard }
          })

          if (toAutoExit.length > 0) {
            setTimeout(() => toAutoExit.forEach(msg => handleExitTrade(msg)), 0)
          }

          return updated
        })

        if (missingSymbols.size > 0) {
          const fallbackResults = await Promise.all(
            Array.from(missingSymbols).map(async (symbol) => {
              const price = await fetchCurrentPrice(symbol)
              return { symbol, price }
            })
          )

          const fallbackMap = new Map(
            fallbackResults
              .filter(item => typeof item.price === 'number')
              .map(item => [item.symbol, item.price as number])
          )

          if (fallbackMap.size > 0) {
            setMessages(prev => prev.map(m => {
              const c = m.tradeCard
              if (!c?.isLive) return m
              const price = fallbackMap.get(c.symbol)
              if (typeof price !== 'number') return m

              const currentProfitPct = c.action === 'BUY'
                ? ((price / c.avgPrice) - 1) * 100
                : ((c.avgPrice / price) - 1) * 100

              const targetProgressPct = c.targetProfitPct
                ? (currentProfitPct / c.targetProfitPct) * 100
                : undefined

              return {
                ...m,
                tradeCard: {
                  ...c,
                  marketPrice: price,
                  returns: computeReturns(c.action, c.avgPrice, price, c.quantity),
                  currentProfitPct,
                  targetProgressPct,
                },
              }
            }))
          }
        }
      } catch { /* silent */ }
    }
    update()
    const iv = setInterval(update, 2000)
    return () => clearInterval(iv)
  }, [liveCount])

  // ── exit trade handler ───────────────────────────────────

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

    setMessages(p => [...p, {
      id: tid, role: 'assistant', content: `Exiting ${c.symbol} position`,
      timestamp: new Date(), messageType: 'trade-status', tradeSteps: steps,
    }])

    const quoteCheck = await getFreshEC2ExitPrice(c.symbol)
    const updatedStep1 = quoteCheck.ok
      ? { ...steps[1], status: 'completed' as const, detail: `Exit price (EC2 Live): ₹${quoteCheck.price.toFixed(2)}` }
      : { ...steps[1], status: 'failed' as const, detail: `Exit blocked: ${quoteCheck.reason}` }

    setMessages(prev => prev.map(m => {
      if (m.id !== tid || !m.tradeSteps) return m
      const u = [...m.tradeSteps]
      u[1] = updatedStep1
      return { ...m, tradeSteps: u }
    }))

    if (!quoteCheck.ok) {
      const failedStep2: TradeStep = { ...steps[2], status: 'failed', detail: 'Exit not executed.' }
      setMessages(prev => prev.map(m => {
        if (m.id !== tid || !m.tradeSteps) return m
        return { ...m, tradeSteps: [steps[0], updatedStep1, failedStep2] }
      }))
      return
    }

    // stop live polling on original card only after successful exit checks
    setMessages(prev => prev.map(m =>
      m.id === message.id && m.tradeCard ? { ...m, tradeCard: { ...m.tradeCard, isLive: false } } : m
    ))

    const ep = quoteCheck.price
    const finalReturns = computeReturns(c.action, c.avgPrice, ep, c.quantity)
    const finalStep2: TradeStep = { ...steps[2], status: 'completed', detail: `${exitAction} ${c.quantity} ${c.symbol} @ ₹${ep.toFixed(2)}` }
    const finalSteps: TradeStep[] = [steps[0], updatedStep1, finalStep2]

    const exitStatusMsg: Message = {
      id: tid, role: 'assistant', content: `Exiting ${c.symbol} position`,
      timestamp: new Date(), messageType: 'trade-status', tradeSteps: finalSteps,
    }
    const closedMsg: Message = {
      id: `${tid}-closed`, role: 'assistant',
      content: `${c.symbol} position closed`,
      timestamp: new Date(), messageType: 'trade-summary',
      tradeCard: {
        symbol: c.symbol, action: c.action, quantity: c.quantity,
        avgPrice: c.avgPrice, marketPrice: ep,
        returns: finalReturns, investedAmount: c.investedAmount,
        isLive: false, priceSource: 'Closed',
      },
    }

    setMessages(prev => {
      const updated = prev.map(m => m.id === tid ? exitStatusMsg : m)
      return [...updated, closedMsg]
    })

    // Save exit messages to DB
    if (activeSessionId) {
      await saveMessage(activeSessionId, exitStatusMsg)
      await saveMessage(activeSessionId, closedMsg)
    }
  }

  // ── copy / edit / share helpers ─────────────────────────

  const handleCopyMessage = (messageId: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedMessageId(messageId)
      setTimeout(() => setCopiedMessageId(null), 2000)
    }).catch(() => {})
  }

  const handleStartEdit = (messageId: string, content: string) => {
    setEditingMessageId(messageId)
    setEditingContent(content)
  }

  const handleCancelEdit = () => {
    setEditingMessageId(null)
    setEditingContent('')
  }

  const handleSubmitEdit = async (messageId: string) => {
    const newContent = editingContent.trim()
    if (!newContent || isLoading) return

    if (!session?.user?.id) {
      redirectToLogin()
      return
    }

    const msgIndex = messages.findIndex(m => m.id === messageId)
    if (msgIndex === -1) return

    // Replace the edited message and drop everything after it (will be replaced by new AI response)
    const updatedMsg: Message = { ...messages[msgIndex], content: newContent, timestamp: new Date() }
    const priorMessages = stripFollowUpSuggestionsFromMessages(messages.slice(0, msgIndex))
    setMessages([...priorMessages, updatedMsg])
    setEditingMessageId(null)
    setEditingContent('')
    setInput('')
    setIsLoading(true)
    abortControllerRef.current = new AbortController()
    let _clientTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      abortControllerRef.current?.abort('timeout')
    }, 120000)

    const sessionIdToUse = activeSessionId

    try {
      const history = priorMessages.slice(-16).map(m => ({ role: m.role, content: m.content }))
      const payload = { message: newContent, conversationHistory: history, conversationMemory: conversationMemoryRef.current, computeModel }
      setThinkingSteps([])
      setThinkingExpanded(false)

      const r = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortControllerRef.current?.signal,
      })

      if (!r.ok) {
        if (r.status === 401) {
          redirectToLogin()
          setIsLoading(false)
          abortControllerRef.current = null
          focusInput()
          return
        }
        const errPayload = await r.json().catch(() => ({}))
        throw new Error(errPayload?.error || 'Request failed')
      }

      if (!r.body) throw new Error('Streaming not supported')

      const reader = r.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let answerText = ''
      let done = false
      while (!done) {
        const { value, done: streamDone } = await reader.read()
        done = streamDone
        if (value) buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'thinking') setThinkingSteps(prev => [...prev, { type: 'thinking', text: event.step }])
            else if (event.type === 'memory_update') conversationMemoryRef.current = event.memory || null
            else if (event.type === 'answer') answerText = event.message || ''
            else if (event.type === 'error') throw new Error(event.message)
          } catch { /* ignore malformed */ }
        }
      }

      if (answerText) {
        const assistantMessage: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: answerText, timestamp: new Date() }
        setMessages(p => [...p, assistantMessage])
        scheduleFollowUpSuggestions(newContent, assistantMessage.id, answerText)
        if (sessionIdToUse) { await saveMessage(sessionIdToUse, assistantMessage); await loadSessions() }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        const errorMessage: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: `Error: ${err.message}`, timestamp: new Date() }
        setMessages(p => [...p, errorMessage])
      }
    } finally {
      if (_clientTimeout) { clearTimeout(_clientTimeout); _clientTimeout = null }
      setIsLoading(false)
      abortControllerRef.current = null
      focusInput()
    }
  }

  const handleShareChat = async () => {
    if (!activeSessionId) return
    setShareLoading(true)
    try {
      const res = await fetch(`/api/chat/sessions/${activeSessionId}/share`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setShareModal({ url: data.url })
      }
    } catch { /* ignore */ } finally {
      setShareLoading(false)
    }
  }

  const handleCopyShareLink = () => {
    if (!shareModal) return
    navigator.clipboard.writeText(shareModal.url).then(() => {
      setShareLinkCopied(true)
      setTimeout(() => setShareLinkCopied(false), 2000)
    }).catch(() => {})
  }

  // ── send handler ─────────────────────────────────────────

  const checkIsPersonalPortfolioQuery = async (text: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/chat/classify-portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json()
      return !!data.isPersonalPortfolio
    } catch {
      return false
    }
  }

  const handlePortfolioChoice = async (option: 'PAPER' | 'BROKER' | 'BOTH', messageId: string, originalQuery: string, customText?: string) => {
    // Dismiss the panel
    setPortfolioPanel(null)
    setPortfolioPanelInput('')

    setIsLoading(true)
    const finalQuery = customText?.trim() || originalQuery

    // Fetch selected holdings
    let context = ''
    try {
      if (option === 'PAPER' || option === 'BOTH') {
        const res = await fetch('/api/holdings', { cache: 'no-store' })
        const data = await res.json()
        if (data.success && data.data?.length > 0) {
          const paperLines = data.data
            .filter((h: any) => h.isLive || h.status === 'LIVE' || h.status === 'CONDITION')
            .slice(0, 20)
            .map((h: any) => `  • ${h.symbol} | ${h.action} ${h.quantity} shares @ ₹${Number(h.avgPrice).toFixed(2)} | LTP ₹${Number(h.marketPrice || h.avgPrice).toFixed(2)} | P&L ${h.returns >= 0 ? '+' : ''}₹${Number(h.returns || 0).toFixed(2)} | Status: ${h.status}`)
            .join('\n')
          if (paperLines) context += `\n📋 PAPER TRADE PORTFOLIO:\n${paperLines}\n`
        }
      }
      if (option === 'BROKER' || option === 'BOTH') {
        const res = await fetch('/api/trading/broker-portfolio', { cache: 'no-store' })
        const data = await res.json()
        if (data.success && data.data?.length > 0) {
          const brokerLines = data.data
            .map((h: any) => `  • ${h.symbol} | ${h.quantity} shares @ avg ₹${Number(h.averagePrice).toFixed(2)} | LTP ₹${Number(h.ltp).toFixed(2)} | P&L ${h.pnl >= 0 ? '+' : ''}₹${Number(h.pnl).toFixed(2)} (${h.pnlPercent >= 0 ? '+' : ''}${Number(h.pnlPercent).toFixed(2)}%)`)
            .join('\n')
          context += `\n📊 BROKER PORTFOLIO (${data.broker}):\n${brokerLines}\n`
        }
      }
    } catch {
      context = ''
    }

    const enrichedQuery = context
      ? `${finalQuery}\n\n[User's current portfolio data for context:${context}]`
      : finalQuery

    // Add user message and run AI
    const userMsgId = `u-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const userMsg: Message = { id: userMsgId, role: 'user', content: finalQuery, timestamp: new Date() }
    setMessages(p => [...stripFollowUpSuggestionsFromMessages(p), userMsg])

    let sessionIdToUse = activeSessionId
    if (!sessionIdToUse) {
      sessionIdToUse = await createSession(finalQuery)
      if (sessionIdToUse) setActiveSessionId(sessionIdToUse)
    }
    if (sessionIdToUse) await saveMessage(sessionIdToUse, userMsg)

    try {
      const history = messages.filter(m => m.messageType !== 'portfolio-choice').slice(-16).map(m => ({ role: m.role, content: m.content }))
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: enrichedQuery, history, sessionId: sessionIdToUse }),
      })
      let answerText = ''
      if (response.body) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          const lines = decoder.decode(value).split('\n')
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6))
              if (event.type === 'step') { /* ignore thinking steps */ }
              else if (event.type === 'answer') answerText = event.message || ''
              else if (event.type === 'error') throw new Error(event.message)
            } catch { /* ignore parse errors */ }
          }
        }
      }
      const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: answerText || 'Could not analyze portfolio.', timestamp: new Date() }
      setMessages(p => [...p, assistantMsg])
      scheduleFollowUpSuggestions(finalQuery, assistantMsg.id, assistantMsg.content)
      if (sessionIdToUse) await saveMessage(sessionIdToUse, assistantMsg)
    } catch (err: any) {
      const errorMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: `Error: ${err.message}`, timestamp: new Date() }
      setMessages(p => [...p, errorMsg])
    } finally {
      setIsLoading(false)
    }
  }

  const handleSend = async () => {
    const rawText = input.trim()
    const hasAttachments = parsedAttachmentsRef.current.length > 0
    const text = rawText || (hasAttachments ? defaultPromptForAttachments(parsedAttachmentsRef.current) : '')
    if (!text || isLoading) return

    if (!session?.user?.id) {
      redirectToLogin()
      return
    }

    const attachCount = parsedAttachmentsRef.current.length
    if (attachCount > 0) {
      try {
        const consumeRes = await fetch('/api/user/attachments/consume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: attachCount }),
        })
        const consumeData = await consumeRes.json().catch(() => ({}))
        if (!consumeRes.ok || !consumeData.success) {
          const limitMsg: Message = {
            id: `attach-limit-${Date.now()}`,
            role: 'assistant',
            content: consumeData.error
              || '**Attachment limit reached.** Pro includes 5 file attachments per 30-day billing period (Excel, PDF, or image). [Upgrade or check Usage](/account/usage).',
            timestamp: new Date(),
          }
          setMessages(p => [...stripFollowUpSuggestionsFromMessages(p), limitMsg])
          return
        }
        setAttachQuota({
          available: true,
          used: consumeData.data?.used ?? 0,
          limit: consumeData.data?.limit ?? 5,
          remaining: consumeData.data?.remaining ?? 0,
        })
      } catch {
        const errMsg: Message = {
          id: `attach-err-${Date.now()}`,
          role: 'assistant',
          content: 'Could not verify attachment quota. Please try again.',
          timestamp: new Date(),
        }
        setMessages(p => [...stripFollowUpSuggestionsFromMessages(p), errMsg])
        return
      }
    }

    const excelOnly = getExcelAttachments(parsedAttachmentsRef.current)
    if (excelOnly.length > 0 && isMergeRequestText(text)) {
      downloadMergedExcel(excelOnly)
    }

    const userMsgId = `u-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const fileLabel = attachCount > 0
      ? ` [${attachCount} file${attachCount > 1 ? 's' : ''} attached]`
      : ''
    const userMsg: Message = { id: userMsgId, role: 'user', content: text + fileLabel, timestamp: new Date() }
    setMessages(p => [...stripFollowUpSuggestionsFromMessages(p), userMsg])
    setInput('')
    setAttachedFiles([])
    const attachmentContext = buildAttachmentContext(parsedAttachmentsRef.current)
    parsedAttachmentsRef.current = []
    setIsLoading(true)

    // ── Portfolio analysis MCQ intercept (LLM-classified) ─────────────
    const isPersonalPortfolio = await checkIsPersonalPortfolioQuery(text)
    if (isPersonalPortfolio) {
      setIsLoading(false)
      setPortfolioPanel({ query: text, id: `portfolio-${Date.now()}` })
      setPortfolioPanelInput('')
      return
    }
    // ─────────────────────────────────────────────────────────────────
    abortControllerRef.current = new AbortController()
    // Auto-abort after 2 minutes to prevent infinite spinner
    let _clientTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      abortControllerRef.current?.abort('timeout')
    }, 120000)

    let sessionIdToUse = activeSessionId
    if (!sessionIdToUse) {
      sessionIdToUse = await createSession(text)
      if (sessionIdToUse) {
        setActiveSessionId(sessionIdToUse)
      }
    }

    if (sessionIdToUse) {
      await saveMessage(sessionIdToUse, userMsg)
    }

    try {
      // ── Detect "exit at X% profit" for an existing live position (before trade cmd) ──
      const exitProfitMatch = text.match(
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
          setMessages(p => [...p, confirmMsg])
          scheduleFollowUpSuggestions(text, confirmMsg.id, confirmMsg.content)
          if (sessionIdToUse) await saveMessage(sessionIdToUse, confirmMsg)
          setIsLoading(false)
          return
        }
      }

      const tradeHandled = await handleTradeIntentRequest(text, sessionIdToUse)

      if (tradeHandled) {
        // handled locally
      } else {
        // Call AI streaming chat for analysis or non-trade messages
        const history = messages.slice(-16).map(m => ({ role: m.role, content: m.content }))
        const messageWithContext = attachmentContext ? `${text}\n\n${attachmentContext}` : text
        const payload = {
          message: messageWithContext,
          conversationHistory: history,
          conversationMemory: conversationMemoryRef.current,
          computeModel,
        }

        const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
        const isLikelyMobile = /Android|iPhone|iPad|iPod|Mobile|wv/i.test(ua)
        const isCapacitorNative =
          typeof window !== 'undefined' &&
          typeof (window as any)?.Capacitor?.isNativePlatform === 'function' &&
          Boolean((window as any).Capacitor.isNativePlatform())
        const useNonStreamingChat = isLikelyMobile || isCapacitorNative

        // Reset thinking state for this new message
        setThinkingSteps([])
        setThinkingExpanded(false)

        if (useNonStreamingChat) {
          const nonStreamRes = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: abortControllerRef.current?.signal,
          })

          if (nonStreamRes.status === 401) {
            setMessages(p => p.filter(m => m.id !== userMsgId))
            setInput(text)
            redirectToLogin()
            if (_clientTimeout) { clearTimeout(_clientTimeout); _clientTimeout = null }
            setIsLoading(false)
            abortControllerRef.current = null
            focusInput()
            return
          }

          const nonStreamData = await nonStreamRes.json().catch(() => ({
            success: false,
            error: 'Failed to parse chat response',
          }))

          if (!nonStreamRes.ok || !nonStreamData.success) {
            throw new Error(nonStreamData.error || 'Chat request failed')
          }

          conversationMemoryRef.current = nonStreamData.conversationMemory || null

          const backendTradeIntent = nonStreamData?.tradeIntent
          if (
            backendTradeIntent &&
            typeof backendTradeIntent.symbol === 'string' &&
            (backendTradeIntent.action === 'BUY' || backendTradeIntent.action === 'SELL') &&
            Number.isFinite(Number(backendTradeIntent.quantity)) &&
            Number(backendTradeIntent.quantity) > 0
          ) {
            await processPaperTradeCommand(text, sessionIdToUse, {
              symbol: backendTradeIntent.symbol.trim().toUpperCase(),
              action: backendTradeIntent.action,
              quantity: Math.max(1, Math.floor(Number(backendTradeIntent.quantity))),
            })
            return
          }

          const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: nonStreamData.message,
            timestamp: new Date(),
            functionCalls: nonStreamData.functionCalls,
          }
          setMessages(p => [...p, assistantMessage])
          scheduleFollowUpSuggestions(text, assistantMessage.id, assistantMessage.content)
          if (sessionIdToUse) {
            await saveMessage(sessionIdToUse, assistantMessage)
            await loadSessions()
          }
          return
        }

        const r = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: abortControllerRef.current?.signal,
        })

        if (!r.ok) {
          if (r.status === 401) {
            setMessages(p => p.filter(m => m.id !== userMsgId))
            setInput(text)
            redirectToLogin()
            if (_clientTimeout) { clearTimeout(_clientTimeout); _clientTimeout = null }
            setIsLoading(false)
            abortControllerRef.current = null
            focusInput()
            return
          }
          let streamError = 'Streaming request failed'
          let isLimitError = false
          try {
            const errPayload = await r.json()
            if (typeof errPayload?.error === 'string' && errPayload.error.trim().length > 0) {
              streamError = errPayload.error
            }
            if (errPayload?.limitReached || r.status === 429) isLimitError = true
          } catch {
            // Ignore parse errors and keep fallback message.
          }
          if (isLimitError) {
            const limitMsg: Message = {
              id: `limit-${Date.now()}`,
              role: 'assistant',
              content: `⚠️ **Daily limit reached**\n\nFree plan allows **10 prompts per day**. Your limit resets at midnight IST.\n\n[Upgrade to Pro (₹499/mo)](/pricing) for unlimited prompts.`,
              timestamp: new Date(),
              messageType: 'text',
            }
            setMessages(prev => [...prev, limitMsg])
            setIsLoading(false)
            return
          }
          throw new Error(streamError)
        }

        if (!r.body) throw new Error('Streaming is not supported in this environment. Please try again.')

        const reader = r.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let answerText = ''
        let streamedTradeIntent: { symbol: string; action: 'BUY' | 'SELL'; quantity: number } | null = null
        let done = false
        // ID of the placeholder assistant message saved at stream-start (used for PATCH later)
        let placeholderDbId: string | null = null

        // Save a placeholder assistant message to DB immediately so a mid-stream refresh
        // still keeps the session in history (it will be overwritten with the real answer).
        if (sessionIdToUse) {
          const placeholderMsg: Message = {
            id: `stream-placeholder-${Date.now()}`,
            role: 'assistant',
            content: '…',
            timestamp: new Date(),
          }
          placeholderDbId = await saveMessage(sessionIdToUse, placeholderMsg)
        }

        while (!done) {
          const { value, done: streamDone } = await reader.read()
          done = streamDone
          if (value) buffer += decoder.decode(value, { stream: true })
          // Parse SSE lines
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            let event: any
            try {
              event = JSON.parse(line.slice(6))
            } catch (parseErr) { continue /* ignore malformed SSE lines */ }

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
              setThinkingSteps(prev => [...prev, { type: 'routing_options', text: `🧭 Reply paths available: ${count}${detail}`, data: event.options }])
            } else if (event.type === 'tool_start') {
              setThinkingSteps(prev => [...prev, { type: 'tool_start', text: `🔧 Calling ${event.tool}(${JSON.stringify(event.args)})`, data: event }])
            } else if (event.type === 'tool_end') {
              setThinkingSteps(prev => [...prev, { type: 'tool_end', text: `✅ ${event.tool} returned data`, data: event.result }])
            } else if (event.type === 'memory_update') {
              conversationMemoryRef.current = event.memory || null
            } else if (event.type === 'trade_intent') {
              const symbol = typeof event.symbol === 'string' ? event.symbol.trim().toUpperCase() : ''
              const quantity = Number(event.quantity)
              const action = event.action === 'SELL' ? 'SELL' : 'BUY'
              if (symbol && Number.isFinite(quantity) && quantity > 0) {
                streamedTradeIntent = {
                  symbol,
                  action,
                  quantity: Math.max(1, Math.floor(quantity)),
                }
              }
            } else if (event.type === 'answer') {
              answerText = event.message || ''
              // Build webSources note if present
              if (event.webSources && event.webSources.length > 0) {
                answerText += '\n\n**Sources:** ' + event.webSources.map((s: any) => `[${s.name}](${s.url})`).join(' · ')
              }
            } else if (event.type === 'error') {
              throw new Error(event.message)
            }
          }
        }

        if (streamedTradeIntent) {
          await processPaperTradeCommand(text, sessionIdToUse, streamedTradeIntent)
          return
        }

        if (answerText) {
          const assistantMessage: Message = {
            id: (Date.now() + 1).toString(), role: 'assistant', content: answerText,
            timestamp: new Date(),
          }
          setMessages(p => [...p, assistantMessage])
          scheduleFollowUpSuggestions(text, assistantMessage.id, answerText)
          if (sessionIdToUse) {
            if (placeholderDbId) {
              // Update the placeholder with the real content
              await updateMessage(sessionIdToUse, { ...assistantMessage, id: placeholderDbId })
            } else {
              await saveMessage(sessionIdToUse, assistantMessage)
            }
            await loadSessions()
          }
        } else {
          throw new Error('No answer received from the AI. Please try again.')
        }
      }
    } catch (err: any) {
      // Distinguish user-cancel from timeout
      if (err.name === 'AbortError' || abortControllerRef.current?.signal.aborted) {
        const reason = (abortControllerRef.current?.signal as any)?.reason
        if (reason === 'timeout') {
          const timeoutMsg: Message = {
            id: (Date.now() + 1).toString(), role: 'assistant',
            content: `⏱️ **Request timed out** after 2 minutes. The AI is taking too long right now.\n\nPlease try again or simplify your question.`,
            timestamp: new Date(),
          }
          setMessages(p => [...p, timeoutMsg])
          if (sessionIdToUse) await saveMessage(sessionIdToUse, timeoutMsg)
        }
        setIsLoading(false)
        abortControllerRef.current = null
        focusInput()
        return
      }
      const errText = String(err?.message || '')
      if (/sign in/i.test(errText) && /ai chat/i.test(errText)) {
        setMessages(p => p.filter(m => m.id !== userMsgId))
        setInput(text)
        redirectToLogin()
        if (_clientTimeout) { clearTimeout(_clientTimeout); _clientTimeout = null }
        setIsLoading(false)
        abortControllerRef.current = null
        focusInput()
        return
      }
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(), role: 'assistant',
        content: `Error: ${err.message}`,
        timestamp: new Date(),
      }
      setMessages(p => [...p, errorMessage])
      if (sessionIdToUse) {
        await saveMessage(sessionIdToUse, errorMessage)
      }
    } finally {
      if (_clientTimeout) { clearTimeout(_clientTimeout); _clientTimeout = null }
      setIsLoading(false)
      abortControllerRef.current = null
      focusInput()
    }
  }

  // ── auto-submit forwarded prompt ─────────────────────────
  // When navigated from AIChat with ?prompt=..., auto-submit once session is ready
  useEffect(() => {
    if (!session?.user?.id) return
    if (!initialPrompt || autoSubmittedRef.current || isLoadingSession) return
    if (initialSessionId && messages.length > 0) return
    const text = initialPrompt.trim()
    if (!text) return
    autoSubmittedRef.current = true

    // Small delay so state flushes before we start the send pipeline
    setTimeout(async () => {
      const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text, timestamp: new Date() }
      setMessages(p => [...stripFollowUpSuggestionsFromMessages(p), userMsg])
      setIsLoading(true)
      abortControllerRef.current = new AbortController()

      let sessionIdToUse = activeSessionId
      if (!sessionIdToUse) {
        sessionIdToUse = await createSession(text)
        if (sessionIdToUse) setActiveSessionId(sessionIdToUse)
      }
      if (sessionIdToUse) await saveMessage(sessionIdToUse, userMsg)

      try {
        const tradeHandled = await handleTradeIntentRequest(text, sessionIdToUse)
        if (tradeHandled) {
          // handled locally
        } else {
          const history = messages.slice(-16).map(m => ({ role: m.role, content: m.content }))
          const r = await fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: text,
              conversationHistory: history,
              conversationMemory: conversationMemoryRef.current,
              computeModel,
            }),
            signal: abortControllerRef.current?.signal,
          })
          if (r.status === 401) {
            setMessages(p => p.filter(m => m.id !== userMsg.id))
            redirectToLogin()
            setIsLoading(false)
            abortControllerRef.current = null
            focusInput()
            return
          }
          const data = await r.json()
          if (data.success) {
            conversationMemoryRef.current = data.conversationMemory || null
            const backendTradeIntent = data?.tradeIntent
            if (
              backendTradeIntent &&
              typeof backendTradeIntent.symbol === 'string' &&
              (backendTradeIntent.action === 'BUY' || backendTradeIntent.action === 'SELL') &&
              Number.isFinite(Number(backendTradeIntent.quantity)) &&
              Number(backendTradeIntent.quantity) > 0
            ) {
              await processPaperTradeCommand(text, sessionIdToUse, {
                symbol: backendTradeIntent.symbol.trim().toUpperCase(),
                action: backendTradeIntent.action,
                quantity: Math.max(1, Math.floor(Number(backendTradeIntent.quantity))),
              })
              return
            }
            const assistantMessage: Message = {
              id: (Date.now() + 1).toString(), role: 'assistant', content: data.message,
              timestamp: new Date(), functionCalls: data.functionCalls,
            }
            setMessages(p => [...p, assistantMessage])
            scheduleFollowUpSuggestions(text, assistantMessage.id, assistantMessage.content)
            if (sessionIdToUse) {
              await saveMessage(sessionIdToUse, assistantMessage)
              await loadSessions()
            }
          } else {
            throw new Error(data.error || 'Failed to get response')
          }
        }
      } catch (err: any) {
        const errMsg = String(err?.message || '')
        if (/sign in/i.test(errMsg) && /ai chat/i.test(errMsg)) {
          setMessages(p => p.filter(m => m.id !== userMsg.id))
          redirectToLogin()
          setIsLoading(false)
          abortControllerRef.current = null
          focusInput()
          return
        }
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(), role: 'assistant',
          content: `Error: ${err.message}`, timestamp: new Date(),
        }
        setMessages(p => [...p, errorMessage])
        if (sessionIdToUse) await saveMessage(sessionIdToUse, errorMessage)
      } finally {
        setIsLoading(false)
        abortControllerRef.current = null
        focusInput()
      }
    }, 150)
  }, [initialPrompt, initialSessionId, isLoadingSession, messages.length, session?.user?.id, redirectToLogin, scheduleFollowUpSuggestions]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsLoading(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    resizeTextarea(e.target)
  }

  const suggestedPrompts = [
    "What are today's top movers?",
    "Analyze WIPRO's technical indicators",
    "Compare RELIANCE with TCS",
    "Show stocks with RSI below 30",
  ]

  // ── render helpers for trade cards ──────────────────────

  const renderTradeStatus = (message: Message) => {
    if (!message.tradeSteps) return null
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">Trade Progress</p>
        {message.tradeSteps.map((step, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="mt-0.5">
              {step.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-[var(--success)]" />}
              {step.status === 'pending' && <CircleDashed className="w-4 h-4 text-[var(--text-muted)] animate-spin" />}
              {step.status === 'failed' && <AlertTriangle className="w-4 h-4 text-[var(--danger)]" />}
            </div>
            <div>
              <p className="text-sm text-[var(--text-primary)]">{step.label}</p>
              {step.detail && <p className="text-xs text-[var(--text-muted)]">{step.detail}</p>}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const renderTradePlanReview = (message: Message) => {
    const plan = message.tradePlan
    if (!plan) return null
    const workflowStatus = getTradePlanWorkflowStatus(message)
    const isConfirmed = workflowStatus === 'executed' || workflowStatus === 'watching' || workflowStatus === 'processing'
    const isCancelled = workflowStatus === 'cancelled' || workflowStatus === 'failed'
    const isActionable = workflowStatus === 'proposed' && pendingTradePlan?.messageId === message.id

    return (
      <AnimatedTradeCard
        plan={plan}
        isConfirmed={isConfirmed}
        isCancelled={isCancelled}
        isActionable={isActionable}
        isWatchingConditions={workflowStatus === 'watching' || isWatchingConditions}
        workflowStatus={workflowStatus}
        tradeSteps={message.tradeSteps}
        tradeCard={message.tradeCard}
        onConfirm={executePendingTrade}
        onCancel={cancelPendingTrade}
        onStopWatching={stopConditionWatching}
        onExit={() => handleExitTrade(message)}
      />
    )
  }
  const renderTradeSummary = (message: Message) => {
    const c = message.tradeCard
    if (!c) return null
    const pos = c.returns >= 0
    const isClosed = !c.isLive
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm text-[var(--text-primary)] font-semibold">{c.symbol} • {c.action} {c.quantity} shares</p>
            <p className="text-xs text-[var(--text-muted)]">Average Price: ₹{formatCurrency(c.avgPrice)}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isClosed ? (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-muted)]">
                CLOSED
              </span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border text-[var(--success)] bg-[var(--accent-bg)]" style={{ borderColor: 'var(--border-color)' }}>
                  <Activity className="w-3 h-3" />LIVE
                </span>
                <button
                  onClick={() => handleExitTrade(message)}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border transition-colors text-[var(--danger)] bg-[var(--danger-bg)]"
                  style={{ borderColor: 'var(--border-color)' }}
                  type="button"
                >
                  <LogOut className="w-3 h-3" />Exit
                </button>
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <div className="rounded-xl border p-2.5 bg-[var(--bg-secondary)]" style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide">Market Price</p>
            <p className="text-sm text-[var(--text-primary)] font-medium">₹{formatCurrency(c.marketPrice)}</p>
            <p className="text-[10px] text-[var(--text-muted)]">{c.priceSource || 'EC2 WebSocket'}</p>
          </div>
          <div className="rounded-xl border p-2.5 bg-[var(--bg-secondary)]" style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide">Returns</p>
            <p className={`text-sm font-semibold ${pos ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>₹{pos ? '+' : ''}{formatCurrency(c.returns)}</p>
            {typeof c.currentProfitPct === 'number' && (
              <p className={`text-[10px] ${c.currentProfitPct >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'} opacity-90`}>
                {c.currentProfitPct >= 0 ? '+' : ''}{c.currentProfitPct.toFixed(2)}%
              </p>
            )}
          </div>
          <div className="rounded-xl border p-2.5 bg-[var(--bg-secondary)]" style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide">Invested</p>
            <p className="text-sm text-[var(--text-primary)] font-medium">₹{formatCurrency(c.investedAmount)}</p>
          </div>
          <div className="rounded-xl border p-2.5 bg-[var(--bg-secondary)]" style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide">Quantity</p>
            <p className="text-sm text-[var(--text-primary)] font-medium">{c.quantity} shares</p>
          </div>
        </div>

        {(c.strategyParams?.length || c.conditions?.length || c.targetProfitPct || c.liveIndicators?.rsi !== undefined) && (
          <div className="rounded-xl border p-2.5 space-y-2 bg-[var(--bg-secondary)]/80" style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide">Strategy Parameters</p>

            {c.strategyParams && c.strategyParams.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {c.strategyParams.map((param) => (
                  <span key={param.key} className="text-[10px] px-2 py-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]">
                    {param.label}: {param.value}
                  </span>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {typeof c.liveIndicators?.rsi === 'number' && (
                <div className="text-[11px] text-[var(--text-secondary)]">
                  <span className="text-[var(--text-muted)]">RSI:</span> {c.liveIndicators.rsi.toFixed(2)}
                </div>
              )}
              {typeof c.targetProfitPct === 'number' && (
                <div className="text-[11px] text-[var(--text-secondary)]">
                  <span className="text-[var(--text-muted)]">Target:</span> {c.targetProfitPct.toFixed(2)}%
                </div>
              )}
              {typeof c.targetPrice === 'number' && (
                <div className="text-[11px] text-[var(--text-secondary)]">
                  <span className="text-[var(--text-muted)]">TP Price:</span> ₹{formatCurrency(c.targetPrice)}
                </div>
              )}
              {typeof c.targetProgressPct === 'number' && (
                <div className="text-[11px] text-[var(--text-secondary)]">
                  <span className="text-[var(--text-muted)]">Progress:</span> {Math.max(0, c.targetProgressPct).toFixed(1)}%
                </div>
              )}
            </div>

            {c.conditions && c.conditions.length > 0 && (
              <div className="space-y-1">
                {c.conditions.map((condition, idx) => {
                  const isCross = !!condition.thresholdIndicator
                  const lhsVal = typeof condition.currentValue === 'number' ? condition.currentValue.toFixed(2) : null
                  const rhsVal = isCross && typeof condition.threshold === 'number' && condition.threshold !== 0 ? condition.threshold.toFixed(2) : null
                  return (
                    <p key={`${condition.indicator}-${idx}`} className={`text-[11px] ${condition.isMet ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
                      {isCross
                        ? `${condition.indicator} ${condition.operator} ${condition.thresholdIndicator}${lhsVal ? ` • ${condition.indicator}: ${lhsVal}` : ''}${rhsVal ? ` | ${condition.thresholdIndicator}: ${rhsVal}` : ''}`
                        : `${condition.indicator} ${condition.operator} ${condition.threshold}${lhsVal ? ` • current ${lhsVal}` : ' • current NA'}`
                      }
                    </p>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════
  //  RENDER — everything is direct JSX, NO inline components
  // ══════════════════════════════════════════════════════════

  const hasMessages = messages.length > 0

  const historySessions = useMemo(
    () => sessions.filter((s) => s.title.trim().toLowerCase() !== 'new chat'),
    [sessions],
  )

  const sidebarWordmarkStyle: CSSProperties = {
    backgroundImage: isDark
      ? 'linear-gradient(to right, #34d399, #22c55e)'
      : isClaude
        ? 'linear-gradient(to right, #d97757, #b4532a)'
        : 'linear-gradient(to right, #52a88c, #6bb89a)',
  }

  const navRowClass = (active: boolean) =>
    cn(
      'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors border border-transparent',
      active
        ? isDark
          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
          : isClaude
            ? 'bg-[var(--accent-bg)] text-[var(--accent)] border-[var(--border-color)]'
            : 'bg-emerald-500/10 text-emerald-800 border-emerald-500/20'
        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]',
    )

  const settingsRowClass =
    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'

  return (
    <div className="relative flex h-[100dvh] max-h-[100dvh] overflow-hidden bg-[var(--chat-canvas-bg)] text-[var(--text-primary)]">
      <StockSearchModal
        open={stockSearchOpen}
        onOpenChange={setStockSearchOpen}
        onAfterNavigate={closeSidebarMobile}
      />
      {isMobile && sidebarOpen && (
        <button
          className="absolute inset-0 z-30 bg-[var(--text-primary)]/25 backdrop-blur-[2px]"
          onClick={() => setSidebarOpen(false)}
          type="button"
          aria-label="Close sidebar"
        />
      )}
      {/* ── sidebar (nav + history — ChatGPT-style) ─────────── */}
      <div
        className={
          isMobile
            ? cn(
                'fixed inset-y-0 left-0 z-40 flex h-full min-h-0 w-72 max-w-[85vw] flex-col overflow-hidden border-r border-[var(--border-color)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] transition-transform duration-300 ease-out',
                'pt-[max(0.5rem,env(safe-area-inset-top))]',
                sidebarOpen ? 'translate-x-0' : '-translate-x-full',
              )
            : cn(
                'flex h-full min-h-0 max-h-[100dvh] flex-col overflow-hidden border-r border-[var(--border-color)] bg-[var(--bg-surface)] transition-all duration-300',
                sidebarOpen ? 'w-72' : 'w-0',
              )
        }
      >
        <div className="shrink-0 space-y-2 border-b border-[var(--border-subtle)] p-3">
          <Link
            href="/stocks"
            onClick={closeSidebarMobile}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-[var(--bg-secondary)]"
          >
            {isClaude && !isDark ? (
              <svg viewBox="0 0 40 32" className="h-8 w-8 shrink-0" fill="none" aria-hidden>
                <rect x="0" y="4" width="6" height="28" rx="1" fill="#d97757" />
                <rect x="8" y="0" width="6" height="32" rx="1" fill="#c45a3c" />
                <rect x="16" y="14" width="6" height="18" rx="1" fill="#e07a5f" />
                <rect x="24" y="8" width="6" height="24" rx="1" fill="#b4532a" />
                <rect x="32" y="2" width="6" height="30" rx="1" fill="#d97757" />
              </svg>
            ) : (
              <svg viewBox="0 0 40 32" className="h-8 w-8 shrink-0" fill="none" aria-hidden>
                <rect x="0" y="4" width="6" height="28" rx="1" fill="#52c49a" />
                <rect x="8" y="0" width="6" height="32" rx="1" fill="#ef4444" />
                <rect x="16" y="14" width="6" height="18" rx="1" fill="#52c49a" />
                <rect x="24" y="8" width="6" height="24" rx="1" fill="#ef4444" />
                <rect x="32" y="2" width="6" height="30" rx="1" fill="#52c49a" />
              </svg>
            )}
            <span
              className="bg-clip-text font-mono text-base font-black leading-none tracking-tight text-transparent sm:text-lg"
              style={sidebarWordmarkStyle}
            >
              iStocks
            </span>
          </Link>

          <button
            onClick={() => {
              startNewChat()
              closeSidebarMobile()
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] py-2.5 font-medium text-[var(--text-primary)] transition-all hover:bg-[var(--bg-surface-hover)]"
            type="button"
          >
            <Plus className="h-4 w-4" /> New Chat
          </button>

          <button
            type="button"
            onClick={() => setStockSearchOpen(true)}
            className="flex w-full items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] py-2 pl-3 pr-3 text-left text-sm text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)]"
          >
            <Search className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
            <span>Search stocks…</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="database-chat-scroll h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain px-2 py-2">
            <div className="pt-0.5">
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Menu
              </p>
              <nav className="flex flex-col gap-0.5" aria-label="Primary navigation">
                {APP_NAV_ITEMS.filter((item) => item.name !== 'About').map((item) => {
                  const Icon = item.icon
                  const isActive =
                    item.url === '/database-chat'
                      ? pathname === '/database-chat' || pathname.startsWith('/database-chat/')
                      : pathname === item.url
                  return (
                    <Fragment key={item.url}>
                      <Link
                        href={item.url}
                        onClick={closeSidebarMobile}
                        className={navRowClass(isActive)}
                      >
                        <Icon className="h-4 w-4 shrink-0 opacity-80" />
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        {item.badge ? (
                          <span className="shrink-0 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white">
                            {item.badge}
                          </span>
                        ) : null}
                      </Link>
                      {item.name === 'Pricing' ? (
                        <a
                          href={ISTOCKS_WHATSAPP_GROUP_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={closeSidebarMobile}
                          className={navRowClass(false)}
                        >
                          <MessageCircle className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">Whatsapp</span>
                        </a>
                      ) : null}
                    </Fragment>
                  )
                })}
              </nav>
            </div>

            <div ref={sidebarAccountSectionRef} className="mt-2 border-t border-[var(--border-subtle)] pt-2">
              <button
                type="button"
                aria-expanded={sidebarAccountOpen}
                onClick={() => setSidebarAccountOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <User className="h-4 w-4 shrink-0 opacity-80" />
                  Account
                </span>
                <ChevronDown
                  className={cn('h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200', sidebarAccountOpen && 'rotate-180')}
                  aria-hidden
                />
              </button>
              {sidebarAccountOpen ? (
                <div className="mt-1 flex flex-col gap-0.5 pb-1 pl-1">
                  <button
                    type="button"
                    onClick={() => {
                      router.push('/pnl')
                      closeSidebarMobile()
                      setSidebarAccountOpen(false)
                    }}
                    className={settingsRowClass}
                  >
                    <BarChart3 className="h-4 w-4 shrink-0 opacity-80" />
                    P&amp;L
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(new Event('istocks-open-llm-settings'))
                      closeSidebarMobile()
                      setSidebarAccountOpen(false)
                    }}
                    className={settingsRowClass}
                  >
                    <Bot className="h-4 w-4 shrink-0 opacity-80" />
                    AI model
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      router.push('/trading/settings')
                      closeSidebarMobile()
                      setSidebarAccountOpen(false)
                    }}
                    className={settingsRowClass}
                  >
                    <Key className="h-4 w-4 shrink-0 opacity-80" />
                    Broker keys
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      router.push('/account/usage')
                      closeSidebarMobile()
                      setSidebarAccountOpen(false)
                    }}
                    className={settingsRowClass}
                  >
                    <Activity className="h-4 w-4 shrink-0 opacity-80" />
                    Usage
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(new Event('istocks-open-appearance'))
                      closeSidebarMobile()
                      setSidebarAccountOpen(false)
                    }}
                    className={settingsRowClass}
                  >
                    <Palette className="h-4 w-4 shrink-0 opacity-80" />
                    Appearance
                  </button>
                  <Link
                    href="/about"
                    onClick={() => {
                      closeSidebarMobile()
                      setSidebarAccountOpen(false)
                    }}
                    className={settingsRowClass}
                  >
                    <Info className="h-4 w-4 shrink-0 opacity-80" />
                    About
                  </Link>
                  {session?.user ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSidebarAccountOpen(false)
                        signOut({ callbackUrl: '/' })
                      }}
                      className={cn(settingsRowClass, 'mt-0.5 text-red-600 dark:text-red-400')}
                    >
                      <LogOut className="h-4 w-4 shrink-0 opacity-80" />
                      Sign out
                    </button>
                  ) : (
                    <Link
                      href="/login"
                      onClick={() => {
                        closeSidebarMobile()
                        setSidebarAccountOpen(false)
                      }}
                      className={cn(settingsRowClass, 'text-[var(--accent)]')}
                    >
                      Sign in
                    </Link>
                  )}
                </div>
              ) : null}
            </div>

            <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
              <div className="sticky top-0 z-[1] -mx-2 mb-1 flex items-center gap-2 bg-[var(--bg-surface)] px-4 py-1.5 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                <History className="h-3 w-3" /> History
              </div>
              <div className="mt-1 space-y-1 px-1 pb-3">
                {historySessions.length === 0 && (
                  <p className="px-2 py-2 text-xs text-[var(--text-muted)]">No chat history yet</p>
                )}
                {historySessions.map(s => (
                  <div
                    key={s.id}
                    onClick={() => {
                      switchSession(s.id)
                      closeSidebarMobile()
                    }}
                    className={`group flex w-full cursor-pointer items-center justify-between rounded-xl border border-transparent px-3 py-2 text-sm transition-colors ${activeSessionId === s.id
                      ? 'border-[var(--border-color)] bg-[var(--accent-bg)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <button
                      onClick={(e) => deleteSession(s.id, e)}
                      className="rounded-lg p-1 opacity-0 transition-all hover:bg-[var(--bg-surface-hover)] group-hover:opacity-100"
                      type="button"
                    >
                      <X className="h-3 w-3 text-[var(--text-muted)]" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-[var(--border-subtle)] px-2 py-2">
          <button
            type="button"
            onClick={openAccountFromProfile}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-secondary)]"
            aria-label="Open account menu"
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white"
              style={{ background: 'var(--accent)' }}
            >
              {userBadge.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--text-primary)]">{userBadge.name}</p>
              <p className="truncate text-xs text-[var(--text-muted)]">{userBadge.plan}</p>
            </div>
          </button>
        </div>
      </div>

      {/* sidebar toggle */}
      {!isMobile && (
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={cn(
            'absolute top-1/2 z-10 -translate-y-1/2 rounded-r-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-1.5 text-[var(--text-muted)] shadow-[var(--shadow-sm)] transition-all hover:text-[var(--text-primary)]',
            sidebarOpen ? 'left-72' : 'left-0',
          )}
          type="button"
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      )}

      {isMobile && !sidebarOpen && (
        <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-2 text-[var(--text-secondary)] shadow-[var(--shadow-sm)] hover:text-[var(--text-primary)]"
            type="button"
            aria-label="Open sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── main content ───────────────────────────────────── */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--chat-canvas-bg)]">

        {/* ── EMPTY STATE ─────────────────────────────────── */}
        {!hasMessages && (
          <div className="flex-1 flex flex-col items-center justify-center px-3 sm:px-4 pt-6 sm:pt-0 overflow-y-auto database-chat-scroll">
            <TradingAgentEmptyBrand theme={theme} />

            {/* center input */}
            <div className="w-full max-w-4xl relative mb-5 sm:mb-6">
              <PromptInputBox
                input={input}
                setInput={setInput}
                handleInputChange={handleInputChange}
                handleKeyDown={handleKeyDown}
                handleSend={handleSend}
                handleStop={handleStop}
                isLoading={isLoading}
                tradingMode={tradeMode}
                selectedBroker={tradeBroker}
                onTradingModeChange={handleTradeModeChange}
                onBrokerChange={handleTradeBrokerChange}
                computeModel={computeModel}
                onComputeModelChange={handleComputeModelChange}
                attachedFiles={attachedFiles}
                onAttachFiles={handleAttachFiles}
                onRemoveFile={handleRemoveFile}
                onDownloadMerged={handleDownloadMerged}
                canDownloadMerged={attachedFiles.filter(f => f.kind === 'excel').length > 1}
                canAttach={attachQuota.available && attachQuota.remaining > attachedFiles.length}
                attachQuotaLabel={
                  attachQuota.available
                    ? `${attachQuota.used}/${attachQuota.limit} attach this Pro period`
                    : 'Attach: Pro only (5/period)'
                }
              />
            </div>

            <div className="flex flex-wrap justify-center gap-2 max-w-4xl">
              {suggestedPrompts.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => { setInput(prompt); focusInput() }}
                  className={`px-3.5 py-2 rounded-full text-sm transition-all border ${
                    isDark
                      ? 'shadow-[var(--shadow-sm)] bg-[var(--card-bg)] border-[var(--card-border)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)]/30'
                      : 'shadow-none bg-transparent border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)]/40'
                  }`}
                  type="button"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── CHAT VIEW ───────────────────────────────────── */}
        {hasMessages && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Top bar: session title + share */}
            <div className={`shrink-0 flex items-center justify-between px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--chat-canvas-bg)] ${isMobile && !sidebarOpen ? 'pt-12' : ''}`}>
              <span className="text-sm font-medium text-[var(--text-muted)] truncate max-w-[70%]">
                {sessions.find(s => s.id === activeSessionId)?.title || 'Chat'}
              </span>
              <button
                onClick={handleShareChat}
                disabled={shareLoading}
                title="Share chat"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] border border-transparent hover:border-[var(--border-subtle)] transition-all disabled:opacity-50"
              >
                {shareLoading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Share2 className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">Share</span>
              </button>
            </div>

            {/* Share link modal */}
            {shareModal && (
              <div className="fixed inset-0 z-[200] flex items-center justify-center px-4" onClick={() => setShareModal(null)}>
                <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
                <div
                  className="relative w-full max-w-md rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-6 shadow-2xl"
                  onClick={e => e.stopPropagation()}
                >
                  <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">Share this conversation</h3>
                  <p className="text-xs text-[var(--text-muted)] mb-4">Anyone with this link can view the conversation. They cannot reply or continue it.</p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={shareModal.url}
                      className="flex-1 min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none select-all"
                      onFocus={e => e.target.select()}
                    />
                    <button
                      onClick={handleCopyShareLink}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 transition-opacity"
                    >
                      {shareLinkCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {shareLinkCopied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <button
                    onClick={() => setShareModal(null)}
                    className="absolute top-4 right-4 p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* messages */}
            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              className={`flex-1 overflow-y-auto overscroll-contain px-3 sm:px-5 py-4 sm:py-6 space-y-4 sm:space-y-5 database-chat-scroll`}
            >
              {messages.map(message => (
                <div key={message.id} className="max-w-3xl mx-auto w-full group/msg">
                  <div className={`flex gap-3 sm:gap-4 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {message.role === 'assistant' && (
                      <div
                        className={`w-8 h-8 flex items-center justify-center flex-shrink-0 rounded-xl border ${
                          isDark
                            ? 'border-[var(--border-subtle)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)]'
                            : 'border-[var(--border-subtle)] bg-[var(--chat-composer-bg)] shadow-none'
                        }`}
                      >
                        <svg viewBox="0 0 40 32" className="w-5 h-5" fill="none">
                          <rect x="0" y="4" width="6" height="28" rx="1" fill="#52c49a" />
                          <rect x="8" y="0" width="6" height="32" rx="1" fill="#ef4444" />
                          <rect x="16" y="14" width="6" height="18" rx="1" fill="#52c49a" />
                          <rect x="24" y="8" width="6" height="24" rx="1" fill="#ef4444" />
                          <rect x="32" y="2" width="6" height="30" rx="1" fill="#52c49a" />
                        </svg>
                      </div>
                    )}
                    <div
                      className={cn(
                        'min-w-0',
                        message.role === 'user' && editingMessageId === message.id
                          ? 'w-full max-w-3xl'
                          : 'max-w-[min(100%,36rem)] sm:max-w-[80%]'
                      )}
                    >
                      {/* Edit mode for user messages */}
                      {message.role === 'user' && editingMessageId === message.id ? (
                        <div className="flex flex-col gap-4 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--accent-bg)] p-4 sm:p-5 shadow-[var(--shadow-sm)]">
                          <textarea
                            value={editingContent}
                            onChange={e => {
                              setEditingContent(e.target.value)
                              resizeTextarea(e.target)
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitEdit(message.id) }
                              if (e.key === 'Escape') handleCancelEdit()
                            }}
                            autoFocus
                            rows={5}
                            className="w-full min-h-[7.5rem] sm:min-h-[8.5rem] rounded-xl px-4 py-3.5 text-sm sm:text-[15px] leading-relaxed border border-[var(--accent)]/40 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 resize-y transition-[box-shadow,border-color]"
                          />
                          <p className="text-[11px] text-[var(--text-muted)] -mt-1">
                            Enter to resend · Shift+Enter new line · Esc to cancel
                          </p>
                          <div className="flex flex-wrap gap-3 justify-end pt-0.5">
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              className="text-sm font-medium px-4 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSubmitEdit(message.id)}
                              disabled={!editingContent.trim() || isLoading}
                              className="text-sm font-medium px-4 py-2.5 rounded-xl bg-[var(--accent)] text-white disabled:opacity-40 transition-opacity min-w-[5.5rem]"
                            >
                              Resend
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className={`rounded-2xl px-3.5 sm:px-4 py-3 border ${
                            message.role === 'user'
                              ? 'bg-[var(--accent-bg)] border-[var(--border-color)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                              : isDark
                                ? 'bg-[var(--card-bg)] border-[var(--card-border)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                                : 'bg-transparent border-transparent text-[var(--text-primary)] shadow-none'
                          }`}
                        >
                          {message.messageType === 'portfolio-choice'
                            ? (
                              <div className="py-1 min-w-[260px]">
                                <p className="text-sm font-semibold text-[var(--text-primary)] mb-3">Which portfolio to analyze?</p>
                                <div className="flex flex-col rounded-lg overflow-hidden border border-[var(--border-subtle)]">
                                  {([
                                    { key: 'PAPER' as const, label: 'Paper Trades', desc: 'AI-placed paper positions' },
                                    { key: 'BROKER' as const, label: 'Broker Portfolio', desc: 'Real holdings from Groww/Zerodha/Dhan' },
                                    { key: 'BOTH' as const, label: 'Both', desc: 'Full picture — paper + broker' },
                                  ]).map((opt, idx) => (
                                    <button
                                      key={opt.key}
                                      type="button"
                                      disabled={isLoading}
                                      onClick={() => handlePortfolioChoice(opt.key, message.id, message.portfolioQuery || '')}
                                      className={`flex items-center gap-3 w-full text-left px-3.5 py-2.5 transition-colors disabled:opacity-50 border-b border-[var(--border-subtle)] last:border-0 ${
                                        idx === 0
                                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                                          : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--accent-bg)]'
                                      }`}
                                    >
                                      <span className={`text-sm font-semibold w-5 shrink-0 ${idx === 0 ? 'text-white/80' : 'text-[var(--text-muted)]'}`}>
                                        {idx + 1}
                                      </span>
                                      <div className="min-w-0">
                                        <span className="text-sm font-medium">{opt.label}</span>
                                        <span className={`text-xs ml-2 ${idx === 0 ? 'text-white/70' : 'text-[var(--text-muted)]'}`}>{opt.desc}</span>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                                <div className="mt-2 relative">
                                  <input
                                    type="text"
                                    placeholder="Tell Compute 1.0 what to do instead…"
                                    value={portfolioChoiceInput[message.id] || ''}
                                    onChange={e => setPortfolioChoiceInput(prev => ({ ...prev, [message.id]: e.target.value }))}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter' && portfolioChoiceInput[message.id]?.trim()) {
                                        handlePortfolioChoice('BOTH', message.id, message.portfolioQuery || '', portfolioChoiceInput[message.id])
                                      }
                                      if (e.key === 'Escape') { setPortfolioPanel(null); setMessages(prev => prev.filter(m => m.id !== message.id)) }
                                    }}
                                    disabled={isLoading}
                                    className="w-full text-xs px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                                  />
                                  {portfolioChoiceInput[message.id]?.trim() && (
                                    <button
                                      type="button"
                                      disabled={isLoading}
                                      onClick={() => handlePortfolioChoice('BOTH', message.id, message.portfolioQuery || '', portfolioChoiceInput[message.id])}
                                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                                    >
                                      ↵
                                    </button>
                                  )}
                                </div>
                                <p className="text-[10px] text-[var(--text-muted)] mt-1.5 px-0.5">Esc to cancel</p>
                              </div>
                            )
                            : message.messageType === 'trade-status'
                            ? renderTradeStatus(message)
                            : message.messageType === 'trade-summary'
                              ? renderTradeSummary(message)
                              : message.messageType === 'trade-plan-review'
                                ? renderTradePlanReview(message)
                                : message.role === 'assistant'
                                  ? (
                                    <MaybePriceRangeScreenerMarkdown
                                      content={message.content}
                                      className="text-[13px] sm:text-sm leading-relaxed"
                                    />
                                  )
                                  : <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>}
                        </div>
                      )}

                      {/* Timestamp + action buttons row */}
                      {editingMessageId !== message.id && (
                        <div className={`mt-1 flex items-center gap-1.5 ${message.role === 'user' ? 'justify-end mr-1' : 'justify-start ml-0.5'}`}>
                          <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
                            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {/* Action buttons — visible on hover */}
                          {!message.messageType?.startsWith('trade') && (
                            <div className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                              {/* Copy */}
                              <button
                                onClick={() => handleCopyMessage(message.id, message.content)}
                                title="Copy"
                                className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                              >
                                {copiedMessageId === message.id
                                  ? <Check className="w-3.5 h-3.5 text-emerald-500" />
                                  : <Copy className="w-3.5 h-3.5" />}
                              </button>
                              {/* Edit (user messages only) */}
                              {message.role === 'user' && !isLoading && (
                                <button
                                  onClick={() => handleStartEdit(message.id, message.content)}
                                  title="Edit & resend"
                                  className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {message.functionCalls && message.functionCalls.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {message.functionCalls.map((call, idx) => (
                            <div key={idx} className="text-[11px] px-2 py-1 rounded-lg flex items-center gap-1 border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--accent)]">
                              <TrendingUp className="w-3 h-3 shrink-0" /><span className="font-medium">{call.name}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {message.role === 'assistant'
                        && message.followUpSuggestions
                        && message.followUpSuggestions.length > 0
                        && (!message.messageType || message.messageType === 'text')
                        && !message.messageType?.startsWith('trade') && (
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {message.followUpSuggestions.map((chip, i) => (
                            <button
                              key={`${message.id}-fu-${i}`}
                              type="button"
                              disabled={isLoading}
                              onClick={() => {
                                setInput(chip)
                                focusInput()
                                resizeTextarea(inputRef.current)
                              }}
                              className={`max-w-full text-left px-3 py-1.5 rounded-full text-xs sm:text-sm transition-all border ${
                                isDark
                                  ? 'shadow-[var(--shadow-sm)] bg-[var(--card-bg)] border-[var(--card-border)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)]/30'
                                  : 'shadow-none bg-transparent border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)]/40'
                              } disabled:opacity-40`}
                            >
                              {chip}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {message.role === 'user' && editingMessageId !== message.id && (
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-white shadow-[var(--shadow-sm)]" style={{ background: 'linear-gradient(145deg, var(--accent), var(--accent-hover))' }}>
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="max-w-3xl mx-auto">
                  <div className="flex gap-3 sm:gap-4">
                    <div
                      className={`w-8 h-8 flex items-center justify-center flex-shrink-0 rounded-xl border ${
                        isDark
                          ? 'border-[var(--border-subtle)] bg-[var(--card-bg)]'
                          : 'border-[var(--border-subtle)] bg-[var(--chat-composer-bg)]'
                      }`}
                    >
                      <svg viewBox="0 0 40 32" className="w-5 h-5" fill="none">
                        <rect x="0" y="4" width="6" height="28" rx="1" fill="#52c49a" />
                        <rect x="8" y="0" width="6" height="32" rx="1" fill="#ef4444" />
                        <rect x="16" y="14" width="6" height="18" rx="1" fill="#52c49a" />
                        <rect x="24" y="8" width="6" height="24" rx="1" fill="#ef4444" />
                        <rect x="32" y="2" width="6" height="30" rx="1" fill="#52c49a" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <AnimatedThinking steps={thinkingSteps} timer={timer} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Portfolio MCQ panel — appears above prompt, like Claude Code */}
            {portfolioPanel && (
              <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--chat-input-strip-bg)] px-3 sm:px-4 pt-3 pb-3">
                <div className="max-w-5xl mx-auto">
                  <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">Which portfolio to analyze?</p>
                  <div className="rounded-lg overflow-hidden border border-[var(--border-subtle)] mb-2">
                    {([
                      { key: 'PAPER' as const, label: 'Paper Trades', desc: 'AI-placed paper positions' },
                      { key: 'BROKER' as const, label: 'Broker Portfolio', desc: 'Real holdings from Groww/Zerodha/Dhan' },
                      { key: 'BOTH' as const, label: 'Both', desc: 'Full picture — paper + broker' },
                    ]).map((opt, idx) => (
                      <button
                        key={opt.key}
                        type="button"
                        disabled={isLoading}
                        onClick={() => handlePortfolioChoice(opt.key, portfolioPanel.id, portfolioPanel.query)}
                        className={`flex items-center gap-3 w-full text-left px-4 py-2.5 transition-colors disabled:opacity-50 border-b border-[var(--border-subtle)] last:border-0 ${
                          idx === 0
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--accent-bg)]'
                        }`}
                      >
                        <span className={`text-sm font-bold w-4 shrink-0 ${idx === 0 ? 'text-white/80' : 'text-[var(--text-muted)]'}`}>
                          {idx + 1}
                        </span>
                        <span className="text-sm font-medium">{opt.label}</span>
                        <span className={`text-xs ${idx === 0 ? 'text-white/70' : 'text-[var(--text-muted)]'}`}>{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      autoFocus
                      placeholder="Tell Compute 1.0 what to do instead…"
                      value={portfolioPanelInput}
                      onChange={e => setPortfolioPanelInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && portfolioPanelInput.trim()) {
                          handlePortfolioChoice('BOTH', portfolioPanel.id, portfolioPanel.query, portfolioPanelInput)
                        }
                        if (e.key === 'Escape') { setPortfolioPanel(null); setPortfolioPanelInput('') }
                      }}
                      disabled={isLoading}
                      className="w-full text-sm px-3.5 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                    />
                    {portfolioPanelInput.trim() && (
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => handlePortfolioChoice('BOTH', portfolioPanel.id, portfolioPanel.query, portfolioPanelInput)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                      >↵</button>
                    )}
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] mt-1.5">Esc to cancel</p>
                </div>
              </div>
            )}

            {/* bottom input */}
            <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--chat-input-strip-bg)] px-3 sm:px-4 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3">
              <div className="max-w-5xl mx-auto relative">
                <PromptInputBox
                  input={input}
                  setInput={setInput}
                  handleInputChange={handleInputChange}
                  handleKeyDown={handleKeyDown}
                  handleSend={handleSend}
                  handleStop={handleStop}
                  isLoading={isLoading}
                  tradingMode={tradeMode}
                  selectedBroker={tradeBroker}
                  onTradingModeChange={handleTradeModeChange}
                  onBrokerChange={handleTradeBrokerChange}
                  computeModel={computeModel}
                  onComputeModelChange={handleComputeModelChange}
                  attachedFiles={attachedFiles}
                  onAttachFiles={handleAttachFiles}
                  onRemoveFile={handleRemoveFile}
                  onDownloadMerged={handleDownloadMerged}
                  canDownloadMerged={attachedFiles.filter(f => f.kind === 'excel').length > 1}
                  canAttach={attachQuota.available && attachQuota.remaining > attachedFiles.length}
                  attachQuotaLabel={
                    attachQuota.available
                      ? `${attachQuota.used}/${attachQuota.limit} attach this Pro period`
                      : 'Attach: Pro only (5/period)'
                  }
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* trade modal */}
      <TradeExecutionModal isOpen={showTradeModal} onClose={() => setShowTradeModal(false)} symbol={tradeSymbol} />
    </div>
  )
}

import { prisma } from '@/lib/prisma'
import {
  normalizeConversationHistory,
  normalizeConversationMemory,
  runAIEngine,
  type AIEvent,
  type ConversationTurn,
} from '@/lib/ai-engine'

export type IterationSource = 'web' | 'telegram'
export type IterationMode = 'trading-agent' | 'stock-ai'

export interface IterationCase {
  id: string
  source: IterationSource
  mode: IterationMode
  userLabel: string
  stockSymbol: string | null
  createdAt: string
  prompt: string
  reply: string
  history: ConversationTurn[]
  dissatisfiedFollowUp: boolean
  dissatisfiedReason: string | null
}

export interface IterationReplayResult {
  caseId: string
  source: IterationSource
  mode: IterationMode
  prompt: string
  oldReply: string
  newReply: string
  userLabel: string
  stockSymbol: string | null
  createdAt: string
  dissatisfiedFollowUp: boolean
  dissatisfiedReason: string | null
  status: 'pass' | 'warning' | 'fail'
  score: number
  improved: boolean
  flags: string[]
}

export interface IterationRecommendation {
  key: string
  area: 'system_prompt' | 'routing' | 'response_handling' | 'function_logic'
  priority: 'high' | 'medium' | 'low'
  title: string
  reason: string
  suggestedChange: string
  evidenceCount: number
  samplePrompts: string[]
}

export interface IterationReplaySummary {
  total: number
  pass: number
  warning: number
  fail: number
  improved: number
  dissatisfiedCases: number
  recommendations: IterationRecommendation[]
}

export interface IterationReplayExecution {
  reply: string
  events: AIEvent[]
}

type FlatTurn = {
  role: 'user' | 'assistant'
  content: string
  createdAt?: string
}

const DISSATISFACTION_PATTERNS = [
  /\b(wrong|incorrect|bad|issue|problem|bug|failed|error)\b/i,
  /\b(not good|not working|didn't work|doesn't work|seriously|funny)\b/i,
  /\b(galat|nahi hua|nhi hua|sahi nahi|bekaar|problem hai|issue hai)\b/i,
]

const FAILURE_PATTERNS = [
  /i apologize/i,
  /encountered an error/i,
  /please try again/i,
  /unable to/i,
  /failed to/i,
  /could not/i,
  /not found/i,
  /not configured/i,
  /rate limit/i,
  /timed out/i,
  /^sorry\b/i,
]

const NON_STOCK_TOKENS = new Set([
  'THE', 'THIS', 'THAT', 'WHAT', 'WHEN', 'WHERE', 'WHY', 'HOW', 'TELL', 'SHOW', 'STOCK', 'STOCKS',
  'PRICE', 'CURRENT', 'TODAY', 'BEST', 'BUY', 'SELL', 'PLEASE', 'WITH', 'FROM', 'THEN', 'LOOK',
  'MORE', 'ABOUT', 'SHOULD', 'COULD', 'WOULD', 'HAVE', 'YOUR', 'MY', 'FOR', 'AND', 'NOT', 'NOW',
  'YES', 'NO', 'OK', 'HI', 'HII', 'BHAI', 'BOSS', 'WANT', 'OPTION', 'HOLDINGS', 'KITNE', 'KITANE',
  'ISS', 'GREAT', 'THIS', 'ABOVE', 'IT', 'THESE', 'THOSE', 'OKAY', 'TELLME', 'COMPLETE', 'ANALYSIS',
])

const DISCLAIMER_PATTERNS = [
  /i cannot provide personal financial advice/i,
  /investment decisions depend/i,
  /consult a financial advisor/i,
  /do your own research/i,
  /i cannot recommend/i,
]

function parseStoredContent(content: string): { text: string | null; messageType?: string; isTrade?: boolean } {
  if (!content || content[0] !== '{') {
    return { text: content || null }
  }

  try {
    const parsed = JSON.parse(content)
    if (parsed?.__trade) {
      if (parsed.messageType === 'text' && typeof parsed.displayContent === 'string') {
        return { text: parsed.displayContent, messageType: parsed.messageType, isTrade: true }
      }
      return { text: null, messageType: parsed.messageType, isTrade: true }
    }
    if (typeof parsed?.displayContent === 'string') {
      return { text: parsed.displayContent, messageType: parsed.messageType }
    }
  } catch {
    return { text: content }
  }

  return { text: content }
}

function detectDissatisfiedFollowUp(text: string): string | null {
  if (!text) return null
  const hit = DISSATISFACTION_PATTERNS.find((pattern) => pattern.test(text))
  return hit ? text.trim().slice(0, 180) : null
}

function buildCasesFromTurns(params: {
  baseId: string
  source: IterationSource
  mode: IterationMode
  userLabel: string
  stockSymbol: string | null
  turns: FlatTurn[]
}): IterationCase[] {
  const cases: IterationCase[] = []
  const usableTurns = normalizeConversationHistory(
    params.turns
      .filter((turn) => turn.content && (turn.role === 'user' || turn.role === 'assistant'))
      .map((turn) => ({ role: turn.role, content: turn.content }))
  )

  for (let index = 0; index < usableTurns.length - 1; index++) {
    const current = usableTurns[index]
    const next = usableTurns[index + 1]
    if (current.role !== 'user' || next.role !== 'assistant') continue

    const maybeFollowUp = usableTurns[index + 2]
    const dissatisfiedReason = maybeFollowUp?.role === 'user'
      ? detectDissatisfiedFollowUp(maybeFollowUp.content)
      : null

    cases.push({
      id: `${params.baseId}:${index}`,
      source: params.source,
      mode: params.mode,
      userLabel: params.userLabel,
      stockSymbol: params.stockSymbol,
      createdAt: params.turns[index + 1]?.createdAt || new Date().toISOString(),
      prompt: current.content,
      reply: next.content,
      history: normalizeConversationHistory(usableTurns.slice(0, index)),
      dissatisfiedFollowUp: !!dissatisfiedReason,
      dissatisfiedReason,
    })
  }

  return cases
}

export async function loadIterationCases(limit = 50, offset = 0): Promise<IterationCase[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 500)
  const safeOffset = Math.max(offset, 0)

  const [sessions, telegramSessions, telegramUsers] = await Promise.all([
    prisma.chatSession.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        stock: { select: { symbol: true } },
        user: { select: { email: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, role: true, content: true, createdAt: true },
        },
      },
    }),
    prisma.telegramSession.findMany({
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.user.findMany({
      where: { telegramId: { not: null } },
      select: { email: true, telegramId: true },
    }),
  ])

  const telegramUserMap = new Map(
    telegramUsers
      .filter((user) => user.telegramId != null)
      .map((user) => [String(user.telegramId), user.email || `telegram:${String(user.telegramId)}`])
  )

  const webCases = sessions.flatMap((session) => {
    const hasStockWelcome = session.messages.some((message) =>
      message.role === 'assistant' && typeof message.content === 'string' && message.content.includes("AI stock analyst")
    )
    const turns: FlatTurn[] = session.messages
      .map((message) => {
        const parsed = parseStoredContent(message.content)
        if (!parsed.text) return null
        return {
          role: message.role as 'user' | 'assistant',
          content: parsed.text,
          createdAt: message.createdAt.toISOString(),
        }
      })
      .filter(Boolean) as FlatTurn[]

    return buildCasesFromTurns({
      baseId: `web:${session.id}`,
      source: 'web',
      mode: hasStockWelcome ? 'stock-ai' : 'trading-agent',
      userLabel: session.user?.email || 'web-user',
      stockSymbol: session.stock?.symbol || null,
      turns,
    })
  })

  const telegramCases = telegramSessions.flatMap((session) => {
    const raw = session.history as any
    const turns = normalizeConversationHistory(raw?.turns ?? raw?.history ?? raw ?? []).map((turn) => ({
      role: turn.role,
      content: turn.content,
      createdAt: session.updatedAt.toISOString(),
    }))

    return buildCasesFromTurns({
      baseId: `telegram:${String(session.chatId)}`,
      source: 'telegram',
      mode: 'trading-agent',
      userLabel: telegramUserMap.get(String(session.chatId)) || `telegram:${String(session.chatId)}`,
      stockSymbol: null,
      turns,
    })
  })

  return [...webCases, ...telegramCases]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(safeOffset, safeOffset + safeLimit)
}

export async function replayIterationCase(caseItem: IterationCase): Promise<IterationReplayExecution> {
  const events: AIEvent[] = []
  const memory = normalizeConversationMemory(null)
  const referer = caseItem.stockSymbol
    ? `http://local.test/stocks/${encodeURIComponent(caseItem.stockSymbol)}`
    : 'http://local.test/database-chat'

  let reply = ''

  await runAIEngine(
    caseItem.prompt,
    caseItem.history,
    (event) => {
      events.push(event)
      if (event.type === 'answer') {
        reply = event.message || ''
      } else if (event.type === 'error' && !reply) {
        reply = event.message || 'Replay failed.'
      }
    },
    referer,
    { conversationMemory: memory }
  )

  return {
    reply: reply || 'Replay produced no final answer.',
    events,
  }
}

function hasFailurePattern(text: string): boolean {
  return FAILURE_PATTERNS.some((pattern) => pattern.test(text))
}

function extractTickerLikeTokens(text: string): string[] {
  const matches = text.match(/\b[A-Za-z][A-Za-z0-9&.-]{2,}\b/g) || []
  return Array.from(new Set(matches
    .map((token) => token.replace(/[^A-Za-z0-9&.-]/g, ''))
    .filter((token) => token.length >= 3)
    .map((token) => token.toUpperCase())
    .filter((token) => !NON_STOCK_TOKENS.has(token))))
}

function looksLikeToolPlanningReply(text: string): boolean {
  return /i will now call|use `?(getMarketMovers|analyzeStock|findStock|webSearch)`?|call `?(getMarketMovers|analyzeStock|findStock|webSearch)`?/i.test(text)
}

function isListIntent(prompt: string): boolean {
  return /top movers|show stocks|stocks with|most underperforming|which stocks|best stock|best stocks|look for more stocks|top losers|top gainers/i.test(prompt)
}

function hasListLikeAnswer(text: string): boolean {
  const bulletCount = (text.match(/^[\-*•]\s/mg) || []).length
  const numberedCount = (text.match(/^\d+\.\s/mg) || []).length
  const tickerCount = extractTickerLikeTokens(text).length
  return bulletCount + numberedCount >= 2 || tickerCount >= 2
}

function extractExplicitSymbolHints(prompt: string, stockSymbol: string | null): Set<string> {
  const hints = new Set<string>()
  if (stockSymbol) hints.add(stockSymbol.toUpperCase())

  const patterns = [
    /\b([A-Za-z][A-Za-z0-9&.-]{2,})\s+ka\s+(?:price|rsi|macd|trend|analysis)\b/gi,
    /\bprice\s+of\s+([A-Za-z][A-Za-z0-9&.-]{2,})\b/gi,
    /\babout\s+([A-Za-z][A-Za-z0-9&.-]{2,})\b/gi,
    /\b(?:buy|sell|compare|vs)\s+([A-Za-z][A-Za-z0-9&.-]{2,})\b/gi,
  ]

  for (const pattern of patterns) {
    for (const match of prompt.matchAll(pattern)) {
      const token = match[1]?.toUpperCase()
      if (token && !NON_STOCK_TOKENS.has(token)) {
        hints.add(token)
      }
    }
  }

  return hints
}

function hasSymbolMismatch(prompt: string, reply: string, stockSymbol: string | null): boolean {
  const replyTokens = extractTickerLikeTokens(reply)
  if (replyTokens.length === 0) return false

  const promptTokens = extractExplicitSymbolHints(prompt, stockSymbol)
  if (promptTokens.size === 0) return false

  const hasExpected = replyTokens.some((token) => promptTokens.has(token))
  const hasUnexpected = replyTokens.some((token) => !promptTokens.has(token))
  return !hasExpected && hasUnexpected
}

function hasDisclaimerReply(text: string): boolean {
  return DISCLAIMER_PATTERNS.some((pattern) => pattern.test(text))
}

export function evaluateReplay(caseItem: IterationCase, newReply: string): IterationReplayResult {
  const flags: string[] = []
  let score = 100

  const oldFailed = hasFailurePattern(caseItem.reply)
  const newFailed = hasFailurePattern(newReply)

  if (newFailed) {
    flags.push('fallback-or-error-reply')
    score -= 45
  }

  if (newReply.trim().length < 40) {
    flags.push('too-short')
    score -= 15
  }

  if (looksLikeToolPlanningReply(newReply)) {
    flags.push('meta-tool-planning-reply')
    score -= 35
  }

  if (hasDisclaimerReply(newReply)) {
    flags.push('disclaimer-style-reply')
    score -= 35
  }

  if (hasSymbolMismatch(caseItem.prompt, newReply, caseItem.stockSymbol)) {
    flags.push('symbol-mismatch')
    score -= 45
  }

  if (isListIntent(caseItem.prompt) && !hasListLikeAnswer(newReply)) {
    flags.push('list-intent-not-satisfied')
    score -= 35
  }

  if (/\b(live|current|price|rsi|macd|abhi|today|news|kyun|why)\b/i.test(caseItem.prompt) && !/\d/.test(newReply)) {
    flags.push('missing-concrete-data')
    score -= 15
  }

  if (caseItem.dissatisfiedFollowUp) {
    flags.push('historically-dissatisfied-user')
    score -= newFailed ? 20 : 0
  }

  const improved = oldFailed && !newFailed
  if (improved) {
    flags.push('improved-over-old-reply')
    score += 10
  }

  const status: 'pass' | 'warning' | 'fail' = score >= 80 ? 'pass' : score >= 55 ? 'warning' : 'fail'

  return {
    caseId: caseItem.id,
    source: caseItem.source,
    mode: caseItem.mode,
    prompt: caseItem.prompt,
    oldReply: caseItem.reply,
    newReply,
    userLabel: caseItem.userLabel,
    stockSymbol: caseItem.stockSymbol,
    createdAt: caseItem.createdAt,
    dissatisfiedFollowUp: caseItem.dissatisfiedFollowUp,
    dissatisfiedReason: caseItem.dissatisfiedReason,
    status,
    score: Math.max(0, Math.min(100, score)),
    improved,
    flags,
  }
}

function uniquePromptSamples(results: IterationReplayResult[], limit = 3): string[] {
  return Array.from(
    new Set(
      results
        .map((item) => item.prompt.trim())
        .filter(Boolean)
        .map((prompt) => prompt.slice(0, 160))
    )
  ).slice(0, limit)
}

export function summarizeReplayResults(results: IterationReplayResult[]): IterationReplaySummary {
  const pass = results.filter((item) => item.status === 'pass')
  const warning = results.filter((item) => item.status === 'warning')
  const fail = results.filter((item) => item.status === 'fail')
  const improved = results.filter((item) => item.improved)
  const dissatisfiedCases = results.filter((item) => item.dissatisfiedFollowUp)

  const errorResults = results.filter((item) => item.flags.includes('fallback-or-error-reply'))
  const missingDataResults = results.filter((item) => item.flags.includes('missing-concrete-data'))
  const tooShortResults = results.filter((item) => item.flags.includes('too-short'))
  const dissatisfiedWeakResults = results.filter(
    (item) => item.dissatisfiedFollowUp && item.status !== 'pass'
  )

  const recommendations: IterationRecommendation[] = []

  if (errorResults.length > 0) {
    recommendations.push({
      key: 'error-recovery',
      area: 'function_logic',
      priority: errorResults.length >= 3 ? 'high' : 'medium',
      title: 'Strengthen fallback and retry paths',
      reason: `${errorResults.length} replayed prompts still ended in fallback-style or error replies.`,
      suggestedChange: 'Improve tool failure handling and final-answer recovery so replayed prompts degrade into a useful answer instead of an apology or generic failure.',
      evidenceCount: errorResults.length,
      samplePrompts: uniquePromptSamples(errorResults),
    })
  }

  if (missingDataResults.length > 0) {
    recommendations.push({
      key: 'grounding-and-routing',
      area: 'routing',
      priority: missingDataResults.length >= 3 ? 'high' : 'medium',
      title: 'Route live and news prompts to more grounded answers',
      reason: `${missingDataResults.length} prompts expected concrete numbers or facts, but replay output stayed vague.`,
      suggestedChange: 'Tighten intent routing and response contracts for live/news/data-heavy prompts so the model must return sourced numbers when the question implies current price, indicators, or reasons.',
      evidenceCount: missingDataResults.length,
      samplePrompts: uniquePromptSamples(missingDataResults),
    })
  }

  if (tooShortResults.length > 0) {
    recommendations.push({
      key: 'response-depth',
      area: 'response_handling',
      priority: tooShortResults.length >= 4 ? 'medium' : 'low',
      title: 'Expand thin answers',
      reason: `${tooShortResults.length} replies were too short to be reliably useful.`,
      suggestedChange: 'Raise the minimum answer contract for replayed prompts so the assistant includes the conclusion, supporting data, and next action instead of a one-line reply.',
      evidenceCount: tooShortResults.length,
      samplePrompts: uniquePromptSamples(tooShortResults),
    })
  }

  if (dissatisfiedWeakResults.length > 0) {
    recommendations.push({
      key: 'dissatisfied-followups',
      area: 'system_prompt',
      priority: 'high',
      title: 'Prioritize historically dissatisfied prompts',
      reason: `${dissatisfiedWeakResults.length} prompts already had unhappy follow-ups and still replayed weakly.`,
      suggestedChange: 'Use these cases as the primary benchmark set when refining system prompts or response policies, because they reflect proven user dissatisfaction rather than heuristic-only weakness.',
      evidenceCount: dissatisfiedWeakResults.length,
      samplePrompts: uniquePromptSamples(dissatisfiedWeakResults),
    })
  }

  if (results.length > 0 && pass.length * 2 < results.length) {
    recommendations.push({
      key: 'system-contract',
      area: 'system_prompt',
      priority: 'medium',
      title: 'Tighten the global answer contract',
      reason: `Only ${pass.length} of ${results.length} replayed prompts passed the current review heuristics.`,
      suggestedChange: 'Refine the main system prompt so it consistently prefers concrete, decisive, data-backed answers and avoids weak generic phrasing across all prompt categories.',
      evidenceCount: results.length - pass.length,
      samplePrompts: uniquePromptSamples(results.filter((item) => item.status !== 'pass')),
    })
  }

  return {
    total: results.length,
    pass: pass.length,
    warning: warning.length,
    fail: fail.length,
    improved: improved.length,
    dissatisfiedCases: dissatisfiedCases.length,
    recommendations: recommendations.sort((left, right) => {
      const priorityWeight = { high: 3, medium: 2, low: 1 }
      return priorityWeight[right.priority] - priorityWeight[left.priority] || right.evidenceCount - left.evidenceCount
    }),
  }
}
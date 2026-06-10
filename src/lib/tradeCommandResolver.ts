export type TradeAction = 'BUY' | 'SELL'

export interface TradeResolverMessage {
  role: 'user' | 'assistant'
  content: string
  tradePlan?: { symbol: string } | null
  tradeCard?: { symbol: string } | null
}

export interface TradeCommandDraft {
  action: TradeAction
  quantity: number | null
  symbolHint: string | null
  resolvedFromContext: boolean
  needsQuantity: boolean
  needsSymbol: boolean
  /** True when the input describes a future/conditional trade ("when RSI < 30 buy ..."). */
  isConditional?: boolean
  /** Confidence of the symbol hint (`strong` = explicit stock word, `weak` = leftover short token). */
  symbolHintConfidence?: 'strong' | 'weak' | 'none'
}

/** Condition keywords: trade should be queued, not executed immediately. */
export const CONDITIONAL_TRIGGER_REGEX =
  /\b(when|whenever|once|if|agar|jab|jaise\s*hi|as\s*soon\s*as)\b/i

const TRADE_ACTION_REGEX = /\b(buy|sell|exit|nikal|kharid|kharido|becho|bechna)\b/i
const QUESTION_LIKE_REGEX = /\?|\b(should|could|would|suggest|recommend|advice|worth|which|what|why|how|kaise|kya|chahiye|whether)\b|\btell\s+me\b/i
const CONTEXT_REFERENCE_REGEX = /\b(this|that|it|same(?:\s+(?:stock|one|trade|position))?|this\s+(?:stock|trade|one)|that\s+(?:stock|trade|one))\b/i
const CONTEXT_CONTINUATION_REGEX = /\b(then|phir|toh|so|next|continue|go\s+ahead|proceed|do\s+it|of\s+it|of\s+this|same\s+(?:stock|one|trade|position))\b/i

const GENERIC_SYMBOL_WORDS = new Set([
  'A', 'AN', 'AND', 'THE', 'OF', 'FOR', 'ME', 'MY', 'TO', 'AT', 'ON', 'IN', 'BY',
  'IS', 'IT', 'ITS', 'BE', 'AS', 'OR',
  'BUY', 'SELL', 'EXIT', 'HOLD',
  'THIS', 'THAT', 'THESE', 'THOSE', 'SAME', 'ONE', 'ONES',
  'STOCK', 'STOCKS', 'SHARE', 'SHARES', 'TRADE', 'TRADES', 'POSITION', 'ORDER', 'ORDERS',
  'NOW', 'TODAY', 'TOMORROW', 'YESTERDAY', 'LATER',
  'PLEASE', 'DO', 'DOIT', 'DOABLE', 'GREAT', 'OK', 'OKAY',
  'SO', 'THEN', 'AFTER', 'NEXT', 'CONTINUE', 'AHEAD', 'PROCEED',
  'PHIR', 'TOH', 'AUR', 'JUST', 'ONLY',
  'CURRENT', 'PRICE', 'LTP', 'VALUE', 'BEST', 'TOP', 'SUGGESTED', 'RECOMMENDED',
  'EXECUTE', 'CONFIRM', 'PLACE', 'OPEN', 'TAKE',
  'KHARID', 'KHARIDO', 'BECHO', 'BECHNA', 'NIKAL',
  // Conditional / comparison words that must NEVER be treated as a ticker.
  'WHEN', 'WHENEVER', 'ONCE', 'IF', 'AGAR', 'JAB',
  'WILL', 'WOULD', 'SHALL', 'SHOULD', 'COULD', 'MAY', 'MIGHT', 'CAN',
  'ABOVE', 'BELOW', 'GREATER', 'LESS', 'MORE', 'THAN',
  'REACHES', 'REACH', 'CROSSES', 'CROSS', 'BREAKS', 'BREAK', 'HITS', 'HIT',
  'DROPS', 'DROP', 'RISES', 'RISE', 'FALLS', 'FALL', 'GOES', 'GETS',
  'BECOMES', 'BECOME', 'TURNS', 'TURN',
  // Indicator-state slang we want to treat as a *condition*, not a symbol.
  'OVERBOUGHT', 'OVERSOLD', 'UNDERBOUGHT', 'UNDERSOLD',
  'OVERVALUED', 'UNDERVALUED', 'BULLISH', 'BEARISH',
])

/** Minimum length for a standalone symbol hint to be trusted without an exact DB hit. */
const MIN_STRONG_HINT_LENGTH = 4

function normalizeCandidate(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function looksLikeTradeQuestion(input: string): boolean {
  const lower = input.toLowerCase()
  if (!QUESTION_LIKE_REGEX.test(input)) return false
  if (/\b(can you|please)\s+(buy|sell|exit|kharid|becho|nikal)\b/i.test(input)) return false
  if (/\b(buy|sell|exit|kharid|becho|nikal)\s+\d+\b/i.test(input)) return false
  if (/\b(do it|execute now|place order|confirm buy|confirm sell)\b/i.test(lower)) return false
  return true
}

function looksLikeActionableTradeCommand(input: string): boolean {
  const trimmed = input.trim()
  const startsWithAction = /^\s*(?:ok(?:ay)?|great|so|please|just|haan|han)?\s*(buy|sell|exit|nikal|kharid|kharido|becho|bechna)\b/i.test(trimmed)
  const hasExecutionCue = /\b(now|for me|do it|execute|place|confirm|open|take trade|take position|kar do|kardo)\b/i.test(trimmed)
  const hasContextReference = CONTEXT_REFERENCE_REGEX.test(trimmed)
  const hasContextContinuation = CONTEXT_CONTINUATION_REGEX.test(trimmed)
  const quantity = extractQuantity(trimmed)
  return startsWithAction || hasExecutionCue || hasContextReference || hasContextContinuation || quantity != null
}

function normalizeTradeAction(rawAction: string): TradeAction {
  const action = rawAction.toLowerCase()
  if (action === 'buy' || action === 'kharid' || action === 'kharido') return 'BUY'
  return 'SELL'
}

function extractQuantity(input: string): number | null {
  const patterns = [
    /\b(?:buy|sell|exit|nikal|kharid(?:o)?|becho|bechna)\s+(\d+)\b/i,
    /\b(\d+)\s*(?:stocks?|shares?|qty|quantity)\b/i,
    /\b(?:qty|quantity)\s*(?:of)?\s*(\d+)\b/i,
    /\b(?:buy|sell|exit|nikal|kharid(?:o)?|becho|bechna)\s+[A-Za-z0-9][A-Za-z0-9&.\-\s]{0,50}\s+(\d+)\b/i,
  ]

  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (!match?.[1]) continue
    const parsed = Number(match[1])
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(1, Math.floor(parsed))
    }
  }

  return null
}

function sanitizeSymbolPhrase(value: string): string | null {
  const cleaned = value
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    .replace(/[,:;|/\\]+/g, ' ')
    .replace(/\b(when|if|agar|jab|once|with|using|target|stop|loss|profit|above|below|greater|less|than|reaches|crosses|hits)\b.*$/i, ' ')
    .trim()

  const tokens = cleaned.match(/[A-Za-z0-9][A-Za-z0-9&.-]*/g) || []
  const filtered = tokens.filter((token) => !GENERIC_SYMBOL_WORDS.has(normalizeCandidate(token)))
  if (filtered.length === 0) return null
  return filtered.slice(0, 4).join(' ').trim() || null
}

function extractExplicitSymbolHint(input: string): string | null {
  // Primary: find "action qty symbol" pattern anywhere in the input.
  // This handles sentences like "you can buy everything buy 100 SYMBOL" where
  // the first "buy" is noise — we need the one followed by a number.
  const actionQtySymbolRe = /\b(?:buy|sell|exit|nikal|kharid(?:o)?|becho|bechna)\s+\d+\s+([A-Za-z][A-Za-z0-9&.\-\s]{1,60})/ig
  let aqsMatch: RegExpExecArray | null
  let lastAqsMatch: RegExpExecArray | null = null
  while ((aqsMatch = actionQtySymbolRe.exec(input)) !== null) {
    lastAqsMatch = aqsMatch
  }
  if (lastAqsMatch?.[1]) {
    const candidate = sanitizeSymbolPhrase(lastAqsMatch[1])
    if (candidate) return candidate
  }

  const actionMatch = input.match(TRADE_ACTION_REGEX)
  if (actionMatch?.index != null) {
    const afterAction = input.slice(actionMatch.index + actionMatch[0].length)
    const explicitPatterns = [
      /\b(?:shares?\s+of\s+|stocks?\s+of\s+)([A-Za-z0-9][A-Za-z0-9&.\-\s]{1,60})/i,
      /^\s*(?:\d+\s+)?([A-Za-z0-9][A-Za-z0-9&.\-\s]{1,60})/i,
    ]

    for (const pattern of explicitPatterns) {
      const match = afterAction.match(pattern)
      const candidate = sanitizeSymbolPhrase(match?.[1] || '')
      if (candidate) return candidate
    }
  }

  // Handle "go for bharti airtel buy 100" / "bharti airtel buy 100 now"
  // where the stock appears BEFORE the action keyword.
  const beforeActionPatterns = [
    /^\s*(?:ok(?:ay)?|great|so|please|just|haan|han)?\s*(?:go\s+(?:for|with)\s+)?([A-Za-z][A-Za-z0-9&.\-\s]{1,60}?)\s+(?:buy|sell|exit|nikal|kharid|kharido|becho|bechna)\s+\d+\b/i,
    /\b(?:go\s+(?:for|with)\s+)([A-Za-z][A-Za-z0-9&.\-\s]{1,60}?)\s+(?:buy|sell|exit|nikal|kharid|kharido|becho|bechna)\b/i,
    /^\s*(?:ok(?:ay)?|great|so|please|just|haan|han)?\s*([A-Za-z][A-Za-z0-9&.\-\s]{1,60}?)\s+(?:buy|sell|exit|nikal|kharid|kharido|becho|bechna)\b/i,
  ]

  for (const pattern of beforeActionPatterns) {
    const match = input.match(pattern)
    const candidate = sanitizeSymbolPhrase(match?.[1] || '')
    if (candidate) return candidate
  }

  return null
}

function extractSymbolFromMessageContent(content: string): string | null {
  const patterns = [
    /\bbased on the analysis of\s+([A-Za-z0-9][A-Za-z0-9&.\-\s]{1,40})\b/i,
    /\bRecommendation:\s*(?:BUY|SELL)\s+([A-Z0-9][A-Z0-9&.-]{1,30})\b/i,
    /\b([A-Za-z0-9][A-Za-z0-9&.\-\s]{1,40})\s+is\s+(?:potentially\s+|currently\s+|still\s+)?a\s+(?:good\s+|strong\s+|speculative\s+)?(?:buy|sell)\b/i,
    /\b([A-Za-z0-9][A-Za-z0-9&.\-\s]{1,40})\s+shows\s+the\s+most\s+promising\b/i,
    /\b([A-Za-z0-9][A-Za-z0-9&.\-\s]{1,40})\s+could\s+be\s+considered\s+for\s+(?:a\s+)?(?:buy|sell)\b/i,
    /\b(?:best\s+(?:stock|pick)|top\s+pick|final\s+pick|single\s+best\s+pick)\s*(?:is|:)\s*([A-Za-z0-9][A-Za-z0-9&.\-\s]{1,40})\b/i,
    /\bTrade plan for\s+([A-Za-z0-9][A-Za-z0-9&.\-\s]{1,40})\b/i,
    /\b(?:Bought|Sold)\s+([A-Za-z0-9][A-Za-z0-9&.\-\s]{1,40})\b/i,
    /\b([A-Z0-9][A-Z0-9&.-]{1,30})\s+Current Price\b/i,
    /\bCurrent price of\s+([A-Za-z0-9][A-Za-z0-9&.\-\s]{1,40})\b/i,
    /\banalysis for buying\s+\d+\s+shares?\s+of\s+([A-Za-z0-9][A-Za-z0-9&.\-\s]{1,40})\b/i,
    /\b(?:buy|sell|analy(?:s|z)e|price(?:\s+of)?|value(?:\s+of)?|about|for)\s+([A-Za-z0-9][A-Za-z0-9&.\-\s]{1,40})\b/i,
  ]

  for (const pattern of patterns) {
    const match = content.match(pattern)
    const candidate = sanitizeSymbolPhrase(match?.[1] || '')
    if (candidate) return candidate
  }

  return null
}

function findRecentTradeContext(messages: TradeResolverMessage[], currentSymbol?: string | null): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const tradeSymbol = message.tradePlan?.symbol || message.tradeCard?.symbol
    if (tradeSymbol) return tradeSymbol

    const fromContent = extractSymbolFromMessageContent(message.content)
    if (fromContent) return fromContent
  }

  return currentSymbol?.trim() || null
}

/**
 * Rank the hint confidence. "Strong" means the hint is long enough to be a real
 * symbol or matches at a word boundary; "weak" means it's leftover short filler
 * (e.g. "its") that should not beat a stock explicitly mentioned in the message.
 */
function classifyHintConfidence(hint: string | null): 'strong' | 'weak' | 'none' {
  if (!hint) return 'none'
  const compact = normalizeCandidate(hint)
  if (!compact) return 'none'
  if (GENERIC_SYMBOL_WORDS.has(compact)) return 'none'
  if (compact.length < MIN_STRONG_HINT_LENGTH) return 'weak'
  return 'strong'
}

export function resolveTradeCommandDraft(
  input: string,
  messages: TradeResolverMessage[],
  options?: { currentSymbol?: string | null }
): TradeCommandDraft | null {
  if (!TRADE_ACTION_REGEX.test(input)) return null
  if (looksLikeTradeQuestion(input)) return null
  if (!looksLikeActionableTradeCommand(input)) return null

  const actionMatch = input.match(TRADE_ACTION_REGEX)
  if (!actionMatch?.[1]) return null

  const action = normalizeTradeAction(actionMatch[1])
  const quantity = extractQuantity(input)
  const explicitSymbol = extractExplicitSymbolHint(input)
  const contextSymbol = findRecentTradeContext(messages, options?.currentSymbol)
  const hasContextReference = CONTEXT_REFERENCE_REGEX.test(input)
  const hasContextContinuation = CONTEXT_CONTINUATION_REGEX.test(input)
  const isConditional = CONDITIONAL_TRIGGER_REGEX.test(input)

  // A hint made entirely of noise words (e.g. "its", "when", "will") must be
  // discarded here — otherwise downstream fuzzy matching turns "its" → "SUKHJITS".
  const cleanedHint = classifyHintConfidence(explicitSymbol) === 'none' ? null : explicitSymbol
  const hintConfidence = classifyHintConfidence(cleanedHint)

  const symbolHint = cleanedHint || contextSymbol || null
  const symbolHintConfidence = cleanedHint
    ? hintConfidence
    : contextSymbol
      ? 'strong'
      : 'none'
  const resolvedFromContext = !cleanedHint && !!contextSymbol
  const needsSymbol = !symbolHint
  const needsQuantity = quantity == null

  if (!cleanedHint && !contextSymbol && !hasContextReference && !hasContextContinuation && quantity == null) {
    return null
  }

  return {
    action,
    quantity,
    symbolHint,
    resolvedFromContext,
    needsQuantity,
    needsSymbol,
    isConditional,
    symbolHintConfidence,
  }
}

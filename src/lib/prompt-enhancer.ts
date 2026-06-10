import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { generateText } from 'ai'
import type { ScannerKey } from './market-scanners'

export interface ScreenerWeights {
    rsi: number
    momentum: number
    sma: number
    volume: number
    macd: number
}

export interface ScreenerCriteria {
    intent: 'undervalued' | 'momentum' | 'oversold' | 'breakout' | 'safe' | 'generic'
    sector?: string
    discoveryKeys: ScannerKey[]
    weights: ScreenerWeights
    topN: number
    horizonDays: number
    label: string
}

type Intent = ScreenerCriteria['intent']

const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-6'

const DISCOVERY_KEYS: Record<Intent, ScannerKey[]> = {
    undervalued: ['near52wLow', 'oversoldRsi', 'bollingerLower'],
    momentum:    ['biggestRunners', 'goldenCross', 'macdBullishCross'],
    oversold:    ['oversoldRsi', 'bollingerLower', 'near52wLow'],
    breakout:    ['near52wHigh', 'goldenCross', 'unusualVolume'],
    safe:        ['aboveSMA200', 'goldenCross', 'near52wHigh'],
    generic:     ['goldenCross', 'oversoldRsi', 'macdBullishCross'],
}

const WEIGHTS: Record<Intent, ScreenerWeights> = {
    undervalued: { rsi: 0.35, momentum: 0.10, sma: 0.20, volume: 0.10, macd: 0.25 },
    momentum:    { rsi: 0.10, momentum: 0.35, sma: 0.30, volume: 0.15, macd: 0.10 },
    oversold:    { rsi: 0.40, momentum: 0.15, sma: 0.15, volume: 0.15, macd: 0.15 },
    breakout:    { rsi: 0.10, momentum: 0.30, sma: 0.25, volume: 0.25, macd: 0.10 },
    safe:        { rsi: 0.15, momentum: 0.20, sma: 0.40, volume: 0.10, macd: 0.15 },
    generic:     { rsi: 0.25, momentum: 0.25, sma: 0.20, volume: 0.15, macd: 0.15 },
}

const LABELS: Record<Intent, string> = {
    undervalued: 'Undervalued / Value Buy',
    momentum:    'Momentum / Breakout',
    oversold:    'Oversold / Bounce Candidates',
    breakout:    'Breakout / 52W High',
    safe:        'Safe / Blue Chip',
    generic:     'Best Picks',
}

const VALID_INTENTS = new Set<string>(['undervalued', 'momentum', 'oversold', 'breakout', 'safe', 'generic'])
const VALID_SECTORS = new Set(['IT', 'Banking', 'Pharma', 'Auto', 'Energy', 'FMCG', 'Infrastructure', 'Metals', 'Realty'])

const CLASSIFY_PROMPT = `You are a stock screener query classifier for Indian markets (NSE/BSE).

Given a user query, extract:
- intent: one of undervalued | momentum | oversold | breakout | safe | generic
  - undervalued: cheap stocks, value buy, below fair value, saste stocks, discount
  - momentum: trending, running, breakout candidates, multibagger, tez chal
  - oversold: RSI low, bounce candidates, reversal play, oversold stocks
  - breakout: near 52-week high, ATH, new highs, breaking out
  - safe: blue chip, large cap, stable, low risk, conservative, defensive
  - generic: any "best stocks", "good stocks", "recommend stocks" without clear intent
- sector: one of IT | Banking | Pharma | Auto | Energy | FMCG | Infrastructure | Metals | Realty | null
- topN: integer 3–10, default 5
- horizonDays: trading-day horizon, default 20 (1 month ≈ 21, 1 week ≈ 5, 1 year ≈ 252)

Respond with ONLY a JSON object, no explanation:
{"intent":"...","sector":null,"topN":5,"horizonDays":20}

Query: {QUERY}`

function buildCriteria(intent: Intent, sector: string | undefined, topN: number, horizonDays: number): ScreenerCriteria {
    return {
        intent,
        sector,
        discoveryKeys: DISCOVERY_KEYS[intent],
        weights: WEIGHTS[intent],
        topN,
        horizonDays,
        label: LABELS[intent],
    }
}

// ── Regex fallback (fast, no LLM) ────────────────────────────────────────────

function parseTopN(q: string): number | null {
    const m =
        q.match(/\btop\s+(\d{1,2})\b/i) ||
        q.match(/\b(\d{1,2})\s+(?:best\s+)?stocks?\b/i) ||
        q.match(/\bgive\s+me\s+(\d{1,2})\b/i) ||
        q.match(/\bshow\s+me\s+(\d{1,2})\b/i)
    if (!m) return null
    const n = parseInt(m[1], 10)
    return isFinite(n) && n > 0 ? Math.min(10, Math.max(3, n)) : null
}

function parseHorizon(q: string): number | null {
    const m = q.match(/\b(?:last|past|previous)\s+(\d{1,3})\s*(day|days|week|weeks|month|months)\b/i)
    if (!m) return null
    const n = Math.min(250, parseInt(m[1], 10))
    const unit = m[2].toLowerCase()
    if (unit.startsWith('d')) return n
    if (unit.startsWith('w')) return n * 5
    return Math.round(n * 21)
}

function detectSector(q: string): string | undefined {
    const checks: [RegExp, string][] = [
        [/\b(it\b|tech|software|infosys|tcs|wipro|hcl\s*tech)\b/i, 'IT'],
        [/\b(bank|banking|hdfc\s*bank|sbi|icici|kotak|axis\s*bank)\b/i, 'Banking'],
        [/\b(pharma|healthcare|medical|cipla|sun\s*pharma|drreddy)\b/i, 'Pharma'],
        [/\b(auto|automobile|car|ev|tata\s*motors|maruti|mahindra)\b/i, 'Auto'],
        [/\b(energy|oil|gas|power|ongc|ntpc|adani\s*power)\b/i, 'Energy'],
        [/\b(fmcg|consumer|food|hul|itc|dabur|nestle)\b/i, 'FMCG'],
        [/\b(infra|infrastructure|construction|l&t|larsen)\b/i, 'Infrastructure'],
        [/\b(metal|steel|mining|tata\s*steel|jsw|hindalco)\b/i, 'Metals'],
        [/\b(realty|real\s*estate|dlf|godrej\s*properties)\b/i, 'Realty'],
    ]
    for (const [re, sector] of checks) {
        if (re.test(q)) return sector
    }
    return undefined
}

function regexFallback(query: string): ScreenerCriteria {
    const q = query.toLowerCase()
    const topN = parseTopN(q) ?? 5
    const horizonDays = parseHorizon(q) ?? 20
    const sector = detectSector(q)

    let intent: Intent = 'generic'
    if (/\b(undervalued|value\s+buy|value\s+stock|cheap|saste|kam\s+daam|bargain|discount|below\s+(?:book|fair|intrinsic))\b/i.test(q)) intent = 'undervalued'
    else if (/\b(momentum|trending|multibagger|rocket|runup|run\s+up|tez\s+chal)\b/i.test(q)) intent = 'momentum'
    else if (/\b(oversold|bounce|reversal|rebound|recovery)\b/i.test(q)) intent = 'oversold'
    else if (/\b(52\s*week\s*high|new\s*high|ath|all[- ]?time\s*high|break\s*out|breakout)\b/i.test(q)) intent = 'breakout'
    else if (/\b(safe|stable|low\s+risk|blue\s+chip|large\s+cap|conservative|defensive|surakshit)\b/i.test(q)) intent = 'safe'

    return buildCriteria(intent, sector, topN, horizonDays)
}

// ── LLM-based enhancer (primary) ─────────────────────────────────────────────

export async function enhancePrompt(query: string): Promise<ScreenerCriteria> {
    try {
        const bedrock = createAmazonBedrock({ region: process.env.AWS_REGION || 'ap-south-1' })
        const { text } = await generateText({
            model: bedrock(BEDROCK_MODEL),
            prompt: CLASSIFY_PROMPT.replace('{QUERY}', query),
            temperature: 0,
            maxOutputTokens: 120,
        })

        // Extract JSON from the response (model may wrap it in markdown)
        const jsonMatch = text.match(/\{[^}]+\}/)
        if (!jsonMatch) throw new Error('No JSON in LLM response')

        const parsed = JSON.parse(jsonMatch[0])

        const intent: Intent = VALID_INTENTS.has(parsed.intent) ? parsed.intent : 'generic'
        const sector = typeof parsed.sector === 'string' && VALID_SECTORS.has(parsed.sector) ? parsed.sector : undefined
        const topN = typeof parsed.topN === 'number' && parsed.topN > 0 ? Math.min(10, Math.max(3, Math.round(parsed.topN))) : 5
        const horizonDays = typeof parsed.horizonDays === 'number' && parsed.horizonDays > 0 ? Math.min(250, Math.round(parsed.horizonDays)) : 20

        return buildCriteria(intent, sector, topN, horizonDays)
    } catch {
        // Silent fallback — regex runs in <1ms
        return regexFallback(query)
    }
}

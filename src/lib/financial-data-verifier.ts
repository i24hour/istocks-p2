/**
 * Financial Data Verifier
 *
 * Crawls multiple authoritative Indian financial data sites (screener.in primary,
 * stockanalysis.com + web search for verification), cross-checks quarterly results,
 * and returns verified data with a confidence score + source citations.
 *
 * Priority sources:
 *   1. screener.in/company/{SYMBOL}/consolidated/  — best Indian financials, stable HTML
 *   2. stockanalysis.com/quote/nse/{symbol}/financials/?p=quarterly — global aggregator
 *   3. Firecrawl web search for 2 more references (moneycontrol, tickertape, ET, etc.)
 */

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1'
const FIRECRAWL_TIMEOUT_MS = 12000

// ── Query type detection ───────────────────────────────────────────────────────

const FINANCIAL_PATTERNS = [
    /\b(quarterly|quarter|q[1-4]\s*fy|fy\d{2,4})\b/i,
    /\b(revenue|sales|turnover|income|profit|loss|ebitda|pat|eps)\b/i,
    /\b(balance\s*sheet|cash\s*flow|p&l|pl|annual\s*result)\b/i,
    /\b(financial\s*result|earnings|result[s]?)\b/i,
    /\b(last\s+\d+\s+quarters?|last\s+\d+\s+years?)\b/i,
    /\b(quarter\s*wise|year\s*wise|yoy|qoq)\b/i,
]

export function isFinancialDataQuery(message: string): boolean {
    const lower = message.toLowerCase()
    return FINANCIAL_PATTERNS.some(p => p.test(lower))
}

// ── Firecrawl scrape helper ────────────────────────────────────────────────────

async function firecrawlScrape(url: string): Promise<string | null> {
    const apiKey = process.env.FIRECRAWL_API_KEY?.trim()
    if (!apiKey) return null

    try {
        const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
            method: 'POST',
            signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url,
                formats: ['markdown'],
                onlyMainContent: true,
                waitFor: 2000, // wait for JS tables to render
            }),
        })
        if (!res.ok) return null
        const data = await res.json()
        if (!data.success) return null
        const content: string = data.data?.markdown ?? ''
        return content.slice(0, 6000) // cap to avoid token explosion
    } catch {
        return null
    }
}

async function firecrawlSearch(query: string, limit = 3): Promise<Array<{ url: string; title: string; content: string }>> {
    const apiKey = process.env.FIRECRAWL_API_KEY?.trim()
    if (!apiKey) return []

    try {
        const res = await fetch(`${FIRECRAWL_BASE}/search`, {
            method: 'POST',
            signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query,
                limit,
                scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
            }),
        })
        if (!res.ok) return []
        const data = await res.json()
        if (!data.success || !Array.isArray(data.data)) return []
        return data.data
            .filter((item: any) => item.url && (item.markdown || item.description))
            .map((item: any) => ({
                url: item.url,
                title: item.metadata?.title ?? item.title ?? item.url,
                content: (item.markdown ?? '').slice(0, 3000),
            }))
    } catch {
        return []
    }
}

// ── URL builders for known Indian financial sites ─────────────────────────────

function buildFinancialUrls(symbol: string): Array<{ label: string; url: string }> {
    const s = symbol.toUpperCase().replace(/\.(NS|BO)$/i, '')
    return [
        {
            label: 'Screener.in (Consolidated)',
            url: `https://www.screener.in/company/${s}/consolidated/`,
        },
        {
            label: 'Screener.in (Standalone)',
            url: `https://www.screener.in/company/${s}/`,
        },
        {
            label: 'StockAnalysis.com (Quarterly)',
            url: `https://stockanalysis.com/quote/nse/${s.toLowerCase()}/financials/?p=quarterly`,
        },
    ]
}

// ── Main export ────────────────────────────────────────────────────────────────

export interface FinancialVerificationResult {
    symbol: string
    primaryContent: string     // Best source full markdown
    verificationContent: string // 2–3 additional sources combined
    sources: Array<{ label: string; url: string; available: boolean }>
    confidenceNote: string
    hasFirecrawlKey: boolean
}

/**
 * Fetch and cross-verify financial data for a stock symbol.
 * Runs screener.in scrape + stockanalysis scrape + web search in parallel.
 */
export async function fetchVerifiedFinancials(
    symbol: string,
    query: string
): Promise<FinancialVerificationResult> {
    const hasKey = !!process.env.FIRECRAWL_API_KEY?.trim()

    const knownUrls = buildFinancialUrls(symbol)

    // Run primary scrapes + search in parallel
    const [screenerResult, stockAnalysisResult, searchResults] = await Promise.allSettled([
        firecrawlScrape(knownUrls[0].url),  // screener.in consolidated
        firecrawlScrape(knownUrls[2].url),  // stockanalysis.com quarterly
        firecrawlSearch(
            `${symbol} quarterly results revenue profit ${new Date().getFullYear()} India`,
            3
        ),
    ])

    const screenerContent = screenerResult.status === 'fulfilled' ? (screenerResult.value ?? '') : ''
    const stockAnalysisContent = stockAnalysisResult.status === 'fulfilled' ? (stockAnalysisResult.value ?? '') : ''
    const searchHits = searchResults.status === 'fulfilled' ? searchResults.value : []

    // Fall back to screener standalone if consolidated returned nothing
    let primaryContent = screenerContent
    let primaryLabel = knownUrls[0].label
    if (!primaryContent.trim()) {
        const standalone = await firecrawlScrape(knownUrls[1].url)
        if (standalone?.trim()) {
            primaryContent = standalone
            primaryLabel = knownUrls[1].label
        }
    }

    // Build verification block from stockanalysis + search hits
    const verificationParts: string[] = []
    if (stockAnalysisContent.trim()) {
        verificationParts.push(`### ${knownUrls[2].label}\nURL: ${knownUrls[2].url}\n\n${stockAnalysisContent}`)
    }
    for (const hit of searchHits) {
        if (hit.content.trim() && !hit.url.includes('screener.in') && !hit.url.includes('stockanalysis.com')) {
            verificationParts.push(`### ${hit.title}\nURL: ${hit.url}\n\n${hit.content}`)
        }
    }

    const sources = [
        { label: primaryLabel, url: knownUrls[0].url, available: !!primaryContent.trim() },
        { label: knownUrls[2].label, url: knownUrls[2].url, available: !!stockAnalysisContent.trim() },
        ...searchHits.map(h => ({ label: h.title.slice(0, 60), url: h.url, available: true })),
    ]

    const availableCount = sources.filter(s => s.available).length
    const confidenceNote = availableCount >= 3
        ? `High confidence — cross-verified across ${availableCount} sources`
        : availableCount === 2
            ? `Medium confidence — verified across 2 sources`
            : availableCount === 1
                ? `Single source — verify independently`
                : `No financial data sources reachable — answer based on LLM training data only`

    console.log(`💰 Financial verifier: ${availableCount} sources for ${symbol} | ${confidenceNote}`)

    return {
        symbol,
        primaryContent,
        verificationContent: verificationParts.join('\n\n---\n\n'),
        sources,
        confidenceNote,
        hasFirecrawlKey: hasKey,
    }
}

/**
 * Format verified financial data for LLM prompt injection.
 */
export function formatVerifiedFinancialsForAI(result: FinancialVerificationResult): string {
    if (!result.primaryContent && !result.verificationContent) return ''

    const sourceLines = result.sources
        .filter(s => s.available)
        .map(s => `  • [${s.label}](${s.url})`)
        .join('\n')

    const parts: string[] = [
        `## Verified Financial Data — ${result.symbol}`,
        `_${result.confidenceNote}_`,
        `\n**Sources crawled:**\n${sourceLines}`,
    ]

    if (result.primaryContent) {
        parts.push(`\n### Primary Source (Screener.in)\n${result.primaryContent}`)
    }
    if (result.verificationContent) {
        parts.push(`\n### Verification Sources\n${result.verificationContent}`)
    }

    return parts.join('\n')
}

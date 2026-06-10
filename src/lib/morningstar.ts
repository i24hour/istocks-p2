/**
 * Morningstar India integration — powered by Firecrawl.
 *
 * Uses Firecrawl's /search with site:morningstar.in to surface mutual fund
 * analyst reports, ratings, performance data, fund manager info, and risk analysis.
 */

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1'
const FIRECRAWL_TIMEOUT_MS = 15000
const MAX_CONTENT_CHARS = 4000   // Morningstar analyst reports are rich — give more room
const MAX_RESULTS = 3

export interface MorningstarResult {
    title: string
    url: string
    content: string
    fundId?: string   // e.g. "f0gbr06rmj" extracted from URL
}

export interface MorningstarQueryResult {
    success: boolean
    results: MorningstarResult[]
    query: string
    error?: string
}

/**
 * Search Morningstar India via Firecrawl for any mutual fund / AMC query.
 * Targets morningstar.in only so results are always fund-data.
 */
export async function queryMorningstar(userQuery: string): Promise<MorningstarQueryResult> {
    const apiKey = process.env.FIRECRAWL_API_KEY?.trim()
    if (!apiKey) {
        return { success: false, results: [], query: userQuery, error: 'Firecrawl API key not configured.' }
    }

    const searchQuery = `${userQuery} site:morningstar.in`

    try {
        const res = await fetch(`${FIRECRAWL_BASE}/search`, {
            method: 'POST',
            signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: searchQuery,
                limit: MAX_RESULTS,
                scrapeOptions: {
                    formats: ['markdown'],
                    onlyMainContent: true,
                },
            }),
        })

        if (!res.ok) {
            return { success: false, results: [], query: userQuery, error: `Firecrawl HTTP ${res.status}` }
        }

        const data = await res.json()
        if (!data.success || !Array.isArray(data.data)) {
            return { success: false, results: [], query: userQuery, error: 'No results from Firecrawl.' }
        }

        const results: MorningstarResult[] = []
        const seen = new Set<string>()

        for (const item of data.data) {
            const url: string = item.url ?? item.metadata?.sourceURL ?? ''
            if (!url || seen.has(url)) continue
            seen.add(url)

            const markdown: string = item.markdown ?? ''

            // Strip ads, image placeholders, social share links, footer noise
            const cleaned = markdown
                .replace(/!\[.*?\]\(data:image\/[^)]*\)/g, '')
                .replace(/!\[.*?\]\(https?:\/\/[^)]*\.(gif|svg|png|jpg|jpeg)[^)]*\)/g, '')
                .replace(/Advertisement[\s\S]{0,200}?ADVERTISEMENT/g, '')
                .replace(/\[Facebook\][\s\S]*$/gm, '')
                .replace(/© Copyright \d{4} Morningstar[\s\S]*/g, '')
                .replace(/International Sites[\s\S]*/g, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim()

            const content = cleaned.slice(0, MAX_CONTENT_CHARS)
            if (!content) continue

            // Extract Morningstar fund ID from URL
            const fundIdMatch = url.match(/mutualfunds\/([a-z0-9]+)\//i)

            results.push({
                title: item.metadata?.title ?? item.title ?? url,
                url,
                content,
                fundId: fundIdMatch?.[1],
            })
        }

        return { success: results.length > 0, results, query: userQuery }
    } catch (err: any) {
        return { success: false, results: [], query: userQuery, error: err?.message ?? 'Unknown error' }
    }
}

/**
 * Format Morningstar results for injection into an LLM prompt.
 */
export function formatMorningstarResultsForAI(result: MorningstarQueryResult): string {
    if (!result.success || result.results.length === 0) return ''

    const sections = result.results.map((r, i) =>
        `[Source ${i + 1}] ${r.title}\nURL: ${r.url}\n\n${r.content}`
    )

    return `## Morningstar India Data (live):\n\n${sections.join('\n\n---\n\n')}`
}

/**
 * Returns true if the message is asking about mutual funds, ETFs, or AMC-related topics.
 * Used to fast-route to yahoo_agent where queryMorningstar tool is available.
 */
export function detectMutualFundIntent(message: string): boolean {
    return /\b(mutual\s*fund|mf\b|flexi\s*cap|large\s*cap|mid\s*cap|small\s*cap|multi\s*cap|index\s*fund|\betf\b|sip\b|nav\b|\bamc\b|fund\s*house|fund\s*manager|morningstar|star\s*rating|expense\s*ratio|exit\s*load|portfolio\s*overlap|fund\s*comparison|fund\s*return|fund\s*performance|direct\s*plan|regular\s*plan|growth\s*plan|dividend\s*plan|parag\s*parikh|mirae\s*asset|motilal\s*oswal\s*(fund|flexi|mid|small)|nippon\s*(fund|india\s*fund)|franklin\s*(templeton|india)|invesco\s*(fund|india)|quant\s*(fund|flexi|mid|small)|axis\s*(fund|flexi|mid|small|blue)|kotak\s*(fund|flexi|mid|small)|dsp\s*(fund|flexi|mid|small)|tata\s*(fund|flexi|mid|small)|uti\s*(fund|flexi|mid|small)|sbi\s*(fund|flexi|mid|small)|icici\s*pru(dential)?\s*(fund|flexi|mid|small))\b/i.test(message)
}

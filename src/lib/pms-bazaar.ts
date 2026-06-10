/**
 * PMS Bazaar integration — powered by Firecrawl.
 *
 * Uses Firecrawl's /search with site:pmsbazaar.com to surface relevant
 * PMS fund data, performance reports, and AIF info for any user query.
 */

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1'
const FIRECRAWL_TIMEOUT_MS = 12000
const MAX_CONTENT_CHARS = 2000   // per result — keeps token cost sane
const MAX_RESULTS = 4

export interface PMSResult {
    title: string
    url: string
    content: string
    datePublished?: string
}

export interface PMSQueryResult {
    success: boolean
    results: PMSResult[]
    query: string
    error?: string
}

/**
 * Search PMS Bazaar via Firecrawl for any PMS/AIF-related query.
 * Targets pmsbazaar.com only so results are always on-topic.
 */
export async function queryPMSBazaar(userQuery: string): Promise<PMSQueryResult> {
    const apiKey = process.env.FIRECRAWL_API_KEY?.trim()
    if (!apiKey) {
        return { success: false, results: [], query: userQuery, error: 'Firecrawl API key not configured.' }
    }

    // Append site filter so Firecrawl only searches PMS Bazaar
    const searchQuery = `${userQuery} site:pmsbazaar.com`

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

        const results: PMSResult[] = []
        const seen = new Set<string>()

        for (const item of data.data) {
            const url: string = item.url ?? item.metadata?.sourceURL ?? ''
            if (!url || seen.has(url)) continue
            seen.add(url)

            const markdown: string = item.markdown ?? ''
            // Strip SVG placeholders and clean up whitespace
            const cleaned = markdown
                .replace(/!\[.*?\]\(data:image\/svg\+xml[^)]*\)/g, '')
                .replace(/\[Facebook\].*?\[share on Linkedin\][^\n]*/gs, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim()

            const content = cleaned.slice(0, MAX_CONTENT_CHARS)
            if (!content) continue

            results.push({
                title: item.metadata?.title ?? item.title ?? url,
                url,
                content,
                datePublished: item.metadata?.publishedTime ?? item.metadata?.datePublished ?? undefined,
            })
        }

        return { success: results.length > 0, results, query: userQuery }
    } catch (err: any) {
        return { success: false, results: [], query: userQuery, error: err?.message ?? 'Unknown error' }
    }
}

/**
 * Format PMS Bazaar results for injection into an LLM prompt.
 */
export function formatPMSResultsForAI(result: PMSQueryResult): string {
    if (!result.success || result.results.length === 0) return ''

    const sections = result.results.map((r, i) => {
        const dateStr = r.datePublished ? `\nPublished: ${r.datePublished}` : ''
        return `[Source ${i + 1}] ${r.title}${dateStr}\nURL: ${r.url}\n\n${r.content}`
    })

    return `## PMS Bazaar Data (live):\n\n${sections.join('\n\n---\n\n')}`
}

/**
 * Returns true if the message is asking about PMS or AIF investments.
 * Used as a hint — not a hard gate; the LLM still decides whether to call the tool.
 */
export function detectPMSIntent(message: string): boolean {
    return /\b(pms|portfolio\s+management\s+service|aif|alternative\s+investment\s+fund|discretionary\s+portfolio|pms\s+fund|pms\s+returns?|pms\s+performance|pms\s+comparison|invest\s+in\s+pms|minimum\s+(?:in\s+pms|pms\s+investment)|marcellus|motilal\s+oswal\s+pms|iifl\s+pms|kotak\s+pms|hdfc\s+pms|ask\s+investment|360\s+one|white\s+oak|avendus|pms\s+vs|pms\s+or\s+mutual|pmsbazaar)\b/i.test(message)
}

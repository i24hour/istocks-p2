// Firecrawl integration for deep content extraction from LinkedIn, X/Twitter, and news sites.
// Runs in parallel with Serper to surface social sentiment and full article text.

export interface FirecrawlResult {
    title: string
    url: string
    snippet: string
    fullContent: string
    source: 'linkedin' | 'x_twitter' | 'news'
    datePublished?: string
}

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1'
const FIRECRAWL_TIMEOUT_MS = 8000

async function firecrawlSearch(query: string, limit = 4): Promise<FirecrawlResult[]> {
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
                scrapeOptions: {
                    formats: ['markdown'],
                    onlyMainContent: true,
                },
            }),
        })

        if (!res.ok) {
            console.warn(`⚠️ Firecrawl search failed (${res.status}) for: "${query}"`)
            return []
        }

        const data = await res.json()
        if (!data.success || !Array.isArray(data.data)) return []

        const out: FirecrawlResult[] = []
        const seen = new Set<string>()

        for (const item of data.data) {
            const url: string = item.url ?? item.metadata?.sourceURL ?? ''
            if (!url || seen.has(url)) continue
            seen.add(url)

            const isLinkedIn = url.includes('linkedin.com')
            const isX = url.includes('x.com') || url.includes('twitter.com')
            const source: FirecrawlResult['source'] = isLinkedIn ? 'linkedin' : isX ? 'x_twitter' : 'news'

            const markdown: string = item.markdown ?? ''
            const snippet = item.metadata?.description ?? item.description ?? markdown.slice(0, 300)
            const datePublished =
                item.metadata?.publishedTime ??
                item.metadata?.datePublished ??
                item.metadata?.['article:published_time'] ??
                undefined

            out.push({
                title: item.metadata?.title ?? item.title ?? url,
                url,
                snippet,
                fullContent: markdown.slice(0, 1500), // cap to avoid token explosion
                source,
                datePublished,
            })
        }

        return out
    } catch (err: any) {
        console.warn(`⚠️ Firecrawl error for "${query}":`, err?.message ?? err)
        return []
    }
}

/**
 * Fetch social + news sentiment for a stock from LinkedIn, X, and web.
 * Runs 3 Firecrawl searches in parallel.
 */
export async function fetchSocialSentiment(
    stockSymbol: string,
    stockName: string
): Promise<FirecrawlResult[]> {
    if (!process.env.FIRECRAWL_API_KEY?.trim()) return []

    const name = stockName || stockSymbol
    const yr = new Date().getFullYear()

    const [linkedInRes, xRes, newsRes] = await Promise.allSettled([
        firecrawlSearch(`"${name}" NSE stock analysis outlook site:linkedin.com`, 3),
        firecrawlSearch(`"${name}" NSE stock buy sell ${yr} site:x.com OR site:twitter.com`, 3),
        firecrawlSearch(`"${name}" stock news latest results ${yr}`, 4),
    ])

    const all: FirecrawlResult[] = []
    const seenUrls = new Set<string>()

    for (const r of [linkedInRes, xRes, newsRes]) {
        if (r.status !== 'fulfilled') continue
        for (const item of r.value) {
            if (!seenUrls.has(item.url)) {
                seenUrls.add(item.url)
                all.push(item)
            }
        }
    }

    const linkedInCount = all.filter(r => r.source === 'linkedin').length
    const xCount = all.filter(r => r.source === 'x_twitter').length
    const newsCount = all.filter(r => r.source === 'news').length
    console.log(`🔥 Firecrawl: ${linkedInCount} LinkedIn, ${xCount} X posts, ${newsCount} news for ${name}`)

    return all
}

/**
 * Format Firecrawl results for injection into an LLM prompt.
 * Returns empty string if no results — safe to concatenate without checks.
 */
export function formatFirecrawlResultsForAI(results: FirecrawlResult[]): string {
    if (!results.length) return ''

    const label = (s: FirecrawlResult['source']) =>
        s === 'linkedin' ? 'LinkedIn' : s === 'x_twitter' ? 'X (Twitter)' : 'News/Web'

    const sections = results
        .filter(r => r.fullContent?.trim() || r.snippet?.trim())
        .map(r => {
            const content = r.fullContent?.trim() || r.snippet?.trim()
            const dateStr = r.datePublished ? `\nDate: ${r.datePublished}` : ''
            return `[${label(r.source)}] ${r.title}${dateStr}\nURL: ${r.url}\n\n${content}`
        })

    if (!sections.length) return ''

    return `\n\n## Social & Deep Web Sentiment (Firecrawl):\n\n${sections.join('\n\n---\n\n')}`
}

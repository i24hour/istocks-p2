// Web search integration for stock news and sentiment analysis.
// Primary: Serper API. Fallback: Google Custom Search API.
// Social enrichment: Firecrawl for LinkedIn + X posts (parallel).

interface SearchResult {
    name: string
    url: string
    snippet: string
    datePublished?: string
}

interface SearchResponse {
    success: boolean
    results: SearchResult[]
    error?: string
}

export interface SearchOptions {
    recencyDays?: number
    requireFresh?: boolean
    requireDatedForFresh?: boolean
    sortByDate?: boolean
}

interface SerperItem {
    title?: string
    link?: string
    snippet?: string
    date?: string
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const SEARCH_FETCH_TIMEOUT_MS = 4000

function recencyToTbs(days: number): string {
    const safeDays = Math.max(1, Math.floor(days))
    if (safeDays <= 31) return `qdr:d${safeDays}`
    const months = Math.max(1, Math.ceil(safeDays / 30))
    return `qdr:m${months}`
}

function recencyToDateRestrict(days: number): string {
    const safeDays = Math.max(1, Math.floor(days))
    if (safeDays <= 31) return `d${safeDays}`
    const months = Math.max(1, Math.ceil(safeDays / 30))
    return `m${months}`
}

function parsePublishedDate(value?: string): Date | null {
    if (!value || typeof value !== 'string') return null
    const raw = value.trim()
    if (!raw) return null

    const lower = raw.toLowerCase()
    const now = new Date()

    if (/\btoday\b/.test(lower)) return now
    if (/\byesterday\b/.test(lower)) return new Date(now.getTime() - ONE_DAY_MS)

    const rel = lower.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/)
    if (rel) {
        const qty = Number(rel[1])
        const unit = rel[2]
        if (!Number.isFinite(qty) || qty <= 0) return null
        const factor =
            unit === 'minute' ? 60 * 1000 :
            unit === 'hour' ? 60 * 60 * 1000 :
            unit === 'day' ? ONE_DAY_MS :
            unit === 'week' ? 7 * ONE_DAY_MS :
            unit === 'month' ? 30 * ONE_DAY_MS :
            365 * ONE_DAY_MS
        return new Date(now.getTime() - qty * factor)
    }

    const parsed = new Date(raw)
    if (!isNaN(parsed.getTime())) return parsed

    const cleaned = raw.replace(/^[•\-–—:\s]+/, '').replace(/[•]/g, '').trim()
    const parsedClean = new Date(cleaned)
    if (!isNaN(parsedClean.getTime())) return parsedClean

    return null
}

function extractDateFromSnippet(snippet: string): string | undefined {
    if (!snippet) return undefined
    const text = snippet.trim()
    const patterns = [
        /^(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/,
        /^([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/,
        /^(\d{4}-\d{2}-\d{2})/,
        /^(\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago)/i,
        /^(today|yesterday)/i,
    ]
    for (const p of patterns) {
        const m = text.match(p)
        if (m?.[1]) return m[1]
    }
    return undefined
}

function filterAndSortByRecency(
    results: SearchResult[],
    recencyDays?: number,
    requireDatedForFresh: boolean = true,
    sortByDate: boolean = true
): SearchResult[] {
    const withTs = results.map((r) => ({
        result: r,
        date: parsePublishedDate(r.datePublished),
    }))

    let filtered = withTs
    if (recencyDays && recencyDays > 0) {
        const cutoff = Date.now() - recencyDays * ONE_DAY_MS
        filtered = withTs.filter((x) => {
            if (!x.date) return !requireDatedForFresh
            return x.date.getTime() >= cutoff
        })
    }

    if (sortByDate) {
        filtered.sort((a, b) => {
            const at = a.date?.getTime() ?? 0
            const bt = b.date?.getTime() ?? 0
            return bt - at
        })
    }

    return filtered.map((x) => x.result)
}

function buildEnhancedQuery(query: string, stockSymbol: string, stockName: string): string {
    const searchContext = stockName || stockSymbol
    return searchContext
        ? `${searchContext} ${query} India stock`
        : query
}

function normalizeSerperResults(payload: any, count: number): SearchResult[] {
    const organic: SerperItem[] = Array.isArray(payload?.organic) ? payload.organic : []
    const news: SerperItem[] = Array.isArray(payload?.news) ? payload.news : []
    const merged = [...organic, ...news]

    const seen = new Set<string>()
    const out: SearchResult[] = []
    for (const item of merged) {
        const name = typeof item?.title === 'string' ? item.title : ''
        const url = typeof item?.link === 'string' ? item.link : ''
        const snippet = typeof item?.snippet === 'string' ? item.snippet : ''
        const directDate = typeof item?.date === 'string' ? item.date : undefined
        const snippetDate = extractDateFromSnippet(snippet)
        const date = directDate || snippetDate
        if (!name || !url || seen.has(url)) continue
        seen.add(url)
        out.push({
            name,
            url,
            snippet,
            datePublished: date,
        })
        if (out.length >= count) break
    }
    return out
}

/**
 * Search Google for stock-related news and articles
 * @param query - Search query (e.g., "ADANIPOWER revenue decline news")
 * @param stockSymbol - Stock symbol for context
 * @param count - Number of results to fetch (default 5)
 */
export async function searchGoogle(
    query: string,
    stockSymbol: string,
    stockName: string = '',
    count: number = 5,
    options: SearchOptions = {}
): Promise<SearchResponse> {
    const serperKey = process.env.SERPER_API_KEY?.trim()
    const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY?.trim()
    const googleSearchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID?.trim()

    if (!serperKey && (!googleApiKey || !googleSearchEngineId)) {
        console.error('❌ SERPER_API_KEY or GOOGLE_SEARCH_API_KEY/GOOGLE_SEARCH_ENGINE_ID is not configured')
        return {
            success: false,
            results: [],
            error: 'Web search is not configured. Please add SERPER_API_KEY or Google Search API credentials.'
        }
    }

    // Build search query — use raw query if it's already specific (from webSearch tool),
    // add stock context only when a symbol/name is explicitly passed in.
    const enhancedQuery = buildEnhancedQuery(query, stockSymbol, stockName)
    const recencyDays = options.recencyDays
    const requireFresh = options.requireFresh === true
    const requireDatedForFresh = options.requireDatedForFresh !== false
    const sortByDate = options.sortByDate !== false

    // 1) Primary path: Serper
    if (serperKey) {
        try {
            console.log(`🔍 Searching via Serper for: "${enhancedQuery}"`)
            const serperResponse = await fetch('https://google.serper.dev/search', {
                method: 'POST',
                signal: AbortSignal.timeout(SEARCH_FETCH_TIMEOUT_MS),
                headers: {
                    'X-API-KEY': serperKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    q: enhancedQuery,
                    gl: 'in',
                    hl: 'en',
                    num: count,
                    ...(recencyDays && recencyDays > 0 ? { tbs: recencyToTbs(recencyDays) } : {}),
                }),
            })

            if (!serperResponse.ok) {
                const err = await serperResponse.json().catch(() => ({}))
                const msg = err?.message || err?.error?.message || 'Unknown error'
                console.error('❌ Serper API error:', serperResponse.status, JSON.stringify(err))
                if (!googleApiKey || !googleSearchEngineId) {
                    return {
                        success: false,
                        results: [],
                        error: `Serper API error: ${serperResponse.status} - ${msg}`
                    }
                }
                console.warn('⚠️ Falling back to Google Custom Search API...')
            } else {
                const serperData = await serperResponse.json()
                const rawSerperResults = normalizeSerperResults(serperData, count * 2)
                const serperResults = filterAndSortByRecency(
                    rawSerperResults,
                    recencyDays,
                    requireDatedForFresh,
                    sortByDate
                ).slice(0, count)
                console.log(`✅ Found ${serperResults.length} search results via Serper${recencyDays ? ` (last ${recencyDays}d)` : ''}`)

                if (serperResults.length > 0) {
                    return {
                        success: true,
                        results: serperResults,
                    }
                }
                if (!googleApiKey || !googleSearchEngineId) {
                    return {
                        success: !requireFresh,
                        results: [],
                        error: requireFresh
                            ? `No fresh search results found in last ${recencyDays || 0} day(s).`
                            : undefined,
                    }
                }
                console.warn('⚠️ Serper returned no usable fresh results. Trying Google fallback...')
            }
        } catch (error: any) {
            console.error('❌ Serper search error:', error)
            if (!googleApiKey || !googleSearchEngineId) {
                return {
                    success: false,
                    results: [],
                    error: error.message || 'Failed to search web via Serper'
                }
            }
            console.warn('⚠️ Falling back to Google Custom Search API...')
        }
    }

    // 2) Fallback path: Google Custom Search
    try {
        if (!googleApiKey || !googleSearchEngineId) {
            return {
                success: true,
                results: [],
            }
        }

        const endpoint = 'https://www.googleapis.com/customsearch/v1'
        const params = new URLSearchParams({
            key: googleApiKey,
            cx: googleSearchEngineId,
            q: enhancedQuery,
            num: count.toString(),
            gl: 'in', // India
            dateRestrict: recencyDays && recencyDays > 0
                ? recencyToDateRestrict(recencyDays)
                : 'y1',
        })

        console.log(`🔍 Searching Google Custom Search for: "${enhancedQuery}"`)
        console.log(`🔑 API Key: ${googleApiKey?.slice(0, 10)}...`)
        console.log(`🆔 Search Engine ID: ${googleSearchEngineId}`)

        const response = await fetch(`${endpoint}?${params}`, {
            method: 'GET',
            signal: AbortSignal.timeout(SEARCH_FETCH_TIMEOUT_MS),
            headers: {
                'Accept': 'application/json',
            },
        })

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            console.error('❌ Google Search API error:', response.status, JSON.stringify(errorData))
            return {
                success: false,
                results: [],
                error: `Google Search API error: ${response.status} - ${errorData?.error?.message || 'Unknown error'}`
            }
        }

        const data = await response.json()

        // Extract relevant results
        const results: SearchResult[] = []

        if (data.items) {
            for (const item of data.items.slice(0, count * 2)) {
                const directDate = item.pagemap?.metatags?.[0]?.['article:published_time'] || undefined
                const snippetDate = extractDateFromSnippet(item.snippet || '')
                results.push({
                    name: item.title,
                    url: item.link,
                    snippet: item.snippet,
                    datePublished: directDate || snippetDate,
                })
            }
        }

        const filtered = filterAndSortByRecency(
            results,
            recencyDays,
            requireDatedForFresh,
            sortByDate
        ).slice(0, count)

        console.log(`✅ Found ${filtered.length} search results${recencyDays ? ` (last ${recencyDays}d)` : ''}`)

        return {
            success: filtered.length > 0 || !requireFresh,
            results: filtered,
            ...(filtered.length === 0 && requireFresh
                ? { error: `No fresh search results found in last ${recencyDays || 0} day(s).` }
                : {}),
        }
    } catch (error: any) {
        console.error('❌ Google Custom Search error:', error)
        return {
            success: false,
            results: [],
            error: error.message || 'Failed to search web'
        }
    }
}

export interface CombinedSearchResponse extends SearchResponse {
    socialSnippet?: string  // pre-formatted Firecrawl block ready for LLM injection
}

/**
 * Run Serper/Google search and Firecrawl social search in parallel.
 * Serper handles news; Firecrawl handles LinkedIn, X posts, and full article extraction.
 */
export async function searchWithSocialContext(
    query: string,
    stockSymbol: string,
    stockName: string,
    count: number = 8,
    options: SearchOptions = {}
): Promise<CombinedSearchResponse> {
    const { fetchSocialSentiment, formatFirecrawlResultsForAI } = await import('@/lib/firecrawl-search')

    const [serperResult, socialResults] = await Promise.allSettled([
        searchGoogle(query, stockSymbol, stockName, count, options),
        fetchSocialSentiment(stockSymbol || stockName, stockName || stockSymbol),
    ])

    const serper = serperResult.status === 'fulfilled'
        ? serperResult.value
        : { success: false, results: [] as SearchResult[] }

    const social = socialResults.status === 'fulfilled' ? socialResults.value : []
    const socialSnippet = formatFirecrawlResultsForAI(social)

    return {
        ...serper,
        socialSnippet: socialSnippet || undefined,
    }
}

/**
 * Format search results into context for Gemini
 */
export function formatSearchResultsForAI(results: SearchResult[]): string {
    if (results.length === 0) {
        return 'No relevant news or articles found from web search.'
    }

    let context = '## Recent News & Articles from Web Search:\n\n'

    results.forEach((result, index) => {
        const date = result.datePublished
            ? (() => {
                const parsed = new Date(result.datePublished as string)
                if (!isNaN(parsed.getTime())) {
                    return parsed.toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                    })
                }
                return result.datePublished as string
            })()
            : 'Recent'

        context += `### ${index + 1}. ${result.name}\n`
        context += `📅 Date: ${date}\n`
        context += `📝 ${result.snippet}\n`
        context += `🔗 Source: ${result.url}\n\n`
    })

    return context
}

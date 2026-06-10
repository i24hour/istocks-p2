// API proxy for EC2 live prices to avoid mixed content (HTTPS -> HTTP) issues
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { batchQuote, fetchLiveMarketQuote, type LiveMarketQuote, type QuoteData } from '@/lib/yahoo-finance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'
/** Large EC2 JSON + filter; batch path is preferred for big symbol lists */
export const maxDuration = 60

const EC2_BASE_URL = (process.env.EC2_LIVE_SERVER_URL || 'http://3.109.208.28:8080').replace(/\/$/, '')
const RAW_BATCH_LIMIT = Number(process.env.LIVE_PRICE_BATCH_LIMIT || 120)
const LIVE_PRICE_BATCH_LIMIT = Number.isFinite(RAW_BATCH_LIMIT) ? Math.max(1, Math.min(250, RAW_BATCH_LIMIT)) : 120
const RAW_CACHE_TTL_MS = Number(process.env.LIVE_PRICE_YAHOO_CACHE_TTL_MS || 15000)
const LIVE_PRICE_YAHOO_CACHE_TTL_MS = Number.isFinite(RAW_CACHE_TTL_MS) ? Math.max(1000, RAW_CACHE_TTL_MS) : 15000
const RAW_DB_SYMBOL_CACHE_TTL_MS = Number(process.env.LIVE_PRICE_DB_SYMBOL_CACHE_TTL_MS || 60000)
const LIVE_PRICE_DB_SYMBOL_CACHE_TTL_MS = Number.isFinite(RAW_DB_SYMBOL_CACHE_TTL_MS)
    ? Math.max(1000, RAW_DB_SYMBOL_CACHE_TTL_MS)
    : 60000

const DEFAULT_FULL_TIMEOUT_MS = Math.min(
  55_000,
  Math.max(15_000, Number(process.env.LIVE_PRICE_EC2_FULL_TIMEOUT_MS) || 55_000),
)
const DEFAULT_BATCH_TIMEOUT_MS = Math.min(
  45_000,
  Math.max(8000, Number(process.env.LIVE_PRICE_EC2_BATCH_TIMEOUT_MS) || 25_000),
)

type YahooFallbackQuote = {
  ltp: number
  previousClose: number | null
  close: number | null
  change: number | null
  change_pct: number | null
  symbol: string
  ticker?: string
  name?: string
  currency?: string | null
  exchange?: string | null
  quoteType?: string | null
  source: 'YAHOO'
  timestamp: string
}

const yahooQuoteCache = new Map<string, { quote: YahooFallbackQuote; updatedAtMs: number }>()
let dbFallbackSymbolCache: { symbols: string[]; updatedAtMs: number } | null = null

function parseSymbolsList(raw: string | null): string[] {
  if (!raw) return []
  const parts = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
  const uniq = Array.from(new Set(parts))
  return uniq.slice(0, LIVE_PRICE_BATCH_LIMIT)
}

function toYahooFallbackQuoteFromLiveMarket(quote: LiveMarketQuote): YahooFallbackQuote {
  return {
    ltp: quote.price,
    previousClose: quote.previousClose,
    close: quote.previousClose,
    change: quote.change,
    change_pct: quote.changePercent,
    symbol: quote.symbol,
    ticker: quote.ticker,
    name: quote.name,
    currency: quote.currency,
    exchange: quote.exchange,
    quoteType: quote.quoteType,
    source: 'YAHOO',
    timestamp: new Date().toISOString(),
  }
}

function toYahooFallbackQuoteFromBatch(quote: QuoteData): YahooFallbackQuote {
  return {
    ltp: quote.price,
    previousClose: quote.previousClose,
    close: quote.previousClose,
    change: quote.change,
    change_pct: quote.changePercent,
    symbol: quote.symbol.toUpperCase(),
    ticker: quote.yahooTicker,
    name: quote.name,
    currency: 'INR',
    exchange: quote.yahooTicker.endsWith('.BO') ? 'BSE' : 'NSE',
    quoteType: 'EQUITY',
    source: 'YAHOO',
    timestamp: new Date().toISOString(),
  }
}

function getCachedYahooQuote(symbol: string): YahooFallbackQuote | null {
  const cached = yahooQuoteCache.get(symbol)
  if (!cached) return null
  if (Date.now() - cached.updatedAtMs > LIVE_PRICE_YAHOO_CACHE_TTL_MS) return null
  return cached.quote
}

function setCachedYahooQuote(symbol: string, quote: YahooFallbackQuote) {
  yahooQuoteCache.set(symbol, { quote, updatedAtMs: Date.now() })
}

type EC2FetchOk = { ok: true; data: any }
type EC2FetchErr = { ok: false; status: number; error: string }

async function fetchEC2FullPrices(): Promise<EC2FetchOk | EC2FetchErr> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_FULL_TIMEOUT_MS)
  try {
    const response = await fetch(`${EC2_BASE_URL}/prices`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) {
      return { ok: false, status: response.status, error: 'Failed to fetch from EC2' }
    }
    const data = await response.json()
    return { ok: true, data }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return { ok: false, status: 504, error: 'EC2 server timeout' }
    }
    return { ok: false, status: 503, error: 'EC2 server unreachable' }
  } finally {
    clearTimeout(timeoutId)
  }
}

function filterEc2PayloadFromFull(
  fullPayload: Record<string, any>,
  symbols: string[],
): Record<string, any> {
  const out: Record<string, any> = {}
  for (const s of symbols) {
    const k = s.toUpperCase()
    if (fullPayload[k]) out[k] = fullPayload[k]
  }
  return out
}

/**
 * Prefer POST /prices/batch on EC2 (small response). If the server is old (404),
 * fall back to one full /prices fetch and filter in Node (same as before, but longer timeout).
 */
async function fetchEC2PricesForSymbols(symbols: string[]): Promise<EC2FetchOk | EC2FetchErr> {
  const uniq = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)))
  if (uniq.length === 0) {
    return {
      ok: true,
      data: { success: true, data: {}, count: 0, timestamp: new Date().toISOString() },
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_BATCH_TIMEOUT_MS)
  try {
    const response = await fetch(`${EC2_BASE_URL}/prices/batch`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: uniq }),
      cache: 'no-store',
      signal: controller.signal,
    })

    if (response.status === 404) {
      const full = await fetchEC2FullPrices()
      if (!full.ok) return full
      const ec2Payload =
        full.data?.data && typeof full.data.data === 'object' ? full.data.data : {}
      return {
        ok: true,
        data: {
          success: true,
          data: filterEc2PayloadFromFull(ec2Payload, uniq),
          count: 0,
          timestamp: full.data?.timestamp || new Date().toISOString(),
          batchFallback: 'full-prices-filtered',
        },
      }
    }

    if (!response.ok) {
      return { ok: false, status: response.status, error: 'Failed to fetch from EC2' }
    }
    const data = await response.json()
    return { ok: true, data }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return { ok: false, status: 504, error: 'EC2 batch timeout' }
    }
    return { ok: false, status: 503, error: 'EC2 server unreachable' }
  } finally {
    clearTimeout(timeoutId)
  }
}

function noStoreHeaders() {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
  }
}

async function fetchDatabaseFallbackSymbols(): Promise<{ symbols: string[]; error?: string }> {
    if (
        dbFallbackSymbolCache
        && Date.now() - dbFallbackSymbolCache.updatedAtMs <= LIVE_PRICE_DB_SYMBOL_CACHE_TTL_MS
    ) {
        return { symbols: dbFallbackSymbolCache.symbols }
    }

    try {
        const rows = await prisma.stock.findMany({
            select: { symbol: true },
            orderBy: { symbol: 'asc' },
            take: LIVE_PRICE_BATCH_LIMIT,
        })

        const symbols = Array.from(
            new Set(
                rows
                    .map((row) => row.symbol.trim().toUpperCase())
                    .filter(Boolean)
            )
        )

        dbFallbackSymbolCache = { symbols, updatedAtMs: Date.now() }
        return { symbols }
    } catch (error: any) {
        console.error('Live price DB fallback symbol lookup failed:', error)
        return {
            symbols: [],
            error: error?.message ? String(error.message) : 'Database fallback symbol lookup failed',
        }
    }
}

async function resolveBatchSymbols(symbols: string[], ec2Data: Record<string, any>) {
  const resolved: Record<string, any> = {}
  const missing: string[] = []

  for (const symbol of symbols) {
    if (ec2Data[symbol]) {
      resolved[symbol] = ec2Data[symbol]
      continue
    }
    const cached = getCachedYahooQuote(symbol)
    if (cached) {
      resolved[symbol] = cached
      continue
    }
    missing.push(symbol)
  }

  if (missing.length > 0) {
    try {
      const yahooQuotes = await batchQuote(missing)
      for (const q of yahooQuotes) {
        const key = q.symbol.toUpperCase()
        const mapped = toYahooFallbackQuoteFromBatch(q)
        resolved[key] = mapped
        setCachedYahooQuote(key, mapped)
      }
    } catch {
      // Keep unresolved symbols absent; caller treats these as unavailable.
    }
  }

  return resolved
}

async function handleGet(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const requestedSymbol = symbol?.trim().toUpperCase() || null
  const requestedSymbols = parseSymbolsList(searchParams.get('symbols'))

  let ec2: EC2FetchOk | EC2FetchErr
  if (requestedSymbol) {
    ec2 = await fetchEC2PricesForSymbols([requestedSymbol])
  } else if (requestedSymbols.length > 0) {
    ec2 = await fetchEC2PricesForSymbols(requestedSymbols)
  } else {
    ec2 = await fetchEC2FullPrices()
  }

  const ec2Data = ec2.ok ? ec2.data : null
  const ec2Error = ec2.ok ? null : { status: ec2.status, error: ec2.error }
  const ec2Payload = ec2Data?.data && typeof ec2Data.data === 'object' ? ec2Data.data : {}
  const ec2Timestamp = ec2Data?.timestamp || new Date().toISOString()

  try {
    if (requestedSymbol) {
      const symbolData = ec2Payload[requestedSymbol]
      if (symbolData) {
        return NextResponse.json(
          {
            success: true,
            data: { [requestedSymbol]: symbolData },
            count: 1,
            timestamp: ec2Timestamp,
          },
          { headers: noStoreHeaders() },
        )
      }
      const fallback = await fetchLiveMarketQuote(requestedSymbol)
      if (fallback.ok) {
        const quote = toYahooFallbackQuoteFromLiveMarket(fallback.quote)
        setCachedYahooQuote(requestedSymbol, quote)
        return NextResponse.json(
          {
            success: true,
            data: { [requestedSymbol]: quote },
            count: 1,
            timestamp: new Date().toISOString(),
            fallback: 'yahoo',
            ec2Error: ec2Error?.error,
          },
          { headers: noStoreHeaders() },
        )
      }

      if (fallback.reason === 'unsupported') {
        return NextResponse.json(
          { success: false, error: fallback.message, symbol: requestedSymbol },
          { status: 400, headers: noStoreHeaders() },
        )
      }

      return NextResponse.json(
        { success: true, data: {}, count: 0, message: `No live data for ${requestedSymbol}` },
        { headers: noStoreHeaders() },
      )
    }

    if (requestedSymbols.length > 0) {
      const merged = await resolveBatchSymbols(requestedSymbols, ec2Payload)
      return NextResponse.json(
        {
          success: true,
          data: merged,
          count: Object.keys(merged).length,
          timestamp: ec2Timestamp,
          fallback: ec2Error ? 'partial-or-full-yahoo' : 'ec2+yahoo',
          ec2Error: ec2Error?.error,
        },
        { headers: noStoreHeaders() },
      )
    }

    // Bare GET /api/live-price — if EC2 failed or empty, fall back to Yahoo for a DB symbol batch
    const ec2KeyCount = Object.keys(ec2Payload).length
    const useYahooFullFeed = Boolean(ec2Error) || ec2KeyCount === 0

    if (useYahooFullFeed) {
      const fallback = await fetchDatabaseFallbackSymbols()
      const merged = fallback.symbols.length > 0
        ? await resolveBatchSymbols(fallback.symbols, {})
        : {}
      return NextResponse.json(
        {
          success: true,
          data: merged,
          count: Object.keys(merged).length,
          requestedCount: fallback.symbols.length,
          timestamp: new Date().toISOString(),
          fallback: ec2Error ? 'yahoo-db-ec2-down' : 'yahoo-db-ec2-empty',
          ec2Error: ec2Error?.error ?? (ec2KeyCount === 0 ? 'EC2 feed returned no symbols' : undefined),
          dbError: fallback.error,
        },
        { status: 200, headers: noStoreHeaders() },
      )
    }

    return NextResponse.json(ec2Data, { headers: noStoreHeaders() })
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error('EC2 proxy timeout')
      return NextResponse.json(
        { success: false, error: 'EC2 server timeout' },
        { status: 504 },
      )
    }
    console.error('EC2 proxy error:', error)
    return NextResponse.json({ success: false, error: 'EC2 server unreachable' }, { status: 503 })
  }
}

type PostBody = { symbols?: string[] }

async function handlePost(request: NextRequest) {
  let body: PostBody
  try {
    body = (await request.json()) as PostBody
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
  }
  const raw = Array.isArray(body.symbols) ? body.symbols : []
  const requested = Array.from(
    new Set(
      raw
        .map((s) => String(s).trim().toUpperCase())
        .filter(Boolean),
    ),
  )
  if (requested.length === 0) {
    return NextResponse.json(
      { success: false, error: 'Missing symbols' },
      { status: 400, headers: noStoreHeaders() },
    )
  }
  if (requested.length > 5000) {
    return NextResponse.json(
      { success: false, error: 'Too many symbols (max 5000)' },
      { status: 400, headers: noStoreHeaders() },
    )
  }

  const ec2 = await fetchEC2PricesForSymbols(requested)
  const ec2Data = ec2.ok ? ec2.data : null
  const ec2Error = ec2.ok ? null : { status: ec2.status, error: ec2.error }
  const ec2Payload = ec2Data?.data && typeof ec2Data.data === 'object' ? ec2Data.data : {}
  const ec2Timestamp = ec2Data?.timestamp || new Date().toISOString()

  const merged = await resolveBatchSymbols(requested, ec2Payload)
  return NextResponse.json(
    {
      success: true,
      data: merged,
      count: Object.keys(merged).length,
      timestamp: ec2Timestamp,
      fallback: ec2Error ? 'partial-or-full-yahoo' : 'ec2+yahoo',
      ec2Error: ec2Error?.error,
    },
    { headers: noStoreHeaders() },
  )
}

export async function GET(request: NextRequest) {
  return handleGet(request)
}

export async function POST(request: NextRequest) {
  return handlePost(request)
}

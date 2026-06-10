import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'


// Force dynamic - cannot be statically generated during build (requires DB connection)
export const dynamic = 'force-dynamic';

type StockRow = {
  id: string
  symbol: string
  name: string
  exchange: string
  latestPrice: number | null
  prevClose: number | null
  change: number | null
  changePercent: number | null
  volume: number | null
  lastUpdated: Date | null
}

type StocksResponseBody = {
  success: boolean
  data: StockRow[]
  stale?: boolean
  cachedAt?: string
  source?: 'db' | 'cache'
  _debugWarning?: string
}

const STOCKS_API_CACHE_TTL_MS = Number(process.env.STOCKS_API_CACHE_TTL_MS || 60_000)

let stocksCache: {
  updatedAt: number
  expiresAt: number
  body: StocksResponseBody
} | null = null

/**
 * Optimized stocks list endpoint using LATERAL JOIN.
 * Updated to cast BigInts (volume, rn) to safe types in SQL to avoid serialization issues.
 */
export async function GET() {
  const nowMs = Date.now()
  if (stocksCache && stocksCache.expiresAt > nowMs) {
    return NextResponse.json(
      {
        ...stocksCache.body,
        source: 'cache',
        cachedAt: new Date(stocksCache.updatedAt).toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=60',
        },
      }
    )
  }

  try {
    // Step 1: Get all stocks
    const stocks = await prisma.stock.findMany({
      select: {
        id: true,
        symbol: true,
        name: true,
        exchange: true,
      },
      orderBy: {
        symbol: 'asc',
      },
    })

    if (stocks.length === 0) {
      return NextResponse.json({ success: true, data: [] })
    }

    // Step 2: Use LATERAL JOIN to get latest 2 prices per stock
    let priceRows: Array<{
      stockId: string
      close: number
      volume: string
      timestamp: Date
      rn: number
    }> = []

    let debugError = null

    try {
      priceRows = await prisma.$queryRaw`
        SELECT 
          s."id" AS "stockId", 
          p."close", 
          p."volume"::text, 
          p."timestamp", 
          p."rn"
        FROM "Stock" s
        CROSS JOIN LATERAL (
          SELECT 
            "close", 
            "volume", 
            "timestamp", 
            CAST(ROW_NUMBER() OVER (ORDER BY "timestamp" DESC) AS INTEGER) AS "rn"
          FROM "StockPrice"
          WHERE "stockId" = s."id"
            AND "timestamp" > NOW() - INTERVAL '35 days' -- aligns with 1-month retention + short buffer
          ORDER BY "timestamp" DESC
          LIMIT 2
        ) p
      `
    } catch (err: any) {
      console.error('❌ Price query failed (returning stocks without prices):', err)
      debugError = err.message
    }

    // Step 3: Group by stockId
    const grouped = new Map<string, { latest?: typeof priceRows[0]; prev?: typeof priceRows[0] }>()
    for (const row of priceRows) {
      const entry = grouped.get(row.stockId) ?? {}
      if (row.rn === 1) entry.latest = row
      else if (row.rn === 2) entry.prev = row
      grouped.set(row.stockId, entry)
    }

    // Step 4: Build response
    const stocksWithPrices = stocks.map((stock) => {
      const priceInfo = grouped.get(stock.id)
      const latest = priceInfo?.latest
      const prev = priceInfo?.prev

      let change: number | null = null
      let changePercent: number | null = null

      if (latest && prev) {
        change = latest.close - prev.close
        changePercent = (change / prev.close) * 100
      }

      return {
        ...stock,
        latestPrice: latest?.close ?? null,
        prevClose: prev?.close ?? null,   // exposed for EC2 change computation on client
        change,
        changePercent,
        volume: latest?.volume ? Number(latest.volume) : null,
        lastUpdated: latest?.timestamp ?? null,
      }
    })

    // Return ALL stocks; UI handles null prices gracefully (shows "—")
    // Index stocks (NIFTY50, SENSEX, etc.) have no StockPrice rows — filtering them out would hide them entirely
    const stocksWithData = stocksWithPrices

    const responseBody: StocksResponseBody = {
      success: true,
      data: stocksWithData,
      _debugWarning: debugError ? `Price fetch failed: ${debugError}` : undefined
    }

    stocksCache = {
      updatedAt: nowMs,
      expiresAt: nowMs + Math.max(1_000, STOCKS_API_CACHE_TTL_MS),
      body: responseBody,
    }

    return NextResponse.json(
      {
        ...responseBody,
        source: 'db',
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=60',
        },
      }
    )
  } catch (error: any) {
    console.error('Error fetching stocks:', error)

    if (stocksCache?.body?.data?.length) {
      return NextResponse.json(
        {
          ...stocksCache.body,
          stale: true,
          source: 'cache',
          cachedAt: new Date(stocksCache.updatedAt).toISOString(),
          _debugWarning: `Serving stale cache due DB error: ${error.message}`,
        },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=60',
          },
        }
      )
    }

    // Return actual error details for debugging
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch stocks',
        details: error.message,
        code: error.code
      },
      { status: 500 }
    )
  }
}


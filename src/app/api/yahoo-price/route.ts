/**
 * /api/yahoo-price?symbol=ADANIPOWER.NS
 *
 * Server-side proxy for Yahoo Finance public quote endpoint.
 * Used as a fallback when EC2 is unavailable (market closed) and the stock
 * is not in our local DB — returns the last traded / previous close price.
 *
 * Yahoo Finance public API (no key required):
 *   https://query1.finance.yahoo.com/v8/finance/spark?symbols=ADANIPOWER.NS&range=1d&interval=1d
 */

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol')
  if (!symbol) {
    return NextResponse.json({ success: false, error: 'symbol is required' }, { status: 400 })
  }

  try {
    // Yahoo Finance v8 spark endpoint — lightweight, returns latest close
    const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(symbol)}&range=5d&interval=1d`

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; iStocks/1.0)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      return NextResponse.json({ success: false, error: `Yahoo returned ${res.status}` }, { status: 502 })
    }

    const json = await res.json()

    // Extract last close from spark response
    const sparkResult = json?.spark?.result?.[0]
    const closes: number[] = sparkResult?.response?.[0]?.indicators?.quote?.[0]?.close ?? []
    const lastClose = closes.filter((v: any) => v != null).at(-1)

    if (typeof lastClose !== 'number') {
      // Fallback: try v7 quote endpoint
      const v7Url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`
      const v7Res = await fetch(v7Url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (v7Res.ok) {
        const v7Json = await v7Res.json()
        const q = v7Json?.quoteResponse?.result?.[0]
        const price = q?.regularMarketPreviousClose ?? q?.regularMarketPrice ?? null
        if (typeof price === 'number') {
          return NextResponse.json({ success: true, price, source: 'yahoo-v7', symbol })
        }
      }
      return NextResponse.json({ success: false, error: 'No price data found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, price: lastClose, source: 'yahoo-spark', symbol })
  } catch (err: any) {
    console.error('[yahoo-price] Error:', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

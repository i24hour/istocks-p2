// EC2-based intraday OHLC endpoint
// Returns today's Open, High, Low, Prev Close computed from EC2 live candles
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'

const EC2_BASE_URL = process.env.EC2_LIVE_SERVER_URL || 'http://3.109.208.28:8080'

const noCacheHeaders = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
}

function getISTMidnight(): Date {
    const now = new Date()
    // IST = UTC+5:30
    const istOffsetMs = 5.5 * 60 * 60 * 1000
    const istNow = new Date(now.getTime() + istOffsetMs)
    const istMidnight = new Date(Date.UTC(
        istNow.getUTCFullYear(),
        istNow.getUTCMonth(),
        istNow.getUTCDate(),
        0, 0, 0, 0
    ))
    // Convert back to UTC
    return new Date(istMidnight.getTime() - istOffsetMs)
}

async function fetchEC2Candles(symbol: string): Promise<any[] | null> {
    try {
        const url = `${EC2_BASE_URL}/candles?symbol=${encodeURIComponent(symbol)}&interval=ONE_MINUTE&count=390`
        const res = await fetch(url, {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) return null
        const body = await res.json()
        if (!body?.success || !Array.isArray(body?.data) || body.data.length === 0) return null
        return body.data
    } catch {
        return null
    }
}

async function fetchEC2BulkPrices(): Promise<Record<string, any> | null> {
    try {
        const res = await fetch(`${EC2_BASE_URL}/prices`, {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) return null
        const body = await res.json()
        return body?.success ? body.data : null
    } catch {
        return null
    }
}

export async function GET(request: NextRequest) {
    const symbol = request.nextUrl.searchParams.get('symbol')?.toUpperCase()
    if (!symbol) {
        return NextResponse.json({ success: false, error: 'symbol required' }, { status: 400 })
    }

    try {
        const [candles, bulkPrices] = await Promise.all([
            fetchEC2Candles(symbol),
            fetchEC2BulkPrices(),
        ])

        const liveData = bulkPrices?.[symbol]
        const ltp = typeof liveData?.ltp === 'number' ? liveData.ltp : null

        if (!candles || candles.length === 0) {
            // EC2 unavailable — return what we have from ltp alone
            return NextResponse.json(
                { success: false, error: 'EC2 candles unavailable', ltp },
                { status: 503, headers: noCacheHeaders }
            )
        }

        const todayStart = getISTMidnight()

        // Separate today's candles (market hours: 09:15+ IST)
        const todayCandles = candles.filter((c: any) => {
            const ts = new Date(c.timestamp)
            return ts >= todayStart
        })

        // Prev day candles = everything before today
        const prevCandles = candles.filter((c: any) => {
            const ts = new Date(c.timestamp)
            return ts < todayStart
        })

        let open: number | null = null
        let high: number | null = null
        let low: number | null = null
        let volume: number | null = null
        let prevClose: number | null = null

        if (todayCandles.length > 0) {
            // Sort by timestamp ascending
            todayCandles.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

            open = Number(todayCandles[0].open)
            high = Math.max(...todayCandles.map((c: any) => Number(c.high)))
            low = Math.min(...todayCandles.map((c: any) => Number(c.low)))
            volume = todayCandles.reduce((sum: number, c: any) => sum + Number(c.volume || 0), 0)

            // Update high/low with live ltp if available
            if (ltp !== null) {
                high = Math.max(high, ltp)
                low = Math.min(low, ltp)
            }
        }

        // Get prev close from last candle before today
        if (prevCandles.length > 0) {
            prevCandles.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            prevClose = Number(prevCandles[0].close)
        } else if (liveData?.close) {
            // EC2 bulk price might carry yesterday's close
            prevClose = Number(liveData.close)
        }

        const currentPrice = ltp ?? (todayCandles.length > 0 ? Number(todayCandles[todayCandles.length - 1].close) : null)

        let change: number | null = null
        let change_pct: number | null = null
        if (currentPrice !== null && prevClose !== null && prevClose !== 0) {
            change = parseFloat((currentPrice - prevClose).toFixed(2))
            change_pct = parseFloat(((change / prevClose) * 100).toFixed(2))
        } else if (liveData?.change !== undefined) {
            change = liveData.change
            change_pct = liveData.change_pct
        }

        return NextResponse.json({
            success: true,
            data: {
                symbol,
                ltp: currentPrice,
                open,
                high,
                low,
                prevClose,
                change,
                change_pct,
                volume,
                todayCandleCount: todayCandles.length,
                source: todayCandles.length > 0 ? 'ec2-candles' : 'ec2-ltp-only',
            }
        }, { headers: noCacheHeaders })

    } catch (err: any) {
        console.error('live-ohlc error:', err)
        return NextResponse.json(
            { success: false, error: err.message },
            { status: 500, headers: noCacheHeaders }
        )
    }
}

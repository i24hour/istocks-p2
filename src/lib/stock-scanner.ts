import { prisma } from '@/lib/prisma'

export interface ScannedStock {
    symbol: string
    name: string
    close: number
    rsi: number | null
    sma50: number | null
    sma200: number | null
    volume: number // formatted or bigint cast
    avgTradedValue20d: number
    change: number // calculated if possible or fetched
}

/**
 * Scans for "Best" stocks based on robust technical criteria:
 * 1. Trend Alignment: Price > SMA50 > SMA200 (Bullish)
 * 2. Momentum: RSI between 55 and 75 (Strong but not overbought)
 * 3. Volume: (Optional addition)
 */
export async function scanBestStocks(): Promise<ScannedStock[]> {
    try {
        const minPrice = 20
        const minAvgTradedValue20d = 20_000_000 // ₹2 crore
        const minCandles20d = 15
        const maxPriceAgeDays = 10
        const cutoffDate = new Date(Date.now() - maxPriceAgeDays * 24 * 60 * 60 * 1000)

        const results = await prisma.$queryRaw<any[]>`
            SELECT
                s.symbol,
                s.name,
                latest.close,
                latest.rsi,
                latest."sma50",
                latest."sma200",
                latest.volume,
                liquidity."avgTradedValue20d"
            FROM "Stock" s
            JOIN LATERAL (
                SELECT
                    sp.timestamp,
                    sp.close,
                    sp.rsi,
                    sp."sma50",
                    sp."sma200",
                    sp.volume
                FROM "StockPrice" sp
                WHERE sp."stockId" = s.id
                ORDER BY sp.timestamp DESC
                LIMIT 1
            ) AS latest ON TRUE
            JOIN LATERAL (
                SELECT
                    AVG((recent.close * recent.volume)::double precision) AS "avgTradedValue20d",
                    COUNT(*)::int AS "candles20d"
                FROM (
                    SELECT sp.close, sp.volume
                    FROM "StockPrice" sp
                    WHERE sp."stockId" = s.id
                    ORDER BY sp.timestamp DESC
                    LIMIT 20
                ) AS recent
            ) AS liquidity ON TRUE
            WHERE
                latest.timestamp >= ${cutoffDate}
                AND latest.close >= ${minPrice}
                AND latest.close > latest."sma50"
                AND latest."sma50" IS NOT NULL
                AND latest.rsi IS NOT NULL
                AND latest.rsi BETWEEN 55 AND 72
                AND (
                    latest."sma200" IS NULL
                    OR latest."sma50" > latest."sma200"
                )
                AND liquidity."candles20d" >= ${minCandles20d}
                AND liquidity."avgTradedValue20d" >= ${minAvgTradedValue20d}
            ORDER BY
                ((latest.close - latest."sma50") / NULLIF(latest."sma50", 0)) DESC,
                ABS(latest.rsi - 60) ASC,
                liquidity."avgTradedValue20d" DESC
            LIMIT 10;
        `

        // Prisma returns bigints as BigInt, we need to serialize them
        return results.map((r: any) => ({
            symbol: r.symbol,
            name: r.name,
            close: r.close,
            rsi: r.rsi,
            sma50: r.sma50,
            sma200: r.sma200,
            volume: Number(r.volume),
            avgTradedValue20d: Number(r.avgTradedValue20d ?? 0),
            change: 0 // Placeholder, handled by calling code or separate calculation if needed
        }))
    } catch (error) {
        console.error('Error scanning best stocks:', error)
        return []
    }
}

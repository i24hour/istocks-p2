import { prisma } from '@/lib/prisma'

export async function getStocks() {
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
            // Cache likely doesn't apply to raw query but useful for stock list
            // next: { revalidate: 60 } 
        })

        if (stocks.length === 0) {
            return []
        }

        // Step 2: Use LATERAL JOIN to get latest 2 prices per stock
        let priceRows: Array<{
            stockId: string
            close: number
            volume: string
            timestamp: Date
            rn: number
        }> = []

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
            AND "timestamp" > NOW() - INTERVAL '60 days'
          ORDER BY "timestamp" DESC
          LIMIT 2
        ) p
      `
        } catch (err: any) {
            console.error('❌ Price query failed (returning stocks without prices):', err)
            // Continue with empty prices to at least show the stock list
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
                change,
                changePercent,
                volume: latest?.volume ? Number(latest.volume) : null,
                lastUpdated: latest?.timestamp ?? null,
            }
        })

        return stocksWithPrices
    } catch (error: any) {
        console.error('Error fetching stocks:', error)
        return []
    }
}

export async function getStockDetails(symbol: string, timeframe: string = '1d') {
    try {
        // Find the stock
        const stock = await prisma.stock.findUnique({
            where: { symbol: symbol.toUpperCase() },
        })

        if (!stock) {
            return null
        }

        // Get the latest timestamp to determine "today"
        const latestRecord = await prisma.stockPrice.findFirst({
            where: { stockId: stock.id },
            orderBy: { timestamp: 'desc' },
            select: { timestamp: true }
        })

        if (!latestRecord) {
            return { stock, priceData: [], latestDayStats: null, timeframe }
        }

        const latestDate = new Date(latestRecord.timestamp)
        let startDate = new Date(latestDate)

        // Calculate date range and sampling based on timeframe
        let sampleInterval = 1 // Every Nth record
        let limit = 500

        switch (timeframe) {
            case '1d':
                startDate = new Date(latestDate.getFullYear(), latestDate.getMonth(), latestDate.getDate(), 0, 0, 0, 0)
                sampleInterval = 1
                limit = 1500
                break
            case '1w':
                startDate.setDate(latestDate.getDate() - 7)
                sampleInterval = 5
                limit = 2500
                break
            case '1m':
                startDate.setDate(latestDate.getDate() - 30)
                sampleInterval = 30
                break
            case '3m':
                startDate.setDate(latestDate.getDate() - 90)
                sampleInterval = 60
                break
            case '6m':
                startDate.setDate(latestDate.getDate() - 180)
                sampleInterval = 120
                break
            case '1y':
                startDate.setDate(latestDate.getDate() - 365)
                sampleInterval = 240
                break
            default:
                startDate.setDate(latestDate.getDate() - 30)
                sampleInterval = 30
        }

        // Parallelize queries
        const [priceData, latestDayAgg, prevDayClose, latestFullRecord] = await Promise.all([
            // 1. Get chart data (LEAN: Only OHLCV + timestamp) - Huge Payload Reduction
            prisma.$queryRaw`
        SELECT * FROM (
            SELECT 
                "stockId", timestamp, open, high, low, close, volume,
                ROW_NUMBER() OVER (ORDER BY timestamp ASC) as rn
            FROM "StockPrice"
            WHERE "stockId" = ${stock.id}
                AND timestamp >= ${startDate}
                AND timestamp <= ${latestDate}
        ) sub
        WHERE (rn - 1) % ${sampleInterval} = 0 OR rn = 1
        ORDER BY timestamp ASC
        LIMIT ${limit}
      ` as Promise<any[]>,

            // 2. Get latest day OHLC
            (async () => {
                const latestDayStart = new Date(latestDate)
                latestDayStart.setHours(0, 0, 0, 0)
                return prisma.$queryRaw`
          SELECT 
            (SELECT open FROM "StockPrice" WHERE "stockId" = ${stock.id} AND timestamp >= ${latestDayStart} ORDER BY timestamp ASC LIMIT 1) as day_open,
            MAX(high) as day_high,
            MIN(low) as day_low,
            (SELECT close FROM "StockPrice" WHERE "stockId" = ${stock.id} AND timestamp >= ${latestDayStart} ORDER BY timestamp DESC LIMIT 1) as day_close,
            SUM(volume) as day_volume
          FROM "StockPrice"
          WHERE "stockId" = ${stock.id}
            AND timestamp >= ${latestDayStart}
        ` as Promise<any[]>
            })(),

            // 3. Get previous day close
            (async () => {
                const latestDayStart = new Date(latestDate)
                latestDayStart.setHours(0, 0, 0, 0)
                const previousDayEnd = new Date(latestDayStart)
                previousDayEnd.setMilliseconds(-1)
                const previousDayStart = new Date(previousDayEnd)
                previousDayStart.setHours(0, 0, 0, 0)

                return prisma.stockPrice.findFirst({
                    where: {
                        stockId: stock.id,
                        timestamp: {
                            gte: previousDayStart,
                            lte: previousDayEnd,
                        },
                    },
                    orderBy: { timestamp: 'desc' },
                    select: { close: true }
                })
            })(),

            // 4. Get Latest Full Record (for indicators) - Rich Data, Single Row
            prisma.stockPrice.findFirst({
                where: { stockId: stock.id },
                orderBy: { timestamp: 'desc' },
            })
        ])

        // Process stats
        let latestDayStats = null
        if (latestDayAgg.length > 0 && latestDayAgg[0].day_open) {
            const agg = latestDayAgg[0]
            const open = Number(agg.day_open)
            const close = Number(agg.day_close)
            const high = Number(agg.day_high)
            const low = Number(agg.day_low)
            const volume = Number(agg.day_volume)
            const prevClose = prevDayClose?.close || close
            const change = close - prevClose
            const changePercent = ((change / prevClose) * 100)

            latestDayStats = {
                open,
                high,
                low,
                close,
                prevClose,
                change: parseFloat(change.toFixed(2)),
                changePercent: parseFloat(changePercent.toFixed(2)),
                volume,
                timestamp: latestDate,
            }
        }

        // Serialize Chart Data (Lean)
        const serializedData = priceData.map(item => ({
            timestamp: item.timestamp,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: Number(item.volume),
        }))

        // Serialize Latest Full Record (Rich)
        const serializedLatest = latestFullRecord ? {
            ...latestFullRecord,
            volume: Number(latestFullRecord.volume),
            obv: latestFullRecord.obv ? Number(latestFullRecord.obv) : null
        } : null

        return {
            stock,
            priceData: serializedData, // Lean history
            latestDayStats,
            latestIndicatorData: serializedLatest, // Rich latest row
            timeframe
        }
    } catch (error: any) {
        console.error('Error fetching stock details:', error)
        return null
    }
}

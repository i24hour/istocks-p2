
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('🚀 Starting debug script for /api/stocks logic...')

    try {
        // Step 1: Get all stocks
        console.log('1. Fetching stocks...')
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
        console.log(`✅ Found ${stocks.length} stocks`)

        if (stocks.length === 0) {
            console.log('No stocks found.')
            return
        }

        // Step 2: Execute Raw Query
        console.log('2. Executing Raw Query with LATERAL JOIN...')
        const priceRows: Array<{
            stockId: string
            close: number
            volume: bigint
            timestamp: Date
            rn: bigint | number
        }> = await prisma.$queryRaw`
      SELECT s."id" AS "stockId", p."close", p."volume", p."timestamp", p."rn"
      FROM "Stock" s
      CROSS JOIN LATERAL (
        SELECT "close", "volume", "timestamp", 
               ROW_NUMBER() OVER (ORDER BY "timestamp" DESC) AS "rn"
        FROM "StockPrice"
        WHERE "stockId" = s."id"
        ORDER BY "timestamp" DESC
        LIMIT 2
      ) p
    `
        console.log(`✅ Raw query returned ${priceRows.length} rows`)

        if (priceRows.length > 0) {
            console.log('Sample row:', priceRows[0])
            console.log('Type of volume:', typeof priceRows[0].volume)
            console.log('Type of rn:', typeof priceRows[0].rn)
        }

        // Step 3: Group by stockId
        console.log('3. Grouping data...')
        const grouped = new Map<string, { latest?: typeof priceRows[0]; prev?: typeof priceRows[0] }>()
        for (const row of priceRows) {
            const entry = grouped.get(row.stockId) ?? {}
            const rnNum = Number(row.rn)
            if (rnNum === 1) entry.latest = row
            else if (rnNum === 2) entry.prev = row
            grouped.set(row.stockId, entry)
        }

        // Step 4: Build response
        console.log('4. Building response objects...')
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

        console.log('5. JSON Serialization Test...')
        const json = JSON.stringify({ success: true, data: stocksWithPrices })
        console.log('✅ JSON Serialization successful!')
        console.log('Sample JSON length:', json.length)

    } catch (error) {
        console.error('❌ ERROR CAUGHT:', error)
    } finally {
        await prisma.$disconnect()
    }
}

main()

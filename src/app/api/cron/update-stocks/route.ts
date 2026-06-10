import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getInstrumentBySymbol, normalizeSymbolKey, updateInstrumentToken } from '@/lib/instrumentRegistry'
import { technicalIndicatorsService } from '@/services/technical-indicators.service'

export const maxDuration = 300 // 5 minutes — Vercel Pro / Fluid Compute max

// Angel One credentials (store these in environment variables in production!)
const API_KEY = process.env.ANGELONE_API_KEY || process.env.ANGEL_API_KEY 
const CLIENT_ID = process.env.ANGELONE_CLIENT_ID || process.env.ANGEL_CLIENT_ID 
const SECRET_KEY = process.env.ANGELONE_SECRET_KEY || process.env.ANGEL_SECRET_KEY 
const TOTP_SECRET = process.env.ANGELONE_TOTP_TOKEN || process.env.ANGEL_TOTP_SECRET 

// Vercel Cron secret to protect the endpoint
const CRON_SECRET = process.env.CRON_SECRET

const SCRIP_MASTER_URL = 'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json'

type CronCursorRow = { cursor: number }

function formatDateForAngel(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(date)

    const map = Object.fromEntries(parts.map(p => [p.type, p.value]))
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`
}

function parseAngelCandleTimestamp(raw: string): Date {
    const value = String(raw).trim()

    if (/Z$|[+-]\d{2}:\d{2}$/.test(value)) {
        return new Date(value)
    }

    const normalized = value.includes('T') ? value : value.replace(' ', 'T')
    return new Date(`${normalized}+05:30`)
}

function normalizeLegacyLatestTimestamp(latestTimestamp: Date): Date {
    const istParts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(latestTimestamp)

    const map = Object.fromEntries(istParts.map(p => [p.type, p.value]))
    const istHour = Number(map.hour)

    const likelyShifted = istHour < 9 || istHour > 15
    if (!likelyShifted) return latestTimestamp

    return new Date(latestTimestamp.getTime() - (5 * 60 + 30) * 60 * 1000)
}

async function fetchDynamicTokenMap(): Promise<Map<string, { token: string; exchange: string }>> {
    const tokenMap = new Map<string, { token: string; exchange: string }>()

    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 12000)

        const res = await fetch(SCRIP_MASTER_URL, { cache: 'no-store', signal: controller.signal })
        clearTimeout(timeoutId)

        if (!res.ok) return tokenMap
        const data = await res.json()
        if (!Array.isArray(data)) return tokenMap

        for (const item of data) {
            if (!item?.token) continue
            if (item.exch_seg !== 'NSE' && item.exch_seg !== 'NSE_IDX') continue

            const exchange = 'NSE'

            if (item.name) {
                tokenMap.set(normalizeSymbolKey(item.name), { token: item.token, exchange })
            }

            if (item.symbol) {
                const symbolKey = normalizeSymbolKey(String(item.symbol).replace(/-EQ$/i, ''))
                tokenMap.set(symbolKey, { token: item.token, exchange })
            }
        }
    } catch (error) {
        console.error('⚠️ Scrip master fetch failed, using fallbacks where possible:', error)
    }

    return tokenMap
}

async function ensureCronCursorTable() {
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "CronCursorState" (
            "jobName" TEXT PRIMARY KEY,
            "cursor" INTEGER NOT NULL DEFAULT 0,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `)
}

async function getCronCursor(jobName: string): Promise<number> {
    await ensureCronCursorTable()

    await prisma.$executeRaw`
        INSERT INTO "CronCursorState" ("jobName", "cursor", "updatedAt")
        VALUES (${jobName}, 0, CURRENT_TIMESTAMP)
        ON CONFLICT ("jobName") DO NOTHING
    `

    const rows = await prisma.$queryRaw<CronCursorRow[]>`
        SELECT "cursor"
        FROM "CronCursorState"
        WHERE "jobName" = ${jobName}
        LIMIT 1
    `

    return rows[0]?.cursor ?? 0
}

async function setCronCursor(jobName: string, cursor: number): Promise<void> {
    await ensureCronCursorTable()

    await prisma.$executeRaw`
        INSERT INTO "CronCursorState" ("jobName", "cursor", "updatedAt")
        VALUES (${jobName}, ${cursor}, CURRENT_TIMESTAMP)
        ON CONFLICT ("jobName")
        DO UPDATE SET
            "cursor" = EXCLUDED."cursor",
            "updatedAt" = CURRENT_TIMESTAMP
    `
}

function pickStocksByCursor<T>(items: T[], startCursor: number, count: number): T[] {
    if (items.length === 0 || count <= 0) return []

    const selected: T[] = []
    for (let i = 0; i < count; i++) {
        selected.push(items[(startCursor + i) % items.length])
    }
    return selected
}

function resolveTokenInfo(
    stock: { symbol: string; name: string },
    instrument: { symbol: string; exchange: string; angelToken: string | null; aliases: string[] } | null,
    dynamicMap: Map<string, { token: string; exchange: string }>
): { token: string; exchange: string } | null {
    if (instrument?.angelToken) {
        return { token: instrument.angelToken, exchange: instrument.exchange || 'NSE' }
    }

    const candidateKeys = new Set<string>([
        normalizeSymbolKey(stock.symbol),
        normalizeSymbolKey(stock.name),
    ])

    if (instrument?.symbol) candidateKeys.add(normalizeSymbolKey(instrument.symbol))
    for (const alias of instrument?.aliases || []) {
        candidateKeys.add(normalizeSymbolKey(alias))
    }

    for (const key of candidateKeys) {
        const found = dynamicMap.get(key)
        if (found) return found
    }

    return null
}

// Generate TOTP
function generateTOTP(secret: string): string {
    const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

    // Decode base32 secret
    let bits = ''
    for (const char of secret.toUpperCase()) {
        const val = base32chars.indexOf(char)
        if (val >= 0) bits += val.toString(2).padStart(5, '0')
    }

    const bytes: number[] = []
    for (let i = 0; i < bits.length; i += 8) {
        bytes.push(parseInt(bits.slice(i, i + 8), 2))
    }

    // Time-based counter (30 second intervals)
    const counter = Math.floor(Date.now() / 1000 / 30)
    const counterBytes = new Uint8Array(8)
    let temp = counter
    for (let i = 7; i >= 0; i--) {
        counterBytes[i] = temp & 0xff
        temp = Math.floor(temp / 256)
    }

    // HMAC-SHA1 (simplified - in production use crypto library)
    const crypto = require('crypto')
    const hmac = crypto.createHmac('sha1', Buffer.from(bytes))
    hmac.update(Buffer.from(counterBytes))
    const hash = hmac.digest()

    const offset = hash[hash.length - 1] & 0xf
    const code = ((hash[offset] & 0x7f) << 24) |
        ((hash[offset + 1] & 0xff) << 16) |
        ((hash[offset + 2] & 0xff) << 8) |
        (hash[offset + 3] & 0xff)

    return (code % 1000000).toString().padStart(6, '0')
}

// Authenticate with Angel One
async function authenticateAngelOne(): Promise<string | null> {
    try {
        const totp = generateTOTP(TOTP_SECRET)

        const response = await fetch('https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-UserType': 'USER',
                'X-SourceID': 'WEB',
                'X-ClientLocalIP': 'CLIENT_LOCAL_IP',
                'X-ClientPublicIP': 'CLIENT_PUBLIC_IP',
                'X-MACAddress': 'MAC_ADDRESS',
                'X-PrivateKey': API_KEY,
            },
            body: JSON.stringify({
                clientcode: CLIENT_ID,
                password: SECRET_KEY,
                totp: totp,
            }),
        })

        const data = await response.json()

        if (data.status && data.data?.jwtToken) {
            return data.data.jwtToken
        }

        console.error('Auth failed:', data)
        return null
    } catch (error) {
        console.error('Auth error:', error)
        return null
    }
}

// Fetch candle data from Angel One
async function fetchCandleData(
    jwtToken: string,
    token: string,
    exchange: string,
    fromDate: string,
    toDate: string
): Promise<any[]> {
    try {
        const response = await fetch('https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-UserType': 'USER',
                'X-SourceID': 'WEB',
                'X-ClientLocalIP': 'CLIENT_LOCAL_IP',
                'X-ClientPublicIP': 'CLIENT_PUBLIC_IP',
                'X-MACAddress': 'MAC_ADDRESS',
                'X-PrivateKey': API_KEY,
                'Authorization': `Bearer ${jwtToken}`,
            },
            body: JSON.stringify({
                exchange: exchange,
                symboltoken: token,
                interval: 'ONE_MINUTE',
                fromdate: fromDate,
                todate: toDate,
            }),
        })

        const data = await response.json()
        return data.data || []
    } catch (error) {
        console.error('Fetch candle error:', error)
        return []
    }
}

async function fetchCandleDataInChunks(
    jwtToken: string,
    token: string,
    exchange: string,
    fromTime: Date,
    toTime: Date
): Promise<any[]> {
    const allCandles: any[] = []
    let cursor = new Date(fromTime)
    const requestedChunkDays = Number(process.env.CRON_CANDLE_CHUNK_DAYS || 30)
    const chunkDays = Number.isFinite(requestedChunkDays)
        ? Math.max(Math.floor(requestedChunkDays), 1)
        : 30
    const chunkMs = chunkDays * 24 * 60 * 60 * 1000

    while (cursor < toTime) {
        const chunkEnd = new Date(Math.min(cursor.getTime() + chunkMs, toTime.getTime()))
        const fromDate = formatDateForAngel(cursor)
        const toDate = formatDateForAngel(chunkEnd)

        const candles = await fetchCandleData(jwtToken, token, exchange, fromDate, toDate)
        if (candles.length > 0) {
            allCandles.push(...candles)
        }

        cursor = chunkEnd
    }

    return allCandles
}

export async function GET(request: Request) {
    // Verify cron secret (skip in development)
    const authHeader = request.headers.get('authorization')
    if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('🚀 Cron job started: Updating stock data')

    try {
        // Get all stocks from database
        const stocks = await prisma.stock.findMany({
            orderBy: { symbol: 'asc' },
        })

        if (stocks.length === 0) {
            return NextResponse.json({ message: 'No stocks to update' })
        }

        const requestedSymbolBatchSize = Number(process.env.CRON_SYMBOL_BATCH_SIZE || 80)
        const symbolCursorKey = process.env.CRON_SYMBOL_CURSOR_KEY || 'update-stocks'
        const symbolBatchSize = Number.isFinite(requestedSymbolBatchSize)
            ? Math.min(Math.max(Math.floor(requestedSymbolBatchSize), 1), stocks.length)
            : Math.min(80, stocks.length)

        const requestedParallelBatchSize = Number(process.env.CRON_PARALLEL_STOCK_BATCH_SIZE || 2)
        const parallelBatchSize = Number.isFinite(requestedParallelBatchSize)
            ? Math.min(Math.max(Math.floor(requestedParallelBatchSize), 1), 10)
            : 2

        const requestedProcessingBudgetMs = Number(process.env.CRON_PROCESSING_BUDGET_MS || 240000)
        const processingBudgetMs = Number.isFinite(requestedProcessingBudgetMs)
            ? Math.max(Math.floor(requestedProcessingBudgetMs), 30000)
            : 240000

        const runStartedAtMs = Date.now()

        const currentCursor = await getCronCursor(symbolCursorKey)
        const startCursor = ((currentCursor % stocks.length) + stocks.length) % stocks.length
        const stocksToProcess = pickStocksByCursor(stocks, startCursor, symbolBatchSize)
        const nextCursor = (startCursor + stocksToProcess.length) % stocks.length

        console.log(
            `🔁 Rotating symbol cursor [${symbolCursorKey}]: start=${startCursor}, batch=${stocksToProcess.length}, next=${nextCursor}, total=${stocks.length}`
        )

        const dynamicTokenMap = await fetchDynamicTokenMap()
        console.log(`✅ Loaded dynamic token map entries: ${dynamicTokenMap.size}`)

        // Authenticate with Angel One
        const jwtToken = await authenticateAngelOne()

        if (!jwtToken) {
            return NextResponse.json({ error: 'Failed to authenticate with Angel One' }, { status: 500 })
        }

        console.log('✅ Authenticated with Angel One')

        // Current time (IST)
        const now = new Date()
        // Keep enough catchup room to recover nearly a full month if scheduler misses runs.
        const maxCatchupDays = Number(process.env.CRON_MAX_CATCHUP_DAYS || 35)
        // Rolling retention: keep only the latest 1 month of 1-minute candles.
        const retentionMonths = Number(process.env.CRON_RETENTION_MONTHS || 1)

        let totalInserted = 0
        let processedStocks = 0
        let stoppedEarlyForBudget = false
        const results: { symbol: string; inserted: number; from?: string; to?: string; reason?: string }[] = []

        // ── Process stocks in parallel batches while respecting function runtime budget ──
        const BATCH_SIZE = parallelBatchSize
        for (let batchStart = 0; batchStart < stocksToProcess.length; batchStart += BATCH_SIZE) {
            const elapsedMs = Date.now() - runStartedAtMs
            if (elapsedMs >= processingBudgetMs) {
                stoppedEarlyForBudget = true
                console.log(
                    `⏱️ Processing budget reached after ${processedStocks} stocks (${elapsedMs}ms >= ${processingBudgetMs}ms). Stopping this run early.`
                )
                break
            }

            const batch = stocksToProcess.slice(batchStart, batchStart + BATCH_SIZE)

            await Promise.all(batch.map(async (stock) => {
                const instrument = await getInstrumentBySymbol(stock.symbol)
                const tokenInfo = resolveTokenInfo(stock, instrument, dynamicTokenMap)

                if (!tokenInfo) {
                    console.log(`⚠️  No token mapping for ${stock.symbol}, skipping`)
                    results.push({ symbol: stock.symbol, inserted: 0, reason: 'no-token-mapping' })
                    return
                }

                if (instrument && !instrument.angelToken) {
                    await updateInstrumentToken(instrument.symbol, tokenInfo.token, tokenInfo.exchange)
                }

                const latestRow = await prisma.stockPrice.findFirst({
                    where: { stockId: stock.id },
                    orderBy: { timestamp: 'desc' },
                    select: { timestamp: true },
                })

                const normalizedLatestTimestamp = latestRow?.timestamp
                    ? normalizeLegacyLatestTimestamp(latestRow.timestamp)
                    : null

                // For first-time symbols, always start from catchup floor (1-month style backfill),
                // not from a short recent lookback window.
                const catchupFloor = new Date(now.getTime() - maxCatchupDays * 24 * 60 * 60 * 1000)

                const uncappedFromTime = normalizedLatestTimestamp
                    ? new Date(normalizedLatestTimestamp.getTime() + 60 * 1000)
                    : catchupFloor

                const wasCapped = uncappedFromTime < catchupFloor
                const fromTime = wasCapped ? catchupFloor : uncappedFromTime

                if (fromTime >= now) {
                    results.push({ symbol: stock.symbol, inserted: 0, reason: 'already-up-to-date' })
                    return
                }

                const fromDate = formatDateForAngel(fromTime)
                const toDate = formatDateForAngel(now)
                console.log(`📈 Fetching ${stock.symbol} from ${fromDate} to ${toDate}`)

                const candles = await fetchCandleDataInChunks(jwtToken, tokenInfo.token, tokenInfo.exchange, fromTime, now)

                if (candles.length > 0) {
                    // ── BATCH INSERT — much faster than per-candle upsert ──
                    type PriceCreateInput = {
                        stockId: string
                        name: string
                        timestamp: Date
                        open: number
                        high: number
                        low: number
                        close: number
                        volume: number
                    }
                    const records: PriceCreateInput[] = candles
                        .map((candle: any) => {
                            try {
                                return {
                                    stockId: stock.id,
                                    name: stock.name,
                                    timestamp: parseAngelCandleTimestamp(candle[0]),
                                    open: Number(candle[1]),
                                    high: Number(candle[2]),
                                    low: Number(candle[3]),
                                    close: Number(candle[4]),
                                    volume: Number(candle[5]),
                                }
                            } catch {
                                return null
                            }
                        })
                        .filter((r): r is PriceCreateInput => r !== null)

                    // Insert in chunks of 500 to avoid DB param limits
                    const CHUNK = 500
                    let batchInserted = 0
                    for (let i = 0; i < records.length; i += CHUNK) {
                        const result = await prisma.stockPrice.createMany({
                            data: records.slice(i, i + CHUNK),
                            skipDuplicates: true,
                        })
                        batchInserted += result.count
                    }
                    totalInserted += batchInserted

                    console.log(`✅ ${stock.symbol}: inserted ${batchInserted}/${candles.length} new candles`)

                    // ── Compute indicators ONCE after all candles are saved ──
                    try {
                        const recentRows = await prisma.stockPrice.findMany({
                            where: { stockId: stock.id },
                            orderBy: { timestamp: 'desc' },
                            take: 500,
                            select: { id: true, timestamp: true, open: true, high: true, low: true, close: true, volume: true },
                        })

                        if (recentRows.length >= 14) {
                            recentRows.reverse() // chronological
                            const priceData = recentRows.map(r => ({
                                timestamp: r.timestamp,
                                open: r.open,
                                high: r.high,
                                low: r.low,
                                close: r.close,
                                volume: Number(r.volume),
                            }))

                            const indicators = technicalIndicatorsService.calculateAllIndicators(priceData)

                            // Only update rows that don't yet have indicator data (new inserts)
                            const updateCount = Math.min(batchInserted + 10, indicators.length)
                            const startIdx = indicators.length - updateCount

                            const indicatorUpdates = []
                            for (let idx = startIdx; idx < indicators.length; idx++) {
                                const ind = indicators[idx] as any
                                const row = recentRows[idx]
                                if (!row || !ind) continue
                                indicatorUpdates.push(
                                    prisma.stockPrice.update({
                                        where: { id: row.id },
                                        data: {
                                            sma20: ind.sma20 ?? null,
                                            sma50: ind.sma50 ?? null,
                                            sma200: ind.sma200 ?? null,
                                            ema12: ind.ema12 ?? null,
                                            ema26: ind.ema26 ?? null,
                                            macd: ind.macd ?? null,
                                            macdSignal: ind.macdSignal ?? null,
                                            macdHistogram: ind.macdHistogram ?? null,
                                            adx: ind.adx ?? null,
                                            plusDI: ind.plusDI ?? null,
                                            minusDI: ind.minusDI ?? null,
                                            rsi: ind.rsi ?? null,
                                            stochK: ind.stochK ?? null,
                                            stochD: ind.stochD ?? null,
                                            cci: ind.cci ?? null,
                                            williamsR: ind.williamsR ?? null,
                                            roc: ind.roc ?? null,
                                            bbUpper: ind.bbUpper ?? null,
                                            bbMiddle: ind.bbMiddle ?? null,
                                            bbLower: ind.bbLower ?? null,
                                            atr: ind.atr ?? null,
                                            obv: ind.obv != null ? BigInt(Math.round(Number(ind.obv))) : null,
                                            vwap: ind.vwap ?? null,
                                            forceIndex: ind.forceIndex ?? null,
                                            adLine: ind.adLine ?? null,
                                            supertrend: ind.supertrend ?? null,
                                            supertrendDirection: ind.supertrendDirection ?? null,
                                        },
                                    })
                                )
                            }

                            // Run indicator updates in parallel batches of 20
                            for (let i = 0; i < indicatorUpdates.length; i += 20) {
                                await Promise.all(indicatorUpdates.slice(i, i + 20))
                            }

                            console.log(`📊 ${stock.symbol}: updated indicators for ${updateCount} rows`)
                        }
                    } catch (indicatorErr) {
                        console.error(`⚠️ Indicator computation failed for ${stock.symbol}:`, indicatorErr)
                    }

                    results.push({ symbol: stock.symbol, inserted: batchInserted, from: fromDate, to: toDate, reason: wasCapped ? 'catchup-window-capped' : undefined })
                } else {
                    console.log(`ℹ️  No new data for ${stock.symbol}`)
                    results.push({ symbol: stock.symbol, inserted: 0, from: fromDate, to: toDate, reason: wasCapped ? 'catchup-window-capped-no-candles' : 'no-candles-returned' })
                }
            }))

            processedStocks += batch.length
        }

        const effectiveNextCursor = (startCursor + processedStocks) % stocks.length
        await setCronCursor(symbolCursorKey, effectiveNextCursor)
        console.log(`✅ Cursor advanced [${symbolCursorKey}] => ${effectiveNextCursor}`)

        const retentionCutoff = new Date(now)
        retentionCutoff.setMonth(retentionCutoff.getMonth() - retentionMonths)

        const elapsedBeforeCleanupMs = Date.now() - runStartedAtMs
        const shouldSkipCleanup = elapsedBeforeCleanupMs >= processingBudgetMs - 15000
        let deletedRows = 0

        if (shouldSkipCleanup) {
            console.log(
                `⏭️ Skipping retention cleanup this run due to time budget (${elapsedBeforeCleanupMs}ms elapsed).`
            )
        } else {
            const cleanupResult = await prisma.stockPrice.deleteMany({
                where: {
                    timestamp: {
                        lt: retentionCutoff,
                    },
                },
            })
            deletedRows = cleanupResult.count

            console.log(
                `🧹 Cleanup completed: removed ${deletedRows} rows older than ${retentionCutoff.toISOString()}`
            )
        }

        console.log(`🎉 Cron job completed. Total inserted: ${totalInserted}`)

        return NextResponse.json({
            success: true,
            message: `Updated ${processedStocks} stocks this run (window ${stocksToProcess.length}, total ${stocks.length})`,
            totalInserted,
            totalDeleted: deletedRows,
            cleanupSkipped: shouldSkipCleanup,
            retentionCutoff: retentionCutoff.toISOString(),
            resolvedTokenCount: dynamicTokenMap.size,
            cursor: {
                key: symbolCursorKey,
                start: startCursor,
                next: effectiveNextCursor,
                batchSize: stocksToProcess.length,
                processedStocks,
                stoppedEarlyForBudget,
                processingBudgetMs,
                runElapsedMs: Date.now() - runStartedAtMs,
                totalStocks: stocks.length,
            },
            results,
            timestamp: now.toISOString(),
        })

    } catch (error: any) {
        console.error('❌ Cron job failed:', error)
        return NextResponse.json({
            error: 'Cron job failed',
            details: error.message
        }, { status: 500 })
    }
}

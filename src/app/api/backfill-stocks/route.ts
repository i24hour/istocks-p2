import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Angel One credentials
const API_KEY = process.env.ANGELONE_API_KEY || process.env.ANGEL_API_KEY 
const CLIENT_ID = process.env.ANGELONE_CLIENT_ID || process.env.ANGEL_CLIENT_ID 
const SECRET_KEY = process.env.ANGELONE_SECRET_KEY || process.env.ANGEL_SECRET_KEY 
const TOTP_SECRET = process.env.ANGELONE_TOTP_TOKEN || process.env.ANGEL_TOTP_SECRET 

// Stock tokens mapping
const STOCK_TOKENS: { [key: string]: { token: string; exchange: string } } = {
    'NIFTY': { token: '99926000', exchange: 'NSE' },
    'WIPRO': { token: '3787', exchange: 'NSE' },
    'ADANIPOWER': { token: '17388', exchange: 'NSE' },
    'VEDL': { token: '3063', exchange: 'NSE' },
}

// Generate TOTP
function generateTOTP(secret: string): string {
    const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    let bits = ''
    for (const char of secret.toUpperCase()) {
        const val = base32chars.indexOf(char)
        if (val >= 0) bits += val.toString(2).padStart(5, '0')
    }
    const bytes: number[] = []
    for (let i = 0; i < bits.length; i += 8) {
        bytes.push(parseInt(bits.slice(i, i + 8), 2))
    }
    const counter = Math.floor(Date.now() / 1000 / 30)
    const counterBytes = new Uint8Array(8)
    let temp = counter
    for (let i = 7; i >= 0; i--) {
        counterBytes[i] = temp & 0xff
        temp = Math.floor(temp / 256)
    }
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

// Fetch candle data
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

// Helper: Format date for Angel One API
function formatDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day} 09:15`
}

function formatDateEnd(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day} 15:30`
}

/**
 * Backfill API - Fetches missing historical data
 * 
 * Query params:
 *   - startDate: YYYY-MM-DD (start of range to fetch)
 *   - endDate: YYYY-MM-DD (end of range to fetch)
 *   - deleteOldDays: number (days to delete from oldest data, optional)
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const startDateStr = searchParams.get('startDate') || '2026-01-30'
    const endDateStr = searchParams.get('endDate') || '2026-02-09'
    const deleteOldDays = parseInt(searchParams.get('deleteOldDays') || '0')

    console.log(`🔄 Backfill started: ${startDateStr} to ${endDateStr}`)
    if (deleteOldDays > 0) {
        console.log(`🗑️  Will delete ${deleteOldDays} days of oldest data`)
    }

    try {
        // Get all stocks
        const stocks = await prisma.stock.findMany()
        if (stocks.length === 0) {
            return NextResponse.json({ error: 'No stocks in database' }, { status: 400 })
        }

        // Authenticate
        const jwtToken = await authenticateAngelOne()
        if (!jwtToken) {
            return NextResponse.json({ error: 'Failed to authenticate with Angel One' }, { status: 500 })
        }
        console.log('✅ Authenticated with Angel One')

        // Parse dates
        const startDate = new Date(startDateStr)
        const endDate = new Date(endDateStr)

        // Calculate trading days (Mon-Fri)
        const tradingDays: Date[] = []
        const current = new Date(startDate)
        while (current <= endDate) {
            const dayOfWeek = current.getDay()
            if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Skip weekends
                tradingDays.push(new Date(current))
            }
            current.setDate(current.getDate() + 1)
        }

        console.log(`📅 Processing ${tradingDays.length} trading days`)

        let totalInserted = 0
        const results: { symbol: string; inserted: number }[] = []

        // Fetch data for each stock
        for (const stock of stocks) {
            const tokenInfo = STOCK_TOKENS[stock.symbol]
            if (!tokenInfo) {
                console.log(`⚠️  No token mapping for ${stock.symbol}, skipping`)
                continue
            }

            let stockInserted = 0

            // Fetch day by day (API limitation)
            for (const day of tradingDays) {
                const fromDate = formatDate(day)
                const toDate = formatDateEnd(day)

                console.log(`📈 Fetching ${stock.symbol} for ${day.toISOString().slice(0, 10)}`)

                const candles = await fetchCandleData(jwtToken, tokenInfo.token, tokenInfo.exchange, fromDate, toDate)

                if (candles.length > 0) {
                    for (const candle of candles) {
                        try {
                            const timestamp = new Date(candle[0])
                            await prisma.stockPrice.upsert({
                                where: {
                                    stockId_timestamp: {
                                        stockId: stock.id,
                                        timestamp: timestamp,
                                    },
                                },
                                update: {
                                    name: stock.name,
                                    open: candle[1],
                                    high: candle[2],
                                    low: candle[3],
                                    close: candle[4],
                                    volume: candle[5],
                                },
                                create: {
                                    stockId: stock.id,
                                    name: stock.name,
                                    timestamp: timestamp,
                                    open: candle[1],
                                    high: candle[2],
                                    low: candle[3],
                                    close: candle[4],
                                    volume: candle[5],
                                },
                            })
                            stockInserted++
                            totalInserted++
                        } catch (err) {
                            // Ignore duplicate key errors
                        }
                    }
                    console.log(`  ✅ Inserted ${candles.length} candles`)
                }

                // Rate limiting - wait 500ms between API calls
                await new Promise(resolve => setTimeout(resolve, 500))
            }

            results.push({ symbol: stock.symbol, inserted: stockInserted })
        }

        // Delete old data if requested
        let deleted = 0
        if (deleteOldDays > 0) {
            console.log(`🗑️  Deleting ${deleteOldDays} days of oldest data...`)

            for (const stock of stocks) {
                // Find the oldest date for this stock
                const oldestRecord = await prisma.stockPrice.findFirst({
                    where: { stockId: stock.id },
                    orderBy: { timestamp: 'asc' },
                })

                if (oldestRecord) {
                    const cutoffDate = new Date(oldestRecord.timestamp)
                    cutoffDate.setDate(cutoffDate.getDate() + deleteOldDays)

                    const deleteResult = await prisma.stockPrice.deleteMany({
                        where: {
                            stockId: stock.id,
                            timestamp: {
                                lt: cutoffDate,
                            },
                        },
                    })

                    deleted += deleteResult.count
                    console.log(`  🗑️  Deleted ${deleteResult.count} old records for ${stock.symbol}`)
                }
            }
        }

        console.log(`🎉 Backfill completed. Inserted: ${totalInserted}, Deleted: ${deleted}`)

        return NextResponse.json({
            success: true,
            message: `Backfill completed`,
            tradingDaysProcessed: tradingDays.length,
            totalInserted,
            totalDeleted: deleted,
            results,
        })

    } catch (error: any) {
        console.error('❌ Backfill failed:', error)
        return NextResponse.json({
            error: 'Backfill failed',
            details: error.message
        }, { status: 500 })
    }
}

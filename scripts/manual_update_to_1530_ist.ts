import { PrismaClient } from '@prisma/client'
import { technicalIndicatorsService } from '../src/services/technical-indicators.service'

const prisma = new PrismaClient()

const API_KEY = process.env.ANGEL_API_KEY 
const CLIENT_ID = process.env.ANGEL_CLIENT_ID 
const SECRET_KEY = process.env.ANGEL_SECRET_KEY 
const TOTP_SECRET = process.env.ANGEL_TOTP_SECRET 

const SCRIP_MASTER_URL = 'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json'

function normalizeSymbolKey(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

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
  if (/Z$|[+-]\d{2}:\d{2}$/.test(value)) return new Date(value)
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
        totp,
      }),
    })

    const data = await response.json()
    if (data.status && data.data?.jwtToken) return data.data.jwtToken

    console.error('Auth failed:', data)
    return null
  } catch (error) {
    console.error('Auth error:', error)
    return null
  }
}

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
        exchange,
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

  while (cursor < toTime) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + 24 * 60 * 60 * 1000, toTime.getTime()))
    const candles = await fetchCandleData(jwtToken, token, exchange, formatDateForAngel(cursor), formatDateForAngel(chunkEnd))
    if (candles.length > 0) allCandles.push(...candles)
    cursor = chunkEnd
  }

  return allCandles
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
      if (item.name) tokenMap.set(normalizeSymbolKey(item.name), { token: item.token, exchange })
      if (item.symbol) tokenMap.set(normalizeSymbolKey(String(item.symbol).replace(/-EQ$/i, '')), { token: item.token, exchange })
    }
  } catch (error) {
    console.error('Scrip master fetch failed:', error)
  }

  return tokenMap
}

async function run() {
  const now = new Date()
  const istNowParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const map = Object.fromEntries(istNowParts.map(p => [p.type, p.value]))
  const targetToTime = new Date(`${map.year}-${map.month}-${map.day}T15:30:00+05:30`)
  const effectiveToTime = now < targetToTime ? now : targetToTime

  console.log(`Target to-time (IST): ${targetToTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}`)
  console.log(`Effective to-time (IST): ${effectiveToTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}`)

  const stocks = await prisma.stock.findMany({ select: { id: true, symbol: true, name: true, exchange: true } })
  const dynamicMap = await fetchDynamicTokenMap()

  const jwt = await authenticateAngelOne()
  if (!jwt) throw new Error('Angel auth failed')

  const results: Array<{ symbol: string; inserted: number; status: string; reason?: string }> = []

  for (const stock of stocks) {
    const normalized = normalizeSymbolKey(stock.symbol)
    const instrument = await prisma.instrument.findFirst({ where: { symbol: normalized }, select: { symbol: true, angelToken: true, exchange: true } })

    const tokenInfo = instrument?.angelToken
      ? { token: instrument.angelToken, exchange: instrument.exchange || 'NSE' }
      : dynamicMap.get(normalized) || dynamicMap.get(normalizeSymbolKey(stock.name)) || null

    if (!tokenInfo) {
      results.push({ symbol: stock.symbol, inserted: 0, status: 'skipped', reason: 'no-token' })
      continue
    }

    if (!instrument?.angelToken) {
      await prisma.instrument.updateMany({ where: { symbol: normalized }, data: { angelToken: tokenInfo.token, exchange: tokenInfo.exchange } })
    }

    const latestRow = await prisma.stockPrice.findFirst({
      where: { stockId: stock.id },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    })

    const normalizedLatest = latestRow?.timestamp ? normalizeLegacyLatestTimestamp(latestRow.timestamp) : null
    const defaultFrom = new Date(effectiveToTime.getTime() - 60 * 60 * 1000)
    const fromTime = normalizedLatest
      ? new Date(normalizedLatest.getTime() + 60 * 1000)
      : defaultFrom

    if (fromTime >= effectiveToTime) {
      results.push({ symbol: stock.symbol, inserted: 0, status: 'up-to-date' })
      continue
    }

    const candles = await fetchCandleDataInChunks(jwt, tokenInfo.token, tokenInfo.exchange, fromTime, effectiveToTime)

    if (candles.length === 0) {
      results.push({ symbol: stock.symbol, inserted: 0, status: 'no-candles' })
      continue
    }

    for (const candle of candles) {
      const timestamp = parseAngelCandleTimestamp(candle[0])
      await prisma.stockPrice.upsert({
        where: { stockId_timestamp: { stockId: stock.id, timestamp } },
        update: { open: candle[1], high: candle[2], low: candle[3], close: candle[4], volume: candle[5] },
        create: { stockId: stock.id, timestamp, open: candle[1], high: candle[2], low: candle[3], close: candle[4], volume: candle[5] },
      })
    }

    const recentRows = await prisma.stockPrice.findMany({
      where: { stockId: stock.id },
      orderBy: { timestamp: 'desc' },
      take: 250,
      select: { id: true, timestamp: true, open: true, high: true, low: true, close: true, volume: true },
    })

    if (recentRows.length >= 14) {
      recentRows.reverse()
      const priceData = recentRows.map(r => ({
        timestamp: r.timestamp,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: Number(r.volume),
      }))

      const indicators = technicalIndicatorsService.calculateAllIndicators(priceData)
      const updateCount = Math.min(candles.length, indicators.length)
      const startIdx = indicators.length - updateCount

      for (let idx = startIdx; idx < indicators.length; idx++) {
        const ind: any = indicators[idx]
        const row = recentRows[idx]
        if (!row || !ind) continue

        await prisma.stockPrice.update({
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
      }
    }

    results.push({ symbol: stock.symbol, inserted: candles.length, status: 'updated' })
    console.log(`Updated ${stock.symbol}: +${candles.length}`)
  }

  const latestPerSymbol = await Promise.all(
    stocks.map(async (stock) => {
      const row = await prisma.stockPrice.findFirst({
        where: { stockId: stock.id },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true, close: true },
      })
      return {
        symbol: stock.symbol,
        lastIST: row ? new Date(row.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) : null,
        close: row?.close ?? null,
      }
    })
  )

  console.log('\n=== SUMMARY ===')
  console.log(JSON.stringify({
    updated: results.filter(r => r.status === 'updated').length,
    skipped: results.filter(r => r.status !== 'updated').length,
    results,
    latestPerSymbol: latestPerSymbol.sort((a, b) => a.symbol.localeCompare(b.symbol)),
  }, null, 2))
}

run()
  .catch((err) => {
    console.error('Manual update failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

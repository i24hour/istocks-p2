import { prisma } from '@/lib/prisma'

type TokenInfo = { token: string; exchange: string }

// ─── SINGLE SOURCE OF TRUTH FOR ANGEL ONE TOKENS ───────────────────────────
// These fallback values are used when Stock.angelToken is NULL in the DB.
// To add/change a token permanently → update Stock.angelToken in the database
// (this table is the source of truth, not this file).
// exchange: 'NSE' for equity/index, 'BSE' for BSE-listed instruments.
const FALLBACK_TOKENS: Record<string, TokenInfo> = {
  NIFTY:      { token: '99926000', exchange: 'NSE' },
  RELIANCE:   { token: '2885',     exchange: 'NSE' },
  HDFCBANK:   { token: '1333',     exchange: 'NSE' },
  ICICIBANK:  { token: '4963',     exchange: 'NSE' },
  SBIN:       { token: '3045',     exchange: 'NSE' },
  WIPRO:      { token: '3787',     exchange: 'NSE' },
  ADANIPOWER: { token: '17388',    exchange: 'NSE' },
  VEDL:       { token: '3063',     exchange: 'NSE' },
  BAJFINANCE: { token: '317',      exchange: 'NSE' },
  ETERNAL:    { token: '5097',     exchange: 'NSE' },
  SWIGGY:     { token: '27066',    exchange: 'NSE' },
  REDINGTON:  { token: '14255',    exchange: 'NSE' },
  MIFL:       { token: '537800',   exchange: 'BSE' }, // BSE-listed
  ANGELONE:   { token: '20374',    exchange: 'NSE' },
  ASIANPAINT: { token: '236',      exchange: 'NSE' },
  CDSL:       { token: '21174',    exchange: 'NSE' },
  INFY:       { token: '1594',     exchange: 'NSE' },
  TCS:        { token: '11536',    exchange: 'NSE' },
}
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_ALIASES: Record<string, string[]> = {
  VEDL: ['VEDANTA'],
  BAJFINANCE: ['BAJAJFINANCE', 'BAJAJ FINANCE', 'BAJAJ FIN', 'BAJAJFIN'],
  HDFCBANK: ['HDFC', 'HDFC BANK'],
  ICICIBANK: ['ICICI', 'ICICI BANK'],
  SBIN: ['SBI'],
  KOTAKBANK: ['KOTAK', 'KOTAK BANK', 'KOTAK MAHINDRA', 'KOTAK MAHINDRA BANK'],
  BHARTIARTL: ['AIRTEL', 'BHARTI AIRTEL', 'BHARTI'],
  'BAJAJ-AUTO': ['BAJAJ AUTO'],
  HEROMOTOCO: ['HERO', 'HERO MOTOCORP'],
  TATAMOTORS: ['TATA MOTORS'],
  TATASTEEL: ['TATA STEEL'],
  'M&M': ['MAHINDRA', 'MAHINDRA AND MAHINDRA'],
  INDHOTEL: ['TAJ HOTELS', 'INDIAN HOTELS'],
}

type CachedStore = {
  expiresAt: number
  bySymbol: Map<string, {
    id: string
    symbol: string
    name: string
    exchange: string
    angelToken: string | null
    aliases: string[]
  }>
  aliasToSymbol: Map<string, string>
}

let cachedStore: CachedStore | null = null

const CACHE_TTL_MS = Number(process.env.INSTRUMENT_CACHE_TTL_MS || 5 * 60 * 1000)

export function normalizeSymbolKey(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function buildAliasList(symbol: string, name: string): string[] {
  const normalizedSymbol = normalizeSymbolKey(symbol)
  const normalizedName = normalizeSymbolKey(name)
  const merged = new Set<string>([normalizedSymbol, normalizedName, ...(DEFAULT_ALIASES[normalizedSymbol] || [])])
  return Array.from(merged)
}

/**
 * Seeds Stock.angelToken from FALLBACK_TOKENS for any stock that doesn't have a token yet.
 * This is a one-time self-heal — once the DB has the token it won't be overwritten.
 */
async function seedMissingTokens() {
  try {
    const stocks = await prisma.stock.findMany({
      select: { symbol: true, angelToken: true },
    })
    for (const stock of stocks) {
      const symbol = normalizeSymbolKey(stock.symbol)
      if (!stock.angelToken && FALLBACK_TOKENS[symbol]) {
        await prisma.stock.update({
          where: { symbol: stock.symbol },
          data: {
            angelToken: FALLBACK_TOKENS[symbol].token,
            exchange:   FALLBACK_TOKENS[symbol].exchange,
          },
        })
      }
    }
  } catch (error) {
    console.warn('[instrumentRegistry] Could not seed missing tokens:', error)
  }
}

function buildStoreFromRows(
  rows: Array<{ id: string; symbol: string; name: string; exchange: string; angelToken: string | null }>
): CachedStore {
  const bySymbol = new Map<string, {
    id: string
    symbol: string
    name: string
    exchange: string
    angelToken: string | null
    aliases: string[]
  }>()
  const aliasToSymbol = new Map<string, string>()

  for (const row of rows) {
    const symbol   = normalizeSymbolKey(row.symbol)
    const fallback = FALLBACK_TOKENS[symbol]
    const aliases  = buildAliasList(symbol, row.name)

    bySymbol.set(symbol, {
      id:         row.id,
      symbol,
      name:       row.name,
      exchange:   row.exchange || fallback?.exchange || 'NSE',
      angelToken: row.angelToken || fallback?.token || null,
      aliases,
    })

    for (const alias of aliases) {
      aliasToSymbol.set(normalizeSymbolKey(alias), symbol)
    }
  }

  return { expiresAt: Date.now() + CACHE_TTL_MS, bySymbol, aliasToSymbol }
}

export async function getInstrumentStore(forceRefresh = false) {
  if (!forceRefresh && cachedStore && cachedStore.expiresAt > Date.now()) {
    return cachedStore
  }

  // Seed any Stock rows that are missing angelToken
  await seedMissingTokens()

  // Stock table is the single source of truth — reads token from Stock.angelToken
  const rows = await prisma.stock.findMany({
    select: { id: true, symbol: true, name: true, exchange: true, angelToken: true },
  })

  cachedStore = buildStoreFromRows(rows)
  return cachedStore
}

export async function resolveCanonicalSymbol(rawValue: string): Promise<string> {
  const normalized = normalizeSymbolKey(rawValue)
  const store = await getInstrumentStore()
  return store.aliasToSymbol.get(normalized) || normalized
}

export async function getInstrumentBySymbol(symbolOrAlias: string) {
  const store = await getInstrumentStore()
  const normalized = normalizeSymbolKey(symbolOrAlias)
  const canonical  = store.aliasToSymbol.get(normalized) || normalized
  return store.bySymbol.get(canonical) || null
}

/**
 * Persists an Angel One token for a symbol directly into Stock.angelToken.
 * This is called by the cron job after scrip-master resolution.
 */
export async function updateInstrumentToken(symbol: string, token: string, exchange?: string) {
  const normalized = normalizeSymbolKey(symbol)
  try {
    // Stock.symbol is unique and uppercase; try direct update first
    await prisma.stock.updateMany({
      where: { symbol: normalized },
      data: {
        angelToken: token,
        ...(exchange ? { exchange } : {}),
      },
    })
  } catch {
    // ignore — will resolve from FALLBACK_TOKENS on next call
  } finally {
    cachedStore = null // bust cache so next read picks up the saved token
  }
}

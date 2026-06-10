import YahooFinance from 'yahoo-finance2';
import { TechnicalIndicatorsService } from '@/services/technical-indicators.service'
import { buildStockQueryCandidates, resolveClosestStocks } from '@/lib/stock-resolver'

// yahoo-finance2 v3 requires instantiation
const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
});
const technicalIndicatorsService = new TechnicalIndicatorsService()

/**
 * Yahoo Finance Utility — iStocks
 * ─────────────────────────────────────────────────────────────────
 * ANALYSIS-ONLY fallback. Never used for trade execution.
 *
 * Exports:
 *   batchQuote(symbols)       → price + % change for multiple stocks (top movers)
 *   fetchOHLCV(symbol, range) → daily candles for a single stock
 *   computeIndicators(candles)→ EMA/SMA/RSI/MACD/BB/ATR from raw OHLCV
 *   yahooSymbol(symbol)       → "WIPRO" → "WIPRO.NS"
 * ─────────────────────────────────────────────────────────────────
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

export function yahooSymbol(symbol: string): string {
  const s = symbol.toUpperCase()
  if (s.includes('.')) return s
  if (s === 'NIFTY50' || s === 'NIFTY') return '^NSEI'
  if (s === 'SENSEX') return '^BSESN'
  // INDEX_ALIAS_TICKERS is defined below — accessed via closure at call time (not at parse time)
  const alias = (INDEX_ALIAS_TICKERS as Record<string, { ticker: string }>)?.[s]
  if (alias) return alias.ticker
  return `${s}.NS`
}

const INDEX_ALIAS_TICKERS: Record<string, { ticker: string; canonical: string }> = {
  // ── Nifty broad market ──────────────────────────────────────────────────────
  NIFTY: { ticker: '^NSEI', canonical: 'NIFTY' },
  NIFTY50: { ticker: '^NSEI', canonical: 'NIFTY' },
  NIFTY100: { ticker: '^CNX100', canonical: 'NIFTY100' },
  NIFTY200: { ticker: '^CNX200', canonical: 'NIFTY200' },
  NIFTY500: { ticker: '^CNX500', canonical: 'NIFTY500' },
  NIFTYNEXT50: { ticker: '^NSMIDCP50', canonical: 'NIFTYNEXT50' },
  JUNIORNIFTY: { ticker: '^NSMIDCP50', canonical: 'NIFTYNEXT50' },
  // ── Nifty mid / small cap ───────────────────────────────────────────────────
  NIFTYMIDCAP50: { ticker: '^NSEMDCP50', canonical: 'NIFTYMIDCAP50' },
  NIFTYMIDCAP100: { ticker: '^CNXMID', canonical: 'NIFTYMIDCAP100' },
  NIFTYMIDCAP150: { ticker: '^NIFMDCP150', canonical: 'NIFTYMIDCAP150' },
  NIFTYMIDSMALLCAP400: { ticker: '^NIFMIDSML400', canonical: 'NIFTYMIDSMALLCAP400' },
  NIFTYSMALLCAP50: { ticker: '^CNXSC', canonical: 'NIFTYSMALLCAP50' },
  NIFTYSMALLCAP100: { ticker: '^CNXSC', canonical: 'NIFTYSMALLCAP100' },
  NIFTYSMALLCAP250: { ticker: '^NIFSMCP250', canonical: 'NIFTYSMALLCAP250' },
  NIFTYMICROCAP250: { ticker: '^NIFMIC250', canonical: 'NIFTYMICROCAP250' },
  NIFTYTOTALMARKET: { ticker: '^NIFTYTM', canonical: 'NIFTYTOTALMARKET' },
  // ── Nifty sectoral ──────────────────────────────────────────────────────────
  NIFTYBANK: { ticker: '^NSEBANK', canonical: 'BANKNIFTY' },
  BANKNIFTY: { ticker: '^NSEBANK', canonical: 'BANKNIFTY' },
  FINNIFTY: { ticker: '^CNXFIN', canonical: 'FINNIFTY' },
  NIFTYIT: { ticker: '^CNXIT', canonical: 'NIFTYIT' },
  NIFTYPHARMA: { ticker: '^CNXPHARMA', canonical: 'NIFTYPHARMA' },
  NIFTYAUTO: { ticker: '^CNXAUTO', canonical: 'NIFTYAUTO' },
  NIFTYFMCG: { ticker: '^CNXFMCG', canonical: 'NIFTYFMCG' },
  NIFTYREALTY: { ticker: '^CNXREALTY', canonical: 'NIFTYREALTY' },
  NIFTYMETAL: { ticker: '^CNXMETAL', canonical: 'NIFTYMETAL' },
  NIFTYENERGY: { ticker: '^CNXENERGY', canonical: 'NIFTYENERGY' },
  NIFTYMEDIA: { ticker: '^CNXMEDIA', canonical: 'NIFTYMEDIA' },
  NIFTYINFRA: { ticker: '^CNXINFRA', canonical: 'NIFTYINFRA' },
  NIFTYPSE: { ticker: '^CNXPSE', canonical: 'NIFTYPSE' },
  NIFTYMNC: { ticker: '^CNXMNC', canonical: 'NIFTYMNC' },
  NIFTYPVTBANK: { ticker: '^NIFTYPVTBANK', canonical: 'NIFTYPVTBANK' },
  NIFTYPSUBANK: { ticker: '^NIFTYPSUBNK', canonical: 'NIFTYPSUBANK' },
  NIFTYCONSMRDUR: { ticker: '^NIFCONSDUR', canonical: 'NIFTYCONSMRDUR' },
  NIFTYHEALTHCARE: { ticker: '^NIFTYHLTHCR', canonical: 'NIFTYHEALTHCARE' },
  NIFTYOILGAS: { ticker: '^NIFTYOG', canonical: 'NIFTYOILGAS' },
  // ── Volatility ──────────────────────────────────────────────────────────────
  INDIAVIX: { ticker: '^INDIAVIX', canonical: 'INDIAVIX' },
  VIX: { ticker: '^INDIAVIX', canonical: 'INDIAVIX' },
  // ── BSE ─────────────────────────────────────────────────────────────────────
  SENSEX: { ticker: '^BSESN', canonical: 'SENSEX' },
  BSE500: { ticker: '^BSE500', canonical: 'BSE500' },
  BSEMIDCAP: { ticker: '^BSEMC', canonical: 'BSEMIDCAP' },
  BSESMALLCAP: { ticker: '^BSESC', canonical: 'BSESMALLCAP' },
  // ── Global ──────────────────────────────────────────────────────────────────
  DOW: { ticker: '^DJI', canonical: 'DOWJONES' },
  DOWJONES: { ticker: '^DJI', canonical: 'DOWJONES' },
  DJIA: { ticker: '^DJI', canonical: 'DOWJONES' },
  NASDAQ: { ticker: '^IXIC', canonical: 'NASDAQ' },
  SP500: { ticker: '^GSPC', canonical: 'SP500' },
  SNP500: { ticker: '^GSPC', canonical: 'SP500' },
  SANDP500: { ticker: '^GSPC', canonical: 'SP500' },
  FTSE: { ticker: '^FTSE', canonical: 'FTSE100' },
  FTSE100: { ticker: '^FTSE', canonical: 'FTSE100' },
  DAX: { ticker: '^GDAXI', canonical: 'DAX' },
  CAC40: { ticker: '^FCHI', canonical: 'CAC40' },
  HANGSENG: { ticker: '^HSI', canonical: 'HANGSENG' },
  NIKKEI: { ticker: '^N225', canonical: 'NIKKEI225' },
  NIKKEI225: { ticker: '^N225', canonical: 'NIKKEI225' },
  SHANGHAI: { ticker: '000001.SS', canonical: 'SSE' },
  SHENZHEN: { ticker: '399001.SZ', canonical: 'SZSE' },
  ASX200: { ticker: '^AXJO', canonical: 'ASX200' },
}

const UNSUPPORTED_MARKET_ALIASES = new Set(['GIFTNIFTY', 'SGXNIFTY'])

function normalizeMarketAlias(value: string): string {
  return value
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]/g, '')
}

function looksLikeDirectTicker(value: string): boolean {
  const v = value.trim().toUpperCase()
  if (!v) return false
  if (v.startsWith('^')) return true
  if (v.includes('=')) return true
  if (/^\d{6}\.(SS|SZ)$/.test(v)) return true
  if (/^[A-Z0-9.-]+\.(NS|BO|SS|SZ|HK|L|AX|TO|PA|DE|MI)$/.test(v)) return true
  return false
}

export function extractKnownMarketSymbol(message: string): string | null {
  const directTicker = message.match(/\^[A-Z0-9.]{2,}/i)?.[0]
  if (directTicker) return directTicker.toUpperCase()

  const checks: Array<{ re: RegExp; symbol: string }> = [
    // ── Unsupported aliases (must be checked first) ─────────────────────────
    { re: /\b(gift\s*nifty|giftnifty|sgx\s*nifty|sgxnifty)\b/i, symbol: 'GIFTNIFTY' },
    // ── Nifty sector / theme (before broad to avoid partial matches) ─────────
    { re: /\b(bank\s*nifty|banknifty)\b/i, symbol: 'BANKNIFTY' },
    { re: /\b(fin\s*nifty|finnifty|nifty\s*fin(ancial)?)\b/i, symbol: 'FINNIFTY' },
    { re: /\b(nifty\s*(pvt|private)\s*bank)\b/i, symbol: 'NIFTYPVTBANK' },
    { re: /\b(nifty\s*psu\s*bank)\b/i, symbol: 'NIFTYPSUBANK' },
    { re: /\b(nifty\s*i\.?t\.?|nifty\s*information\s*tech)\b/i, symbol: 'NIFTYIT' },
    { re: /\b(nifty\s*pharma(ceutical)?)\b/i, symbol: 'NIFTYPHARMA' },
    { re: /\b(nifty\s*auto(mobile)?)\b/i, symbol: 'NIFTYAUTO' },
    { re: /\b(nifty\s*fmcg)\b/i, symbol: 'NIFTYFMCG' },
    { re: /\b(nifty\s*realty|nifty\s*real\s*estate)\b/i, symbol: 'NIFTYREALTY' },
    { re: /\b(nifty\s*metal)\b/i, symbol: 'NIFTYMETAL' },
    { re: /\b(nifty\s*energy)\b/i, symbol: 'NIFTYENERGY' },
    { re: /\b(nifty\s*oil\s*(and|&)?\s*gas)\b/i, symbol: 'NIFTYOILGAS' },
    { re: /\b(nifty\s*media)\b/i, symbol: 'NIFTYMEDIA' },
    { re: /\b(nifty\s*infra(structure)?)\b/i, symbol: 'NIFTYINFRA' },
    { re: /\b(nifty\s*pse)\b/i, symbol: 'NIFTYPSE' },
    { re: /\b(nifty\s*mnc)\b/i, symbol: 'NIFTYMNC' },
    { re: /\b(nifty\s*healthcare|nifty\s*health)\b/i, symbol: 'NIFTYHEALTHCARE' },
    { re: /\b(nifty\s*consumer\s*dur(ables?)?)\b/i, symbol: 'NIFTYCONSMRDUR' },
    // ── Nifty mid / small cap ────────────────────────────────────────────────
    { re: /\b(nifty\s*midcap\s*150)\b/i, symbol: 'NIFTYMIDCAP150' },
    { re: /\b(nifty\s*midcap\s*100)\b/i, symbol: 'NIFTYMIDCAP100' },
    { re: /\b(nifty\s*midcap\s*50|nifty\s*mid\s*cap\s*50)\b/i, symbol: 'NIFTYMIDCAP50' },
    { re: /\b(nifty\s*smallcap\s*250)\b/i, symbol: 'NIFTYSMALLCAP250' },
    { re: /\b(nifty\s*smallcap\s*100)\b/i, symbol: 'NIFTYSMALLCAP100' },
    { re: /\b(nifty\s*smallcap\s*50)\b/i, symbol: 'NIFTYSMALLCAP50' },
    { re: /\b(nifty\s*micro\s*cap\s*250|nifty\s*microcap)\b/i, symbol: 'NIFTYMICROCAP250' },
    { re: /\b(nifty\s*(mid\s*)?small\s*cap\s*400)\b/i, symbol: 'NIFTYMIDSMALLCAP400' },
    { re: /\b(nifty\s*(next\s*50|junior)|junior\s*nifty)\b/i, symbol: 'NIFTYNEXT50' },
    // ── Nifty broad market ───────────────────────────────────────────────────
    { re: /\b(nifty\s*500)\b/i, symbol: 'NIFTY500' },
    { re: /\b(nifty\s*200)\b/i, symbol: 'NIFTY200' },
    { re: /\b(nifty\s*100)\b/i, symbol: 'NIFTY100' },
    { re: /\b(nifty\s*total\s*market)\b/i, symbol: 'NIFTYTOTALMARKET' },
    { re: /\b(nifty\s*50|nifty50|nifty\s*index|\bnifty\b)\b/i, symbol: 'NIFTY' },
    // ── Volatility ──────────────────────────────────────────────────────────
    { re: /\b(india\s*vix|indiavix)\b/i, symbol: 'INDIAVIX' },
    // ── BSE ─────────────────────────────────────────────────────────────────
    { re: /\b(sensex)\b/i, symbol: 'SENSEX' },
    { re: /\b(bse\s*500)\b/i, symbol: 'BSE500' },
    { re: /\b(bse\s*mid\s*cap)\b/i, symbol: 'BSEMIDCAP' },
    { re: /\b(bse\s*small\s*cap)\b/i, symbol: 'BSESMALLCAP' },
    // ── Global ───────────────────────────────────────────────────────────────
    { re: /\b(dow\s*jones|djia|\bdow\b)\b/i, symbol: 'DOWJONES' },
    { re: /\b(nasdaq)\b/i, symbol: 'NASDAQ' },
    { re: /\b(s&p\s*500|snp\s*500|sp\s*500|sp500)\b/i, symbol: 'SP500' },
    { re: /\b(ftse(\s*100)?)\b/i, symbol: 'FTSE100' },
    { re: /\b(dax)\b/i, symbol: 'DAX' },
    { re: /\b(cac\s*40|cac40)\b/i, symbol: 'CAC40' },
    { re: /\b(hang\s*seng)\b/i, symbol: 'HANGSENG' },
    { re: /\b(nikkei(\s*225)?)\b/i, symbol: 'NIKKEI225' },
    { re: /\b(shanghai)\b/i, symbol: 'SHANGHAI' },
    { re: /\b(shenzhen)\b/i, symbol: 'SHENZHEN' },
    { re: /\b(asx\s*200|asx200)\b/i, symbol: 'ASX200' },
  ]

  const hit = checks.find((item) => item.re.test(message))
  return hit ? hit.symbol : null
}

type ResolvedLiveQuoteInput =
  | { ok: true; ticker: string; canonical: string }
  | { ok: false; reason: 'unsupported'; message: string }

function resolveLiveQuoteInput(rawSymbol: string): ResolvedLiveQuoteInput {
  const raw = rawSymbol.trim().toUpperCase()
  if (!raw) {
    return { ok: false, reason: 'unsupported', message: 'Symbol is required' }
  }

  if (looksLikeDirectTicker(raw)) {
    return { ok: true, ticker: raw, canonical: raw }
  }

  const alias = normalizeMarketAlias(raw)
  if (UNSUPPORTED_MARKET_ALIASES.has(alias)) {
    return {
      ok: false,
      reason: 'unsupported',
      message:
        'GIFT NIFTY direct live quote is not available from our current feeds (Angel + Yahoo). You can use NIFTY as a proxy.',
    }
  }

  const mapped = INDEX_ALIAS_TICKERS[alias]
  if (mapped) {
    return { ok: true, ticker: mapped.ticker, canonical: mapped.canonical }
  }

  return { ok: true, ticker: yahooSymbol(raw), canonical: raw }
}

export interface LiveMarketQuote {
  symbol: string
  ticker: string
  name: string
  price: number
  previousClose: number | null
  change: number | null
  changePercent: number | null
  currency: string | null
  exchange: string | null
  quoteType: string | null
  source: 'yahoo-quote'
}

export type LiveMarketQuoteResult =
  | { ok: true; quote: LiveMarketQuote }
  | { ok: false; reason: 'unsupported' | 'not_found' | 'error'; message: string }

export async function fetchLiveMarketQuote(rawSymbol: string): Promise<LiveMarketQuoteResult> {
  const resolved = resolveLiveQuoteInput(rawSymbol)
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, message: resolved.message }
  }

  try {
    const q: any = await yahooFinance.quote(resolved.ticker, {}, { validateResult: false })
    if (!q || typeof q.regularMarketPrice !== 'number') {
      return { ok: false, reason: 'not_found', message: `No live quote found for ${rawSymbol}` }
    }

    return {
      ok: true,
      quote: {
        symbol: resolved.canonical,
        ticker: String(q.symbol || resolved.ticker).toUpperCase(),
        name: q.shortName ?? q.longName ?? resolved.canonical,
        price: Number(q.regularMarketPrice),
        previousClose:
          typeof q.regularMarketPreviousClose === 'number' ? Number(q.regularMarketPreviousClose) : null,
        change: typeof q.regularMarketChange === 'number' ? Number(q.regularMarketChange) : null,
        changePercent:
          typeof q.regularMarketChangePercent === 'number' ? Number(q.regularMarketChangePercent) : null,
        currency: typeof q.currency === 'string' ? q.currency : null,
        exchange: typeof q.exchange === 'string' ? q.exchange : null,
        quoteType: typeof q.quoteType === 'string' ? q.quoteType : null,
        source: 'yahoo-quote',
      },
    }
  } catch (error: any) {
    return {
      ok: false,
      reason: 'error',
      message: error?.message ? String(error.message) : `Quote fetch failed for ${rawSymbol}`,
    }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QuoteData {
  symbol: string
  yahooTicker: string
  name: string
  price: number
  previousClose: number
  changePercent: number
  change: number
  volume: number
  avgVolume: number
  marketCap: number | null
  fiftyTwoWeekHigh: number
  fiftyTwoWeekLow: number
  peRatio: number | null
  source: 'yahoo-batch'
}

export interface OHLCVCandle {
  timestamp: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface ComputedIndicators {
  ema12: number | null
  ema26: number | null
  sma20: number | null
  sma50: number | null
  sma200: number | null
  rsi14: number | null
  macd: number | null
  macdSignal: number | null
  macdHist: number | null
  stochK: number | null
  stochD: number | null
  adx: number | null
  plusDI: number | null
  minusDI: number | null
  cci: number | null
  roc: number | null
  vwap: number | null
  supertrend: number | null
  supertrendDirection: number | null
  bbUpper: number | null
  bbMiddle: number | null
  bbLower: number | null
  atr14: number | null
  latestClose: number | null
  latestHigh: number | null
  latestLow: number | null
  latestVolume: number | null
  candleCount: number
  periodStart: Date | null
  periodEnd: Date | null
}

// ── Batch Quote (top movers) ──────────────────────────────────────────────────

export async function batchQuote(symbols: string[]): Promise<QuoteData[]> {
  const tickers = symbols.map(yahooSymbol)

  const results = await yahooFinance.quote(tickers, {}, { validateResult: false })
  const quotesData = Array.isArray(results) ? results : [results];

  // Find which symbols returned no price — retry those with .BO
  const foundTickers = new Set(
    quotesData
      .filter((q: any) => typeof q.regularMarketPrice === 'number')
      .map((q: any) => q.symbol.replace(/\.(NS|BO)$/i, '').toUpperCase())
  )
  const missing = symbols.filter(s => !foundTickers.has(s.toUpperCase()))
  let boQuotes: any[] = []
  if (missing.length > 0) {
    const boTickers = missing.map(s => `${s.toUpperCase().replace(/\.(NS|BO)$/i, '')}.BO`)
    try {
      const boResults = await yahooFinance.quote(boTickers, {}, { validateResult: false })
      boQuotes = Array.isArray(boResults) ? boResults : [boResults]
    } catch { /* ignore */ }
  }

  const allQuotes = [...quotesData, ...boQuotes]
  const seenSymbols = new Set<string>()
  const quotes: QuoteData[] = allQuotes
    .filter((q: any) => typeof q.regularMarketPrice === 'number')
    .filter((q: any) => {
      const base = q.symbol.replace(/\.(NS|BO)$/i, '').toUpperCase()
      if (seenSymbols.has(base)) return false
      seenSymbols.add(base)
      return true
    })
    .map((q: any) => {
      const originalSymbol = q.symbol.replace(/\.NS$/i, '').replace(/\.BO$/i, '')
      return {
        symbol: originalSymbol,
        yahooTicker: q.symbol,
        name: q.shortName ?? q.longName ?? originalSymbol,
        price: q.regularMarketPrice,
        previousClose: q.regularMarketPreviousClose ?? q.regularMarketPrice,
        changePercent: q.regularMarketChangePercent ?? 0,
        change: q.regularMarketChange ?? 0,
        volume: q.regularMarketVolume ?? 0,
        avgVolume: q.averageVolume ?? 0,
        marketCap: q.marketCap ?? null,
        fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? 0,
        fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? 0,
        peRatio: q.trailingPE ?? null,
        source: 'yahoo-batch' as const,
      }
    })

  return quotes.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
}

// ── OHLCV Candles ─────────────────────────────────────────────────────────────

export type YahooRange = '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y'
export type YahooInterval = '1d' | '1wk' | '1mo'

function buildCandleBucketKey(date: Date, interval: YahooInterval): string {
  if (interval === '1d') return date.toISOString().slice(0, 10)
  return date.toISOString()
}

function sanitizeChartQuotes(rows: any[], interval: YahooInterval): OHLCVCandle[] {
  const deduped = new Map<string, OHLCVCandle>()

  for (const row of rows || []) {
    const timestamp = row?.date instanceof Date ? row.date : new Date(row?.date)
    if (
      row?.open == null ||
      row?.high == null ||
      row?.low == null ||
      row?.close == null
    ) {
      continue
    }

    const open = Number(row.open)
    const high = Number(row.high)
    const low = Number(row.low)
    const close = Number(row.close)
    const volume = Number(row?.volume ?? 0)

    if (
      Number.isNaN(timestamp.getTime()) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      high < Math.max(open, close) ||
      low > Math.min(open, close)
    ) {
      continue
    }

    deduped.set(buildCandleBucketKey(timestamp, interval), {
      timestamp,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    })
  }

  return Array.from(deduped.values()).sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
}

async function fetchChartCandles(
  ticker: string,
  period1: Date,
  period2: Date,
  interval: YahooInterval
): Promise<OHLCVCandle[]> {
  const result: any = await yahooFinance.chart(
    ticker,
    { period1, period2, interval, return: 'array' },
    { validateResult: false }
  )

  return sanitizeChartQuotes(Array.isArray(result?.quotes) ? result.quotes : [], interval)
}

export async function fetchOHLCV(
  symbol: string,
  range: YahooRange = '3mo',
  interval: YahooInterval = '1d'
): Promise<OHLCVCandle[]> {
  const now = new Date();
  let period1 = new Date();
  if (range === '1mo') period1.setMonth(now.getMonth() - 1);
  else if (range === '3mo') period1.setMonth(now.getMonth() - 3);
  else if (range === '6mo') period1.setMonth(now.getMonth() - 6);
  else if (range === '1y') period1.setFullYear(now.getFullYear() - 1);
  else if (range === '2y') period1.setFullYear(now.getFullYear() - 2);
  else if (range === '5y') period1.setFullYear(now.getFullYear() - 5);
  else period1.setMonth(now.getMonth() - 3);

  // Use chart() directly instead of historical(): Yahoo often emits partial/null
  // rows for the current candle, and chart() lets us sanitize and dedupe them.
  const nsTicker = yahooSymbol(symbol)
  try {
    const candles = await fetchChartCandles(nsTicker, period1, now, interval)
    if (candles.length > 0) return candles
  } catch {
    // .NS failed — fall through to .BO retry.
  }

  const boTicker = `${symbol.toUpperCase().replace(/\.(NS|BO)$/i, '')}.BO`
  try {
    return await fetchChartCandles(boTicker, period1, now, interval)
  } catch {
    return []
  }
}

// ── Indicator Computation ─────────────────────────────────────────────────────

function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const ema: number[] = []
  if (values.length < period) return new Array(values.length).fill(NaN)
  // Proper seeding: SMA of the first `period` values (Wilder's method)
  // Old approach seeded with just the first value — caused EMA drift for small datasets
  for (let i = 0; i < period - 1; i++) ema.push(NaN)
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  ema.push(prev)
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    ema.push(prev)
  }
  return ema
}

function calcSMA(values: number[], period: number): number[] {
  const sma: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { sma.push(NaN); continue }
    const slice = values.slice(i - period + 1, i + 1)
    sma.push(slice.reduce((a, b) => a + b, 0) / period)
  }
  return sma
}

function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(period).fill(NaN)
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) avgGain += diff / period
    else avgLoss += Math.abs(diff) / period
  }
  if (avgLoss === 0) { rsi.push(100); }
  else rsi.push(100 - 100 / (1 + avgGain / avgLoss))

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? Math.abs(diff) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    if (avgLoss === 0) rsi.push(100)
    else rsi.push(100 - 100 / (1 + avgGain / avgLoss))
  }
  return rsi
}

function calcATR(candles: OHLCVCandle[], period = 14): number[] {
  const tr: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i]
    const prevClose = candles[i - 1].close
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)))
  }
  const atr: number[] = new Array(period).fill(NaN)
  let sum = tr.slice(0, period).reduce((a, b) => a + b, 0)
  atr.push(sum / period)
  for (let i = period; i < tr.length; i++) {
    const prev = atr[atr.length - 1]
    atr.push((prev * (period - 1) + tr[i]) / period)
  }
  return atr
}

export function computeIndicators(candles: OHLCVCandle[]): ComputedIndicators {
  if (candles.length === 0) {
    return {
      ema12: null, ema26: null, sma20: null, sma50: null, sma200: null,
      rsi14: null, macd: null, macdSignal: null, macdHist: null,
      stochK: null, stochD: null, adx: null, plusDI: null, minusDI: null,
      cci: null, roc: null, vwap: null, supertrend: null, supertrendDirection: null,
      bbUpper: null, bbMiddle: null, bbLower: null, atr14: null,
      latestClose: null, latestHigh: null, latestLow: null, latestVolume: null,
      candleCount: 0, periodStart: null, periodEnd: null,
    }
  }

  const closes = candles.map((c) => c.close)
  const n = closes.length
  const last = candles[n - 1]

  const ema12Arr = calcEMA(closes, 12)
  const ema26Arr = calcEMA(closes, 26)

  const macdLine = ema12Arr.map((v, i) => v - ema26Arr[i])
  const macdSignalArr = calcEMA(macdLine.slice(25), 9)

  const sma20Arr = calcSMA(closes, 20)
  const sma50Arr = calcSMA(closes, 50)
  const sma200Arr = calcSMA(closes, 200)

  const rsiArr = calcRSI(closes, 14)

  const bbMiddleArr = calcSMA(closes, 20)
  const bbUpperArr: number[] = [], bbLowerArr: number[] = []
  for (let i = 0; i < n; i++) {
    if (i < 19) { bbUpperArr.push(NaN); bbLowerArr.push(NaN); continue }
    const slice = closes.slice(i - 19, i + 1)
    const mean = bbMiddleArr[i]
    const std = Math.sqrt(slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / 20)
    bbUpperArr.push(mean + 2 * std)
    bbLowerArr.push(mean - 2 * std)
  }

  const atrArr = calcATR(candles, 14)

  const lastValid = (arr: number[]) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (!isNaN(arr[i]) && arr[i] !== undefined) return arr[i]
    }
    return null
  }

  const macdVal = lastValid(macdLine)
  const macdSigVal = macdSignalArr.length ? lastValid(macdSignalArr) : null
  let extended: Record<string, any> = {}
  try {
    extended = technicalIndicatorsService.calculateLiveSnapshot(candles as any) as Record<string, any>
  } catch {
    extended = {}
  }
  const safeNum = (v: unknown): number | null => {
    if (v === null || v === undefined) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  return {
    ema12: lastValid(ema12Arr),
    ema26: lastValid(ema26Arr),
    sma20: lastValid(sma20Arr),
    sma50: lastValid(sma50Arr),
    sma200: lastValid(sma200Arr),
    rsi14: lastValid(rsiArr),
    macd: macdVal,
    macdSignal: macdSigVal,
    macdHist: macdVal != null && macdSigVal != null ? macdVal - macdSigVal : null,
    stochK: safeNum(extended.stochK),
    stochD: safeNum(extended.stochD),
    adx: safeNum(extended.adx),
    plusDI: safeNum(extended.plusDI),
    minusDI: safeNum(extended.minusDI),
    cci: safeNum(extended.cci),
    roc: safeNum(extended.roc),
    vwap: safeNum(extended.vwap),
    supertrend: safeNum(extended.supertrend),
    supertrendDirection: safeNum(extended.supertrendDirection),
    bbUpper: lastValid(bbUpperArr),
    bbMiddle: lastValid(bbMiddleArr),
    bbLower: lastValid(bbLowerArr),
    atr14: lastValid(atrArr),
    latestClose: last.close,
    latestHigh: last.high,
    latestLow: last.low,
    latestVolume: last.volume,
    candleCount: n,
    periodStart: candles[0].timestamp,
    periodEnd: last.timestamp,
  }
}

// ── Symbol Search (name → NSE symbol) ───────────────────────────────────────

export interface SymbolSearchResult {
  symbol: string   // NSE symbol without .NS, e.g. "REDINGTON"
  fullTicker: string // e.g. "REDINGTON.NS"
  name: string
  exchange: string
}

export async function searchSymbol(query: string): Promise<SymbolSearchResult[]> {
  const seen = new Set<string>()
  const results: SymbolSearchResult[] = []
  const closest = await resolveClosestStocks(query, 5)

  const pushYahooQuotes = (quotes: any[]) => {
    for (const q of quotes) {
      const baseSymbol = q.symbol.replace(/\.(NS|BO)$/i, '').toUpperCase()
      if (!baseSymbol || seen.has(baseSymbol)) continue
      seen.add(baseSymbol)
      results.push({
        symbol: baseSymbol,
        fullTicker: `${baseSymbol}.NS`,  // always use .NS for analysis
        name: q.longname ?? q.shortname ?? q.symbol,
        exchange: 'NSE',
      })
    }
  }

  const pushClosestMatches = (matches: typeof closest) => {
    for (const match of matches) {
      if (seen.has(match.symbol)) continue
      seen.add(match.symbol)
      results.push({
        symbol: match.symbol,
        fullTicker: `${match.symbol}.NS`,
        name: match.name,
        exchange: match.exchange === 'BSE' ? 'BSE' : 'NSE',
      })
      if (results.length >= 5) break
    }
  }

  const strongClosest = closest.filter((match) => match.score >= 118)
  if (strongClosest.length > 0) {
    pushClosestMatches(strongClosest)
  }

  const candidates = buildStockQueryCandidates(query)
  for (const candidate of candidates.slice(0, 4)) {
    if (results.length >= 5) break
    try {
      const r = await yahooFinance.search(candidate, {}, { validateResult: false })
      const quotes = ((r as any).quotes as any[] || []).filter((q: any) =>
        q.isYahooFinance &&
        (q.quoteType === 'EQUITY' || q.quoteType === 'equity') &&
        (
          q.symbol?.endsWith('.NS') || q.exchange === 'NSI' ||   // NSE
          q.symbol?.endsWith('.BO') || q.exchange === 'BSE'       // BSE (dual-listed — convert to .NS)
        )
      )
      pushYahooQuotes(quotes)
      if (results.length >= 5) break
    } catch {
      // Ignore Yahoo search errors for specific candidate phrases.
    }
  }

  if (results.length < 5) {
    pushClosestMatches(closest)
  }

  return results
}

// ── Range mapper ──────────────────────────────────────────────────────────────

export function mapTimeframeToYahoo(timeframe: string): {
  yahooRange: YahooRange
  minDbRows: number
  label: string
} {
  const t = timeframe.toLowerCase()
  if (/7\s*day|1\s*week|7\s*din/.test(t)) return { yahooRange: '1mo', minDbRows: 7, label: '1 week' }
  if (/1\s*month|30\s*day|1\s*mahina/.test(t)) return { yahooRange: '1mo', minDbRows: 20, label: '1 month' }
  if (/3\s*month|90\s*day/.test(t)) return { yahooRange: '3mo', minDbRows: 60, label: '3 months' }
  if (/6\s*month|180\s*day/.test(t)) return { yahooRange: '6mo', minDbRows: 120, label: '6 months' }
  if (/1\s*year|12\s*month|1\s*saal/.test(t)) return { yahooRange: '1y', minDbRows: 250, label: '1 year' }
  if (/2\s*year/.test(t)) return { yahooRange: '2y', minDbRows: 500, label: '2 years' }
  return { yahooRange: '3mo', minDbRows: 60, label: '3 months' }
}

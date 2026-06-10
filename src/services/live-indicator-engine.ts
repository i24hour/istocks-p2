import { technicalIndicatorsService } from '@/services/technical-indicators.service'

type Candle = {
  timestamp: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type IndicatorSnapshot = {
  symbol: string
  timeframe: '1m'
  lastTickAt: string
  currentPrice: number
  source: 'live' | 'ec2-seed' | 'ec2-seed+live'
  indicators: {
    sma20?: number
    sma50?: number
    sma200?: number
    ema12?: number
    ema26?: number
    macd?: number
    macdSignal?: number
    macdHistogram?: number
    adx?: number
    plusDI?: number
    minusDI?: number
    rsi?: number
    stochK?: number
    stochD?: number
    cci?: number
    williamsR?: number
    roc?: number
    bbUpper?: number
    bbMiddle?: number
    bbLower?: number
    atr?: number
    obv?: number
    vwap?: number
    forceIndex?: number
    adLine?: number
    supertrend?: number
    supertrendDirection?: number
  }
  readiness: {
    candles: number
    minNeededForCore: number
    isCoreReady: boolean
    ec2SeedCandles: number
    liveTicks: number
  }
}

type SymbolState = {
  candles: Candle[]
  currentCandle: Candle | null
  lastTickAt: Date | null
  lastPrice: number | null
  snapshot: IndicatorSnapshot | null
  ec2SeedCount: number
  liveTickCount: number
}

const MAX_CANDLES = Number(process.env.LIVE_INDICATOR_MAX_CANDLES || 500)
const POLL_MS = Number(process.env.LIVE_INDICATOR_POLL_MS || 2000)
const EC2_SEED_CANDLES = Number(process.env.LIVE_INDICATOR_EC2_SEED || 300)
const MIN_CORE_CANDLES = 26
const EC2_BASE_URL = process.env.EC2_LIVE_SERVER_URL || 'http://3.109.208.28:8080'

function minuteBucket(date: Date): number {
  return Math.floor(date.getTime() / 60000) * 60000
}

function sanitizeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) return undefined
  return value
}

class LiveIndicatorEngine {
  private states = new Map<string, SymbolState>()
  private started = false
  private seeded = false
  private seedPromise: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null

  /**
   * Start the engine. On first call (cold start), seeds from EC2 live candles
   * so indicators like RSI are immediately available without waiting 14+ minutes.
   * Never seeds from DB — only real intraday 1-min candles from EC2.
   */
  async ensureStarted() {
    if (this.started) return

    // Seed from EC2 live candles first (only once)
    if (!this.seeded && !this.seedPromise) {
      this.seedPromise = this.seedFromEC2().catch((err) => {
        console.error('EC2 seed failed (non-fatal, will rely on live ticks):', err)
      })
    }

    if (this.seedPromise) {
      await this.seedPromise
      this.seedPromise = null
    }

    this.started = true
    this.timer = setInterval(() => {
      this.pollLivePrices().catch((error) => {
        console.error('Live indicator poll failed:', error)
      })
    }, POLL_MS)

    this.pollLivePrices().catch((error) => {
      console.error('Initial live indicator poll failed:', error)
    })
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.started = false
  }

  getSnapshot(symbol?: string) {
    if (symbol) {
      const state = this.states.get(symbol)
      return state?.snapshot || null
    }

    return Array.from(this.states.values())
      .map(s => s.snapshot)
      .filter(Boolean)
      .sort((a, b) => (a?.symbol || '').localeCompare(b?.symbol || ''))
  }

  /**
   * Load last N intraday 1-min candles from EC2 for each symbol that has live data.
   * This gives the indicator engine enough history to compute RSI (14), MACD (33),
   * SMA50, etc. immediately on cold start — using REAL live candles, never DB.
   */
  private async seedFromEC2() {
    if (this.seeded) return
    this.seeded = true

    // Fetch the live prices first to know which symbols are active
    let activeSymbols: string[] = []
    try {
      const res = await fetch(`${EC2_BASE_URL}/prices`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const body = await res.json()
        if (body?.success && body?.data) {
          activeSymbols = Object.keys(body.data as Record<string, unknown>).map(s => s.toUpperCase().trim())
        }
      }
    } catch {
      console.warn('EC2 /prices unavailable during seed — engine will populate from live ticks only')
      return
    }

    if (activeSymbols.length === 0) {
      console.warn('No active symbols from EC2 /prices — skipping EC2 seed')
      return
    }

    // Seed each symbol from EC2 /candles
    for (const symbol of activeSymbols) {
      try {
        const url = `${EC2_BASE_URL}/candles?symbol=${encodeURIComponent(symbol)}&interval=ONE_MINUTE&count=${EC2_SEED_CANDLES}`
        const res = await fetch(url, {
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) continue
        const body = await res.json()
        if (!body?.success || !body?.data || body.data.length === 0) continue

        const rows: Candle[] = body.data.map((c: any) => ({
          timestamp: new Date(c.timestamp),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
          volume: Number(c.volume),
        }))

        // rows are already in chronological order from EC2
        const state = this.getState(symbol)
        state.ec2SeedCount = rows.length

        // Load all as completed candles except the last (which becomes currentCandle)
        for (let i = 0; i < rows.length; i++) {
          if (i < rows.length - 1) {
            state.candles.push(rows[i])
          } else {
            state.currentCandle = rows[i]
            state.lastTickAt = rows[i].timestamp
            state.lastPrice = rows[i].close
          }
        }

        // Trim if over max
        if (state.candles.length > MAX_CANDLES) {
          state.candles = state.candles.slice(-MAX_CANDLES)
        }

        this.refreshSnapshot(symbol, state)
        console.log(`🌱 Seeded ${symbol}: ${rows.length} EC2 candles → RSI=${state.snapshot?.indicators.rsi?.toFixed(2) ?? 'N/A'}`)
      } catch (err) {
        console.warn(`EC2 seed failed for ${symbol}:`, err)
      }
    }
  }

  private getState(symbol: string): SymbolState {
    if (!this.states.has(symbol)) {
      this.states.set(symbol, {
        candles: [],
        currentCandle: null,
        lastTickAt: null,
        lastPrice: null,
        snapshot: null,
        ec2SeedCount: 0,
        liveTickCount: 0,
      })
    }
    return this.states.get(symbol)!
  }

  private async pollLivePrices() {
    try {
      const response = await fetch(`${EC2_BASE_URL}/prices`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })

      if (!response.ok) return

      const body = await response.json()
      if (!body?.success || !body?.data) return

      const now = new Date()
      const entries = Object.entries(body.data as Record<string, any>)

      for (const [rawSymbol, payload] of entries) {
        const symbol = String(rawSymbol || '').toUpperCase().trim()
        const ltp = typeof payload?.ltp === 'number' ? payload.ltp : null
        if (!symbol || ltp === null) continue
        this.consumeTick(symbol, ltp, now)
      }
    } catch {
      // Silently ignore poll failures - EC2 might be down or market closed
    }
  }

  private consumeTick(symbol: string, price: number, now: Date) {
    const state = this.getState(symbol)
    state.lastTickAt = now
    state.lastPrice = price
    state.liveTickCount++

    const bucket = minuteBucket(now)

    if (!state.currentCandle) {
      state.currentCandle = {
        timestamp: new Date(bucket),
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
      }
      this.refreshSnapshot(symbol, state)
      return
    }

    const currentBucket = minuteBucket(state.currentCandle.timestamp)

    if (bucket === currentBucket) {
      state.currentCandle.high = Math.max(state.currentCandle.high, price)
      state.currentCandle.low = Math.min(state.currentCandle.low, price)
      state.currentCandle.close = price
      this.refreshSnapshot(symbol, state)
      return
    }

    // Candle rollover
    state.candles.push(state.currentCandle)
    if (state.candles.length > MAX_CANDLES) {
      state.candles = state.candles.slice(-MAX_CANDLES)
    }

    state.currentCandle = {
      timestamp: new Date(bucket),
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
    }

    this.refreshSnapshot(symbol, state)
  }

  private refreshSnapshot(symbol: string, state: SymbolState) {
    if (!state.currentCandle || !state.lastTickAt || state.lastPrice === null) return

    const merged = [...state.candles, state.currentCandle]
    const indicatorsArray = technicalIndicatorsService.calculateAllIndicators(merged as any)
    const latest = indicatorsArray[indicatorsArray.length - 1] || {}

    const source: IndicatorSnapshot['source'] =
      state.liveTickCount > 0 && state.ec2SeedCount > 0 ? 'ec2-seed+live'
        : state.ec2SeedCount > 0 ? 'ec2-seed'
          : 'live'

    state.snapshot = {
      symbol,
      timeframe: '1m',
      lastTickAt: state.lastTickAt.toISOString(),
      currentPrice: state.lastPrice,
      source,
      indicators: {
        sma20: sanitizeNumber((latest as any).sma20),
        sma50: sanitizeNumber((latest as any).sma50),
        sma200: sanitizeNumber((latest as any).sma200),
        ema12: sanitizeNumber((latest as any).ema12),
        ema26: sanitizeNumber((latest as any).ema26),
        macd: sanitizeNumber((latest as any).macd),
        macdSignal: sanitizeNumber((latest as any).macdSignal),
        macdHistogram: sanitizeNumber((latest as any).macdHistogram),
        adx: sanitizeNumber((latest as any).adx),
        plusDI: sanitizeNumber((latest as any).plusDI),
        minusDI: sanitizeNumber((latest as any).minusDI),
        rsi: sanitizeNumber((latest as any).rsi),
        stochK: sanitizeNumber((latest as any).stochK),
        stochD: sanitizeNumber((latest as any).stochD),
        cci: sanitizeNumber((latest as any).cci),
        williamsR: sanitizeNumber((latest as any).williamsR),
        roc: sanitizeNumber((latest as any).roc),
        bbUpper: sanitizeNumber((latest as any).bbUpper),
        bbMiddle: sanitizeNumber((latest as any).bbMiddle),
        bbLower: sanitizeNumber((latest as any).bbLower),
        atr: sanitizeNumber((latest as any).atr),
        obv: typeof (latest as any).obv === 'bigint' ? Number((latest as any).obv) : sanitizeNumber((latest as any).obv),
        vwap: sanitizeNumber((latest as any).vwap),
        forceIndex: sanitizeNumber((latest as any).forceIndex),
        adLine: sanitizeNumber((latest as any).adLine),
        supertrend: sanitizeNumber((latest as any).supertrend),
        supertrendDirection: sanitizeNumber((latest as any).supertrendDirection),
      },
      readiness: {
        candles: merged.length,
        minNeededForCore: MIN_CORE_CANDLES,
        isCoreReady: merged.length >= MIN_CORE_CANDLES,
        ec2SeedCandles: state.ec2SeedCount,
        liveTicks: state.liveTickCount,
      },
    }
  }
}

const globalForLiveIndicator = globalThis as unknown as {
  liveIndicatorEngine?: LiveIndicatorEngine
}

export const liveIndicatorEngine = globalForLiveIndicator.liveIndicatorEngine || new LiveIndicatorEngine()
// Preserve instance across hot-reloads in ALL environments (critical for Vercel serverless)
globalForLiveIndicator.liveIndicatorEngine = liveIndicatorEngine

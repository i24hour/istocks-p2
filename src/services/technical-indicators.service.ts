import {
  SMA,
  EMA,
  WMA,
  MACD,
  RSI,
  BollingerBands,
  ATR,
  Stochastic,
  ADX,
  CCI,
  WilliamsR,
  ROC,
  OBV,
  VWAP as VWAPIndicator,
  ForceIndex,
  ADL,
  AwesomeOscillator,
  MFI,
  KeltnerChannels,
  TRIX,
  KST,
  PSAR,
  IchimokuCloud,
  SD,
} from 'technicalindicators'

interface PriceData {
  timestamp: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface CalculatedIndicators {
  // Moving Averages
  sma20?: number
  sma50?: number
  sma200?: number
  ema12?: number
  ema26?: number
  wma20?: number
  dema20?: number
  tema20?: number
  hma20?: number
  vwma20?: number
  // MACD
  macd?: number
  macdSignal?: number
  macdHistogram?: number
  // Momentum
  rsi?: number
  stochK?: number
  stochD?: number
  williamsR?: number
  roc?: number
  ao?: number
  uo?: number    // Ultimate Oscillator — computed manually
  cmo?: number
  tsi?: number
  ppo?: number
  dpo?: number
  // Trend
  cci?: number
  adx?: number
  plusDI?: number
  minusDI?: number
  trix?: number
  kst?: number
  kstSignal?: number
  aroonUp?: number
  aroonDown?: number
  aroonOsc?: number
  psar?: number
  psarSignal?: number  // 1 = bullish, -1 = bearish
  ichimokuConv?: number
  ichimokuBase?: number
  ichimokuLeadA?: number
  ichimokuLeadB?: number
  ichimokuLagging?: number
  supertrend?: number
  supertrendDirection?: number
  // Volatility / Channels
  bbUpper?: number
  bbMiddle?: number
  bbLower?: number
  atr?: number
  kcUpper?: number
  kcMiddle?: number
  kcLower?: number
  dcUpper?: number
  dcMiddle?: number
  dcLower?: number
  stdDev20?: number
  // Volume
  obv?: bigint
  vwap?: number
  forceIndex?: number
  adLine?: number
  mfi?: number
  cmf?: number
  pvt?: number
  eom?: number
}

// ── Pure-TS helpers for indicators not in the `technicalindicators` package ──

function calcWMA(closes: number[], w: number): number | undefined {
  if (closes.length < w) return undefined
  const slice = closes.slice(-w)
  let num = 0, den = 0
  for (let i = 0; i < w; i++) { num += slice[i] * (i + 1); den += (i + 1) }
  return num / den
}

function calcDEMA(closes: number[], w: number): number | undefined {
  if (closes.length < w * 2) return undefined
  const ema1 = EMA.calculate({ period: w, values: closes })
  if (ema1.length < w) return undefined
  const ema2 = EMA.calculate({ period: w, values: ema1 })
  const v1 = ema1[ema1.length - 1]; const v2 = ema2[ema2.length - 1]
  if (v1 == null || v2 == null) return undefined
  return 2 * v1 - v2
}

function calcTEMA(closes: number[], w: number): number | undefined {
  if (closes.length < w * 3) return undefined
  const ema1 = EMA.calculate({ period: w, values: closes })
  if (ema1.length < w) return undefined
  const ema2 = EMA.calculate({ period: w, values: ema1 })
  if (ema2.length < w) return undefined
  const ema3 = EMA.calculate({ period: w, values: ema2 })
  const v1 = ema1[ema1.length - 1]; const v2 = ema2[ema2.length - 1]; const v3 = ema3[ema3.length - 1]
  if (v1 == null || v2 == null || v3 == null) return undefined
  return 3 * v1 - 3 * v2 + v3
}

function calcHMA(closes: number[], w: number): number | undefined {
  const half = Math.max(Math.floor(w / 2), 1)
  const sqrtW = Math.max(Math.round(Math.sqrt(w)), 1)
  const wmaFull = calcWMA(closes, w)
  const wmaHalf = calcWMA(closes, half)
  if (wmaFull == null || wmaHalf == null) return undefined
  // We need a series of (2*wma_half - wma_full) values, but for last value only we approximate:
  if (closes.length < w + sqrtW) return undefined
  const raw: number[] = []
  for (let i = sqrtW - 1; i < closes.length; i++) {
    const sl = closes.slice(0, i + 1)
    const wh = calcWMA(sl, Math.min(half, sl.length))
    const wf = calcWMA(sl, Math.min(w, sl.length))
    if (wh != null && wf != null) raw.push(2 * wh - wf)
  }
  return calcWMA(raw, Math.min(sqrtW, raw.length))
}

function calcVWMA(closes: number[], vols: number[], w: number): number | undefined {
  if (closes.length < w) return undefined
  const cs = closes.slice(-w); const vs = vols.slice(-w)
  let pv = 0, v = 0
  for (let i = 0; i < w; i++) { pv += cs[i] * vs[i]; v += vs[i] }
  return v === 0 ? undefined : pv / v
}

function calcAroon(highs: number[], lows: number[], w: number) {
  if (highs.length < w + 1) return { up: undefined, down: undefined, osc: undefined }
  const h = highs.slice(-(w + 1)); const l = lows.slice(-(w + 1))
  let hiIdx = 0, loIdx = 0
  for (let i = 1; i <= w; i++) { if (h[i] > h[hiIdx]) hiIdx = i; if (l[i] < l[loIdx]) loIdx = i }
  const up = ((hiIdx) / w) * 100
  const dn = ((loIdx) / w) * 100
  return { up, down: dn, osc: up - dn }
}

function calcCMO(closes: number[], w: number): number | undefined {
  if (closes.length < w + 1) return undefined
  const sl = closes.slice(-(w + 1))
  let up = 0, dn = 0
  for (let i = 1; i <= w; i++) {
    const d = sl[i] - sl[i - 1]
    if (d > 0) up += d; else dn += Math.abs(d)
  }
  return up + dn === 0 ? 0 : 100 * (up - dn) / (up + dn)
}

function calcTSI(closes: number[], r = 25, s = 13): number | undefined {
  if (closes.length < r + s + 1) return undefined
  const diff: number[] = []
  for (let i = 1; i < closes.length; i++) diff.push(closes[i] - closes[i - 1])
  const absDiff = diff.map(Math.abs)
  const ema1 = EMA.calculate({ period: r, values: diff })
  const ema2 = EMA.calculate({ period: s, values: ema1 })
  const absEma1 = EMA.calculate({ period: r, values: absDiff })
  const absEma2 = EMA.calculate({ period: s, values: absEma1 })
  const n = ema2[ema2.length - 1]; const d = absEma2[absEma2.length - 1]
  return d == null || d === 0 ? undefined : 100 * n / d
}

function calcPPO(closes: number[], fast = 12, slow = 26): number | undefined {
  if (closes.length < slow) return undefined
  const emaF = EMA.calculate({ period: fast, values: closes })
  const emaS = EMA.calculate({ period: slow, values: closes })
  const f = emaF[emaF.length - 1]; const s = emaS[emaS.length - 1]
  return s == null || s === 0 ? undefined : (f - s) / s * 100
}

function calcDPO(closes: number[], w = 20): number | undefined {
  const shift = Math.floor(w / 2) + 1
  if (closes.length < w + shift) return undefined
  const smaIdx = closes.length - 1 - shift
  const smaSlice = closes.slice(smaIdx - w + 1, smaIdx + 1)
  const smaVal = smaSlice.reduce((a, b) => a + b, 0) / w
  return closes[closes.length - 1 - shift] - smaVal
}

function calcUO(highs: number[], lows: number[], closes: number[], w1 = 7, w2 = 14, w3 = 28): number | undefined {
  const n = closes.length
  if (n < w3 + 1) return undefined
  const bp: number[] = []; const tr: number[] = []
  for (let i = 1; i < n; i++) {
    const pc = closes[i - 1]
    const minLC = Math.min(lows[i], pc); const maxHC = Math.max(highs[i], pc)
    bp.push(closes[i] - minLC)
    tr.push(maxHC - minLC)
  }
  const sumBP = (a: number[], s: number, e: number) => a.slice(s, e).reduce((x, y) => x + y, 0)
  const sumTR = (a: number[], s: number, e: number) => a.slice(s, e).reduce((x, y) => x + y, 0)
  const e = bp.length
  const avg1 = sumBP(bp, e - w1, e) / sumTR(tr, e - w1, e)
  const avg2 = sumBP(bp, e - w2, e) / sumTR(tr, e - w2, e)
  const avg3 = sumBP(bp, e - w3, e) / sumTR(tr, e - w3, e)
  return 100 * (4 * avg1 + 2 * avg2 + avg3) / 7
}

function calcCMF(highs: number[], lows: number[], closes: number[], vols: number[], w = 20): number | undefined {
  if (closes.length < w) return undefined
  let pvol = 0, vol = 0
  for (let i = closes.length - w; i < closes.length; i++) {
    const hl = highs[i] - lows[i]
    if (hl === 0) continue
    const mfm = ((closes[i] - lows[i]) - (highs[i] - closes[i])) / hl
    pvol += mfm * vols[i]; vol += vols[i]
  }
  return vol === 0 ? undefined : pvol / vol
}

function calcPVT(closes: number[], vols: number[]): number {
  let pvt = 0
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] !== 0) pvt += ((closes[i] - closes[i - 1]) / closes[i - 1]) * vols[i]
  }
  return pvt
}

function calcEOM(highs: number[], lows: number[], vols: number[], w = 14): number | undefined {
  if (highs.length < w + 1) return undefined
  const eom: number[] = []
  for (let i = 1; i < highs.length; i++) {
    const dm = (highs[i] + lows[i]) / 2 - (highs[i - 1] + lows[i - 1]) / 2
    const box = vols[i] / (highs[i] - lows[i] || 1)
    eom.push(dm / box)
  }
  if (eom.length < w) return undefined
  const sl = eom.slice(-w)
  return sl.reduce((a, b) => a + b, 0) / w
}

function calcDonchian(highs: number[], lows: number[], w = 20) {
  if (highs.length < w) return { upper: undefined, middle: undefined, lower: undefined }
  const hs = highs.slice(-w); const ls = lows.slice(-w)
  const upper = Math.max(...hs); const lower = Math.min(...ls)
  return { upper, middle: (upper + lower) / 2, lower }
}

function safeLast<T>(arr: T[]): T | undefined {
  return arr.length > 0 ? arr[arr.length - 1] : undefined
}

function safeNum(v: unknown): number | undefined {
  if (v == null) return undefined
  const n = Number(v)
  return isNaN(n) ? undefined : n
}

export class TechnicalIndicatorsService {
  /**
   * calculateLiveSnapshot — efficient single-pass computation, returns only the LATEST value
   * for all 51 indicators. Used for real-time EC2 live feed queries.
   */
  calculateLiveSnapshot(data: PriceData[]): CalculatedIndicators {
    if (data.length < 2) return {}
    const closes  = data.map(d => d.close)
    const highs   = data.map(d => d.high)
    const lows    = data.map(d => d.low)
    const opens   = data.map(d => d.open)
    const volumes = data.map(d => d.volume)
    const result: CalculatedIndicators = {}

    // ── Moving Averages ──────────────────────────────────────────────────
    result.sma20  = safeNum(safeLast(SMA.calculate({ period: 20,  values: closes })))
    result.sma50  = safeNum(safeLast(SMA.calculate({ period: 50,  values: closes })))
    result.sma200 = safeNum(safeLast(SMA.calculate({ period: 200, values: closes })))
    result.ema12  = safeNum(safeLast(EMA.calculate({ period: 12,  values: closes })))
    result.ema26  = safeNum(safeLast(EMA.calculate({ period: 26,  values: closes })))
    result.wma20  = calcWMA(closes, 20)
    result.dema20 = calcDEMA(closes, 20)
    result.tema20 = calcTEMA(closes, 20)
    result.hma20  = calcHMA(closes, 20)
    result.vwma20 = calcVWMA(closes, volumes, 20)

    // ── MACD ─────────────────────────────────────────────────────────────
    const macdArr = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false })
    const macdLast = safeLast(macdArr)
    result.macd          = safeNum(macdLast?.MACD)
    result.macdSignal    = safeNum(macdLast?.signal)
    result.macdHistogram = safeNum(macdLast?.histogram)

    // ── RSI ───────────────────────────────────────────────────────────────
    result.rsi = safeNum(safeLast(RSI.calculate({ period: 14, values: closes })))

    // ── Stochastic ────────────────────────────────────────────────────────
    const stochArr = Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 })
    const stochLast = safeLast(stochArr)
    result.stochK = safeNum(stochLast?.k)
    result.stochD = safeNum(stochLast?.d)

    // ── Williams %R ───────────────────────────────────────────────────────
    result.williamsR = safeNum(safeLast(WilliamsR.calculate({ high: highs, low: lows, close: closes, period: 14 })))

    // ── ROC ───────────────────────────────────────────────────────────────
    result.roc = safeNum(safeLast(ROC.calculate({ values: closes, period: 10 })))

    // ── AO ────────────────────────────────────────────────────────────────
    result.ao = safeNum(safeLast(AwesomeOscillator.calculate({ high: highs, low: lows, fastPeriod: 5, slowPeriod: 34 })))

    // ── UO ────────────────────────────────────────────────────────────────
    result.uo = calcUO(highs, lows, closes)

    // ── CMO ───────────────────────────────────────────────────────────────
    result.cmo = calcCMO(closes, 14)

    // ── TSI ───────────────────────────────────────────────────────────────
    result.tsi = calcTSI(closes)

    // ── PPO ───────────────────────────────────────────────────────────────
    result.ppo = calcPPO(closes)

    // ── DPO ───────────────────────────────────────────────────────────────
    result.dpo = calcDPO(closes)

    // ── CCI ───────────────────────────────────────────────────────────────
    result.cci = safeNum(safeLast(CCI.calculate({ high: highs, low: lows, close: closes, period: 20 })))

    // ── ADX ───────────────────────────────────────────────────────────────
    const adxArr = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 })
    const adxLast = safeLast(adxArr)
    result.adx     = safeNum(adxLast?.adx)
    result.plusDI  = safeNum(adxLast?.pdi)
    result.minusDI = safeNum(adxLast?.mdi)

    // ── TRIX ──────────────────────────────────────────────────────────────
    result.trix = safeNum(safeLast(TRIX.calculate({ values: closes, period: 15 })))

    // ── KST ───────────────────────────────────────────────────────────────
    const kstArr = KST.calculate({ values: closes, ROCPer1: 10, ROCPer2: 13, ROCPer3: 14, ROCPer4: 15, SMAROCPer1: 10, SMAROCPer2: 13, SMAROCPer3: 14, SMAROCPer4: 15, signalPeriod: 9 })
    const kstLast = safeLast(kstArr)
    result.kst       = safeNum(kstLast?.kst)
    result.kstSignal = safeNum(kstLast?.signal)

    // ── Aroon ─────────────────────────────────────────────────────────────
    const aroon = calcAroon(highs, lows, 25)
    result.aroonUp   = aroon.up
    result.aroonDown = aroon.down
    result.aroonOsc  = aroon.osc

    // ── Parabolic SAR ─────────────────────────────────────────────────────
    const psarArr = PSAR.calculate({ high: highs, low: lows, step: 0.02, max: 0.2 })
    const psarLast = safeNum(safeLast(psarArr as number[]))
    if (psarLast != null) {
      result.psar = psarLast
      result.psarSignal = psarLast < closes[closes.length - 1] ? 1 : -1
    }

    // ── Ichimoku Cloud ────────────────────────────────────────────────────
    const ichiArr = IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 })
    const ichiLast = safeLast(ichiArr)
    result.ichimokuConv    = safeNum(ichiLast?.conversion)
    result.ichimokuBase    = safeNum(ichiLast?.base)
    result.ichimokuLeadA   = safeNum(ichiLast?.spanA)
    result.ichimokuLeadB   = safeNum(ichiLast?.spanB)
    result.ichimokuLagging = undefined // laggingSpan not in this library version

    // ── Supertrend ────────────────────────────────────────────────────────
    const stResult = this.calculateSupertrend(data, ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }), 14, 3)
    const stLast = stResult[stResult.length - 1]
    result.supertrend          = stLast?.value
    result.supertrendDirection = stLast?.direction

    // ── Bollinger Bands ───────────────────────────────────────────────────
    const bbLast = safeLast(BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 }))
    result.bbUpper  = safeNum(bbLast?.upper)
    result.bbMiddle = safeNum(bbLast?.middle)
    result.bbLower  = safeNum(bbLast?.lower)

    // ── ATR ───────────────────────────────────────────────────────────────
    result.atr = safeNum(safeLast(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 })))

    // ── Keltner Channel ───────────────────────────────────────────────────
    const kcLast = safeLast(KeltnerChannels.calculate({ high: highs, low: lows, close: closes, maPeriod: 20, atrPeriod: 10, useSMA: false, multiplier: 2 }))
    result.kcUpper  = safeNum(kcLast?.upper)
    result.kcMiddle = safeNum(kcLast?.middle)
    result.kcLower  = safeNum(kcLast?.lower)

    // ── Donchian Channel ──────────────────────────────────────────────────
    const dc = calcDonchian(highs, lows, 20)
    result.dcUpper  = dc.upper
    result.dcMiddle = dc.middle
    result.dcLower  = dc.lower

    // ── StdDev ────────────────────────────────────────────────────────────
    result.stdDev20 = safeNum(safeLast(SD.calculate({ period: 20, values: closes })))

    // ── OBV ───────────────────────────────────────────────────────────────
    const obvArr = OBV.calculate({ close: closes, volume: volumes })
    const obvLast = safeLast(obvArr)
    result.obv = obvLast != null ? BigInt(Math.round(obvLast)) : undefined

    // ── VWAP ──────────────────────────────────────────────────────────────
    const last = data[data.length - 1]
    result.vwap = last ? (last.close * last.volume) / last.volume : undefined

    // ── Force Index ───────────────────────────────────────────────────────
    result.forceIndex = safeNum(safeLast(ForceIndex.calculate({ close: closes, volume: volumes, period: 13 })))

    // ── A/D Line ──────────────────────────────────────────────────────────
    result.adLine = safeNum(safeLast(ADL.calculate({ high: highs, low: lows, close: closes, volume: volumes })))

    // ── MFI ───────────────────────────────────────────────────────────────
    result.mfi = safeNum(safeLast(MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period: 14 })))

    // ── CMF ───────────────────────────────────────────────────────────────
    result.cmf = calcCMF(highs, lows, closes, volumes)

    // ── PVT ───────────────────────────────────────────────────────────────
    result.pvt = calcPVT(closes, volumes)

    // ── EOM ───────────────────────────────────────────────────────────────
    result.eom = calcEOM(highs, lows, volumes)

    return result
  }

  private calculateSupertrend(
    data: PriceData[],
    atrValues: number[],
    atrPeriod = 14,
    multiplier = 3
  ): Array<{ value?: number; direction?: number }> {
    const output: Array<{ value?: number; direction?: number }> = Array(data.length).fill({})

    let prevFinalUpper: number | null = null
    let prevFinalLower: number | null = null
    let prevTrend: 1 | -1 = 1

    for (let i = atrPeriod; i < data.length; i++) {
      const atr = atrValues[i - atrPeriod]
      if (atr === undefined) continue

      const hl2 = (data[i].high + data[i].low) / 2
      const basicUpper = hl2 + multiplier * atr
      const basicLower = hl2 - multiplier * atr

      if (prevFinalUpper === null || prevFinalLower === null) {
        prevFinalUpper = basicUpper
        prevFinalLower = basicLower
      }

      const prevClose = data[i - 1]?.close ?? data[i].close
      const prevUpper = prevFinalUpper ?? basicUpper
      const prevLower = prevFinalLower ?? basicLower

      const finalUpper: number = (basicUpper < prevUpper || prevClose > prevUpper)
        ? basicUpper
        : prevUpper

      const finalLower: number = (basicLower > prevLower || prevClose < prevLower)
        ? basicLower
        : prevLower

      let trend: 1 | -1 = prevTrend
      if (prevTrend === 1) {
        trend = data[i].close < finalLower ? -1 : 1
      } else {
        trend = data[i].close > finalUpper ? 1 : -1
      }

      const supertrendValue = trend === 1 ? finalLower : finalUpper
      output[i] = { value: supertrendValue, direction: trend }

      prevFinalUpper = finalUpper
      prevFinalLower = finalLower
      prevTrend = trend
    }

    return output
  }

  calculateAllIndicators(data: PriceData[]): CalculatedIndicators[] {
    if (data.length < 200) {
      console.warn('Not enough data points for all indicators')
    }

    const closes = data.map(d => d.close)
    const highs = data.map(d => d.high)
    const lows = data.map(d => d.low)
    const opens = data.map(d => d.open)
    const volumes = data.map(d => d.volume)

    // Calculate indicators
    const sma20Values = SMA.calculate({ period: 20, values: closes })
    const sma50Values = SMA.calculate({ period: 50, values: closes })
    const sma200Values = SMA.calculate({ period: 200, values: closes })
    
    const ema12Values = EMA.calculate({ period: 12, values: closes })
    const ema26Values = EMA.calculate({ period: 26, values: closes })
    
    const macdValues = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    })
    
    const rsiValues = RSI.calculate({ period: 14, values: closes })
    
    const stochValues = Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
      signalPeriod: 3,
    })
    
    const bbValues = BollingerBands.calculate({
      period: 20,
      values: closes,
      stdDev: 2,
    })
    
    const atrValues = ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
    })
    
    const adxValues = ADX.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
    })
    
    const cciValues = CCI.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 20,
    })
    
    const williamsRValues = WilliamsR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
    })
    
    const rocValues = ROC.calculate({
      values: closes,
      period: 12,
    })
    
    const obvValues = OBV.calculate({
      close: closes,
      volume: volumes,
    })
    
    const forceIndexValues = ForceIndex.calculate({
      close: closes,
      volume: volumes,
      period: 13,
    })
    
    const adlValues = ADL.calculate({
      high: highs,
      low: lows,
      close: closes,
      volume: volumes,
    })

    const supertrendValues = this.calculateSupertrend(data, atrValues, 14, 3)

    // Combine all indicators
    const results: CalculatedIndicators[] = []
    
    for (let i = 0; i < data.length; i++) {
      const indicators: CalculatedIndicators = {}
      
      // Adjust indices for indicators with different starting points
      const sma20Index = i - (20 - 1)
      const sma50Index = i - (50 - 1)
      const sma200Index = i - (200 - 1)
      const ema12Index = i - (12 - 1)
      const ema26Index = i - (26 - 1)
      const macdIndex = i - (26 + 9 - 2)
      const rsiIndex = i - (14)
      const stochIndex = i - (14 + 3 - 2)
      const bbIndex = i - (20 - 1)
      const atrIndex = i - (14)
      const adxIndex = i - (14 * 2)
      const cciIndex = i - (20 - 1)
      const williamsRIndex = i - (14 - 1)
      const rocIndex = i - (12)
      
      if (sma20Index >= 0 && sma20Values[sma20Index] !== undefined) {
        indicators.sma20 = sma20Values[sma20Index]
      }
      if (sma50Index >= 0 && sma50Values[sma50Index] !== undefined) {
        indicators.sma50 = sma50Values[sma50Index]
      }
      if (sma200Index >= 0 && sma200Values[sma200Index] !== undefined) {
        indicators.sma200 = sma200Values[sma200Index]
      }
      if (ema12Index >= 0 && ema12Values[ema12Index] !== undefined) {
        indicators.ema12 = ema12Values[ema12Index]
      }
      if (ema26Index >= 0 && ema26Values[ema26Index] !== undefined) {
        indicators.ema26 = ema26Values[ema26Index]
      }
      if (macdIndex >= 0 && macdValues[macdIndex]) {
        indicators.macd = macdValues[macdIndex].MACD
        indicators.macdSignal = macdValues[macdIndex].signal
        indicators.macdHistogram = macdValues[macdIndex].histogram
      }
      if (rsiIndex >= 0 && rsiValues[rsiIndex] !== undefined) {
        indicators.rsi = rsiValues[rsiIndex]
      }
      if (stochIndex >= 0 && stochValues[stochIndex]) {
        indicators.stochK = stochValues[stochIndex].k
        indicators.stochD = stochValues[stochIndex].d
      }
      if (bbIndex >= 0 && bbValues[bbIndex]) {
        indicators.bbUpper = bbValues[bbIndex].upper
        indicators.bbMiddle = bbValues[bbIndex].middle
        indicators.bbLower = bbValues[bbIndex].lower
      }
      if (atrIndex >= 0 && atrValues[atrIndex] !== undefined) {
        indicators.atr = atrValues[atrIndex]
      }
      if (adxIndex >= 0 && adxValues[adxIndex]) {
        indicators.adx = adxValues[adxIndex].adx
        indicators.plusDI = adxValues[adxIndex].pdi
        indicators.minusDI = adxValues[adxIndex].mdi
      }
      if (cciIndex >= 0 && cciValues[cciIndex] !== undefined) {
        indicators.cci = cciValues[cciIndex]
      }
      if (williamsRIndex >= 0 && williamsRValues[williamsRIndex] !== undefined) {
        indicators.williamsR = williamsRValues[williamsRIndex]
      }
      if (rocIndex >= 0 && rocValues[rocIndex] !== undefined) {
        indicators.roc = rocValues[rocIndex]
      }
      if (obvValues[i] !== undefined) {
        indicators.obv = BigInt(Math.round(obvValues[i]))
      }
      if (forceIndexValues[i] !== undefined) {
        indicators.forceIndex = forceIndexValues[i]
      }
      if (adlValues[i] !== undefined) {
        indicators.adLine = adlValues[i]
      }

      if (supertrendValues[i]?.value !== undefined) {
        indicators.supertrend = supertrendValues[i].value
      }
      if (supertrendValues[i]?.direction !== undefined) {
        indicators.supertrendDirection = supertrendValues[i].direction
      }
      
      // Calculate VWAP
      const vwap = (data[i].close * data[i].volume) / data[i].volume
      indicators.vwap = vwap
      
      results.push(indicators)
    }
    
    return results
  }
}

export const technicalIndicatorsService = new TechnicalIndicatorsService()

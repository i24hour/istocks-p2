/**
 * Trading Levels Calculator
 * Deterministic, explainable Entry / Stop-Loss / Target / Support / Resistance / Holding Period
 * for any stock using OHLCV data or a pre-computed indicator snapshot.
 */

import { prisma } from '@/lib/prisma'
import { fetchOHLCV } from '@/lib/yahoo-finance'
import type { EC2LiveIndicators, EC2LiveSnapshot } from '@/lib/ec2-helpers'

// ── Types ────────────────────────────────────────────────────────────────────

export interface OHLCVCandle {
  open: number
  high: number
  low: number
  close: number
  volume: number
  timestamp: number
}

export type Timeframe = '5m' | '15m' | '1h' | '1d'

export interface HoldingPeriod {
  holdingDays: number
  holdingLabel: string
  averageDailyMove: number
}

export interface TradingLevels {
  entry_price: number
  stop_loss: number
  target_price: number
  resistance: number
  support: number
  risk_reward_ratio: number
  setup_type: 'Breakout' | 'Pullback' | 'Market'
  confidence_score: number
  holding?: HoldingPeriod
}

// ── Lookback windows by timeframe ─────────────────────────────────────────────

const LOOKBACK: Record<Timeframe, number> = {
  '5m': 20,
  '15m': 30,
  '1h': 50,
  '1d': 100,
}

// ── Helper: count candles that touched a level within ±0.5% ──────────────────

function countTouches(candles: OHLCVCandle[], level: number, useHigh: boolean): number {
  const band = level * 0.005
  return candles.filter(c => {
    const val = useHigh ? c.high : c.low
    return Math.abs(val - level) <= band
  }).length
}

// ── Step 1: Resistance ────────────────────────────────────────────────────────

export function calculateResistance(
  candles: OHLCVCandle[],
  lookback: number
): { level: number; valid: boolean; touches: number } {
  const slice = candles.slice(-lookback)
  const level = Math.max(...slice.map(c => c.high))
  const touches = countTouches(slice, level, true)
  return { level, valid: touches >= 2, touches }
}

// ── Step 2: Support ───────────────────────────────────────────────────────────

export function calculateSupport(
  candles: OHLCVCandle[],
  lookback: number
): { level: number; valid: boolean; touches: number } {
  const slice = candles.slice(-lookback)
  const level = Math.min(...slice.map(c => c.low))
  const touches = countTouches(slice, level, false)
  return { level, valid: touches >= 2, touches }
}

// ── Step 3: ATR (14-period) ───────────────────────────────────────────────────

export function calculateATR(candles: OHLCVCandle[], period = 14): number {
  if (candles.length < period + 1) return 0
  const trValues: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i]
    const prevClose = candles[i - 1].close
    trValues.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)))
  }
  const slice = trValues.slice(-period)
  return slice.reduce((sum, v) => sum + v, 0) / slice.length
}

// ── Step 4: Entry ─────────────────────────────────────────────────────────────

export function calculateEntry(
  latestClose: number,
  resistance: number,
  support: number
): { price: number; setup_type: 'Breakout' | 'Pullback' | 'Market' } {
  const proximityBand = resistance * 0.005
  if (latestClose > resistance || Math.abs(latestClose - resistance) <= proximityBand) {
    return { price: r2(resistance * 1.001), setup_type: 'Breakout' }
  }
  const supportBand = support * 0.01
  if (Math.abs(latestClose - support) <= supportBand) {
    return { price: r2(support), setup_type: 'Pullback' }
  }
  return { price: r2(latestClose), setup_type: 'Market' }
}

// ── Step 5: Stop Loss ─────────────────────────────────────────────────────────

export function calculateStopLoss(entryPrice: number, atr: number, support: number): number {
  const atrStop = entryPrice - atr * 1.5
  const supportStop = support * 0.995
  return r2(Math.max(atrStop, supportStop))
}

// ── Step 6: Target ────────────────────────────────────────────────────────────

export function calculateTarget(entryPrice: number, stopLoss: number, rrRatio = 2): number {
  const risk = entryPrice - stopLoss
  return r2(entryPrice + risk * rrRatio)
}

// ── Round to 2 decimals ───────────────────────────────────────────────────────

function r2(v: number): number {
  return Math.round(v * 100) / 100
}

// ── Holding Period Calculation (O(n), pure, deterministic) ────────────────────

/**
 * Calculates how long to hold the trade based on real price volatility.
 * Uses daily move average over the last 30 closes to estimate days to target.
 */
export function calculateHoldingPeriod(
  entryPrice: number,
  targetPrice: number,
  last30Closes: number[]
): HoldingPeriod {
  const DEFAULT_DAYS = 5

  if (!last30Closes || last30Closes.length < 2) {
    return { holdingDays: DEFAULT_DAYS, holdingLabel: holdingLabel(DEFAULT_DAYS), averageDailyMove: 0 }
  }

  // Step 2: daily absolute moves — O(n)
  let totalMove = 0
  for (let i = 1; i < last30Closes.length; i++) {
    totalMove += Math.abs(last30Closes[i] - last30Closes[i - 1])
  }

  // Step 3: average daily move
  const averageDailyMove = r2(totalMove / (last30Closes.length - 1))

  if (averageDailyMove === 0) {
    return { holdingDays: DEFAULT_DAYS, holdingLabel: holdingLabel(DEFAULT_DAYS), averageDailyMove: 0 }
  }

  // Step 4 + 5: distance to target → days
  const distance = Math.abs(targetPrice - entryPrice)
  let holdingDays = Math.ceil(distance / averageDailyMove)

  // Step 6: safety clamp
  holdingDays = Math.max(1, Math.min(90, holdingDays))

  return { holdingDays, holdingLabel: holdingLabel(holdingDays), averageDailyMove }
}

// Step 7: label mapping
function holdingLabel(days: number): string {
  if (days === 1) return 'Intraday'
  if (days <= 3) return '1–3 days'
  if (days <= 10) return '3–10 days'
  if (days <= 30) return '2–4 weeks'
  return '1–3 months'
}

// ── DB fetch: last 30 closing prices (with Yahoo fallback) ───────────────────

/**
 * Fetches the last 30 daily closing prices for a symbol.
 * Primary: iStocks PostgreSQL (StockPrice table via stockId).
 * Fallback: Yahoo Finance 1-year daily candles (last 30 taken).
 */
export async function fetchLast30Closes(symbol: string): Promise<number[]> {
  try {
    const stock = await prisma.stock.findFirst({
      where: { symbol: symbol.toUpperCase() },
      select: { id: true },
    })

    if (stock) {
      const rows = await prisma.stockPrice.findMany({
        where: { stockId: stock.id },
        orderBy: { timestamp: 'desc' },
        take: 30,
        select: { close: true },
      })

      if (rows.length >= 2) {
        // Reverse to chronological order
        return rows.map(r => Number(r.close)).reverse()
      }
    }
  } catch {
    // Fall through to Yahoo
  }

  // Yahoo Finance fallback — stock not in DB or insufficient data
  try {
    const candles = await fetchOHLCV(symbol, '3mo', '1d')
    if (candles.length >= 2) {
      return candles.slice(-30).map((c: any) => Number(c.close))
    }
  } catch {
    // Give up gracefully
  }

  return []
}

// ── Convenience: fetch closes + compute holding period ───────────────────────

export async function computeHoldingPeriodForSymbol(
  symbol: string,
  entryPrice: number,
  targetPrice: number
): Promise<HoldingPeriod> {
  const closes = await fetchLast30Closes(symbol)
  return calculateHoldingPeriod(entryPrice, targetPrice, closes)
}

// ── Main: from raw OHLCV candles ──────────────────────────────────────────────

export function calculateTradingLevels(
  symbol: string,
  timeframe: Timeframe,
  ohlcData: OHLCVCandle[]
): TradingLevels | null {
  if (!ohlcData || ohlcData.length < 15) return null

  const lookback = LOOKBACK[timeframe]
  const candles = ohlcData.slice(-Math.max(lookback + 14, ohlcData.length))

  const res = calculateResistance(candles, lookback)
  const sup = calculateSupport(candles, lookback)
  const atr = calculateATR(candles)

  if (atr <= 0) return null

  const latestClose = candles[candles.length - 1].close
  const { price: entry, setup_type } = calculateEntry(latestClose, res.level, sup.level)
  const stop_loss = calculateStopLoss(entry, atr, sup.level)
  const target_price = calculateTarget(entry, stop_loss)

  if (stop_loss >= entry || target_price <= entry) return null

  const risk_reward_ratio = r2((target_price - entry) / (entry - stop_loss))
  const confidence_score = computeConfidenceFromOHLCV(candles, res, atr)

  // Derive holding period from the OHLCV data already in hand (no extra fetch)
  const last30Closes = candles.slice(-30).map(c => c.close)
  const holding = calculateHoldingPeriod(entry, target_price, last30Closes)

  return {
    entry_price: entry,
    stop_loss,
    target_price,
    resistance: r2(res.level),
    support: r2(sup.level),
    risk_reward_ratio,
    setup_type,
    confidence_score,
    holding,
  }
}

// ── Confidence from raw OHLCV ─────────────────────────────────────────────────

function computeConfidenceFromOHLCV(
  candles: OHLCVCandle[],
  res: { touches: number; valid: boolean },
  atr: number
): number {
  let score = 40
  if (res.valid) score += 15
  if (res.touches >= 3) score += 10

  const last5Vol = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5
  const prev5Vol = candles.slice(-10, -5).reduce((s, c) => s + c.volume, 0) / 5
  if (prev5Vol > 0 && last5Vol > prev5Vol * 1.1) score += 15

  const priorATR = calculateATR(candles.slice(0, -1))
  if (priorATR > 0 && Math.abs(atr - priorATR) / priorATR < 0.15) score += 10

  const sup = Math.min(...candles.slice(-20).map(c => c.low))
  const supTouches = countTouches(candles.slice(-20), sup, false)
  if (supTouches >= 2) score += 10

  return Math.min(100, Math.max(0, score))
}

// ── Snapshot-based calculation (uses pre-computed indicators) ─────────────────

export function calculateTradingLevelsFromSnapshot(
  snapshot: EC2LiveSnapshot,
  holding?: HoldingPeriod
): TradingLevels | null {
  const ltp = snapshot.ltp
  const iv = snapshot.indicators
  if (!ltp || ltp <= 0 || !iv) return null

  const atr = iv.atr
  if (!atr || atr <= 0) return null

  const resistance = iv.dcUpper ?? iv.bbUpper ?? iv.sma50 ?? ltp * 1.02
  const support = iv.dcLower ?? iv.bbLower ?? iv.sma20 ?? ltp * 0.98

  const { price: entry, setup_type } = calculateEntry(ltp, resistance, support)
  const stop_loss = calculateStopLoss(entry, atr, support)
  const target_price = calculateTarget(entry, stop_loss)

  if (stop_loss >= entry || target_price <= entry) return null

  const risk_reward_ratio = r2((target_price - entry) / (entry - stop_loss))
  const confidence_score = computeConfidenceFromSnapshot(ltp, iv, setup_type)

  return {
    entry_price: entry,
    stop_loss,
    target_price,
    resistance: r2(resistance),
    support: r2(support),
    risk_reward_ratio,
    setup_type,
    confidence_score,
    holding,
  }
}

// ── Confidence from indicator snapshot ───────────────────────────────────────

function computeConfidenceFromSnapshot(
  ltp: number,
  iv: EC2LiveIndicators,
  setup_type: string
): number {
  let score = 40
  if (iv.adx != null && iv.adx > 25) score += 10
  if (setup_type === 'Breakout' && iv.supertrendDirection === 1) score += 15
  if (setup_type === 'Pullback' && iv.supertrendDirection === -1) score += 5
  if (iv.rsi != null) {
    if (setup_type === 'Breakout' && iv.rsi >= 50 && iv.rsi <= 70) score += 10
    if (setup_type === 'Pullback' && iv.rsi >= 30 && iv.rsi <= 55) score += 10
    if (setup_type === 'Market' && iv.rsi >= 40 && iv.rsi <= 60) score += 5
  }
  if (iv.macdHistogram != null && iv.macdHistogram > 0) score += 8
  if (iv.mfi != null && iv.mfi > 50) score += 7
  else if (iv.cmf != null && iv.cmf > 0) score += 7
  if (iv.dcUpper != null && iv.dcLower != null) score += 5
  return Math.min(100, Math.max(0, score))
}

// ── Formatter for AI prompt injection ────────────────────────────────────────

export function formatTradingLevelsBlock(levels: TradingLevels): string {
  const confidenceBar = '█'.repeat(Math.round(levels.confidence_score / 10)) + '░'.repeat(10 - Math.round(levels.confidence_score / 10))
  const setupEmoji = levels.setup_type === 'Breakout' ? '🚀' : levels.setup_type === 'Pullback' ? '🔄' : '📍'
  const holdingLine = levels.holding
    ? `\n⏱️  Hold Period:   ${levels.holding.holdingLabel} (~${levels.holding.holdingDays}d, avg move ₹${levels.holding.averageDailyMove.toFixed(2)}/day)`
    : ''

  return `
📐 CALCULATED TRADING LEVELS (${setupEmoji} ${levels.setup_type} Setup)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 Entry Price:   ₹${levels.entry_price.toFixed(2)}
🎯 Target Price:  ₹${levels.target_price.toFixed(2)}
🛑 Stop-Loss:     ₹${levels.stop_loss.toFixed(2)}
📈 Resistance:    ₹${levels.resistance.toFixed(2)}
📉 Support:       ₹${levels.support.toFixed(2)}
⚖️  Risk/Reward:  ${levels.risk_reward_ratio.toFixed(2)}${holdingLine}
🎲 Confidence:    ${levels.confidence_score}/100  [${confidenceBar}]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`.trim()
}

// ── Compact inline formatter for answer cards ─────────────────────────────────

export function formatTradingLevelsSummary(levels: TradingLevels): string {
  const holdingPart = levels.holding
    ? ` | Holding: ${levels.holding.holdingLabel} (~${levels.holding.holdingDays}d)`
    : ''
  return (
    `Entry: ₹${levels.entry_price.toFixed(2)} | ` +
    `Target: ₹${levels.target_price.toFixed(2)} | ` +
    `Stop-Loss: ₹${levels.stop_loss.toFixed(2)} | ` +
    `R/R: ${levels.risk_reward_ratio.toFixed(2)}` +
    holdingPart
  )
}

import { prisma } from '@/lib/prisma'
import { Prisma, PrismaClient } from '@prisma/client'
import {
  selectBestStocks,
  type BestStockCandidate,
  type BestStockSelectionResult,
} from '@/lib/best-stock-selector'

const DEFAULT_STORED_COUNT = 50

function getIstDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    year: map.year,
    month: map.month,
    day: map.day,
  }
}

export function toIstSelectionDate(date = new Date()): Date {
  const { year, month, day } = getIstDateParts(date)
  return new Date(`${year}-${month}-${day}T00:00:00+05:30`)
}

function mapStoredCandidate(candidate: {
  id: string
  stockId: string
  symbol: string
  name: string
  exchange: string
  latestTimestamp: Date
  close: number
  rsi: number
  sma50: number
  avgTradedValue20d: number
  candles20d: number
  trendGapPct: number
  trendScore: number
  rsiScore: number
  technicalScore: number
  webScore: number
  finalScore: number
  sentimentLabel: string
  sentimentSummary: string
  sourceCount: number
  topHeadlines: unknown
}): BestStockCandidate {
  return {
    id: candidate.stockId,
    symbol: candidate.symbol,
    name: candidate.name,
    exchange: candidate.exchange,
    latestTimestamp: candidate.latestTimestamp,
    close: candidate.close,
    rsi: candidate.rsi,
    sma50: candidate.sma50,
    avgTradedValue20d: candidate.avgTradedValue20d,
    candles20d: candidate.candles20d,
    trendGapPct: candidate.trendGapPct,
    trendScore: candidate.trendScore,
    rsiScore: candidate.rsiScore,
    technicalScore: candidate.technicalScore,
    webScore: candidate.webScore,
    finalScore: candidate.finalScore,
    sentimentLabel:
      candidate.sentimentLabel === 'Positive' ||
      candidate.sentimentLabel === 'Negative'
        ? candidate.sentimentLabel
        : 'Neutral',
    sentimentSummary: candidate.sentimentSummary,
    sourceCount: candidate.sourceCount,
    topHeadlines: Array.isArray(candidate.topHeadlines)
      ? (candidate.topHeadlines as BestStockCandidate['topHeadlines'])
      : [],
  }
}

export async function generateAndStoreDailyStockSelection(
  now = new Date()
): Promise<BestStockSelectionResult> {
  const db = prisma as PrismaClient
  const selectionDate = toIstSelectionDate(now)
  const selection = await selectBestStocks({
    requestedCount: DEFAULT_STORED_COUNT,
    shortlistCount: DEFAULT_STORED_COUNT,
    allowExpandedCount: true,
  })

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const run = await tx.dailyStockSelectionRun.upsert({
      where: { selectionDate },
      create: {
        selectionDate,
        universeCount: selection.universeCount,
        eligibleCount: selection.eligibleCount,
        shortlistCount: selection.shortlistCount,
        technicalWeight: selection.weights.technical,
        webWeight: selection.weights.web,
        status: 'COMPLETED',
      },
      update: {
        generatedAt: new Date(),
        universeCount: selection.universeCount,
        eligibleCount: selection.eligibleCount,
        shortlistCount: selection.shortlistCount,
        technicalWeight: selection.weights.technical,
        webWeight: selection.weights.web,
        status: 'COMPLETED',
        notes: null,
      },
    })

    await tx.dailyStockSelectionResult.deleteMany({
      where: { runId: run.id },
    })

    if (selection.candidates.length > 0) {
      await tx.dailyStockSelectionResult.createMany({
        data: selection.candidates.map((candidate, index) => ({
          runId: run.id,
          stockId: candidate.id,
          rank: index + 1,
          symbol: candidate.symbol,
          name: candidate.name,
          exchange: candidate.exchange,
          latestTimestamp: candidate.latestTimestamp,
          close: candidate.close,
          rsi: candidate.rsi,
          sma50: candidate.sma50,
          avgTradedValue20d: candidate.avgTradedValue20d,
          candles20d: candidate.candles20d,
          trendGapPct: candidate.trendGapPct,
          trendScore: candidate.trendScore,
          rsiScore: candidate.rsiScore,
          technicalScore: candidate.technicalScore,
          webScore: candidate.webScore,
          finalScore: candidate.finalScore,
          sentimentLabel: candidate.sentimentLabel,
          sentimentSummary: candidate.sentimentSummary,
          sourceCount: candidate.sourceCount,
          topHeadlines: candidate.topHeadlines,
        })),
      })
    }
  })

  return selection
}

export async function getLatestDailyStockSelection(
  requestedCount = 10
): Promise<BestStockSelectionResult | null> {
  const db = prisma as PrismaClient
  const run = await db.dailyStockSelectionRun.findFirst({
    orderBy: { selectionDate: 'desc' },
    include: {
      results: {
        orderBy: { rank: 'asc' },
        take: Math.max(1, Math.min(DEFAULT_STORED_COUNT, requestedCount)),
      },
    },
  })

  if (!run) return null

  return {
    generatedAt: run.generatedAt,
    universeCount: run.universeCount,
    eligibleCount: run.eligibleCount,
    shortlistCount: run.shortlistCount,
    requestedCount: run.results.length,
    weights: {
      technical: run.technicalWeight,
      web: run.webWeight,
    },
    candidates: run.results.map(mapStoredCandidate),
  }
}

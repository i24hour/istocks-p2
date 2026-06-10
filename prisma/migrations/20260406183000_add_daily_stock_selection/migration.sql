-- Daily precomputed best-stock ranking
-- Additive + idempotent migration

CREATE TABLE IF NOT EXISTS "DailyStockSelectionRun" (
  "id" TEXT NOT NULL,
  "selectionDate" TIMESTAMP(3) NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "universeCount" INTEGER NOT NULL,
  "eligibleCount" INTEGER NOT NULL,
  "shortlistCount" INTEGER NOT NULL,
  "technicalWeight" DOUBLE PRECISION NOT NULL,
  "webWeight" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "notes" TEXT,
  CONSTRAINT "DailyStockSelectionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DailyStockSelectionResult" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "stockId" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "symbol" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "exchange" TEXT NOT NULL,
  "latestTimestamp" TIMESTAMP(3) NOT NULL,
  "close" DOUBLE PRECISION NOT NULL,
  "rsi" DOUBLE PRECISION NOT NULL,
  "sma50" DOUBLE PRECISION NOT NULL,
  "avgTradedValue20d" DOUBLE PRECISION NOT NULL,
  "candles20d" INTEGER NOT NULL,
  "trendGapPct" DOUBLE PRECISION NOT NULL,
  "trendScore" DOUBLE PRECISION NOT NULL,
  "rsiScore" DOUBLE PRECISION NOT NULL,
  "technicalScore" DOUBLE PRECISION NOT NULL,
  "webScore" DOUBLE PRECISION NOT NULL,
  "finalScore" DOUBLE PRECISION NOT NULL,
  "sentimentLabel" TEXT NOT NULL,
  "sentimentSummary" TEXT NOT NULL,
  "sourceCount" INTEGER NOT NULL,
  "topHeadlines" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyStockSelectionResult_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DailyStockSelectionResult_runId_fkey'
  ) THEN
    ALTER TABLE "DailyStockSelectionResult"
      ADD CONSTRAINT "DailyStockSelectionResult_runId_fkey"
      FOREIGN KEY ("runId") REFERENCES "DailyStockSelectionRun"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DailyStockSelectionResult_stockId_fkey'
  ) THEN
    ALTER TABLE "DailyStockSelectionResult"
      ADD CONSTRAINT "DailyStockSelectionResult_stockId_fkey"
      FOREIGN KEY ("stockId") REFERENCES "Stock"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "DailyStockSelectionRun_selectionDate_key" ON "DailyStockSelectionRun"("selectionDate");
CREATE INDEX IF NOT EXISTS "DailyStockSelectionRun_generatedAt_idx" ON "DailyStockSelectionRun"("generatedAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "DailyStockSelectionResult_runId_rank_key" ON "DailyStockSelectionResult"("runId", "rank");
CREATE INDEX IF NOT EXISTS "DailyStockSelectionResult_stockId_idx" ON "DailyStockSelectionResult"("stockId");
CREATE INDEX IF NOT EXISTS "DailyStockSelectionResult_symbol_idx" ON "DailyStockSelectionResult"("symbol");
CREATE INDEX IF NOT EXISTS "DailyStockSelectionResult_finalScore_idx" ON "DailyStockSelectionResult"("finalScore" DESC);

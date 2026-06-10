-- Add missing updatedAt column to TradingOrder (IF NOT EXISTS = safe to re-run)
ALTER TABLE "TradingOrder"
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
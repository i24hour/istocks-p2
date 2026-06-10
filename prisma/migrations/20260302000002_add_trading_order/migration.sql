-- CreateTable
CREATE TABLE IF NOT EXISTS "TradingOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "productType" TEXT NOT NULL DEFAULT 'INTRADAY',
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "tradingMode" TEXT NOT NULL DEFAULT 'PAPER',
    "executedPrice" DOUBLE PRECISION,
    "executedAt" TIMESTAMP(3),
    "positionValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "entryCondition" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradingOrder_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey (safe: drop first if it already exists)
ALTER TABLE "TradingOrder"
DROP CONSTRAINT IF EXISTS "TradingOrder_userId_fkey";

ALTER TABLE "TradingOrder"
ADD CONSTRAINT "TradingOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TradingOrder_userId_createdAt_idx" ON "TradingOrder" ("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "TradingOrder_symbol_idx" ON "TradingOrder" ("symbol");

CREATE INDEX IF NOT EXISTS "TradingOrder_status_idx" ON "TradingOrder" ("status");
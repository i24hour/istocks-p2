-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'NSE',
    "angelToken" TEXT,
    "aliases" TEXT [] DEFAULT ARRAY[]::TEXT [],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_symbol_key" ON "Instrument" ("symbol");

-- CreateIndex
CREATE INDEX "Instrument_symbol_idx" ON "Instrument" ("symbol");

-- CreateIndex
CREATE INDEX "Instrument_isActive_idx" ON "Instrument" ("isActive");
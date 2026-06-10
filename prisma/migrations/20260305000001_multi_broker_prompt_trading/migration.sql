-- Multi-broker prompt trading foundation
-- Safe additive migration (idempotent where possible)

ALTER TABLE "Stock"
  ADD COLUMN IF NOT EXISTS "dhanSecurityId" TEXT,
  ADD COLUMN IF NOT EXISTS "zerodhaTradingSymbol" TEXT,
  ADD COLUMN IF NOT EXISTS "zerodhaExchange" TEXT;

ALTER TABLE "TradingOrder"
  ADD COLUMN IF NOT EXISTS "brokerName" TEXT,
  ADD COLUMN IF NOT EXISTS "brokerOrderId" TEXT,
  ADD COLUMN IF NOT EXISTS "brokerStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "executionError" TEXT,
  ADD COLUMN IF NOT EXISTS "rawBrokerResponse" JSONB,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "entryPrice" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "stopLoss" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "takeProfit" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "trailingStopPct" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expiryDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "strikePrice" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "optionType" TEXT;

CREATE TABLE IF NOT EXISTS "BrokerConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "brokerName" TEXT NOT NULL,
  "apiKeyEnc" TEXT,
  "apiSecretEnc" TEXT,
  "clientIdEnc" TEXT,
  "accessTokenEnc" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "isConnected" BOOLEAN NOT NULL DEFAULT false,
  "lastValidatedAt" TIMESTAMP(3),
  "metaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrokerConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserTradingPreference" (
  "userId" TEXT NOT NULL,
  "tradingMode" TEXT NOT NULL DEFAULT 'PAPER',
  "preferredLiveBroker" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserTradingPreference_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "BrokerAuthState" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "brokerName" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "consentId" TEXT,
  "codeVerifier" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrokerAuthState_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'BrokerConnection_userId_fkey'
  ) THEN
    ALTER TABLE "BrokerConnection"
      ADD CONSTRAINT "BrokerConnection_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'UserTradingPreference_userId_fkey'
  ) THEN
    ALTER TABLE "UserTradingPreference"
      ADD CONSTRAINT "UserTradingPreference_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'BrokerAuthState_userId_fkey'
  ) THEN
    ALTER TABLE "BrokerAuthState"
      ADD CONSTRAINT "BrokerAuthState_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "BrokerConnection_userId_brokerName_key" ON "BrokerConnection"("userId", "brokerName");
CREATE INDEX IF NOT EXISTS "BrokerConnection_brokerName_idx" ON "BrokerConnection"("brokerName");
CREATE INDEX IF NOT EXISTS "BrokerConnection_updatedAt_idx" ON "BrokerConnection"("updatedAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "BrokerAuthState_state_key" ON "BrokerAuthState"("state");
CREATE INDEX IF NOT EXISTS "BrokerAuthState_userId_brokerName_expiresAt_idx" ON "BrokerAuthState"("userId", "brokerName", "expiresAt");

CREATE INDEX IF NOT EXISTS "TradingOrder_brokerName_idx" ON "TradingOrder"("brokerName");
CREATE UNIQUE INDEX IF NOT EXISTS "TradingOrder_idempotencyKey_key" ON "TradingOrder"("idempotencyKey");

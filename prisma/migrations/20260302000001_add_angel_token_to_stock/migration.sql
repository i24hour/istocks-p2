-- AlterTable: add angelToken column to Stock (IF NOT EXISTS handles already-migrated DBs)
ALTER TABLE "Stock" ADD COLUMN IF NOT EXISTS "angelToken" TEXT;

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS "Stock_angelToken_idx" ON "Stock" ("angelToken");
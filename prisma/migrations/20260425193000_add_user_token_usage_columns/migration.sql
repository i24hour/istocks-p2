-- Token usage counters added after removing prompt limits.
-- Safe additive migration for production DBs that already have the User table.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "totalTokensIn" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalTokensOut" INTEGER NOT NULL DEFAULT 0;

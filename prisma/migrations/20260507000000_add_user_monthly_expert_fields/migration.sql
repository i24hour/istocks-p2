-- Add monthly expert usage tracking columns to User table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "monthlyExpertCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "monthlyExpertResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

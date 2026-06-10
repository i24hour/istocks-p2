-- Add daily prompt limit tracking columns to User table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dailyPromptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dailyPromptResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

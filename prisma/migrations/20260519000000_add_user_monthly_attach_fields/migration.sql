-- Monthly file-attachment usage (Pro only; resets 1st of month IST)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "monthlyAttachCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "monthlyAttachResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

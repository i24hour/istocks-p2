-- Per-subscription-period usage counters (Pro: 50 experts + 5 attaches per ~30-day billing period)
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "periodExpertCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "periodAttachCount" INTEGER NOT NULL DEFAULT 0;

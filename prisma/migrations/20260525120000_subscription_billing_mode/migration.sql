-- Add billingMode to Subscription; backfill from Razorpay paymentOrderId prefix
ALTER TABLE "Subscription" ADD COLUMN "billingMode" TEXT NOT NULL DEFAULT 'one_time';

UPDATE "Subscription"
SET "billingMode" = 'autopay'
WHERE "paymentOrderId" LIKE 'sub_%';

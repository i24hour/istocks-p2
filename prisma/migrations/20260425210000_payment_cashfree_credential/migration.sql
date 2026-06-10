-- Which Cashfree App ID/Secret pair was used to create this order (verify + webhook)
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "cashfreeCredential" TEXT NOT NULL DEFAULT 'default';

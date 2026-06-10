-- Single Cashfree app (CASHFREE_APP_ID + CASHFREE_SECRET_KEY) — no per-order credential
ALTER TABLE "Payment" DROP COLUMN IF EXISTS "cashfreeCredential";

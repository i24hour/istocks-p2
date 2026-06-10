-- Optional phone for payment gateway (Cashfree customer_phone)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;

-- Rename Cashfree-specific columns to provider-neutral names (Razorpay order_id / payment_id)
ALTER TABLE "Subscription" RENAME COLUMN "cashfreeOrderId" TO "paymentOrderId";
ALTER TABLE "Payment" RENAME COLUMN "cashfreeOrderId" TO "paymentOrderId";
ALTER TABLE "Payment" RENAME COLUMN "cashfreePaymentId" TO "paymentId";

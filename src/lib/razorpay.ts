/**
 * Razorpay Standard Checkout + Subscriptions — server-only.
 * Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_PLAN_ID (subscriptions)
 */

import crypto from 'crypto'
import Razorpay from 'razorpay'

export const RAZORPAY_MIN_AMOUNT_PAISE = 100

/** Monthly billing cycles — ~10 years; user can cancel anytime in Razorpay. */
export const RAZORPAY_SUBSCRIPTION_TOTAL_COUNT = 120

export function isRazorpayConfigured(): boolean {
    return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
}

export function getRazorpayPlanId(): string {
    return (process.env.RAZORPAY_PLAN_ID || '').trim()
}

export function isRazorpaySubscriptionConfigured(): boolean {
    return isRazorpayConfigured() && !!getRazorpayPlanId()
}

export function getRazorpayClient(): Razorpay {
    const key_id     = process.env.RAZORPAY_KEY_ID || ''
    const key_secret = process.env.RAZORPAY_KEY_SECRET || ''
    if (!key_id || !key_secret) {
        throw new Error('Razorpay is not configured (missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET)')
    }
    return new Razorpay({ key_id, key_secret })
}

function verifyHmacHex(body: string, signature: string): boolean {
    const secret = process.env.RAZORPAY_KEY_SECRET || ''
    if (!secret || !body || !signature) return false
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
    try {
        return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))
    } catch {
        return false
    }
}

/**
 * One-time order payment signature: HMAC-SHA256(order_id + "|" + payment_id, secret)
 */
export function verifyRazorpayPaymentSignature(
    orderId: string,
    paymentId: string,
    signature: string
): boolean {
    if (!orderId || !paymentId || !signature) return false
    return verifyHmacHex(`${orderId}|${paymentId}`, signature)
}

/**
 * Subscription auth/charge signature: HMAC-SHA256(payment_id + "|" + subscription_id, secret)
 */
export function verifyRazorpaySubscriptionSignature(
    paymentId: string,
    subscriptionId: string,
    signature: string
): boolean {
    if (!paymentId || !subscriptionId || !signature) return false
    return verifyHmacHex(`${paymentId}|${subscriptionId}`, signature)
}

export function verifyRazorpayWebhookSignature(
    rawBody: string,
    signature: string | null
): boolean {
    const secret = (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim()
    if (!secret || !signature || !rawBody) return false
    return Razorpay.validateWebhookSignature(rawBody, signature, secret)
}

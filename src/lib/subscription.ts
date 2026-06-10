/**
 * Subscription helpers — server-only.
 *
 * Plans
 *   free  — default, no payment required
 *   pro   — ₹499/month, unlocks Compute models + 1 Cr paper trade limit
 */

import { prisma } from '@/lib/prisma'

export const PLANS = {
    free: {
        id: 'free',
        label: 'Free',
        price: 0,
        paperTradeMax: 10_00_000,        // ₹10 lakh
        computeModelsEnabled: false,
    },
    pro: {
        id: 'pro',
        label: 'Pro',
        price: 499,
        paperTradeMax: 1_00_00_000,      // ₹1 crore
        computeModelsEnabled: true,
    },
} as const

export type PlanId = keyof typeof PLANS
export type BillingMode = 'autopay' | 'one_time'

/** Razorpay subscriptions use sub_* ids; legacy one-time orders use order_*. */
export function inferBillingModeFromPaymentOrderId(paymentOrderId: string): BillingMode {
    return paymentOrderId.startsWith('sub_') ? 'autopay' : 'one_time'
}

/**
 * Return the active subscription plan for a user.
 * Falls back to 'free' when no active subscription exists.
 */
export async function getActiveSubscription(userId: string) {
    return prisma.subscription.findFirst({
        where: {
            userId,
            status: 'ACTIVE',
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: 'desc' },
    })
}

export async function getUserPlan(userId: string): Promise<PlanId> {
    const sub = await getActiveSubscription(userId)
    const raw = String(sub?.plan ?? 'free').toLowerCase()
    return (raw in PLANS ? raw : 'free') as PlanId
}

/**
 * Activate (or extend) a Pro subscription for `userId`.
 * Called after a confirmed payment (Razorpay).
 *
 * Idempotent: renewals for the same paymentOrderId extend expiresAt instead of
 * creating a duplicate row.
 */
export async function activateProSubscription(
    userId: string,
    paymentOrderId: string,
    durationDays = 30,
    billingMode?: BillingMode
): Promise<void> {
    const mode = billingMode ?? inferBillingModeFromPaymentOrderId(paymentOrderId)
    const existing = await prisma.subscription.findFirst({
        where: { userId, paymentOrderId, status: 'ACTIVE' },
    })

    const now = new Date()

    if (existing) {
        const base =
            existing.expiresAt && existing.expiresAt > now ? existing.expiresAt : now
        await prisma.subscription.update({
            where: { id: existing.id },
            data: {
                expiresAt: new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000),
                billingMode: mode,
            },
        })
        return
    }

    const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000)

    await prisma.$transaction(async (tx) => {
        await tx.subscription.updateMany({
            where: { userId, status: 'ACTIVE' },
            data: { status: 'CANCELLED' },
        })
        await tx.subscription.create({
            data: {
                userId,
                plan: 'pro',
                status: 'ACTIVE',
                startedAt: now,
                expiresAt,
                paymentOrderId,
                billingMode: mode,
            },
        })
    })
}

/** Mark gateway payment success and activate/extend Pro (idempotent). */
export async function completeRazorpayProPayment(
    userId: string,
    gatewayOrderId: string,
    paymentId?: string | null
): Promise<void> {
    if (paymentId) {
        await prisma.payment.updateMany({
            where: { paymentOrderId: gatewayOrderId, userId },
            data: {
                status: 'SUCCESS',
                paymentId,
                rawResponse: { gatewayOrderId, paymentId } as object,
            },
        })
    }
    await activateProSubscription(userId, gatewayOrderId)
}

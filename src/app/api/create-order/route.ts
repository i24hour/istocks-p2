import { NextRequest, NextResponse } from 'next/server'
import { getAuthSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
    getRazorpayClient,
    getRazorpayPlanId,
    isRazorpaySubscriptionConfigured,
    RAZORPAY_SUBSCRIPTION_TOTAL_COUNT,
} from '@/lib/razorpay'
import { PLANS } from '@/lib/subscription'
import { normalizeIndianMobile } from '@/lib/phone'

export const runtime = 'nodejs'

/**
 * POST /api/create-order
 * Creates a Razorpay subscription (autopay) for the Pro plan. Requires auth.
 */
export async function POST(request: NextRequest) {
    const session = await getAuthSession()
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isRazorpaySubscriptionConfigured()) {
        return NextResponse.json(
            {
                error:
                    'Payments are not configured. Add RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_PLAN_ID.',
            },
            { status: 503 }
        )
    }

    const body = await request.json().catch(() => null)
    const plan = body?.plan ?? 'pro'

    if (!(plan in PLANS) || plan === 'free') {
        return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    const planDetails = PLANS[plan as keyof typeof PLANS]

    let userPhone = await prisma.user
        .findUnique({
            where: { id: session.user.id },
            select: { phone: true },
        })
        .then((u) => normalizeIndianMobile(u?.phone ?? null))

    const fromBody = normalizeIndianMobile(typeof body?.phone === 'string' ? body.phone : null)
    if (fromBody) {
        userPhone = fromBody
        await prisma.user
            .update({
                where: { id: session.user.id },
                data: { phone: fromBody },
            })
            .catch(() => {})
    }

    if (!userPhone) {
        return NextResponse.json(
            {
                error: 'Add your 10-digit Indian mobile number to continue payment.',
                code: 'PHONE_REQUIRED',
            },
            { status: 400 }
        )
    }

    let pendingSubscriptionId: string | null = null
    try {
        const rzp = getRazorpayClient()
        const subscription = await rzp.subscriptions.create({
            plan_id: getRazorpayPlanId(),
            total_count: RAZORPAY_SUBSCRIPTION_TOTAL_COUNT,
            quantity: 1,
            customer_notify: 1,
            notify_info: {
                notify_phone: userPhone,
                ...(session.user.email ? { notify_email: session.user.email } : {}),
            },
            notes: {
                userId: session.user.id,
                plan,
            },
            expire_by: Math.floor(Date.now() / 1000) + 60 * 60,
        })

        const subscriptionId = subscription.id as string
        pendingSubscriptionId = subscriptionId

        await prisma.payment.create({
            data: {
                userId: session.user.id,
                paymentOrderId: subscriptionId,
                amount: planDetails.price,
                currency: 'INR',
                status: 'PENDING',
                plan,
            },
        })

        return NextResponse.json({
            subscription_id: subscriptionId,
            plan_id: getRazorpayPlanId(),
        })
    } catch (e: unknown) {
        if (pendingSubscriptionId) {
            await prisma.payment
                .deleteMany({ where: { paymentOrderId: pendingSubscriptionId } })
                .catch(() => {})
        }
        const err = e as { statusCode?: number; error?: { description?: string }; message?: string }
        if (err.statusCode === 401) {
            return NextResponse.json({ error: 'Razorpay authentication failed. Check key secret.' }, { status: 401 })
        }
        const message =
            err.error?.description ||
            err.message ||
            (e instanceof Error ? e.message : 'Failed to create subscription')
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

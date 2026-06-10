import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyRazorpayWebhookSignature } from '@/lib/razorpay'
import { activateProSubscription, completeRazorpayProPayment } from '@/lib/subscription'

export const runtime = 'nodejs'

type RazorpaySubscriptionEntity = {
    id?: string
    status?: string
    notes?: Record<string, string>
}

type RazorpayPaymentEntity = {
    id?: string
}

type RazorpayWebhookEvent = {
    event?: string
    payload?: {
        subscription?: { entity?: RazorpaySubscriptionEntity }
        payment?: { entity?: RazorpayPaymentEntity }
    }
}

const ACTIVATE_EVENTS = new Set([
    'subscription.authenticated',
    'subscription.activated',
    'subscription.charged',
])

const CANCEL_EVENTS = new Set(['subscription.cancelled', 'subscription.halted'])

async function resolveUserId(
    subscription: RazorpaySubscriptionEntity
): Promise<string | null> {
    const fromNotes = subscription.notes?.userId
    if (fromNotes) return fromNotes

    if (!subscription.id) return null
    const payment = await prisma.payment.findUnique({
        where: { paymentOrderId: subscription.id },
        select: { userId: true },
    })
    return payment?.userId ?? null
}

/**
 * POST /api/payments/razorpay-webhook
 * Razorpay Subscriptions + payment events (configure in Razorpay Dashboard).
 */
export async function POST(request: NextRequest) {
    const rawBody = await request.text()
    const signature = request.headers.get('x-razorpay-signature')

    if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 })
    }

    let event: RazorpayWebhookEvent
    try {
        event = JSON.parse(rawBody) as RazorpayWebhookEvent
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const eventName = event.event ?? ''
    const subscription = event.payload?.subscription?.entity
    const payment = event.payload?.payment?.entity

    if (subscription?.id && ACTIVATE_EVENTS.has(eventName)) {
        const userId = await resolveUserId(subscription)
        if (userId) {
            await completeRazorpayProPayment(userId, subscription.id, payment?.id ?? null)
        }
    }

    if (subscription?.id && CANCEL_EVENTS.has(eventName)) {
        const userId = await resolveUserId(subscription)
        if (userId) {
            await prisma.subscription.updateMany({
                where: {
                    userId,
                    paymentOrderId: subscription.id,
                    status: 'ACTIVE',
                },
                data: { status: 'CANCELLED' },
            })
        }
    }

    return NextResponse.json({ received: true })
}

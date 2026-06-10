import { NextRequest, NextResponse } from 'next/server'
import { getAuthSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
    verifyRazorpayPaymentSignature,
    verifyRazorpaySubscriptionSignature,
} from '@/lib/razorpay'
import { completeRazorpayProPayment } from '@/lib/subscription'

export const runtime = 'nodejs'

/**
 * POST /api/verify-payment
 * Body (subscription): { razorpay_subscription_id, razorpay_payment_id, razorpay_signature }
 * Body (legacy order): { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
export async function POST(request: NextRequest) {
    const session = await getAuthSession()
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const subscriptionId =
        typeof body?.razorpay_subscription_id === 'string' ? body.razorpay_subscription_id : ''
    const orderId = typeof body?.razorpay_order_id === 'string' ? body.razorpay_order_id : ''
    const paymentId = typeof body?.razorpay_payment_id === 'string' ? body.razorpay_payment_id : ''
    const signature = typeof body?.razorpay_signature === 'string' ? body.razorpay_signature : ''

    const gatewayId = subscriptionId || orderId

    if (!gatewayId || !paymentId || !signature) {
        return NextResponse.json(
            {
                error:
                    'Missing payment id and signature (subscription_id or order_id required).',
            },
            { status: 400 }
        )
    }

    const signatureOk = subscriptionId
        ? verifyRazorpaySubscriptionSignature(paymentId, subscriptionId, signature)
        : verifyRazorpayPaymentSignature(orderId, paymentId, signature)

    if (!signatureOk) {
        return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 })
    }

    const payment = await prisma.payment.findUnique({ where: { paymentOrderId: gatewayId } })
    if (!payment || payment.userId !== session.user.id) {
        return NextResponse.json({ error: 'Payment record not found' }, { status: 404 })
    }

    if (payment.status === 'SUCCESS') {
        return NextResponse.json({ success: true, status: 'SUCCESS', plan: payment.plan })
    }

    await completeRazorpayProPayment(session.user.id, gatewayId, paymentId)

    return NextResponse.json({ success: true, status: 'SUCCESS', plan: payment.plan })
}

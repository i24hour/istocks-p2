import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireInternalSession } from '@/lib/internal-auth'
import { inferBillingModeFromPaymentOrderId } from '@/lib/subscription'

export const runtime = 'nodejs'

const LIMIT = 200

export async function GET() {
    const { error } = await requireInternalSession()
    if (error) return error

    const payments = await prisma.payment.findMany({
        select: {
            id: true,
            userEmail: true,
            userName: true,
            amount: true,
            currency: true,
            status: true,
            plan: true,
            paymentOrderId: true,
            paymentId: true,
            createdAt: true,
            updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: LIMIT,
    })

    return NextResponse.json({
        payments: payments.map((payment) => ({
            ...payment,
            billingMode: inferBillingModeFromPaymentOrderId(payment.paymentOrderId),
            isAutopay: payment.paymentOrderId.startsWith('sub_'),
            createdAt: payment.createdAt.toISOString(),
            updatedAt: payment.updatedAt.toISOString(),
        })),
        limit: LIMIT,
    })
}

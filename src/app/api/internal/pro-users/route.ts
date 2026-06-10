import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireInternalSession } from '@/lib/internal-auth'

export const runtime = 'nodejs'

const LIMIT = 200

export async function GET() {
    const { error } = await requireInternalSession()
    if (error) return error

    const subscriptions = await prisma.subscription.findMany({
        where: {
            plan: 'pro',
            status: 'ACTIVE',
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: {
            id: true,
            userId: true,
            startedAt: true,
            expiresAt: true,
            createdAt: true,
            billingMode: true,
            user: {
                select: {
                    name: true,
                    email: true,
                },
            },
        },
        orderBy: { createdAt: 'desc' },
        take: LIMIT,
    })

    const userIds = subscriptions.map((sub) => sub.userId)
    const successfulPayments =
        userIds.length === 0
            ? []
            : await prisma.payment.findMany({
                  where: {
                      userId: { in: userIds },
                      status: 'SUCCESS',
                  },
                  select: {
                      userId: true,
                      createdAt: true,
                  },
                  orderBy: { createdAt: 'desc' },
              })

    const latestPaymentByUser = new Map<string, Date>()
    for (const payment of successfulPayments) {
        if (!latestPaymentByUser.has(payment.userId)) {
            latestPaymentByUser.set(payment.userId, payment.createdAt)
        }
    }

    return NextResponse.json({
        proUsers: subscriptions.map((sub) => ({
            subscriptionId: sub.id,
            userId: sub.userId,
            name: sub.user.name,
            email: sub.user.email,
            billingMode: sub.billingMode,
            isAutopay: sub.billingMode === 'autopay',
            subscriptionStartedAt: sub.startedAt.toISOString(),
            subscriptionExpiresAt: sub.expiresAt?.toISOString() ?? null,
            lastPaymentAt: latestPaymentByUser.get(sub.userId)?.toISOString() ?? null,
        })),
        limit: LIMIT,
    })
}

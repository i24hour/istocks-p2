import { NextResponse } from 'next/server'
import { getAuthSession } from '@/lib/auth'
import { getUserPlan, PLANS } from '@/lib/subscription'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function GET() {
    const session = await getAuthSession()
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const planId = await getUserPlan(session.user.id)
    const plan   = PLANS[planId]

    const [sub, user] = await Promise.all([
        prisma.subscription.findFirst({
            where: {
                userId: session.user.id,
                status: 'ACTIVE',
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            orderBy: { createdAt: 'desc' },
            select: { expiresAt: true, startedAt: true },
        }),
        prisma.user.findUnique({
            where: { id: session.user.id },
            select: { name: true, email: true },
        }),
    ])

    const PRO_PERIOD_MS = 30 * 24 * 60 * 60 * 1000
    const expiresAt =
        sub?.expiresAt ??
        (sub?.startedAt ? new Date(sub.startedAt.getTime() + PRO_PERIOD_MS) : null)
    let daysRemaining: number | null = null
    if (expiresAt) {
        daysRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    }

    return NextResponse.json({
        plan: planId,
        label: plan.label,
        name: user?.name || user?.email?.split('@')[0] || 'User',
        paperTradeMax: plan.paperTradeMax,
        computeModelsEnabled: plan.computeModelsEnabled,
        expiresAt: expiresAt?.toISOString() ?? null,
        startedAt: sub?.startedAt?.toISOString() ?? null,
        daysRemaining,
    })
}

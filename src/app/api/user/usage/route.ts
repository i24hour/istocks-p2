import { NextResponse } from 'next/server'
import { getAuthSession } from '@/lib/auth'
import { getDailyUsage } from '@/lib/user-limit'
import { getExpertUsage } from '@/lib/expert-limit'
import { getAttachUsage } from '@/lib/attach-limit'
import { getUserPlan } from '@/lib/subscription'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
    const session = await getAuthSession()
    if (!session?.user?.id) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const [prompts, experts, attachments, plan, sub] = await Promise.all([
        getDailyUsage(userId),
        getExpertUsage(userId),
        getAttachUsage(userId),
        getUserPlan(userId),
        prisma.subscription.findFirst({
            where: {
                userId,
                status: 'ACTIVE',
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            orderBy: { createdAt: 'desc' },
            select: { expiresAt: true, startedAt: true },
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
        success: true,
        data: {
            plan: prompts.plan,
            subscription: {
                plan,
                expiresAt: expiresAt?.toISOString() ?? null,
                startedAt: sub?.startedAt?.toISOString() ?? null,
                daysRemaining,
            },
            prompts: {
                used:      prompts.used,
                limit:     prompts.limit,
                remaining: prompts.remaining,
                period:    'daily',
            },
            experts: {
                used:      experts.used,
                limit:     experts.limit,
                remaining: experts.remaining,
                resetsOn:  experts.resetsOn,
                period:    experts.period,
                model:     'Compute 1.0',
            },
            attachments: {
                available: attachments.available,
                used:      attachments.used,
                limit:     attachments.limit,
                remaining: attachments.remaining,
                resetsOn:  attachments.resetsOn,
                period:    attachments.period,
            },
        },
    })
}

import { prisma } from '@/lib/prisma'
import { getActiveSubscription, getUserPlan } from '@/lib/subscription'

export const FREE_MONTHLY_EXPERT_LIMIT = 3
export const PRO_PERIOD_EXPERT_LIMIT = 50

export type ExpertUsagePeriod = 'calendar' | 'subscription'

export interface ExpertLimitResult {
    allowed: boolean
    remaining: number
    used: number
    limit: number
    plan: 'free' | 'pro'
    resetsOn: string
    period: ExpertUsagePeriod
}

/** Returns true if we're past the 1st of the current month IST vs the stored reset date. */
function needsMonthlyReset(resetAt: Date): boolean {
    const offsetMs = 5.5 * 60 * 60 * 1000
    const nowIST   = new Date(Date.now() + offsetMs)
    const resetIST = new Date(resetAt.getTime() + offsetMs)
    return (
        nowIST.getUTCFullYear() !== resetIST.getUTCFullYear() ||
        nowIST.getUTCMonth()    !== resetIST.getUTCMonth()
    )
}

/** ISO string of the 1st of next month at 00:00 IST (Free plan). */
function nextCalendarResetISO(): string {
    const offsetMs = 5.5 * 60 * 60 * 1000
    const nowIST   = new Date(Date.now() + offsetMs)
    const firstOfNext = new Date(Date.UTC(
        nowIST.getUTCFullYear(),
        nowIST.getUTCMonth() + 1,
        1, 0, 0, 0
    ) - offsetMs)
    return firstOfNext.toISOString()
}

async function getFreeExpertUsage(userId: string): Promise<ExpertLimitResult> {
    const limit = FREE_MONTHLY_EXPERT_LIMIT
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { monthlyExpertCount: true, monthlyExpertResetAt: true },
    })

    const now = new Date()
    const resetNeeded = needsMonthlyReset(user?.monthlyExpertResetAt ?? now)
    const used = resetNeeded ? 0 : (user?.monthlyExpertCount ?? 0)

    return {
        allowed:   used < limit,
        remaining: Math.max(0, limit - used),
        used,
        limit,
        plan: 'free',
        resetsOn: nextCalendarResetISO(),
        period: 'calendar',
    }
}

async function incrementFreeExpert(userId: string): Promise<ExpertLimitResult> {
    const limit = FREE_MONTHLY_EXPERT_LIMIT
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { monthlyExpertCount: true, monthlyExpertResetAt: true },
    })

    const now = new Date()
    const resetNeeded = needsMonthlyReset(user?.monthlyExpertResetAt ?? now)
    const currentCount = resetNeeded ? 0 : (user?.monthlyExpertCount ?? 0)

    if (currentCount >= limit) {
        return {
            allowed: false,
            remaining: 0,
            used: currentCount,
            limit,
            plan: 'free',
            resetsOn: nextCalendarResetISO(),
            period: 'calendar',
        }
    }

    await prisma.user.update({
        where: { id: userId },
        data: {
            monthlyExpertCount:   resetNeeded ? 1 : { increment: 1 },
            ...(resetNeeded ? { monthlyExpertResetAt: now } : {}),
        },
    })

    const newCount = currentCount + 1
    return {
        allowed: true,
        remaining: limit - newCount,
        used: newCount,
        limit,
        plan: 'free',
        resetsOn: nextCalendarResetISO(),
        period: 'calendar',
    }
}

function proResetsOn(sub: { expiresAt: Date | null; startedAt: Date }): string {
    return (sub.expiresAt ?? sub.startedAt).toISOString()
}

async function getProExpertUsage(userId: string): Promise<ExpertLimitResult | null> {
    const sub = await getActiveSubscription(userId)
    if (!sub || String(sub.plan).toLowerCase() !== 'pro') return null

    const limit = PRO_PERIOD_EXPERT_LIMIT
    const used = sub.periodExpertCount ?? 0

    return {
        allowed:   used < limit,
        remaining: Math.max(0, limit - used),
        used,
        limit,
        plan: 'pro',
        resetsOn: proResetsOn(sub),
        period: 'subscription',
    }
}

async function incrementProExpert(userId: string): Promise<ExpertLimitResult | null> {
    const sub = await getActiveSubscription(userId)
    if (!sub || String(sub.plan).toLowerCase() !== 'pro') return null

    const limit = PRO_PERIOD_EXPERT_LIMIT
    const used = sub.periodExpertCount ?? 0

    if (used >= limit) {
        return {
            allowed: false,
            remaining: 0,
            used,
            limit,
            plan: 'pro',
            resetsOn: proResetsOn(sub),
            period: 'subscription',
        }
    }

    const updated = await prisma.subscription.update({
        where: { id: sub.id },
        data: { periodExpertCount: { increment: 1 } },
        select: { periodExpertCount: true, expiresAt: true, startedAt: true },
    })

    const newUsed = updated.periodExpertCount
    return {
        allowed: true,
        remaining: limit - newUsed,
        used: newUsed,
        limit,
        plan: 'pro',
        resetsOn: proResetsOn(updated),
        period: 'subscription',
    }
}

export async function checkAndIncrementExpertLimit(userId: string): Promise<ExpertLimitResult> {
    const plan = await getUserPlan(userId)
    if (plan === 'pro') {
        const pro = await incrementProExpert(userId)
        if (pro) return pro
    }
    return incrementFreeExpert(userId)
}

export async function getExpertUsage(userId: string): Promise<ExpertLimitResult> {
    const plan = await getUserPlan(userId)
    if (plan === 'pro') {
        const pro = await getProExpertUsage(userId)
        if (pro) return pro
    }
    return getFreeExpertUsage(userId)
}

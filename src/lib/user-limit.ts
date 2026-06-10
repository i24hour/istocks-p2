import { prisma } from '@/lib/prisma'
import { getUserPlan } from '@/lib/subscription'

export const FREE_DAILY_LIMIT = 10

function isSameDayIST(a: Date, b: Date): boolean {
    // IST = UTC+5:30
    const offsetMs = 5.5 * 60 * 60 * 1000
    const toIST = (d: Date) => new Date(d.getTime() + offsetMs)
    const ai = toIST(a)
    const bi = toIST(b)
    return (
        ai.getUTCFullYear() === bi.getUTCFullYear() &&
        ai.getUTCMonth() === bi.getUTCMonth() &&
        ai.getUTCDate() === bi.getUTCDate()
    )
}

export interface PromptLimitResult {
    allowed: boolean
    remaining: number   // Infinity for pro
    used: number
    limit: number       // Infinity for pro
    plan: 'free' | 'pro'
}

export async function checkAndIncrementPromptLimit(userId: string): Promise<PromptLimitResult> {
    const plan = await getUserPlan(userId)

    if (plan === 'pro') {
        prisma.user
            .update({ where: { id: userId }, data: { promptCount: { increment: 1 } } })
            .catch(() => {})
        return { allowed: true, remaining: Infinity, used: 0, limit: Infinity, plan }
    }

    // Free: enforce 10/day, reset at midnight IST
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { dailyPromptCount: true, dailyPromptResetAt: true },
    })

    const now = new Date()
    const resetAt = user?.dailyPromptResetAt ?? now
    const needsReset = !isSameDayIST(resetAt, now)
    const currentCount = needsReset ? 0 : (user?.dailyPromptCount ?? 0)

    if (currentCount >= FREE_DAILY_LIMIT) {
        return { allowed: false, remaining: 0, used: currentCount, limit: FREE_DAILY_LIMIT, plan }
    }

    await prisma.user.update({
        where: { id: userId },
        data: {
            promptCount: { increment: 1 },
            dailyPromptCount: needsReset ? 1 : { increment: 1 },
            ...(needsReset ? { dailyPromptResetAt: now } : {}),
        },
    })

    const newCount = currentCount + 1
    return {
        allowed: true,
        remaining: FREE_DAILY_LIMIT - newCount,
        used: newCount,
        limit: FREE_DAILY_LIMIT,
        plan,
    }
}

export async function getDailyUsage(userId: string): Promise<PromptLimitResult> {
    const plan = await getUserPlan(userId)

    if (plan === 'pro') {
        return { allowed: true, remaining: Infinity, used: 0, limit: Infinity, plan }
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { dailyPromptCount: true, dailyPromptResetAt: true },
    })

    const now = new Date()
    const resetAt = user?.dailyPromptResetAt ?? now
    const needsReset = !isSameDayIST(resetAt, now)
    const used = needsReset ? 0 : (user?.dailyPromptCount ?? 0)

    return {
        allowed: used < FREE_DAILY_LIMIT,
        remaining: Math.max(0, FREE_DAILY_LIMIT - used),
        used,
        limit: FREE_DAILY_LIMIT,
        plan,
    }
}

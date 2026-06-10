import { prisma } from '@/lib/prisma'
import { getActiveSubscription, getUserPlan } from '@/lib/subscription'

export const PRO_PERIOD_ATTACH_LIMIT = 5

export type AttachUsagePeriod = 'calendar' | 'subscription'

export interface AttachLimitResult {
  allowed: boolean
  available: boolean
  remaining: number
  used: number
  limit: number
  plan: 'free' | 'pro'
  resetsOn: string
  period: AttachUsagePeriod
}

function proResetsOn(sub: { expiresAt: Date | null; startedAt: Date }): string {
  return (sub.expiresAt ?? sub.startedAt).toISOString()
}

function nextCalendarResetISO(): string {
  const offsetMs = 5.5 * 60 * 60 * 1000
  const nowIST = new Date(Date.now() + offsetMs)
  const firstOfNext = new Date(Date.UTC(
    nowIST.getUTCFullYear(),
    nowIST.getUTCMonth() + 1,
    1, 0, 0, 0
  ) - offsetMs)
  return firstOfNext.toISOString()
}

async function getProAttachUsage(userId: string): Promise<AttachLimitResult | null> {
  const sub = await getActiveSubscription(userId)
  if (!sub || String(sub.plan).toLowerCase() !== 'pro') return null

  const limit = PRO_PERIOD_ATTACH_LIMIT
  const used = sub.periodAttachCount ?? 0

  return {
    allowed: used < limit,
    available: true,
    remaining: Math.max(0, limit - used),
    used,
    limit,
    plan: 'pro',
    resetsOn: proResetsOn(sub),
    period: 'subscription',
  }
}

export async function getAttachUsage(userId: string): Promise<AttachLimitResult> {
  const plan = await getUserPlan(userId)
  const resetsOn = nextCalendarResetISO()

  if (plan !== 'pro') {
    return {
      allowed: false,
      available: false,
      remaining: 0,
      used: 0,
      limit: 0,
      plan,
      resetsOn,
      period: 'calendar',
    }
  }

  const pro = await getProAttachUsage(userId)
  if (pro) return pro

  return {
    allowed: false,
    available: false,
    remaining: 0,
    used: 0,
    limit: PRO_PERIOD_ATTACH_LIMIT,
    plan: 'pro',
    resetsOn,
    period: 'subscription',
  }
}

/** Each attached file in a send counts as 1 toward the Pro billing-period cap. */
export async function checkAndIncrementAttachLimit(
  userId: string,
  fileCount: number
): Promise<AttachLimitResult> {
  const plan = await getUserPlan(userId)
  const fallbackResets = nextCalendarResetISO()

  if (plan !== 'pro' || fileCount <= 0) {
    return {
      allowed: false,
      available: plan === 'pro',
      remaining: 0,
      used: 0,
      limit: plan === 'pro' ? PRO_PERIOD_ATTACH_LIMIT : 0,
      plan,
      resetsOn: fallbackResets,
      period: 'subscription',
    }
  }

  const sub = await getActiveSubscription(userId)
  if (!sub || String(sub.plan).toLowerCase() !== 'pro') {
    return {
      allowed: false,
      available: false,
      remaining: 0,
      used: 0,
      limit: PRO_PERIOD_ATTACH_LIMIT,
      plan: 'free',
      resetsOn: fallbackResets,
      period: 'calendar',
    }
  }

  const limit = PRO_PERIOD_ATTACH_LIMIT
  const used = sub.periodAttachCount ?? 0
  const resetsOn = proResetsOn(sub)

  if (used + fileCount > limit) {
    return {
      allowed: false,
      available: true,
      remaining: Math.max(0, limit - used),
      used,
      limit,
      plan: 'pro',
      resetsOn,
      period: 'subscription',
    }
  }

  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data: { periodAttachCount: { increment: fileCount } },
    select: { periodAttachCount: true, expiresAt: true, startedAt: true },
  })

  const newUsed = updated.periodAttachCount
  return {
    allowed: true,
    available: true,
    remaining: limit - newUsed,
    used: newUsed,
    limit,
    plan: 'pro',
    resetsOn: proResetsOn(updated),
    period: 'subscription',
  }
}

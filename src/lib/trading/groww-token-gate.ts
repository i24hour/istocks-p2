import { prisma } from '@/lib/prisma'

/**
 * Most recent daily Groww access reset instant (6:00 AM IST = 00:30 UTC).
 * Aligns with `nextGrowwReset` in groww.adapter.ts.
 */
export function lastGrowwDailyResetUtc(now = new Date()): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 30, 0, 0),
  )
  if (d.getTime() > now.getTime()) {
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return d
}

/**
 * Whether the stored Groww access token should be treated as expired for UX /
 * session purposes (user must click Connect again after each 6 AM IST window).
 */
export function isGrowwSessionTokenExpired(
  tokenExpiresAt: Date | null,
  lastValidatedAt: Date | null,
  now = new Date(),
): boolean {
  if (tokenExpiresAt) {
    return tokenExpiresAt.getTime() <= now.getTime()
  }
  const boundary = lastGrowwDailyResetUtc(now)
  if (!lastValidatedAt) return true
  return lastValidatedAt.getTime() < boundary.getTime()
}

/**
 * Clears Groww access token and connected flag when the daily session has ended.
 * API keys are kept so the user only taps Connect again.
 */
export async function invalidateExpiredGrowwConnection(userId: string): Promise<void> {
  const row = await prisma.brokerConnection.findUnique({
    where: { userId_brokerName: { userId, brokerName: 'GROWW' } },
  })
  if (!row?.accessTokenEnc || !row.isConnected) return

  if (!isGrowwSessionTokenExpired(row.tokenExpiresAt, row.lastValidatedAt, new Date())) {
    return
  }

  await prisma.brokerConnection.update({
    where: { userId_brokerName: { userId, brokerName: 'GROWW' } },
    data: {
      accessTokenEnc: null,
      tokenExpiresAt: null,
      isConnected: false,
    },
  })
}

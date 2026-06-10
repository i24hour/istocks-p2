import crypto from 'crypto'
import { prisma } from './prisma'

function truncate(text: string, max = 180): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function computeSqlFingerprint(sql: string, errorMessage: string): string {
  const normalizedError = errorMessage.toLowerCase().replace(/\s+/g, ' ').trim()
  const normalizedSql = sql.replace(/\s+/g, ' ').trim()
  return crypto
    .createHash('sha256')
    .update(`${normalizedError}|${normalizedSql}`)
    .digest('hex')
    .slice(0, 16)
}

export async function recordSqlError(params: {
  sql: string
  errorMessage: string
  errorCode?: string
  modelName?: string
  stockSymbol?: string
  timeframe?: string
  retries: number
  fingerprint?: string
}): Promise<string> {
  const fingerprint =
    params.fingerprint || computeSqlFingerprint(params.sql, params.errorMessage)

  const sqlErrorLog = (prisma as any).sqlErrorLog
  if (!sqlErrorLog) {
    console.warn('⚠️ SqlErrorLog model not generated yet; skipping persistence.')
  }

  try {
    await sqlErrorLog?.upsert({
      where: { fingerprint },
      update: {
        sql: params.sql,
        errorMessage: params.errorMessage,
        errorCode: params.errorCode,
        modelName: params.modelName,
        stockSymbol: params.stockSymbol,
        timeframe: params.timeframe,
        retries: params.retries,
        resolved: false,
        lastSeenAt: new Date(),
      },
      create: {
        fingerprint,
        sql: params.sql,
        errorMessage: params.errorMessage,
        errorCode: params.errorCode,
        modelName: params.modelName,
        stockSymbol: params.stockSymbol,
        timeframe: params.timeframe,
        retries: params.retries,
      },
    })
  } catch (err) {
    console.error('⚠️ Failed to persist SqlErrorLog:', (err as any)?.message)
  }

  return fingerprint
}

export async function markSqlFingerprintResolved(fingerprint: string) {
  try {
    const sqlErrorLog = (prisma as any).sqlErrorLog
    await sqlErrorLog?.update({
      where: { fingerprint },
      data: { resolved: true, lastSeenAt: new Date() },
    })
  } catch (err) {
    // No-op if not found
    console.error('⚠️ Failed to mark SqlErrorLog resolved:', (err as any)?.message)
  }
}

export async function getRecentSqlErrorPatterns(limit = 8): Promise<string[]> {
  try {
    const sqlErrorLog = (prisma as any).sqlErrorLog
    if (!sqlErrorLog) {
      console.warn('⚠️ SqlErrorLog model not generated yet; returning empty avoid list.')
      return []
    }

    const rows: { fingerprint: string; errorMessage: string }[] = await sqlErrorLog.findMany({
      orderBy: { lastSeenAt: 'desc' },
      take: limit,
      select: { fingerprint: true, errorMessage: true },
    })

    const formatted = rows.map((row) =>
      `Avoid ${row.fingerprint}: ${truncate(row.errorMessage)}`
    )

    return formatted
  } catch (err) {
    console.error('⚠️ Failed to fetch SqlErrorLog from Postgres:', (err as any)?.message)
    return []
  }
}

/**
 * Query Logger Service
 * Logs every AI query to the database for learning and debugging.
 */

import { prisma } from '@/lib/prisma'

export interface QueryLogInput {
    stockSymbol: string
    userId?: string | null
    userPrompt: string
    intentType?: string | null
    extractedParams?: Record<string, unknown> | null
    sqlGenerated?: string | null
    sqlSource?: 'template' | 'dynamic'
    templateId?: string | null
}

export interface QueryLogUpdate {
    sqlGenerated?: string
    sqlResult?: object
    aiResponse?: string
    success?: boolean
    errorMessage?: string
    executionTime?: number
}

/**
 * Create a new query log entry
 */
export async function createQueryLog(data: QueryLogInput) {
    return (prisma as any).queryLog.create({
        data: {
            stockSymbol: data.stockSymbol,
            userId: data.userId,
            userPrompt: data.userPrompt,
            intentType: data.intentType,
            extractedParams: data.extractedParams as object ?? undefined,
            sqlGenerated: data.sqlGenerated,
            sqlSource: data.sqlSource || 'dynamic',
            templateId: data.templateId,
        }
    })
}

/**
 * Update a query log with results
 */
export async function updateQueryLog(id: string, data: QueryLogUpdate) {
    return (prisma as any).queryLog.update({
        where: { id },
        data: {
            sqlGenerated: data.sqlGenerated,
            sqlResult: data.sqlResult ?? undefined,
            aiResponse: data.aiResponse,
            success: data.success,
            errorMessage: data.errorMessage,
            executionTime: data.executionTime,
        }
    })
}

/**
 * Get recent query logs for a stock
 */
export async function getRecentQueries(stockSymbol: string, limit = 10) {
    return (prisma as any).queryLog.findMany({
        where: { stockSymbol },
        orderBy: { createdAt: 'desc' },
        take: limit,
    })
}

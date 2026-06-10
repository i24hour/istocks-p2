/**
 * Accumulates token counts from one or more AI calls then flushes them to
 * the User row in one fire-and-forget DB update.
 *
 * Usage:
 *   const acc = createTokenAccumulator(userId)
 *   await runAIEngine(..., { onTokens: acc.add })
 *   acc.flush()   // non-blocking
 */

import { prisma } from '@/lib/prisma'

export interface TokenAccumulator {
    /** Called by runAIEngine after each model call. */
    add: (inputTokens: number, outputTokens: number) => void
    /** Fire-and-forget: increments DB counters. Never throws. */
    flush: () => void
    /** Current accumulated counts (for optional SSE reporting). */
    totals: () => { in: number; out: number }
}

export function createTokenAccumulator(userId: string): TokenAccumulator {
    let totalIn = 0
    let totalOut = 0

    return {
        add(inputTokens: number, outputTokens: number) {
            totalIn += inputTokens
            totalOut += outputTokens
        },
        flush() {
            if (totalIn === 0 && totalOut === 0) return
            const i = totalIn
            const o = totalOut
            prisma.user
                .update({
                    where: { id: userId },
                    data: {
                        totalTokensIn: { increment: i },
                        totalTokensOut: { increment: o },
                    },
                })
                .catch(() => { /* non-critical */ })
        },
        totals: () => ({ in: totalIn, out: totalOut }),
    }
}

export const maxDuration = 300
export const runtime = 'nodejs'

import { NextRequest } from 'next/server'
import { getAuthSession } from '@/lib/auth'
import { runExperts, createExpertsSession } from '@/lib/probability-agents'
import { checkAndIncrementExpertLimit } from '@/lib/expert-limit'
import type { ExpertsEvent } from '@/lib/probability-agents/types'

export async function POST(request: NextRequest) {
    const session = await getAuthSession()

    const body = await request.json()
    const { query, sessionId: existingSessionId, userProvidedData, discussionRounds } = body

    if (!query?.trim()) {
        return new Response(JSON.stringify({ error: 'Query is required' }), { status: 400 })
    }

    const userId = session?.user?.id

    // ── Enforce monthly expert limit ────────────────────────────────────────
    if (userId) {
        const limitResult = await checkAndIncrementExpertLimit(userId)
        if (!limitResult.allowed) {
            return new Response(
                JSON.stringify({
                    error: 'limit_exceeded',
                    message: limitResult.period === 'subscription'
                        ? `You've used all ${limitResult.limit} Compute 1.0 analyses for this Pro period (30 days). Renews or resets when you extend Pro — ${new Date(limitResult.resetsOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}.`
                        : `You've used all ${limitResult.limit} Compute 1.0 analyses this month. Resets on ${new Date(limitResult.resetsOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}.`,
                    used: limitResult.used,
                    limit: limitResult.limit,
                    plan: limitResult.plan,
                    resetsOn: limitResult.resetsOn,
                }),
                { status: 429, headers: { 'Content-Type': 'application/json' } }
            )
        }
    }
    // ────────────────────────────────────────────────────────────────────────

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
        async start(controller) {
            const emit = (event: ExpertsEvent) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
            }

            try {
                // Create or reuse session
                let sessionId = existingSessionId
                if (!sessionId) {
                    sessionId = await createExpertsSession(query.trim(), userId)
                    emit({ type: 'session_created', sessionId })
                }

                await runExperts(query.trim(), emit, {
                    sessionId,
                    userId,
                    userProvidedData: userProvidedData?.trim() || undefined,
                    discussionRounds: discussionRounds ?? 2,
                })
            } catch (err) {
                emit({ type: 'error', message: err instanceof Error ? err.message : 'Analysis failed' })
            } finally {
                controller.close()
            }
        },
    })

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    })
}

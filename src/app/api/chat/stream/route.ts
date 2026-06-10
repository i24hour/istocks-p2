/**
 * /api/chat/stream — Streaming SSE endpoint for Trading Agent (Web UI)
 *
 * Uses the shared AI engine from @/lib/ai-engine.
 * Emits real-time SSE events so the UI can show live AI progress.
 */

export const maxDuration = 120
export const runtime = 'nodejs'

import { NextRequest } from 'next/server'
import { getAuthSession } from '@/lib/auth'
import { checkAndIncrementPromptLimit } from '@/lib/user-limit'
import { createTokenAccumulator } from '@/lib/token-accumulator'
import {
    runAIEngine,
    normalizeConversationHistory,
    normalizeConversationMemory,
    type AIEvent,
} from '@/lib/ai-engine'
import { stripAttribution } from '@/lib/strip-attribution'

export async function POST(request: NextRequest) {
    const session = await getAuthSession()
    if (!session?.user?.id) {
        return new Response(JSON.stringify({ error: 'Please sign in to use the AI chat.' }), { status: 401 })
    }

    const limitCheck = await checkAndIncrementPromptLimit(session.user.id)
    if (!limitCheck.allowed) {
        return new Response(
            JSON.stringify({ error: `Daily limit reached. Free plan allows ${limitCheck.limit} prompts per day. Upgrade to Pro for unlimited access.`, limitReached: true }),
            { status: 429 }
        )
    }
    const tokenAcc = createTokenAccumulator(session.user.id)

    const body = await request.json()
    const { message, conversationHistory, conversationMemory, computeModel } = body
    if (!message) return new Response(JSON.stringify({ error: 'Message is required' }), { status: 400 })

    const history = normalizeConversationHistory(conversationHistory)
    const memory = normalizeConversationMemory(conversationMemory)
    const referer = request.headers.get('referer') || undefined

    // Create SSE stream
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
        async start(controller) {
            const emit = (event: AIEvent) => {
                const filtered: AIEvent =
                    event.type === 'answer'
                        ? { ...event, message: stripAttribution(event.message) }
                        : event
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(filtered)}\n\n`))
            }

            await runAIEngine(message, history, emit, referer, {
                conversationMemory: memory,
                computeModel,
                onTokens: tokenAcc.add,
            })
            tokenAcc.flush()
            controller.close()
        }
    })

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        }
    })
}

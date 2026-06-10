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

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  const session = await getAuthSession()
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Please sign in to use the AI chatbot.' }), { status: 401 })
  }

  await checkAndIncrementPromptLimit(session.user.id)
  const tokenAcc = createTokenAccumulator(session.user.id)

  const body = await request.json().catch(() => null)
  const query = typeof body?.query === 'string' ? body.query : body?.message
  if (typeof query !== 'string' || query.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'Query is required' }), { status: 400 })
  }

  const history = normalizeConversationHistory(body?.conversationHistory)
  const memory = normalizeConversationMemory(body?.conversationMemory)
  const computeModel = body?.computeModel
  const fallbackReferer = `${request.nextUrl.origin}/stock/${encodeURIComponent(
    params.symbol.toUpperCase()
  )}`
  const referer = request.headers.get('referer') || fallbackReferer

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AIEvent | Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        await runAIEngine(query, history, emit as (event: AIEvent) => void, referer, {
          conversationMemory: memory,
          computeModel,
          onTokens: tokenAcc.add,
        })
        tokenAcc.flush()
      } catch (error: any) {
        emit({
          type: 'error',
          message: typeof error?.message === 'string' && error.message.length > 0
            ? error.message
            : 'Something went wrong.',
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

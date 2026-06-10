import { NextRequest, NextResponse } from 'next/server'
import { getAuthSession } from '@/lib/auth'
import { checkAndIncrementPromptLimit } from '@/lib/user-limit'
import { createTokenAccumulator } from '@/lib/token-accumulator'
import {
  runAIEngine,
  normalizeConversationHistory,
  normalizeConversationMemory,
  type AIEvent,
  type ReplyPathOption,
} from '@/lib/ai-engine'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  const session = await getAuthSession()
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        success: false,
        error: 'Please sign in to use the AI chatbot',
        requiresAuth: true,
      },
      { status: 401 }
    )
  }

  await checkAndIncrementPromptLimit(session.user.id)
  const tokenAcc = createTokenAccumulator(session.user.id)

  const body = await request.json().catch(() => null)
  const query = typeof body?.query === 'string' ? body.query : body?.message
  if (typeof query !== 'string' || query.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: 'Query is required' },
      { status: 400 }
    )
  }

  const history = normalizeConversationHistory(body?.conversationHistory)
  const memory = normalizeConversationMemory(body?.conversationMemory)
  const fallbackReferer = `${request.nextUrl.origin}/stock/${encodeURIComponent(
    params.symbol.toUpperCase()
  )}`
  const referer = request.headers.get('referer') || fallbackReferer

  let analysis = ''
  let webSources: { name: string; url: string }[] = []
  let replyPathOptions: ReplyPathOption[] = []
  let latestMemory = memory
  let tradeIntent: {
    symbol: string
    stockName: string
    action: 'BUY' | 'SELL'
    quantity: number
    price: number
  } | null = null

  await runAIEngine(
    query,
    history,
    (event: AIEvent) => {
      if (event.type === 'answer') {
        analysis = event.message || ''
        webSources = event.webSources || []
      } else if (event.type === 'routing_options') {
        replyPathOptions = event.options
      } else if (event.type === 'trade_intent') {
        tradeIntent = {
          symbol: event.symbol,
          stockName: event.stockName,
          action: event.action,
          quantity: event.quantity,
          price: event.price,
        }
      } else if (event.type === 'memory_update') {
        latestMemory = event.memory
      } else if (event.type === 'error') {
        analysis = event.message || 'Something went wrong.'
      }
    },
    referer,
    { conversationMemory: memory }
  )
  tokenAcc.flush()

  if (!analysis) {
    return NextResponse.json(
      { success: false, error: 'No response generated.' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    analysis,
    message: analysis,
    searchedWeb: webSources.length > 0,
    webSources,
    replyWaysCount: replyPathOptions.length,
    replyPathOptions,
    tradeIntent,
    conversationMemory: latestMemory,
    debug: {
      mode: 'shared-ai-engine',
      stockContext: params.symbol.toUpperCase(),
    },
  })
}

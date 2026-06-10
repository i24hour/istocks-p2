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
import { stripAttribution } from '@/lib/strip-attribution'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const session = await getAuthSession()
  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: 'Please sign in to use the AI chat.' },
      { status: 401 }
    )
  }

  const limitCheck = await checkAndIncrementPromptLimit(session.user.id)
  if (!limitCheck.allowed) {
    return NextResponse.json(
      { success: false, error: `Daily limit reached. Free plan allows ${limitCheck.limit} prompts per day. Upgrade to Pro for unlimited access.`, limitReached: true },
      { status: 429 }
    )
  }
  const tokenAcc = createTokenAccumulator(session.user.id)

  const body = await request.json().catch(() => null)
  const message = body?.message
  if (typeof message !== 'string' || message.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: 'Message is required' },
      { status: 400 }
    )
  }

  const history = normalizeConversationHistory(body?.conversationHistory)
  const memory = normalizeConversationMemory(body?.conversationMemory)
  const computeModel = body?.computeModel
  const referer = request.headers.get('referer') || undefined

  let finalMessage = ''
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
    message,
    history,
    (event: AIEvent) => {
      if (event.type === 'answer') {
        finalMessage = stripAttribution(event.message || '')
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
        finalMessage = event.message || 'Something went wrong.'
      }
    },
    referer,
    { conversationMemory: memory, computeModel, onTokens: tokenAcc.add }
  )
  tokenAcc.flush()

  if (!finalMessage) {
    return NextResponse.json(
      { success: false, error: 'No response generated.' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    message: finalMessage,
    searchedWeb: webSources.length > 0,
    webSources,
    replyWaysCount: replyPathOptions.length,
    replyPathOptions,
    tradeIntent,
    conversationMemory: latestMemory,
  })
}

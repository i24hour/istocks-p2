import { NextRequest, NextResponse } from 'next/server'
import { getAuthSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

// ── GET /api/user/llm-settings ─────────────────────────────────────────────
// Returns the user's saved LLM config (API key is masked — only shown as *****)
export async function GET() {
  const session = await getAuthSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { llmProvider: true, llmApiKey: true, llmModel: true, llmBaseUrl: true },
  })

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  return NextResponse.json({
    provider: user.llmProvider ?? null,
    model:    user.llmModel    ?? null,
    baseUrl:  user.llmBaseUrl  ?? null,
    // Mask the key — never send it back to the browser
    hasApiKey: !!user.llmApiKey,
    maskedKey: user.llmApiKey
      ? `${user.llmApiKey.slice(0, 6)}${'•'.repeat(Math.max(0, user.llmApiKey.length - 10))}${user.llmApiKey.slice(-4)}`
      : null,
  })
}

// ── PUT /api/user/llm-settings ─────────────────────────────────────────────
// Saves / updates the user's LLM config.
// Pass apiKey = "" to clear all settings (reset to system Gemini).
export async function PUT(req: NextRequest) {
  const session = await getAuthSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { provider, apiKey, model, baseUrl } = body as {
    provider?: string
    apiKey?: string
    model?: string
    baseUrl?: string
  }

  // Clear all settings when apiKey is explicitly empty string
  if (apiKey === '') {
    await prisma.user.update({
      where: { email: session.user.email },
      data: { llmProvider: null, llmApiKey: null, llmModel: null, llmBaseUrl: null },
    })
    return NextResponse.json({ success: true, cleared: true })
  }

  // Validate required fields
  if (!provider || !apiKey || !model) {
    return NextResponse.json(
      { error: 'provider, apiKey, and model are required' },
      { status: 400 }
    )
  }

  if (provider === 'custom' && !baseUrl) {
    return NextResponse.json(
      { error: 'baseUrl is required for custom provider' },
      { status: 400 }
    )
  }

  await prisma.user.update({
    where: { email: session.user.email },
    data: {
      llmProvider: provider,
      llmApiKey:   apiKey,
      llmModel:    model,
      llmBaseUrl:  baseUrl ?? null,
    },
  })

  return NextResponse.json({ success: true })
}

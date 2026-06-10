import { NextRequest, NextResponse } from 'next/server'
import { getAuthSession } from '@/lib/auth'
import { generateFollowUpSuggestions } from '@/lib/follow-up-suggestions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const session = await getAuthSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => null)
    const userMessage = typeof body?.userMessage === 'string' ? body.userMessage : ''
    const assistantMessage = typeof body?.assistantMessage === 'string' ? body.assistantMessage : ''
    const suggestions = await generateFollowUpSuggestions(userMessage, assistantMessage)
    return NextResponse.json({ suggestions })
  } catch {
    return NextResponse.json({ suggestions: [] }, { status: 200 })
  }
}

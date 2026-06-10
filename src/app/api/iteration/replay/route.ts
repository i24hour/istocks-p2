import { NextRequest, NextResponse } from 'next/server'
import { getAuthSession } from '@/lib/auth'
import {
  evaluateReplay,
  loadIterationCases,
  replayIterationCase,
  summarizeReplayResults,
  type IterationCase,
} from '@/lib/iteration-review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const session = await getAuthSession()
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const limit = Math.min(Math.max(Number(body?.limit || 10), 1), 25)
    const providedCases = Array.isArray(body?.cases) ? body.cases as IterationCase[] : null
    const cases = providedCases?.length ? providedCases.slice(0, limit) : await loadIterationCases(limit)

    const results = []
    for (const caseItem of cases) {
      try {
        const { reply: newReply } = await replayIterationCase(caseItem)
        results.push(evaluateReplay(caseItem, newReply))
      } catch (error: any) {
        results.push(evaluateReplay(caseItem, `Replay failed: ${error?.message || 'Unknown error'}`))
      }
    }

    const summary = summarizeReplayResults(results)

    return NextResponse.json({ success: true, summary, results })
  } catch (error: any) {
    console.error('Iteration replay error:', error)
    return NextResponse.json({ success: false, error: 'Failed to replay iteration cases' }, { status: 500 })
  }
}
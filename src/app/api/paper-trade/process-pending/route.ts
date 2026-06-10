import { NextResponse } from 'next/server'
import { processPendingPaperTrades } from '@/lib/pending-paper-trades'
import { getCurrentUserBasic } from '@/lib/trading/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
  try {
    const user = await getCurrentUserBasic()
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      )
    }

    const result = await processPendingPaperTrades({ userId: user.id })

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('❌ process-pending (user trigger) failed:', error?.message || error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to process pending trades' },
      { status: 500 }
    )
  }
}

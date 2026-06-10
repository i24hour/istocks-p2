import { NextResponse } from 'next/server'
import { generateAndStoreDailyStockSelection } from '@/lib/daily-stock-selection'

export const maxDuration = 300

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const selection = await generateAndStoreDailyStockSelection()
    return NextResponse.json({
      success: true,
      generatedAt: selection.generatedAt.toISOString(),
      universeCount: selection.universeCount,
      eligibleCount: selection.eligibleCount,
      shortlistCount: selection.shortlistCount,
      storedCount: selection.candidates.length,
    })
  } catch (error: any) {
    console.error('❌ Daily stock selection cron failed:', error?.message || error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Daily stock selection failed' },
      { status: 500 }
    )
  }
}

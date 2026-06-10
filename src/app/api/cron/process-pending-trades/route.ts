import { NextResponse } from 'next/server'
import { processPendingPaperTrades } from '@/lib/pending-paper-trades'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await processPendingPaperTrades()
    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('❌ Pending trade processor cron failed:', error?.message || error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Processor failed' },
      { status: 500 }
    )
  }
}


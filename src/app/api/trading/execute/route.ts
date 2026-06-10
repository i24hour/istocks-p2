'use server'

import { NextRequest, NextResponse } from 'next/server'
import { executeTradeForUser } from '@/lib/trading/executor'
import { getCurrentUserBasic } from '@/lib/trading/auth'

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserBasic()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()

    const result = await executeTradeForUser(user.id, {
      symbol: body.symbol,
      side: body.side || body.action,
      quantity: body.quantity,
      mode: body.mode || body.tradingMode,
      productType: body.productType,
      orderType: body.orderType,
      price: body.price ?? body.entryPrice ?? null,
      confirmed: body.confirmed,
      idempotencyKey: body.idempotencyKey,
      brokerName: body.brokerName,
      sessionId: body.sessionId,
      userPrompt: typeof body.userPrompt === 'string' ? body.userPrompt.slice(0, 500) : undefined,
      targetProfitPct: typeof body.targetProfitPct === 'number' ? body.targetProfitPct : undefined,
      strategyParams: Array.isArray(body.strategyParams) ? body.strategyParams : undefined,
      conditions: Array.isArray(body.conditions) ? body.conditions : undefined,
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error: any) {
    console.error('Trading execute error:', error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to execute trade' },
      { status: 400 }
    )
  }
}

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveCanonicalSymbol } from '@/lib/instrumentRegistry'
import { executeTradeForUser } from '@/lib/trading/executor'
import { getCurrentUserBasic } from '@/lib/trading/auth'

// Backward-compatible wrapper.
// - Watch orders (status=PENDING) still create pending paper orders.
// - Immediate execution routes through unified executor in PAPER mode.
export async function POST(req: Request) {
  try {
    const user = await getCurrentUserBasic()
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const { symbol, action, quantity, orderType, productType, status, conditions, sessionId, userPrompt, mode, brokerName } = body

    const normalizedSymbol = await resolveCanonicalSymbol(symbol || '')
    if (!normalizedSymbol || !action) {
      return NextResponse.json(
        { success: false, error: 'Missing symbol or action' },
        { status: 400 }
      )
    }

    if (status === 'PENDING') {
      const entryData = {
        conditions: conditions || [],
        sessionId: sessionId || null,
        ...(userPrompt && typeof userPrompt === 'string' ? { userPrompt: userPrompt.slice(0, 500) } : {}),
      } as any

      const tradingMode = mode === 'LIVE' ? 'LIVE' : 'PAPER'
      const trade = await prisma.tradingOrder.create({
        data: {
          userId: user.id,
          symbol: normalizedSymbol,
          orderType: action,
          productType: productType || 'INTRADAY',
          quantity: quantity || 1,
          status: 'PENDING',
          entryCondition: entryData,
          tradingMode,
          brokerName: tradingMode === 'LIVE' && brokerName ? brokerName : null,
          positionValue: 0,
          idempotencyKey: `watch-${crypto.randomUUID()}`,
        },
      })

      return NextResponse.json({
        success: true,
        message: 'Watch order registered successfully',
        tradeId: trade.id,
      })
    }

    const result = await executeTradeForUser(user.id, {
      symbol: normalizedSymbol,
      side: action,
      quantity: quantity || 1,
      mode: 'PAPER',
      productType: productType || 'INTRADAY',
      orderType: orderType || 'MARKET',
      confirmed: true,
      idempotencyKey: body.idempotencyKey || `paper-${crypto.randomUUID()}`,
      sessionId,
    })

    if (result.status === 'PENDING' || result.deferred) {
      return NextResponse.json({
        success: true,
        trade: {
          symbol: result.symbol,
          action: result.side,
          quantity: result.quantity,
          price: null,
          totalValue: 0,
          timestamp: new Date().toISOString(),
          orderType: orderType || 'MARKET',
          status: result.status,
          dbId: result.orderId,
        },
        message: result.message || 'Trade queued in Conditional and will auto-execute when market opens.',
      })
    }

    return NextResponse.json({
      success: true,
      trade: {
        symbol: result.symbol,
        action: result.side,
        quantity: result.quantity,
        price: result.executedPrice,
        totalValue: (result.executedPrice || 0) * result.quantity,
        timestamp: new Date().toISOString(),
        orderType: orderType || 'MARKET',
        status: result.status,
        dbId: result.orderId,
      },
      message: `Successfully executed ${result.side} order for ${result.quantity} ${result.symbol}`,
    })
  } catch (error: any) {
    console.error('Paper trade error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

'use server'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUserBasic } from '@/lib/trading/auth'
import { isBrokerName } from '@/lib/trading/types'

export async function DELETE(
  _request: Request,
  { params }: { params: { broker: string } }
) {
  try {
    const user = await getCurrentUserBasic()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const broker = params.broker.toUpperCase()
    if (!isBrokerName(broker)) {
      return NextResponse.json({ error: 'Unsupported broker' }, { status: 400 })
    }

    await prisma.$transaction([
      prisma.brokerConnection.updateMany({
        where: { userId: user.id, brokerName: broker },
        data: {
          accessTokenEnc: null,
          tokenExpiresAt: null,
          isConnected: false,
          lastValidatedAt: null,
        },
      }),
      prisma.brokerAuthState.deleteMany({
        where: { userId: user.id, brokerName: broker, usedAt: null },
      }),
      prisma.userTradingPreference.updateMany({
        where: { userId: user.id, preferredLiveBroker: broker },
        data: {
          preferredLiveBroker: null,
          tradingMode: 'PAPER',
        },
      }),
    ])

    return NextResponse.json({
      success: true,
      message: `${broker} disconnected`,
    })
  } catch (error) {
    console.error('Broker disconnect error:', error)
    return NextResponse.json({ error: 'Failed to disconnect broker' }, { status: 500 })
  }
}

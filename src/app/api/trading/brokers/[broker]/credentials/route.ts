'use server'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encryptSecret } from '@/lib/crypto'
import { getCurrentUserBasic } from '@/lib/trading/auth'
import { isBrokerName } from '@/lib/trading/types'

export async function POST(
  request: NextRequest,
  { params }: { params: { broker: string } }
) {
  try {
    const user = await getCurrentUserBasic()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const broker = params.broker.toUpperCase()
    if (!isBrokerName(broker)) {
      return NextResponse.json({ error: 'Unsupported broker' }, { status: 400 })
    }

    const body = await request.json()
    const apiKey = body?.apiKey?.trim?.() || ''
    const apiSecret = body?.apiSecret?.trim?.() || ''
    const clientId = body?.clientId?.trim?.() || ''

    if (!apiKey) {
      return NextResponse.json({ error: 'apiKey is required' }, { status: 400 })
    }

    if (broker === 'ZERODHA' && !apiSecret) {
      return NextResponse.json({ error: 'apiSecret is required for Zerodha' }, { status: 400 })
    }

    if (broker === 'DHAN' && (!apiSecret || !clientId)) {
      return NextResponse.json(
        { error: 'apiSecret and clientId are required for Dhan' },
        { status: 400 }
      )
    }

    if (broker === 'GROWW' && !apiSecret) {
      return NextResponse.json(
        { error: 'apiSecret is required for Groww' },
        { status: 400 }
      )
    }

    const connection = await prisma.brokerConnection.upsert({
      where: {
        userId_brokerName: {
          userId: user.id,
          brokerName: broker,
        },
      },
      update: {
        apiKeyEnc: encryptSecret(apiKey),
        apiSecretEnc: encryptSecret(apiSecret || null),
        clientIdEnc: encryptSecret(clientId || null),
        // Credentials update invalidates prior session token.
        accessTokenEnc: null,
        tokenExpiresAt: null,
        isConnected: false,
        lastValidatedAt: null,
      },
      create: {
        userId: user.id,
        brokerName: broker,
        apiKeyEnc: encryptSecret(apiKey),
        apiSecretEnc: encryptSecret(apiSecret || null),
        clientIdEnc: encryptSecret(clientId || null),
        accessTokenEnc: null,
        tokenExpiresAt: null,
        isConnected: false,
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        brokerName: connection.brokerName,
        configured: true,
        connected: false,
      },
    })
  } catch (error) {
    console.error('Broker credentials error:', error)
    return NextResponse.json({ error: 'Failed to save broker credentials' }, { status: 500 })
  }
}

'use server'

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decryptSecret } from '@/lib/crypto'
import { getCurrentUserBasic } from '@/lib/trading/auth'
import { getBrokerAdapter } from '@/lib/brokers/factory'
import { isBrokerName } from '@/lib/trading/types'

function getRedirectUri(req: NextRequest, broker: string): string {
  const baseUrl = process.env.NEXTAUTH_URL || req.nextUrl.origin
  return `${baseUrl}/api/trading/brokers/${broker.toLowerCase()}/callback`
}

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

    const connection = await prisma.brokerConnection.findUnique({
      where: {
        userId_brokerName: {
          userId: user.id,
          brokerName: broker,
        },
      },
    })

    if (!connection) {
      return NextResponse.json(
        { error: 'Please save broker credentials first' },
        { status: 400 }
      )
    }

    const credentials = {
      apiKey: decryptSecret(connection.apiKeyEnc),
      apiSecret: decryptSecret(connection.apiSecretEnc),
      clientId: decryptSecret(connection.clientIdEnc),
      accessToken: decryptSecret(connection.accessTokenEnc),
      tokenExpiresAt: connection.tokenExpiresAt,
      meta: (connection.metaJson as Record<string, unknown> | null) || null,
    }

    const state = crypto.randomBytes(24).toString('hex')
    const redirectUri = getRedirectUri(request, broker)

    const adapter = getBrokerAdapter(broker)
    const start = await adapter.connectStart({
      state,
      redirectUri,
      credentials,
    })

    await prisma.brokerAuthState.create({
      data: {
        userId: user.id,
        brokerName: broker,
        state,
        consentId:
          typeof start.meta?.consentAppId === 'string'
            ? start.meta.consentAppId
            : typeof start.meta?.consentId === 'string'
              ? start.meta.consentId
              : null,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        redirectUrl: start.redirectUrl,
      },
    })
  } catch (error: any) {
    console.error('Broker connect start error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to start broker connection flow' },
      { status: 500 }
    )
  }
}

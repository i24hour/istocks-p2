'use server'

import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { isBrokerName, normalizeMode } from '@/lib/trading/types'

async function getCurrentUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })

  return user?.id || null
}

import { invalidateExpiredGrowwConnection } from '@/lib/trading/groww-token-gate'

// GET /api/trading/settings
export async function GET() {
  try {
    const userId = await getCurrentUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await invalidateExpiredGrowwConnection(userId)

    const [preference, connections] = await Promise.all([
      prisma.userTradingPreference.findUnique({ where: { userId } }),
      prisma.brokerConnection.findMany({
        where: { userId },
        select: {
          brokerName: true,
          isConnected: true,
          lastValidatedAt: true,
          updatedAt: true,
          apiKeyEnc: true,
          apiSecretEnc: true,
          clientIdEnc: true,
          accessTokenEnc: true,
        },
      }),
    ])

    const statusByBroker: Record<string, any> = {
      ZERODHA: {
        configured: false,
        connected: false,
        lastValidatedAt: null,
      },
      DHAN: {
        configured: false,
        connected: false,
        lastValidatedAt: null,
      },
      GROWW: {
        configured: false,
        connected: false,
        lastValidatedAt: null,
      },
      ANGELONE: {
        configured: false,
        connected: false,
        lastValidatedAt: null,
      },
    }

    for (const connection of connections) {
      if (!isBrokerName(connection.brokerName)) continue
      statusByBroker[connection.brokerName] = {
        configured: Boolean(connection.apiKeyEnc || connection.clientIdEnc || connection.apiSecretEnc),
        connected: Boolean(connection.isConnected && connection.accessTokenEnc),
        lastValidatedAt: connection.lastValidatedAt,
        updatedAt: connection.updatedAt,
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        tradingMode: normalizeMode(preference?.tradingMode),
        preferredLiveBroker:
          preference?.preferredLiveBroker && isBrokerName(preference.preferredLiveBroker)
            ? preference.preferredLiveBroker
            : null,
        brokers: statusByBroker,
      },
    })
  } catch (error) {
    console.error('Settings GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

// PATCH /api/trading/settings
export async function PATCH(request: NextRequest) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const tradingMode = normalizeMode(body?.tradingMode)
    const preferredLiveBrokerRaw = body?.preferredLiveBroker

    const preferredLiveBroker =
      typeof preferredLiveBrokerRaw === 'string' && preferredLiveBrokerRaw.length > 0
        ? preferredLiveBrokerRaw.toUpperCase()
        : null

    if (preferredLiveBroker && !isBrokerName(preferredLiveBroker)) {
      return NextResponse.json(
        { error: 'preferredLiveBroker must be ZERODHA, DHAN, GROWW, or ANGELONE' },
        { status: 400 }
      )
    }

    if (tradingMode === 'LIVE' && !preferredLiveBroker) {
      return NextResponse.json(
        { error: 'preferredLiveBroker is required when tradingMode is LIVE' },
        { status: 400 }
      )
    }

    const pref = await prisma.userTradingPreference.upsert({
      where: { userId },
      update: {
        tradingMode,
        preferredLiveBroker,
      },
      create: {
        userId,
        tradingMode,
        preferredLiveBroker,
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        tradingMode: pref.tradingMode,
        preferredLiveBroker: pref.preferredLiveBroker,
      },
    })
  } catch (error) {
    console.error('Settings PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}

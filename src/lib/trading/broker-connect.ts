import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { getBrokerAdapter } from '@/lib/brokers/factory'
import { getCurrentUserBasic } from '@/lib/trading/auth'
import type { BrokerName } from '@/lib/trading/types'

function settingsRedirect(req: NextRequest, broker: BrokerName, ok: boolean, message?: string) {
  const url = req.nextUrl.clone()
  url.pathname = '/trading/settings'
  url.search = ''
  url.searchParams.set('broker', broker)
  url.searchParams.set('connected', ok ? '1' : '0')
  if (message) url.searchParams.set('message', message)
  return NextResponse.redirect(url)
}

export async function handleBrokerCallback(
  req: NextRequest,
  broker: BrokerName,
  options: { requireState: boolean }
) {
  const user = await getCurrentUserBasic()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    return settingsRedirect(req, broker, false, 'Missing broker credentials')
  }

  let authState = null as any
  if (options.requireState) {
    const state = req.nextUrl.searchParams.get('state')
    if (!state) {
      return settingsRedirect(req, broker, false, 'Missing state in callback')
    }

    authState = await prisma.brokerAuthState.findUnique({ where: { state } })
    if (!authState || authState.userId !== user.id || authState.brokerName !== broker) {
      return settingsRedirect(req, broker, false, 'Invalid callback state')
    }
  } else {
    authState = await prisma.brokerAuthState.findFirst({
      where: {
        userId: user.id,
        brokerName: broker,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!authState) {
      return settingsRedirect(req, broker, false, 'No pending auth state found')
    }
  }

  if (authState.usedAt || authState.expiresAt < new Date()) {
    return settingsRedirect(req, broker, false, 'Callback state expired')
  }

  const credentials = {
    apiKey: decryptSecret(connection.apiKeyEnc),
    apiSecret: decryptSecret(connection.apiSecretEnc),
    clientId: decryptSecret(connection.clientIdEnc),
    accessToken: decryptSecret(connection.accessTokenEnc),
    tokenExpiresAt: connection.tokenExpiresAt,
    meta: (connection.metaJson as Record<string, unknown> | null) || null,
  }

  try {
    const adapter = getBrokerAdapter(broker)
    const callback = await adapter.connectCallback({
      query: req.nextUrl.searchParams,
      redirectUri: `${req.nextUrl.origin}/api/trading/brokers/${broker.toLowerCase()}/callback`,
      credentials,
    })

    const existingMeta = (connection.metaJson as Record<string, unknown> | null) || {}
    const mergedMeta = {
      ...existingMeta,
      ...(callback.meta || {}),
      connectedAt: new Date().toISOString(),
    }

    const clientIdFromMeta =
      typeof callback.meta?.dhanClientId === 'string' ? callback.meta.dhanClientId : null

    await prisma.$transaction([
      prisma.brokerConnection.update({
        where: {
          userId_brokerName: {
            userId: user.id,
            brokerName: broker,
          },
        },
        data: {
          accessTokenEnc: encryptSecret(callback.accessToken),
          tokenExpiresAt: callback.tokenExpiresAt || null,
          isConnected: true,
          lastValidatedAt: new Date(),
          ...(clientIdFromMeta ? { clientIdEnc: encryptSecret(clientIdFromMeta) } : {}),
          metaJson: mergedMeta,
        },
      }),
      prisma.brokerAuthState.update({
        where: { id: authState.id },
        data: { usedAt: new Date() },
      }),
    ])

    return settingsRedirect(req, broker, true, `${broker} connected successfully`)
  } catch (error: any) {
    console.error(`${broker} callback error:`, error)

    await prisma.brokerConnection.update({
      where: {
        userId_brokerName: {
          userId: user.id,
          brokerName: broker,
        },
      },
      data: {
        isConnected: false,
      },
    })

    return settingsRedirect(req, broker, false, error?.message || 'Broker callback failed')
  }
}

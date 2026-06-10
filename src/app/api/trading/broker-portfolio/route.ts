'use server'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { getCurrentUserBasic } from '@/lib/trading/auth'
import { getBrokerAdapter } from '@/lib/brokers/factory'
import { isBrokerName } from '@/lib/trading/types'
import { fetchCascadingPrices } from '@/lib/cascading-price-fetch'
import { invalidateExpiredGrowwConnection } from '@/lib/trading/groww-token-gate'

export async function GET() {
    const user = await getCurrentUserBasic()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    await invalidateExpiredGrowwConnection(user.id)

    const connections = await prisma.brokerConnection.findMany({
        where: { userId: user.id, isConnected: true },
        orderBy: { updatedAt: 'desc' },
    })

    if (connections.length === 0) {
        return NextResponse.json({ success: true, data: [], broker: null })
    }

    // Use first connected broker (priority: GROWW > ZERODHA > DHAN)
    const priority = ['GROWW', 'ANGELONE', 'ZERODHA', 'DHAN']
    const connection = connections.sort((a, b) =>
        priority.indexOf(a.brokerName) - priority.indexOf(b.brokerName)
    )[0]

    const brokerName = connection.brokerName
    if (!isBrokerName(brokerName)) {
        return NextResponse.json({ error: 'Unsupported broker' }, { status: 400 })
    }

    const adapter = getBrokerAdapter(brokerName)
    if (!adapter.getHoldings) {
        return NextResponse.json({
            error: `Holdings not supported for ${brokerName} yet`,
            broker: brokerName,
        }, { status: 501 })
    }

    let credentials = {
        apiKey: decryptSecret(connection.apiKeyEnc),
        apiSecret: decryptSecret(connection.apiSecretEnc),
        clientId: decryptSecret(connection.clientIdEnc),
        accessToken: decryptSecret(connection.accessTokenEnc),
        tokenExpiresAt: connection.tokenExpiresAt,
        meta: (connection.metaJson as Record<string, unknown> | null) || null,
    }

    // Auto-refresh token if needed
    if (adapter.refreshIfNeeded) {
        try {
            const refreshed = await adapter.refreshIfNeeded(credentials)
            if (refreshed.accessToken !== credentials.accessToken) {
                await prisma.brokerConnection.update({
                    where: { userId_brokerName: { userId: user.id, brokerName } },
                    data: {
                        accessTokenEnc: encryptSecret(refreshed.accessToken),
                        tokenExpiresAt: refreshed.tokenExpiresAt ?? null,
                    },
                })
                credentials = { ...credentials, ...refreshed }
            }
        } catch {
            // proceed with existing token
        }
    }

    try {
        // Step 1: Get holdings (symbol, qty, avg_price) from broker
        const holdings = await adapter.getHoldings(credentials)

        if (holdings.length === 0) {
            return NextResponse.json({ success: true, broker: brokerName, data: [], summary: { totalInvested: 0, totalCurrent: 0, totalPnl: 0, totalPnlPercent: 0, count: 0 } })
        }

        // Step 2: Fetch live prices for all symbols via EC2/Yahoo cascading feed
        const symbols = holdings.map(h => h.symbol)
        const priceMap = await fetchCascadingPrices(symbols)

        // Step 3: Enrich each holding with live LTP + recalculate P&L
        const enriched = holdings.map(h => {
            const priceData = priceMap.get(h.symbol)
            const ltp = priceData?.price ?? h.averagePrice
            const currentValue = h.quantity * ltp
            const investedValue = h.quantity * h.averagePrice
            const pnl = currentValue - investedValue
            const pnlPercent = investedValue > 0 ? (pnl / investedValue) * 100 : 0
            const dayChange = priceData?.changePercent ?? 0
            return {
                ...h,
                ltp,
                currentValue,
                investedValue,
                pnl,
                pnlPercent,
                dayChangePercent: dayChange,
                priceSource: priceData?.source ?? 'fallback',
            }
        })

        const totalInvested = enriched.reduce((s, h) => s + h.investedValue, 0)
        const totalCurrent = enriched.reduce((s, h) => s + h.currentValue, 0)
        const totalPnl = totalCurrent - totalInvested

        return NextResponse.json({
            success: true,
            broker: brokerName,
            data: enriched,
            summary: {
                totalInvested,
                totalCurrent,
                totalPnl,
                totalPnlPercent: totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0,
                count: enriched.length,
            },
        })
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Failed to fetch broker holdings' }, { status: 502 })
    }
}

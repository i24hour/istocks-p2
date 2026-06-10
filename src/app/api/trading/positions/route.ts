'use server'

import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

// GET: List user's positions
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions)
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email }
        })
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }

        const { searchParams } = new URL(request.url)
        const status = searchParams.get('status') || 'OPEN'
        const tradingMode = searchParams.get('mode') || 'PAPER'

        const positions = await (prisma as any).position.findMany({
            where: {
                userId: user.id,
                status,
                tradingMode
            },
            orderBy: { createdAt: 'desc' }
        })

        return NextResponse.json({ success: true, data: positions })
    } catch (error) {
        console.error('Positions GET error:', error)
        return NextResponse.json({ error: 'Failed to fetch positions' }, { status: 500 })
    }
}

// POST: Open a new position (manual or from order execution)
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions)
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email }
        })
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }

        const body = await request.json()
        const {
            symbol,
            productType,
            side,           // LONG | SHORT
            quantity,
            entryPrice,
            stopLoss,
            takeProfit,
            tradingMode,
            expiryDate,
            strikePrice,
            optionType
        } = body

        if (!symbol || !productType || !side || !quantity || !entryPrice) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            )
        }

        const position = await (prisma as any).position.create({
            data: {
                userId: user.id,
                symbol,
                productType,
                side,
                quantity,
                entryPrice,
                currentPrice: entryPrice,
                stopLoss,
                takeProfit,
                tradingMode: tradingMode || 'PAPER',
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                strikePrice,
                optionType,
                status: 'OPEN'
            }
        })

        return NextResponse.json({ success: true, data: position })
    } catch (error) {
        console.error('Positions POST error:', error)
        return NextResponse.json({ error: 'Failed to open position' }, { status: 500 })
    }
}

// PATCH: Update position (stop loss, take profit, or close)
export async function PATCH(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions)
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email }
        })
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }

        const body = await request.json()
        const { id, stopLoss, takeProfit, close, exitPrice } = body

        if (!id) {
            return NextResponse.json({ error: 'Position ID required' }, { status: 400 })
        }

        const position = await (prisma as any).position.findFirst({
            where: { id, userId: user.id }
        })

        if (!position) {
            return NextResponse.json({ error: 'Position not found' }, { status: 404 })
        }

        // Close position
        if (close) {
            const closePrice = exitPrice || position.currentPrice || position.entryPrice
            const pnl = position.side === 'LONG'
                ? (closePrice - position.entryPrice) * position.quantity
                : (position.entryPrice - closePrice) * position.quantity

            const updated = await (prisma as any).position.update({
                where: { id },
                data: {
                    status: 'CLOSED',
                    exitPrice: closePrice,
                    exitedAt: new Date(),
                    realizedPnL: pnl
                }
            })

            return NextResponse.json({ success: true, data: updated })
        }

        // Update stop loss / take profit
        const updated = await (prisma as any).position.update({
            where: { id },
            data: {
                ...(stopLoss !== undefined && { stopLoss }),
                ...(takeProfit !== undefined && { takeProfit })
            }
        })

        return NextResponse.json({ success: true, data: updated })
    } catch (error) {
        console.error('Positions PATCH error:', error)
        return NextResponse.json({ error: 'Failed to update position' }, { status: 500 })
    }
}

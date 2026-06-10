'use server'

import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { executeTradeForUser } from '@/lib/trading/executor'

// GET: List user's trading orders
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
        const status = searchParams.get('status') // PENDING, EXECUTED, etc.
        const symbol = searchParams.get('symbol')

        const orders = await (prisma as any).tradingOrder.findMany({
            where: {
                userId: user.id,
                ...(status && { status }),
                ...(symbol && { symbol })
            },
            orderBy: { createdAt: 'desc' },
            take: 100
        })

        return NextResponse.json({ success: true, data: orders })
    } catch (error) {
        console.error('Orders GET error:', error)
        return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
    }
}

// POST: Create new trading order
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
            orderType,      // BUY | SELL
            productType,    // INTRADAY | CNC | FNO_FUT | FNO_OPT
            quantity,
            entryCondition, // {indicator, operator, value}
            entryPrice,
            stopLoss,
            takeProfit,
            trailingStopPct,
            positionValue,
            tradingMode,    // PAPER | REAL
            expiresAt,
            // F&O specific
            expiryDate,
            strikePrice,
            optionType
        } = body

        // Validate required fields
        if (!symbol || !orderType || !productType || !quantity || !positionValue) {
            return NextResponse.json(
                { error: 'Missing required fields: symbol, orderType, productType, quantity, positionValue' },
                { status: 400 }
            )
        }

        const normalizedMode = tradingMode === 'REAL' ? 'LIVE' : 'PAPER'

        if (normalizedMode === 'LIVE') {
            const execution = await executeTradeForUser(user.id, {
                symbol,
                side: orderType,
                quantity,
                mode: 'LIVE',
                productType: productType === 'CNC' ? 'DELIVERY' : 'INTRADAY',
                orderType: entryPrice ? 'LIMIT' : 'MARKET',
                price: entryPrice || null,
                confirmed: true,
                idempotencyKey: body.idempotencyKey || `orders-${crypto.randomUUID()}`,
                brokerName: body.brokerName,
            })

            return NextResponse.json({ success: true, data: execution })
        }

        const order = await (prisma as any).tradingOrder.create({
            data: {
                userId: user.id,
                symbol,
                orderType,
                productType,
                quantity,
                entryCondition,
                entryPrice,
                stopLoss,
                takeProfit,
                trailingStopPct,
                positionValue,
                tradingMode: tradingMode || 'PAPER',
                idempotencyKey: body.idempotencyKey || `orders-${crypto.randomUUID()}`,
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                strikePrice,
                optionType,
                status: 'PENDING'
            }
        })

        return NextResponse.json({ success: true, data: order })
    } catch (error) {
        console.error('Orders POST error:', error)
        return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
    }
}

// DELETE: Cancel a pending order
export async function DELETE(request: NextRequest) {
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
        const orderId = searchParams.get('id')

        if (!orderId) {
            return NextResponse.json({ error: 'Order ID required' }, { status: 400 })
        }

        // Verify ownership and status
        const order = await (prisma as any).tradingOrder.findFirst({
            where: { id: orderId, userId: user.id }
        })

        if (!order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 })
        }

        if (order.status !== 'PENDING') {
            return NextResponse.json({ error: 'Can only cancel pending orders' }, { status: 400 })
        }

        await (prisma as any).tradingOrder.update({
            where: { id: orderId },
            data: { status: 'CANCELLED' }
        })

        return NextResponse.json({ success: true, message: 'Order cancelled' })
    } catch (error) {
        console.error('Orders DELETE error:', error)
        return NextResponse.json({ error: 'Failed to cancel order' }, { status: 500 })
    }
}

'use server'

import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

// GET: List user's holdings
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
        const tradingMode = searchParams.get('mode') || 'PAPER'

        const holdings = await (prisma as any).holding.findMany({
            where: {
                userId: user.id,
                tradingMode
            },
            include: {
                transactions: {
                    orderBy: { createdAt: 'desc' },
                    take: 10
                }
            },
            orderBy: { updatedAt: 'desc' }
        })

        // Calculate totals
        const summary = holdings.reduce((acc: any, h: any) => ({
            totalInvested: acc.totalInvested + h.investedValue,
            totalCurrent: acc.totalCurrent + (h.currentValue || h.investedValue),
            totalPnL: acc.totalPnL + h.unrealizedPnL,
            totalDayChange: acc.totalDayChange + h.dayChange
        }), { totalInvested: 0, totalCurrent: 0, totalPnL: 0, totalDayChange: 0 })

        return NextResponse.json({
            success: true,
            data: holdings,
            summary: {
                ...summary,
                totalReturnPct: summary.totalInvested > 0
                    ? ((summary.totalCurrent - summary.totalInvested) / summary.totalInvested) * 100
                    : 0
            }
        })
    } catch (error) {
        console.error('Holdings GET error:', error)
        return NextResponse.json({ error: 'Failed to fetch holdings' }, { status: 500 })
    }
}

// POST: Add to holdings (buy stock)
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
        const { symbol, quantity, price, tradingMode = 'PAPER' } = body

        if (!symbol || !quantity || !price) {
            return NextResponse.json(
                { error: 'Missing required fields: symbol, quantity, price' },
                { status: 400 }
            )
        }

        const total = quantity * price

        // Check if holding exists
        const existing = await (prisma as any).holding.findUnique({
            where: {
                userId_symbol_tradingMode: {
                    userId: user.id,
                    symbol,
                    tradingMode
                }
            }
        })

        let holding
        if (existing) {
            // Add to existing holding (weighted average)
            const newQuantity = existing.quantity + quantity
            const newInvested = existing.investedValue + total
            const newAvgPrice = newInvested / newQuantity

            holding = await (prisma as any).holding.update({
                where: { id: existing.id },
                data: {
                    quantity: newQuantity,
                    avgPrice: newAvgPrice,
                    investedValue: newInvested
                }
            })
        } else {
            // Create new holding
            holding = await (prisma as any).holding.create({
                data: {
                    userId: user.id,
                    symbol,
                    quantity,
                    avgPrice: price,
                    investedValue: total,
                    currentPrice: price,
                    currentValue: total,
                    tradingMode
                }
            })
        }

        // Record transaction
        await (prisma as any).holdingTransaction.create({
            data: {
                holdingId: holding.id,
                type: 'BUY',
                quantity,
                price,
                total
            }
        })

        return NextResponse.json({ success: true, data: holding })
    } catch (error) {
        console.error('Holdings POST error:', error)
        return NextResponse.json({ error: 'Failed to add holding' }, { status: 500 })
    }
}

// PATCH: Sell from holdings
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
        const { id, sellQuantity, sellPrice } = body

        if (!id || !sellQuantity || !sellPrice) {
            return NextResponse.json(
                { error: 'Missing required fields: id, sellQuantity, sellPrice' },
                { status: 400 }
            )
        }

        const holding = await (prisma as any).holding.findFirst({
            where: { id, userId: user.id }
        })

        if (!holding) {
            return NextResponse.json({ error: 'Holding not found' }, { status: 404 })
        }

        if (sellQuantity > holding.quantity) {
            return NextResponse.json({ error: 'Insufficient quantity' }, { status: 400 })
        }

        const sellTotal = sellQuantity * sellPrice
        const remainingQty = holding.quantity - sellQuantity

        if (remainingQty === 0) {
            // Delete holding if fully sold
            await (prisma as any).holding.delete({ where: { id } })
        } else {
            // Update holding
            const remainingInvested = holding.avgPrice * remainingQty
            await (prisma as any).holding.update({
                where: { id },
                data: {
                    quantity: remainingQty,
                    investedValue: remainingInvested,
                    currentValue: (holding.currentPrice || holding.avgPrice) * remainingQty
                }
            })

            // Record transaction
            await (prisma as any).holdingTransaction.create({
                data: {
                    holdingId: id,
                    type: 'SELL',
                    quantity: sellQuantity,
                    price: sellPrice,
                    total: sellTotal
                }
            })
        }

        // Calculate realized P&L
        const realizedPnL = (sellPrice - holding.avgPrice) * sellQuantity

        return NextResponse.json({
            success: true,
            message: `Sold ${sellQuantity} shares`,
            realizedPnL
        })
    } catch (error) {
        console.error('Holdings PATCH error:', error)
        return NextResponse.json({ error: 'Failed to sell holding' }, { status: 500 })
    }
}

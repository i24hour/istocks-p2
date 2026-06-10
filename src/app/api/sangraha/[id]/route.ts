import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession } from '@/lib/auth'

// GET /api/sangraha/[id] - Get strategy detail
export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getAuthSession()
        const { id } = params

        const strategy = await prisma.strategy.findUnique({
            where: { id },
            include: {
                author: {
                    select: { id: true, name: true, image: true }
                },
                backtests: {
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                    select: {
                        id: true,
                        stockSymbol: true,
                        startDate: true,
                        endDate: true,
                        totalTrades: true,
                        winRate: true,
                        totalPnL: true,
                        status: true,
                        createdAt: true
                    }
                },
                forkedFrom: {
                    select: { id: true, name: true, author: { select: { name: true } } }
                },
                _count: {
                    select: { forkChildren: true, starredBy: true }
                }
            }
        })

        if (!strategy) {
            return NextResponse.json(
                { success: false, error: 'Strategy not found' },
                { status: 404 }
            )
        }

        // Check access - private strategies only visible to owner
        if (strategy.visibility === 'private' && strategy.authorId !== session?.user?.id) {
            return NextResponse.json(
                { success: false, error: 'Strategy not found' },
                { status: 404 }
            )
        }

        // Check if current user has starred
        let isStarred = false
        if (session?.user?.id) {
            const star = await prisma.strategyStar.findUnique({
                where: {
                    strategyId_userId: {
                        strategyId: id,
                        userId: session.user.id
                    }
                }
            })
            isStarred = !!star
        }

        return NextResponse.json({
            success: true,
            data: {
                ...strategy,
                isStarred,
                isOwner: strategy.authorId === session?.user?.id,
                starCount: strategy._count.starredBy,
                forkCount: strategy._count.forkChildren
            }
        })
    } catch (error) {
        console.error('Error fetching strategy:', error)
        return NextResponse.json(
            { success: false, error: 'Failed to fetch strategy' },
            { status: 500 }
        )
    }
}

// PATCH /api/sangraha/[id] - Update strategy
export async function PATCH(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getAuthSession()

        if (!session?.user?.id) {
            return NextResponse.json(
                { success: false, error: 'Authentication required' },
                { status: 401 }
            )
        }

        const { id } = params

        // Check ownership
        const strategy = await prisma.strategy.findUnique({
            where: { id }
        })

        if (!strategy || strategy.authorId !== session.user.id) {
            return NextResponse.json(
                { success: false, error: 'Not authorized' },
                { status: 403 }
            )
        }

        const body = await request.json()
        const { name, description, readme, visibility, tags } = body

        const updated = await prisma.strategy.update({
            where: { id },
            data: {
                ...(name && { name }),
                ...(description !== undefined && { description }),
                ...(readme && { readme }),
                ...(visibility && { visibility }),
                ...(tags && { tags })
            }
        })

        return NextResponse.json({
            success: true,
            data: updated
        })
    } catch (error) {
        console.error('Error updating strategy:', error)
        return NextResponse.json(
            { success: false, error: 'Failed to update strategy' },
            { status: 500 }
        )
    }
}

// DELETE /api/sangraha/[id] - Delete strategy
export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getAuthSession()

        if (!session?.user?.id) {
            return NextResponse.json(
                { success: false, error: 'Authentication required' },
                { status: 401 }
            )
        }

        const { id } = params

        // Check ownership
        const strategy = await prisma.strategy.findUnique({
            where: { id }
        })

        if (!strategy || strategy.authorId !== session.user.id) {
            return NextResponse.json(
                { success: false, error: 'Not authorized' },
                { status: 403 }
            )
        }

        await prisma.strategy.delete({
            where: { id }
        })

        return NextResponse.json({
            success: true,
            message: 'Strategy deleted'
        })
    } catch (error) {
        console.error('Error deleting strategy:', error)
        return NextResponse.json(
            { success: false, error: 'Failed to delete strategy' },
            { status: 500 }
        )
    }
}

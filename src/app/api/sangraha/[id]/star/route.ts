import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession } from '@/lib/auth'

// POST /api/sangraha/[id]/star - Toggle star on strategy
export async function POST(
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

        // Check if strategy exists
        const strategy = await prisma.strategy.findUnique({
            where: { id }
        })

        if (!strategy) {
            return NextResponse.json(
                { success: false, error: 'Strategy not found' },
                { status: 404 }
            )
        }

        // Check if already starred
        const existingStar = await prisma.strategyStar.findUnique({
            where: {
                strategyId_userId: {
                    strategyId: id,
                    userId: session.user.id
                }
            }
        })

        if (existingStar) {
            // Unstar
            await prisma.strategyStar.delete({
                where: { id: existingStar.id }
            })

            // Decrement star count
            await prisma.strategy.update({
                where: { id },
                data: { stars: { decrement: 1 } }
            })

            return NextResponse.json({
                success: true,
                starred: false,
                message: 'Strategy unstarred'
            })
        } else {
            // Star
            await prisma.strategyStar.create({
                data: {
                    strategyId: id,
                    userId: session.user.id
                }
            })

            // Increment star count
            await prisma.strategy.update({
                where: { id },
                data: { stars: { increment: 1 } }
            })

            return NextResponse.json({
                success: true,
                starred: true,
                message: 'Strategy starred'
            })
        }
    } catch (error) {
        console.error('Error toggling star:', error)
        return NextResponse.json(
            { success: false, error: 'Failed to toggle star' },
            { status: 500 }
        )
    }
}

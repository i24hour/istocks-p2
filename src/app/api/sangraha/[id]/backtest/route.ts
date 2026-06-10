import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession } from '@/lib/auth'
import { backtestService } from '@/services/backtest.service'

// GET /api/sangraha/[id]/backtest - List backtests for a strategy
export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const { id } = params

        const backtests = await prisma.backtest.findMany({
            where: { strategyId: id },
            orderBy: { createdAt: 'desc' },
            include: {
                user: { select: { name: true, image: true } }
            }
        })

        return NextResponse.json({
            success: true,
            data: backtests
        })
    } catch (error) {
        console.error('Error fetching backtests:', error)
        return NextResponse.json(
            { success: false, error: 'Failed to fetch backtests' },
            { status: 500 }
        )
    }
}

// POST /api/sangraha/[id]/backtest - Run a new backtest
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
        const body = await request.json()
        const { stockSymbol, startDate, endDate } = body

        // Validation
        if (!stockSymbol || !startDate || !endDate) {
            return NextResponse.json(
                { success: false, error: 'stockSymbol, startDate, and endDate are required' },
                { status: 400 }
            )
        }

        // Get strategy
        const strategy = await prisma.strategy.findUnique({
            where: { id }
        })

        if (!strategy) {
            return NextResponse.json(
                { success: false, error: 'Strategy not found' },
                { status: 404 }
            )
        }

        // Check access
        if (strategy.visibility === 'private' && strategy.authorId !== session.user.id) {
            return NextResponse.json(
                { success: false, error: 'Not authorized' },
                { status: 403 }
            )
        }

        // Create backtest record (pending)
        const backtest = await prisma.backtest.create({
            data: {
                strategyId: id,
                userId: session.user.id,
                stockSymbol: stockSymbol.toUpperCase(),
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                status: 'running'
            }
        })

        // Run backtest
        try {
            const result = await backtestService.runBacktest(
                strategy.strategyCode as any,
                stockSymbol,
                new Date(startDate),
                new Date(endDate)
            )

            // Update backtest with results
            const updatedBacktest = await prisma.backtest.update({
                where: { id: backtest.id },
                data: {
                    totalTrades: result.totalTrades,
                    winningTrades: result.winningTrades,
                    losingTrades: result.losingTrades,
                    winRate: result.winRate,
                    totalPnL: result.totalPnL,
                    maxDrawdown: result.maxDrawdown,
                    avgTradeReturn: result.avgTradeReturn,
                    sharpeRatio: result.sharpeRatio,
                    tradeLog: result.tradeLog as any,
                    equityCurve: result.equityCurve as any,
                    status: 'completed',
                    completedAt: new Date()
                }
            })

            return NextResponse.json({
                success: true,
                data: updatedBacktest
            })
        } catch (backtestError: any) {
            // Mark backtest as failed
            await prisma.backtest.update({
                where: { id: backtest.id },
                data: {
                    status: 'failed',
                    errorMessage: backtestError.message
                }
            })

            return NextResponse.json(
                { success: false, error: backtestError.message },
                { status: 400 }
            )
        }
    } catch (error) {
        console.error('Error running backtest:', error)
        return NextResponse.json(
            { success: false, error: 'Failed to run backtest' },
            { status: 500 }
        )
    }
}

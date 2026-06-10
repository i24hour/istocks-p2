import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession } from '@/lib/auth'
import { resolveSessionListTitle, sanitizeSessionTitleOnCreate } from '@/lib/chat-session-title'

// GET /api/chat/sessions - List all sessions for a stock
export async function GET(request: NextRequest) {
    try {
        const authSession = await getAuthSession()
        if (!authSession?.user?.id) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const searchParams = request.nextUrl.searchParams
        const stockSymbol = searchParams.get('stock')

        // Build where clause — if stock is provided, filter by it; otherwise load ALL user sessions
        let whereClause: any = { userId: authSession.user.id }

        if (stockSymbol) {
            const stock = await prisma.stock.findUnique({
                where: { symbol: stockSymbol.toUpperCase() },
            })

            if (!stock) {
                return NextResponse.json(
                    { success: false, error: 'Stock not found' },
                    { status: 404 }
                )
            }
            whereClause.stockId = stock.id
        }

        // Get sessions ordered by most recent
        const sessions = await prisma.chatSession.findMany({
            where: whereClause,
            orderBy: { updatedAt: 'desc' },
            include: {
                messages: {
                    where: { role: 'user' },
                    orderBy: { createdAt: 'asc' },
                    take: 1,
                },
                _count: {
                    select: { messages: true },
                },
            },
        })

        return NextResponse.json({
            success: true,
            data: (sessions as any[]).map((s) => ({
                id: s.id,
                title: resolveSessionListTitle(
                    s.title,
                    s.messages?.[0]?.content,
                    s._count?.messages ?? 0,
                ),
                messageCount: s._count?.messages ?? 0,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
            })),
        })
    } catch (error: any) {
        console.error('Error fetching chat sessions:', error)
        return NextResponse.json(
            { success: false, error: 'Failed to fetch sessions' },
            { status: 500 }
        )
    }
}

// POST /api/chat/sessions - Create a new session
export async function POST(request: NextRequest) {
    try {
        const authSession = await getAuthSession()
        if (!authSession?.user?.id) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { stockSymbol, title } = body

        if (!stockSymbol) {
            return NextResponse.json(
                { success: false, error: 'Stock symbol is required' },
                { status: 400 }
            )
        }

        // Find the stock
        const stock = await prisma.stock.findUnique({
            where: { symbol: stockSymbol.toUpperCase() },
        })

        if (!stock) {
            return NextResponse.json(
                { success: false, error: 'Stock not found' },
                { status: 404 }
            )
        }

        // Create new session
        const createdSession = await prisma.chatSession.create({
            data: {
                stockId: stock.id,
                userId: authSession.user.id,
                title: sanitizeSessionTitleOnCreate(title),
            },
        })

        return NextResponse.json({
            success: true,
            data: {
                id: createdSession.id,
                stockId: createdSession.stockId,
                title: createdSession.title,
                createdAt: createdSession.createdAt,
            },
        })
    } catch (error: any) {
        console.error('Error creating chat session:', error)
        return NextResponse.json(
            { success: false, error: 'Failed to create session' },
            { status: 500 }
        )
    }
}

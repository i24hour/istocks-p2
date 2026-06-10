import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession } from '@/lib/auth'

// DELETE /api/chat/sessions/[sessionId] - Delete a session and all its messages
export async function DELETE(
    request: NextRequest,
    { params }: { params: { sessionId: string } }
) {
    try {
        const authSession = await getAuthSession()
        if (!authSession?.user?.id) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const { sessionId } = params

        // Delete session (messages cascade delete automatically)
        await prisma.chatSession.delete({
            where: { id: sessionId, userId: authSession.user.id } as any,
        })

        return NextResponse.json({
            success: true,
            message: 'Session deleted successfully',
        })
    } catch (error: any) {
        console.error('Error deleting session:', error)

        if (error.code === 'P2025') {
            return NextResponse.json(
                { success: false, error: 'Session not found' },
                { status: 404 }
            )
        }

        return NextResponse.json(
            { success: false, error: 'Failed to delete session' },
            { status: 500 }
        )
    }
}

// GET /api/chat/sessions/[sessionId] - Get session details
export async function GET(
    request: NextRequest,
    { params }: { params: { sessionId: string } }
) {
    try {
        const authSession = await getAuthSession()
        if (!authSession?.user?.id) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const { sessionId } = params

        const session = await prisma.chatSession.findFirst({
            where: { id: sessionId, userId: authSession.user.id } as any,
            include: {
                stock: {
                    select: { symbol: true, name: true },
                },
                _count: {
                    select: { messages: true },
                },
            },
        })

        if (!session) {
            return NextResponse.json(
                { success: false, error: 'Session not found' },
                { status: 404 }
            )
        }

        return NextResponse.json({
            success: true,
            data: {
                id: session.id,
                title: session.title,
                stock: session.stock,
                messageCount: session._count.messages,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
            },
        })
    } catch (error: any) {
        console.error('Error fetching session:', error)
        return NextResponse.json(
            { success: false, error: 'Failed to fetch session' },
            { status: 500 }
        )
    }
}

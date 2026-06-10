import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession } from '@/lib/auth'
import {
    deriveSessionTitleFromUserContent,
    isPlaceholderSessionTitle,
} from '@/lib/chat-session-title'

// GET /api/chat/sessions/[sessionId]/messages - Get all messages for a session
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

        const messages = await prisma.chatMessage.findMany({
            where: { sessionId, session: { userId: authSession.user.id } as any },
            orderBy: { createdAt: 'asc' },
            include: {
                session: {
                    select: {
                        user: {
                            select: {
                                email: true,
                            },
                        },
                    },
                },
            },
        })

        return NextResponse.json({
            success: true,
            data: messages.map(({ session, ...message }) => ({
                ...message,
                userEmail: session?.user?.email ?? null,
            })),
        })
    } catch (error: any) {
        console.error('Error fetching messages:', error)
        return NextResponse.json(
            { success: false, error: 'Failed to fetch messages' },
            { status: 500 }
        )
    }
}

// POST /api/chat/sessions/[sessionId]/messages - Add a message to session
export async function POST(
    request: NextRequest,
    { params }: { params: { sessionId: string } }
) {
    try {
        const authSession = await getAuthSession()
        if (!authSession?.user?.id) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const { sessionId } = params
        const body = await request.json()
        const { role, content, sql } = body

        if (!role || !content) {
            return NextResponse.json(
                { success: false, error: 'Role and content are required' },
                { status: 400 }
            )
        }

        // Verify session exists
        const session = await prisma.chatSession.findFirst({
            where: { id: sessionId, userId: authSession.user.id } as any,
        })

        if (!session) {
            return NextResponse.json(
                { success: false, error: 'Session not found' },
                { status: 404 }
            )
        }

        // Create message
        const message = await prisma.chatMessage.create({
            data: {
                sessionId,
                role,
                content,
                sql: sql || null,
            },
        })

        const sessionUpdate: { updatedAt: Date; title?: string } = { updatedAt: new Date() }

        // Keep session title in sync with the first real user message (fixes sidebar "New Chat" ghosts)
        if (role === 'user') {
            const derivedTitle = deriveSessionTitleFromUserContent(content)
            if (derivedTitle && isPlaceholderSessionTitle(session.title)) {
                const userMessageCount = await prisma.chatMessage.count({
                    where: { sessionId, role: 'user' },
                })
                if (userMessageCount === 1) {
                    sessionUpdate.title = derivedTitle
                } else {
                    const firstUser = await prisma.chatMessage.findFirst({
                        where: { sessionId, role: 'user' },
                        orderBy: { createdAt: 'asc' },
                        select: { content: true },
                    })
                    const firstTitle = deriveSessionTitleFromUserContent(firstUser?.content ?? '')
                    if (firstTitle) sessionUpdate.title = firstTitle
                }
            }
        }

        await prisma.chatSession.update({
            where: { id: sessionId },
            data: sessionUpdate,
        })

        return NextResponse.json({
            success: true,
            data: message,
        })
    } catch (error: any) {
        console.error('Error creating message:', error)
        return NextResponse.json(
            { success: false, error: 'Failed to create message' },
            { status: 500 }
        )
    }
}

// PATCH /api/chat/sessions/[sessionId]/messages - Update a message in session
export async function PATCH(
    request: NextRequest,
    { params }: { params: { sessionId: string } }
) {
    try {
        const authSession = await getAuthSession()
        if (!authSession?.user?.id) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const { sessionId } = params
        const body = await request.json()
        const { messageId, content, role } = body

        if (!messageId || !content) {
            return NextResponse.json(
                { success: false, error: 'Message ID and content are required' },
                { status: 400 }
            )
        }

        const existingMessage = await prisma.chatMessage.findFirst({
            where: {
                id: messageId,
                sessionId,
                session: { userId: authSession.user.id } as any,
            },
        })

        if (!existingMessage) {
            return NextResponse.json(
                { success: false, error: 'Message not found' },
                { status: 404 }
            )
        }

        const updatedMessage = await prisma.chatMessage.update({
            where: { id: existingMessage.id },
            data: {
                content,
                role: role || existingMessage.role,
            },
        })

        await prisma.chatSession.update({
            where: { id: sessionId },
            data: { updatedAt: new Date() },
        })

        return NextResponse.json({
            success: true,
            data: updatedMessage,
        })
    } catch (error: any) {
        console.error('Error updating message:', error)
        return NextResponse.json(
            { success: false, error: 'Failed to update message' },
            { status: 500 }
        )
    }
}

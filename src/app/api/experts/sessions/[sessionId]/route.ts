export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/experts/sessions/[sessionId] — fetch session + all analyses
export async function GET(
    _request: NextRequest,
    { params }: { params: { sessionId: string } }
) {
    const { sessionId } = params
    const session = await prisma.expertsSession.findUnique({
        where: { id: sessionId },
        include: {
            analyses: {
                orderBy: { createdAt: 'desc' },
            },
        },
    })

    if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    return NextResponse.json({ session })
}

// DELETE /api/experts/sessions/[sessionId] — delete a session
export async function DELETE(
    _request: NextRequest,
    { params }: { params: { sessionId: string } }
) {
    const { sessionId } = params
    await prisma.expertsSession.delete({ where: { id: sessionId } })
    return NextResponse.json({ success: true })
}

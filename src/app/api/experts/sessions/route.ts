export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getAuthSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/experts/sessions — list sessions for the current user
export async function GET() {
    const session = await getAuthSession()
    const userId = session?.user?.id || null

    const sessions = await prisma.expertsSession.findMany({
        where: userId ? { userId } : { userId: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
            analyses: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { finalProbability: true, finalConfidence: true, createdAt: true },
            },
        },
    })

    return NextResponse.json({ sessions })
}

// POST /api/experts/sessions — create a new session
export async function POST(request: NextRequest) {
    const session = await getAuthSession()
    const userId = session?.user?.id || null
    const { query } = await request.json()

    if (!query?.trim()) {
        return NextResponse.json({ error: 'Query required' }, { status: 400 })
    }

    const title = query.length > 80 ? query.slice(0, 77) + '...' : query
    const created = await prisma.expertsSession.create({
        data: { query: query.trim(), title, userId },
    })

    return NextResponse.json({ session: created })
}

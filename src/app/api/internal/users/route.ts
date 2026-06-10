import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireInternalSession } from '@/lib/internal-auth'

export const runtime = 'nodejs'

const LIMIT = 200

export async function GET() {
    const { error } = await requireInternalSession()
    if (error) return error

    const users = await prisma.user.findMany({
        select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
            dailyPromptCount: true,
            promptCount: true,
            subscriptions: {
                where: {
                    status: 'ACTIVE',
                    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { plan: true },
            },
        },
        orderBy: { createdAt: 'desc' },
        take: LIMIT,
    })

    return NextResponse.json({
        users: users.map((user) => ({
            id: user.id,
            name: user.name,
            email: user.email,
            plan: user.subscriptions[0]?.plan ?? 'free',
            createdAt: user.createdAt.toISOString(),
            dailyPromptCount: user.dailyPromptCount,
            lifetimePromptCount: user.promptCount,
        })),
        limit: LIMIT,
    })
}

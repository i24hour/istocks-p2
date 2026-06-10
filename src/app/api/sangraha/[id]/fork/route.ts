import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession } from '@/lib/auth'

// POST /api/sangraha/[id]/fork - Fork a strategy
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

        // Get original strategy
        const original = await prisma.strategy.findUnique({
            where: { id },
            include: {
                author: { select: { name: true } }
            }
        })

        if (!original) {
            return NextResponse.json(
                { success: false, error: 'Strategy not found' },
                { status: 404 }
            )
        }

        // Check if public or owned by user
        if (original.visibility === 'private' && original.authorId !== session.user.id) {
            return NextResponse.json(
                { success: false, error: 'Cannot fork private strategy' },
                { status: 403 }
            )
        }

        // Create forked strategy
        const forked = await prisma.strategy.create({
            data: {
                name: `${original.name} (Fork)`,
                description: original.description,
                readme: `# ${original.name} (Fork)

> Forked from [${original.name}](${original.id}) by ${original.author.name}

${original.readme}
`,
                naturalInput: original.naturalInput,
                strategyCode: original.strategyCode as any,
                sqlQuery: original.sqlQuery,
                stockSymbol: original.stockSymbol,
                strategyType: original.strategyType,
                tags: original.tags,
                visibility: 'private', // Forks start as private
                forkedFromId: original.id,
                authorId: session.user.id
            }
        })

        // Increment fork count on original
        await prisma.strategy.update({
            where: { id },
            data: { forks: { increment: 1 } }
        })

        return NextResponse.json({
            success: true,
            data: forked,
            message: 'Strategy forked successfully'
        })
    } catch (error) {
        console.error('Error forking strategy:', error)
        return NextResponse.json(
            { success: false, error: 'Failed to fork strategy' },
            { status: 500 }
        )
    }
}
